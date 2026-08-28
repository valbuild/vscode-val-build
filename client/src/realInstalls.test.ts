import { spawn } from "node:child_process";
import { createRequire } from "node:module";
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
 * fast and hermetic. This is the other half: four projects under
 * `fixtures/`, each installed by a different package manager from a
 * committed lockfile, because the thing being tested is how those managers
 * actually lay a tree out. `npm run install-fixtures` recreates them.
 *
 * The pnpm fixture is the one that earns its keep. `@valbuild/language-server` is
 * a transitive dependency, so under pnpm's isolated `node_modules` it is not
 * reachable from the project root at all — a naive
 * `require.resolve(name, { paths: [valRoot] })` passes under npm and yarn and
 * fails there.
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

const missing = ["npm", "pnpm", "yarn", "old-val"].filter((n) => !fixture(n));
if (missing.length > 0) {
  console.warn(
    `Skipping real-install tests; run \`npm run install-fixtures\` (missing: ${missing.join(", ")})`,
  );
}
const withFixtures = missing.length === 0 ? describe : describe.skip;

withFixtures("resolution against real installs", () => {
  for (const manager of ["npm", "pnpm", "yarn"] as const) {
    describe(manager, () => {
      const valRoot = () => path.join(fixtures, manager);

      test("resolves a launchable server entry", () => {
        const resolved = resolveLanguageServer(valRoot());
        expect(resolved).not.toBeNull();
        expect(resolved!.version).toMatch(/^0\.98\./);
        expect(resolved!.override).toBeNull();
        expect(fs.existsSync(resolved!.entry)).toBe(true);
        expect(path.basename(resolved!.entry)).toBe("bin.js");
      });

      test("reads the Val version off a carrier package, not off core", () => {
        // @valbuild/next@0.98.0 depends on @valbuild/core@0.97.7, so reading the
        // version off core would report an up-to-date project as behind.
        const detected = detectValVersion(valRoot());
        expect(detected).not.toBeNull();
        expect(detected!.packageName).toBe("@valbuild/next");
        expect(detected!.carriesLanguageServer).toBe(true);
        expect(detected!.version).toMatch(/^0\.98\./);
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
    const pnpmRoot = path.join(fixtures, "pnpm");
    expect(
      fs.existsSync(
        path.join(pnpmRoot, "node_modules", "@valbuild", "language-server"),
      ),
    ).toBe(false);
    expect(() =>
      createRequire(path.join(pnpmRoot, "package.json")).resolve(
        "@valbuild/language-server/package.json",
      ),
    ).toThrow();

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
      return { capabilities: result.capabilities.experimental?.val, stderr };
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

  for (const manager of ["npm", "pnpm", "yarn"] as const) {
    test(`negotiates protocol v1 and advertises features (${manager})`, async () => {
      const { capabilities, stderr } = await handshake(
        path.join(fixtures, manager),
      );
      expect(capabilities).toBeDefined();
      // Check `incompatible` first: absent capabilities prove nothing, because
      // vscode-languageserver injects `textDocumentSync` on its own.
      expect(capabilities!.incompatible).toBeUndefined();
      expect(capabilities!.protocolVersion).toBe(1);
      expect(capabilities!.features).toContain("diagnostics");
      expect(capabilities!.valRoot).toBe(path.join(fixtures, manager));
      expect(capabilities!.versions.languageServer).toMatch(/^0\.98\./);
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
    const { capabilities } = await handshake(path.join(fixtures, "npm"), {
      min: 99,
      max: 99,
    });
    expect(capabilities!.versions.languageServer).toMatch(/^0\.98\./);
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
