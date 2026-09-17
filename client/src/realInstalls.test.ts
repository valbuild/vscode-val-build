import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as fs from "fs";
import * as path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { diagnoseLanguageServer } from "./languageServerDiagnosis";
import { detectPackageManager } from "./packageManager";
import { resolveLanguageServer } from "./resolveLanguageServer";
import { CLIENT_PROTOCOL_VERSIONS, negotiateProtocolVersion } from "./valProtocol";
import type { ValInitializationOptions, ValServerCapabilities } from "./valProtocol";
import { detectValVersion, MIN_VAL_VERSION } from "./valVersion";

/**
 * Resolution and the handshake, against **real installs** of a published Val.
 *
 * `resolveLanguageServer.test.ts` builds `node_modules` trees by hand, which is
 * fast and hermetic. This is the other half: five projects under `fixtures/`,
 * each a real install from a committed lockfile, because the thing being tested
 * is how a package manager actually lays a tree out. `npm run install-fixtures`
 * recreates them.
 *
 * **Regenerate a pnpm fixture's lockfile with the pnpm CI uses**, which is why
 * `fixtures/tanstack` pins `packageManager`. pnpm 12 enforces a
 * `minimumReleaseAge` supply-chain policy and resolves *around* it, picking the
 * newest version old enough to pass; pnpm 10 has no such policy and takes the
 * newest full stop. A lockfile written by the older one is rejected outright by
 * `--frozen-lockfile` on the newer — and TanStack publishes several times a day,
 * so this fixture is the one where that difference is never theoretical.
 *
 * The pnpm fixture is the one that earns its keep. `@valbuild/language-server` is
 * a transitive dependency, so under pnpm's isolated `node_modules` it is not
 * reachable from the project root at all — a naive
 * `require.resolve(name, { paths: [valRoot] })` passes under npm and yarn and
 * fails there.
 *
 * The `tanstack` fixture is the second: everything above is `@valbuild/next`,
 * and nothing here is supposed to be about Next.js. The language server ships
 * inside whichever package a project depends on directly — `@valbuild/next` for
 * Next.js, `@valbuild/tanstack` for TanStack Start — and the anchor walk is
 * written to take that from the project's own `package.json` rather than from a
 * list baked into this extension. A fixture on a *different* framework package,
 * installed with pnpm so the anchor walk is load-bearing, is what holds that
 * claim up.
 *
 * Skipped rather than failed when a fixture has not been installed, so a
 * checkout without `install-fixtures` still has a green suite.
 */

/**
 * Top-level rather than under `client/`, deliberately.
 *
 * Node resolution walks *up*, so a fixture nested inside `client/` would find
 * `client/node_modules/@valbuild/language-server` — the devDependency this
 * extension takes for the protocol types. The `old-val` fixture would then
 * "resolve" a server it does not have, and the very case these fixtures exist to
 * cover would silently pass. The repository root has no `@valbuild/*` at all,
 * which is what makes it a safe parent.
 */
const fixtures = path.resolve(__dirname, "..", "..", "fixtures");

function fixture(name: string): string | null {
  const dir = path.join(fixtures, name);
  return fs.existsSync(path.join(dir, "node_modules")) ? dir : null;
}

const missing = ["npm", "pnpm", "yarn", "old-val", "tanstack"].filter(
  (n) => !fixture(n),
);
if (missing.length > 0) {
  console.warn(
    `Skipping real-install tests; run \`npm run install-fixtures\` (missing: ${missing.join(", ")})`,
  );
}
const withFixtures = missing.length === 0 ? describe : describe.skip;

/**
 * The Val a fixture is really installed at, read from its own `node_modules`.
 *
 * Read rather than written down, because the fixtures are deliberately not all
 * on the same Val: `npm` tracks a current one (the integration suite needs a
 * server that announces `workspace/executeCommand` names — a Val too old to do
 * that hid the collision that broke 1.1.0), while `pnpm` and `yarn` stay on
 * 0.98, since they exist for their `node_modules` layout and an
 * older-but-supported Val is worth keeping under test. A version literal here
 * would fail the next time either is bumped, for no reason a reader could act
 * on.
 */
function installedValVersion(
  valRoot: string,
  packageName = "@valbuild/next",
): string {
  const manifest = path.join(
    valRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
}

const SEMVER = /^\d+\.\d+\.\d+/;

withFixtures("resolution against real installs", () => {
  for (const manager of ["npm", "pnpm", "yarn"] as const) {
    describe(manager, () => {
      const valRoot = () => path.join(fixtures, manager);

      test("resolves a launchable server entry", () => {
        const resolved = resolveLanguageServer(valRoot());
        expect(resolved).not.toBeNull();
        expect(resolved!.version).toMatch(SEMVER);
        expect(resolved!.override).toBeNull();
        expect(fs.existsSync(resolved!.entry)).toBe(true);
        expect(path.basename(resolved!.entry)).toBe("bin.js");
        // Inside the fixture, not `client/node_modules`: this extension keeps a
        // copy of the same package as a devDependency for its types, and
        // resolving that one would make these fixtures prove nothing. The path
        // is what tells them apart — the two versions can be, and often are,
        // identical.
        expect(resolved!.entry.startsWith(valRoot() + path.sep)).toBe(true);
      });

      test("reads the Val version off a carrier package, not off core", () => {
        // @valbuild/next@0.98.0 depends on @valbuild/core@0.97.7, so reading the
        // version off core would report an up-to-date project as behind. The
        // pnpm and yarn fixtures are still on that pair, which is what gives
        // this assertion teeth — Val has since moved to lockstep versions, where
        // reading the wrong package looks right.
        const detected = detectValVersion(valRoot());
        expect(detected).not.toBeNull();
        expect(detected!.packageName).toBe("@valbuild/next");
        expect(detected!.carriesLanguageServer).toBe(true);
        expect(detected!.version).toBe(installedValVersion(valRoot()));
      });

      test("is diagnosed as ok", () => {
        expect(
          diagnoseLanguageServer({
            resolved: resolveLanguageServer(valRoot()),
            detected: detectValVersion(valRoot()),
            packageManager: detectPackageManager(valRoot()),
          }).kind,
        ).toBe("ok");
      });

      test("the package manager is detected from the lockfile", () => {
        expect(detectPackageManager(valRoot())).toBe(manager);
      });
    });
  }

  test("pnpm needs the anchor walk: root-only resolution genuinely fails there", () => {
    // The reason resolveLanguageServer goes *through* @valbuild/next instead of
    // straight from the project root. Pinned so nobody simplifies it away.
    //
    // The absent directory is the assertion: under pnpm's isolated layout the
    // project's node_modules holds only its direct dependencies, so root-only
    // resolution has nowhere to look. Expecting `createRequire(...).resolve()`
    // to throw would say the same thing less reliably — Node appends its global
    // folders ($NODE_PATH, ~/.node_modules) to every bare specifier, so on a
    // machine that has one it does not throw at all.
    const pnpmRoot = path.join(fixtures, "pnpm");
    expect(
      fs.existsSync(
        path.join(pnpmRoot, "node_modules", "@valbuild", "language-server"),
      ),
    ).toBe(false);

    const resolved = resolveLanguageServer(pnpmRoot);
    expect(resolved).not.toBeNull();
    expect(resolved!.via).toBe("@valbuild/next");
  });

  test("npm and yarn hoist it, so the root resolves it directly", () => {
    for (const manager of ["npm", "yarn"]) {
      const resolved = resolveLanguageServer(path.join(fixtures, manager));
      expect(resolved!.via).toBe("direct dependency");
    }
  });

  describe("a framework package that is not @valbuild/next", () => {
    // The whole reason this fixture exists. Everything above resolves through
    // @valbuild/next, which is exactly the coupling the anchor walk was written
    // to remove: the language server ships inside whichever package a project
    // depends on directly, and a project on TanStack Start depends on
    // @valbuild/tanstack and has never heard of @valbuild/next.
    //
    // Installed with pnpm on purpose: under npm's hoisting the project root
    // resolves the server directly, so nothing about the anchors would be
    // exercised at all. pnpm's isolated layout is the one where a server has to
    // be reached through a package the project declares.
    const valRoot = () => path.join(fixtures, "tanstack");

    test("@valbuild/tanstack is what puts a language server in the tree", () => {
      // The claim everything below rests on, asserted against the manifest npm
      // actually served rather than against Val's repository: the fixture
      // declares @valbuild/core and @valbuild/tanstack and nothing else, and
      // core cannot carry the server — the server depends on it. So if this
      // dependency ever goes away, a TanStack project has no language server and
      // the extension has nothing to launch.
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(
            valRoot(),
            "node_modules",
            "@valbuild",
            "tanstack",
            "package.json",
          ),
          "utf8",
        ),
      );
      expect(Object.keys(manifest.dependencies ?? {})).toContain(
        "@valbuild/language-server",
      );
    });

    test("resolves a launchable server entry, through an anchor rather than the root", () => {
      // The absent directory is half the assertion: @valbuild/language-server is
      // a transitive dependency, so under pnpm it is not at the project root at
      // all and root-only resolution has nowhere to look.
      expect(
        fs.existsSync(
          path.join(valRoot(), "node_modules", "@valbuild", "language-server"),
        ),
      ).toBe(false);

      const resolved = resolveLanguageServer(valRoot());
      expect(resolved).not.toBeNull();
      // Not "direct dependency": the walk went through a package the project
      // declares. Which one is not worth asserting — pnpm links every package in
      // the tree into `.pnpm/node_modules`, so the walk reaches the server from
      // any anchor and `via` just names the first one tried. What the anchors
      // are is what matters, and they are read from this project's package.json,
      // which has never heard of @valbuild/next.
      expect(resolved!.via).not.toBe("direct dependency");
      expect(resolved!.version).toMatch(SEMVER);
      expect(resolved!.override).toBeNull();
      expect(fs.existsSync(resolved!.entry)).toBe(true);
      expect(path.basename(resolved!.entry)).toBe("bin.js");
      expect(resolved!.entry.startsWith(valRoot() + path.sep)).toBe(true);
    });

    test("the Val version is read off @valbuild/tanstack", () => {
      // Not off @valbuild/core, which this fixture also declares directly and
      // which comes first in its package.json. A carrier package wins over a
      // library one, and that is what makes the "upgrade Val" message name the
      // package the user can actually act on.
      const detected = detectValVersion(valRoot());
      expect(detected).not.toBeNull();
      expect(detected!.packageName).toBe("@valbuild/tanstack");
      expect(detected!.carriesLanguageServer).toBe(true);
      expect(detected!.version).toBe(
        installedValVersion(valRoot(), "@valbuild/tanstack"),
      );
      // No floor is claimed for a package this build has no release history
      // for, and inventing one would point the user at a version that may not
      // exist.
      expect(detected!.shipsSince).toBeNull();
    });

    test("is diagnosed as ok", () => {
      expect(
        diagnoseLanguageServer({
          resolved: resolveLanguageServer(valRoot()),
          detected: detectValVersion(valRoot()),
          packageManager: detectPackageManager(valRoot()),
        }).kind,
      ).toBe("ok");
    });

    test("the package manager is detected from the lockfile", () => {
      expect(detectPackageManager(valRoot())).toBe("pnpm");
    });
  });

  describe("a Val older than the language server", () => {
    const valRoot = () => path.join(fixtures, "old-val");

    test("does not resolve", () => {
      expect(resolveLanguageServer(valRoot())).toBeNull();
    });

    test("is reported as needing a Val upgrade, not as not found", () => {
      const result = diagnoseLanguageServer({
        resolved: resolveLanguageServer(valRoot()),
        detected: detectValVersion(valRoot()),
        packageManager: detectPackageManager(valRoot()),
      });
      expect(result.kind).toBe("problem");
      if (result.kind !== "problem") {
        return;
      }
      expect(result.reason).toBe("val-too-old");
      expect(result.message).toContain(MIN_VAL_VERSION);
      expect(result.message).toContain("0.97.7");
      expect(result.actions[0].value).toBe(
        "npm install @valbuild/next@latest",
      );
    });
  });
});

withFixtures("the handshake against a real server", () => {
  // Run as a child process over stdio, never in-process: under `--stdio` the
  // server replaces the global `console`, and `vscode-languageserver` registers
  // `end`/`close` handlers on its input that call `process.exit()` — ending a
  // stream in teardown would kill the jest worker and hang the run rather than
  // failing it.
  async function handshake(
    valRoot: string,
    clientRange = CLIENT_PROTOCOL_VERSIONS,
  ): Promise<{
    capabilities: ValServerCapabilities | undefined;
    stderr: string;
    /** What resolution read off disk, to check the wire against. */
    resolvedVersion: string | null;
  }> {
    const resolved = resolveLanguageServer(valRoot);
    if (!resolved) {
      throw new Error(`no language server resolved for ${valRoot}`);
    }
    const child = spawn(process.execPath, [resolved.entry, "--stdio"], {
      cwd: valRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    connection.onUnhandledNotification(() => {}); // it logs via window/logMessage
    connection.listen();

    const initializationOptions: ValInitializationOptions = {
      client: { name: "vscode-val-build", version: "1.0.23" },
      supportedProtocolVersions: clientRange,
      valRoot,
    };
    try {
      const result: {
        capabilities: { experimental?: { val?: ValServerCapabilities } };
      } = await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: { experimental: { val: { pick: true, input: true } } },
        initializationOptions,
      });
      return {
        capabilities: result.capabilities.experimental?.val,
        stderr,
        resolvedVersion: resolved.version,
      };
    } finally {
      // Never end/destroy the streams, and never send `exit`.
      connection.dispose();
      child.kill();
    }
  }

  // Spawning a real server and evaluating a project takes seconds, not the
  // default 5. Set at block scope: `@types/jest` 30 no longer accepts a
  // per-test timeout argument.
  jest.setTimeout(60000);

  // `tanstack` is in the list for the same reason it has a fixture at all: the
  // handshake is the point at which a server that was resolved through the wrong
  // package, or not resolved at all, stops being a resolution detail and becomes
  // "no Val features in this editor".
  for (const fixtureName of ["npm", "pnpm", "yarn", "tanstack"] as const) {
    test(`negotiates protocol v1 and advertises features (${fixtureName})`, async () => {
      const { capabilities, stderr, resolvedVersion } = await handshake(
        path.join(fixtures, fixtureName),
      );
      expect(capabilities).toBeDefined();
      // Check `incompatible` first: absent capabilities prove nothing, because
      // vscode-languageserver injects `textDocumentSync` on its own.
      expect(capabilities!.incompatible).toBeUndefined();
      expect(capabilities!.protocolVersion).toBe(1);
      expect(capabilities!.features).toContain("diagnostics");
      expect(capabilities!.valRoot).toBe(path.join(fixtures, fixtureName));
      // What the server says over the wire is what resolution read off disk —
      // the assertion a version literal was standing in for, and the one that
      // survives a fixture bump.
      expect(capabilities!.versions.languageServer).toBe(resolvedVersion);
      // Editors treat stderr noise from a language server as a startup failure.
      expect(stderr).toBe("");
    });
  }

  test("a client from the future is told the server is too old", async () => {
    // Manual check 6 from the migration plan, automated: pretend to be a client
    // that only speaks protocol v99 and confirm the real server answers with a
    // *directional* verdict. This is what makes the difference between "update
    // Val in this project" and a generic "incompatible versions" dead end.
    const { capabilities } = await handshake(path.join(fixtures, "npm"), {
      min: 99,
      max: 99,
    });
    expect(capabilities).toBeDefined();
    expect(capabilities!.incompatible).toBeDefined();
    expect(capabilities!.incompatible!.status).toBe("server-too-old");
    // Both ranges come back, so the message can name them.
    expect(capabilities!.incompatible!.client).toEqual({ min: 99, max: 99 });
    expect(capabilities!.incompatible!.server.max).toBe(1);
    // Nothing is advertised when negotiation failed, so a client that ignored
    // `incompatible` would still offer no features.
    expect(capabilities!.features).toEqual([]);
    expect(capabilities!.commands).toEqual([]);
  });

  test("a mismatched handshake still returns a usable payload", async () => {
    // The client has to be able to name versions in the message it shows, so the
    // server must fill these in even when it is refusing to serve.
    const { capabilities, resolvedVersion } = await handshake(
      path.join(fixtures, "npm"),
      { min: 99, max: 99 },
    );
    expect(capabilities!.versions.languageServer).toBe(resolvedVersion);
    expect(capabilities!.valRoot).toBe(path.join(fixtures, "npm"));
  });

  test("this client's range is one the published server accepts", async () => {
    const { capabilities } = await handshake(path.join(fixtures, "npm"));
    expect(
      negotiateProtocolVersion(CLIENT_PROTOCOL_VERSIONS, {
        min: capabilities!.protocolVersion,
        max: capabilities!.protocolVersion,
      }).status,
    ).toBe("ok");
  });
});

/**
 * The smoke test for TanStack Start: not "a server was resolved", but "the
 * server this project ships evaluates this project".
 *
 * Resolution and the handshake say the launcher found something and it spoke
 * back. Neither touches a Val module, so neither would notice a server that
 * cannot read a project whose `initVal` comes from `@valbuild/tanstack` — which
 * is what "the extension does not work with TanStack" would actually look like
 * to a user: an editor with no diagnostics in it, and nothing in the log.
 *
 * Driven over the wire rather than through VS Code because it belongs with the
 * other real-install tests and runs in seconds. The integration suite covers the
 * same fixture from inside a real editor.
 */
withFixtures("a TanStack Start project, evaluated by its own server", () => {
  // Spawning a server and evaluating a project from cold, twice over.
  jest.setTimeout(120000);

  /**
   * Open `relativePaths` in the project's own language server and return what it
   * published for each, keyed by the path opened.
   *
   * Push diagnostics, so there is nothing to ask for: the server validates on
   * `didOpen` and sends when it is done — including an empty list, which is the
   * answer this test is mostly looking for.
   */
  async function diagnosticsFor(
    valRoot: string,
    relativePaths: string[],
  ): Promise<Map<string, { message: string }[]>> {
    const resolved = resolveLanguageServer(valRoot);
    if (!resolved) {
      throw new Error(`no language server resolved for ${valRoot}`);
    }
    const child = spawn(process.execPath, [resolved.entry, "--stdio"], {
      cwd: valRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const published = new Map<string, { message: string }[]>();
    // Registered before `listen`, or the first publish is an unhandled
    // notification and is dropped.
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: { uri: string; diagnostics: { message: string }[] }) => {
        const opened = relativePaths.find(
          (relativePath) => params.uri === uriOf(valRoot, relativePath),
        );
        if (opened !== undefined) {
          published.set(opened, params.diagnostics);
        }
      },
    );
    connection.onUnhandledNotification(() => {}); // window/logMessage
    connection.listen();

    const initializationOptions: ValInitializationOptions = {
      client: { name: "vscode-val-build", version: "1.0.23" },
      supportedProtocolVersions: CLIENT_PROTOCOL_VERSIONS,
      valRoot,
    };
    try {
      await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: { experimental: { val: { pick: true, input: true } } },
        initializationOptions,
      });
      connection.sendNotification("initialized", {});
      for (const relativePath of relativePaths) {
        connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: uriOf(valRoot, relativePath),
            languageId: "typescript",
            version: 1,
            text: fs.readFileSync(path.join(valRoot, relativePath), "utf8"),
          },
        });
      }
      const deadline = Date.now() + 90000;
      while (published.size < relativePaths.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return published;
    } finally {
      // As in `handshake`: never end the streams, never send `exit`.
      connection.dispose();
      child.kill();
    }
  }

  /** `file:` URI for a path inside a fixture, the way an editor would send one. */
  function uriOf(valRoot: string, relativePath: string): string {
    return pathToFileURL(path.join(valRoot, relativePath)).href;
  }

  const valRoot = () => path.join(fixtures, "tanstack");

  test("validates a route module typed with s.router(tanstackRouter, …)", async () => {
    // The TanStack-specific half. `src/routes/_site.posts.$postId.val.ts` is a
    // record whose keys are URLs, and the only thing that knows `$postId` is a
    // parameter — and therefore that `/posts/hello-world` is a key this module
    // may have — is the route pattern read out of the *file name*. A server that
    // did not understand TanStack's conventions would report the key as invalid
    // rather than say nothing.
    const published = await diagnosticsFor(valRoot(), [
      "src/routes/_site.posts.$postId.val.ts",
    ]);
    const diagnostics = published.get("src/routes/_site.posts.$postId.val.ts");
    expect(diagnostics).toBeDefined();
    expect(diagnostics!.map((d) => d.message)).toEqual([]);
  });

  test("reports a validation error in a TanStack project's content", async () => {
    // And the other half: silence is only meaningful if this server is capable
    // of speaking. `src/content/errors.val.ts` is a string one character short
    // of its schema — the same module the npm fixture uses, so the two projects
    // are being held to the same standard.
    const published = await diagnosticsFor(valRoot(), [
      "src/content/errors.val.ts",
    ]);
    const diagnostics = published.get("src/content/errors.val.ts");
    expect(diagnostics).toBeDefined();
    expect(diagnostics!.length).toBeGreaterThan(0);
    expect(diagnostics![0].message).toMatch(/at least 30 characters/);
  });
});
