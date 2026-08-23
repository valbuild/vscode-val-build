import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveLanguageServer } from "./resolveLanguageServer";
import {
  detectValVersion,
  isAtLeastVersion,
  isTooOldForLanguageServer,
} from "./valVersion";

/**
 * Resolution is tested against real `node_modules` trees built on disk rather
 * than a mocked `require`, because the thing under test *is* Node's resolution
 * behaviour — in particular that a transitive dependency is unreachable from a
 * pnpm project root. Mocking that away would test nothing.
 *
 * The trees are built here rather than committed as fixtures with lockfiles so
 * the suite is hermetic: no network, no per-package-manager install in CI, and
 * the pnpm layout is reproduced exactly (symlinks into a content-addressed
 * store) instead of approximately.
 */

const LS = "@valbuild/language-server";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "val-ls-resolve-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** A package as Val publishes it: `./package.json` is in the exports map. */
function writePackage(
  dir: string,
  pkg: { name: string; version: string; dependencies?: Record<string, string> },
  options: { bin?: boolean } = {},
): void {
  writeJson(path.join(dir, "package.json"), {
    ...pkg,
    ...(options.bin ? { bin: { "val-language-server": "./bin.js" } } : {}),
    exports: { ".": "./dist/index.js", "./package.json": "./package.json" },
  });
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "index.js"), "module.exports = {};");
  if (options.bin) {
    fs.writeFileSync(path.join(dir, "bin.js"), "require('.').main();");
  }
}

/**
 * npm/yarn: everything the project needs, transitive dependencies included, is
 * flattened into the project's own `node_modules`.
 */
function hoistedProject(root: string, version: string): void {
  writeJson(path.join(root, "package.json"), {
    name: "app",
    dependencies: { "@valbuild/next": `^${version}` },
  });
  writePackage(path.join(root, "node_modules", "@valbuild", "next"), {
    name: "@valbuild/next",
    version,
    dependencies: { [LS]: version },
  });
  writePackage(
    path.join(root, "node_modules", "@valbuild", "language-server"),
    { name: LS, version },
    { bin: true },
  );
}

/**
 * pnpm: the project's `node_modules` holds *only* its direct dependencies, as
 * symlinks into `.pnpm`. A transitive dependency lives beside its dependent
 * inside the store and is reachable only through it.
 */
function isolatedProject(
  root: string,
  version: string,
  anchor = "next",
): void {
  writeJson(path.join(root, "package.json"), {
    name: "app",
    dependencies: { [`@valbuild/${anchor}`]: `^${version}` },
  });
  const store = path.join(root, "node_modules", ".pnpm");
  const nextReal = path.join(
    store,
    `@valbuild+${anchor}@${version}`,
    "node_modules",
    "@valbuild",
    anchor,
  );
  const lsReal = path.join(
    store,
    `@valbuild+language-server@${version}`,
    "node_modules",
    "@valbuild",
    "language-server",
  );
  writePackage(nextReal, {
    name: `@valbuild/${anchor}`,
    version,
    dependencies: { [LS]: version },
  });
  writePackage(lsReal, { name: LS, version }, { bin: true });

  // Only the direct dependency is linked into the project root...
  fs.mkdirSync(path.join(root, "node_modules", "@valbuild"), {
    recursive: true,
  });
  fs.symlinkSync(
    nextReal,
    path.join(root, "node_modules", "@valbuild", anchor),
  );
  // ...while the language server is linked only next to @valbuild/next.
  const nextDeps = path.join(
    store,
    `@valbuild+${anchor}@${version}`,
    "node_modules",
    "@valbuild",
  );
  fs.symlinkSync(lsReal, path.join(nextDeps, "language-server"));
}

/**
 * npm's other layout: on a version conflict the transitive dependency is
 * *nested* under its dependent rather than hoisted, so it is reachable only
 * through the anchor. Also what a hoisted tree looks like from the root's point
 * of view once the root does not carry a copy.
 */
function nestedProject(root: string, anchor: string, version: string): void {
  writeJson(path.join(root, "package.json"), {
    name: "app",
    dependencies: { [`@valbuild/${anchor}`]: `^${version}` },
  });
  const anchorDir = path.join(root, "node_modules", "@valbuild", anchor);
  writePackage(anchorDir, {
    name: `@valbuild/${anchor}`,
    version,
    dependencies: { [LS]: version },
  });
  writePackage(
    path.join(anchorDir, "node_modules", "@valbuild", "language-server"),
    { name: LS, version },
    { bin: true },
  );
}

describe("resolveLanguageServer", () => {
  test("resolves under a hoisted layout", () => {
    hoistedProject(tmp, "0.98.0");
    const resolved = resolveLanguageServer(tmp);
    expect(resolved).not.toBeNull();
    expect(resolved!.version).toBe("0.98.0");
    expect(resolved!.override).toBeNull();
    expect(fs.existsSync(resolved!.entry)).toBe(true);
    expect(path.basename(resolved!.entry)).toBe("bin.js");
    // Hoisting flattens a transitive dependency into the project's own
    // node_modules, so it is indistinguishable from a direct one by resolution.
    // Reported honestly rather than guessed at: the entry is the same either way.
    expect(resolved!.via).toBe("direct dependency");
  });

  test("resolves through @valbuild/next under pnpm's isolated layout", () => {
    // The case that earns its keep. A naive
    // `require.resolve(LS, { paths: [valRoot] })` passes hoisted and fails here.
    isolatedProject(tmp, "0.98.0");
    const resolved = resolveLanguageServer(tmp);
    expect(resolved).not.toBeNull();
    expect(resolved!.via).toBe("@valbuild/next");
    expect(resolved!.version).toBe("0.98.0");
    expect(fs.existsSync(resolved!.entry)).toBe(true);
  });

  test("the naive root-only resolution this replaces really does fail under pnpm", () => {
    // Pins *why* the anchor walk exists, so nobody simplifies it away.
    isolatedProject(tmp, "0.98.0");
    expect(() =>
      require.resolve(`${LS}/package.json`, { paths: [tmp] }),
    ).toThrow();
    expect(resolveLanguageServer(tmp)).not.toBeNull();
  });

  test("resolves through @valbuild/next when the server is nested under it", () => {
    nestedProject(tmp, "next", "0.98.0");
    const resolved = resolveLanguageServer(tmp);
    expect(resolved!.via).toBe("@valbuild/next");
    expect(fs.existsSync(resolved!.entry)).toBe(true);
  });

  test("resolves through @valbuild/cli when @valbuild/next is absent", () => {
    // A CLI-only project: no framework package, so the only route to the server
    // is through @valbuild/cli.
    nestedProject(tmp, "cli", "0.98.0");
    const resolved = resolveLanguageServer(tmp);
    expect(resolved!.via).toBe("@valbuild/cli");
    expect(fs.existsSync(resolved!.entry)).toBe(true);
  });

  test("prefers a direct dependency over an anchor", () => {
    // A project that pins the language server itself gets the version it asked
    // for, not the one @valbuild/next happens to carry.
    hoistedProject(tmp, "0.98.0");
    writeJson(path.join(tmp, "package.json"), {
      name: "app",
      dependencies: { "@valbuild/next": "^0.98.0", [LS]: "0.99.0" },
    });
    writePackage(
      path.join(tmp, "node_modules", "@valbuild", "language-server"),
      { name: LS, version: "0.99.0" },
      { bin: true },
    );
    const resolved = resolveLanguageServer(tmp);
    expect(resolved!.via).toBe("direct dependency");
    expect(resolved!.version).toBe("0.99.0");
  });

  test("resolves through a framework package this build has never heard of", () => {
    // The anchors come from the project's own package.json, not from a list baked
    // into the extension. So a project on a Val framework package released after
    // this extension was built — @valbuild/tanstackstart-react, say — resolves
    // under pnpm without an extension update. A hard-coded [next, cli] list would
    // silently fail here, because under pnpm's isolated node_modules the language
    // server is reachable *only* through the package that depends on it.
    isolatedProject(tmp, "0.98.0", "tanstackstart-react");
    const resolved = resolveLanguageServer(tmp);
    expect(resolved).not.toBeNull();
    expect(resolved!.via).toBe("@valbuild/tanstackstart-react");
    expect(fs.existsSync(resolved!.entry)).toBe(true);
  });

  test("an unknown framework package is treated as one that should carry a server", () => {
    // No known floor for it, so it is never called "too old" — that would be a
    // guess. It is still the package reported and the one the user is pointed at.
    isolatedProject(tmp, "1.4.0", "tanstackstart-react");
    const detected = detectValVersion(tmp);
    expect(detected).toEqual({
      version: "1.4.0",
      packageName: "@valbuild/tanstackstart-react",
      carriesLanguageServer: true,
      shipsSince: null,
    });
    expect(isTooOldForLanguageServer(detected)).toBe(false);
  });

  test("returns null on a Val too old to carry a language server", () => {
    // The "needs a Val upgrade" path: @valbuild/next is installed and healthy,
    // it simply has no language server in it.
    writeJson(path.join(tmp, "package.json"), {
      name: "app",
      dependencies: { "@valbuild/next": "^0.97.0" },
    });
    writePackage(path.join(tmp, "node_modules", "@valbuild", "next"), {
      name: "@valbuild/next",
      version: "0.97.7",
    });
    expect(resolveLanguageServer(tmp)).toBeNull();
    const detected = detectValVersion(tmp);
    expect(detected).toEqual({
      version: "0.97.7",
      packageName: "@valbuild/next",
      carriesLanguageServer: true,
      shipsSince: "0.98.0",
    });
    // A package that should carry the server, at a version known to predate it.
    expect(isTooOldForLanguageServer(detected)).toBe(true);
  });

  test("returns null when nothing Val-shaped is installed", () => {
    writeJson(path.join(tmp, "package.json"), { name: "app" });
    expect(resolveLanguageServer(tmp)).toBeNull();
    expect(detectValVersion(tmp)).toBeNull();
  });

  test("ignores a resolvable package that declares no binary", () => {
    // A half-written or hand-edited package.json must not produce an entry path
    // that cannot be launched.
    hoistedProject(tmp, "0.98.0");
    writePackage(
      path.join(tmp, "node_modules", "@valbuild", "language-server"),
      { name: LS, version: "0.98.0" },
      { bin: false },
    );
    expect(resolveLanguageServer(tmp)).toBeNull();
  });

  test("does not throw when the project has no package.json at all", () => {
    expect(resolveLanguageServer(path.join(tmp, "nope"))).toBeNull();
  });
});

describe("resolveLanguageServer overrides", () => {
  test("the setting wins over resolution", () => {
    hoistedProject(tmp, "0.98.0");
    const resolved = resolveLanguageServer(tmp, {
      settingPath: "/elsewhere/bin.js",
    });
    expect(resolved!.entry).toBe("/elsewhere/bin.js");
    expect(resolved!.override).toEqual({
      kind: "setting",
      source: "valBuild.languageServerPath",
      path: "/elsewhere/bin.js",
    });
  });

  test("the env var wins over resolution", () => {
    hoistedProject(tmp, "0.98.0");
    const resolved = resolveLanguageServer(tmp, {
      envPath: "/elsewhere/bin.js",
    });
    expect(resolved!.override!.kind).toBe("env");
  });

  test("the setting wins over the env var", () => {
    const resolved = resolveLanguageServer(tmp, {
      settingPath: "/from/setting.js",
      envPath: "/from/env.js",
    });
    expect(resolved!.entry).toBe("/from/setting.js");
  });

  test("blank and whitespace-only overrides fall through to resolution", () => {
    isolatedProject(tmp, "0.98.0");
    const resolved = resolveLanguageServer(tmp, {
      settingPath: "   ",
      envPath: "",
    });
    expect(resolved!.override).toBeNull();
    expect(resolved!.via).toBe("@valbuild/next");
  });

  test("reads the version beside an overridden entry when there is one", () => {
    // Pointing at a local monorepo checkout is the supported way to develop
    // against an unreleased Val, and its version should still be reported.
    const pkgDir = path.join(tmp, "packages", "language-server");
    writePackage(pkgDir, { name: LS, version: "0.99.0-dev" }, { bin: true });
    const resolved = resolveLanguageServer(tmp, {
      settingPath: path.join(pkgDir, "bin.js"),
    });
    expect(resolved!.version).toBe("0.99.0-dev");
  });

  test("an override with no package.json beside it still resolves", () => {
    const resolved = resolveLanguageServer(tmp, {
      settingPath: "/opt/val/server.js",
    });
    expect(resolved!.entry).toBe("/opt/val/server.js");
    expect(resolved!.version).toBeNull();
  });
});

describe("detectValVersion", () => {
  test("prefers @valbuild/next over cli and core", () => {
    writeJson(path.join(tmp, "package.json"), { name: "app" });
    for (const [name, version] of [
      ["next", "0.98.0"],
      ["cli", "0.97.0"],
      ["core", "0.96.0"],
    ]) {
      writePackage(path.join(tmp, "node_modules", "@valbuild", name), {
        name: `@valbuild/${name}`,
        version,
      });
    }
    expect(detectValVersion(tmp)).toEqual({
      version: "0.98.0",
      packageName: "@valbuild/next",
      carriesLanguageServer: true,
      shipsSince: "0.98.0",
    });
  });

  test("a carrier package wins over core even when core is newer", () => {
    // The real shape of a Val 0.98.0 install: next is 0.98.0 while core is still
    // 0.97.7. Reading the version off core would report a project that is
    // perfectly up to date as being behind.
    writeJson(path.join(tmp, "package.json"), { name: "app" });
    writePackage(path.join(tmp, "node_modules", "@valbuild", "next"), {
      name: "@valbuild/next",
      version: "0.98.0",
    });
    writePackage(path.join(tmp, "node_modules", "@valbuild", "core"), {
      name: "@valbuild/core",
      version: "0.97.7",
    });
    const detected = detectValVersion(tmp);
    expect(detected).toEqual({
      version: "0.98.0",
      packageName: "@valbuild/next",
      carriesLanguageServer: true,
      shipsSince: "0.98.0",
    });
    expect(isTooOldForLanguageServer(detected)).toBe(false);
  });

  test("core alone proves it is a Val project but is never a carrier", () => {
    writeJson(path.join(tmp, "package.json"), { name: "app" });
    writePackage(path.join(tmp, "node_modules", "@valbuild", "core"), {
      name: "@valbuild/core",
      // Even at a version far past the floor: core does not ship a server, and
      // Val does not version it in lockstep with next and cli.
      version: "1.5.0",
    });
    const detected = detectValVersion(tmp);
    expect(detected).toEqual({
      version: "1.5.0",
      packageName: "@valbuild/core",
      carriesLanguageServer: false,
      shipsSince: null,
    });
    // Never "too old": there is no version of core that would carry a server.
    expect(isTooOldForLanguageServer(detected)).toBe(false);
  });
});

describe("isAtLeastVersion", () => {
  const cases: [string, string, boolean][] = [
    ["0.98.0", "0.98.0", true],
    ["0.98.1", "0.98.0", true],
    ["0.99.0", "0.98.0", true],
    ["1.0.0", "0.98.0", true],
    ["0.97.7", "0.98.0", false],
    ["0.9.0", "0.98.0", false],
    // 0.98 vs 0.9: a string compare would get this wrong, and 0.9 sorts below.
    ["0.9.99", "0.98.0", false],
    ["v0.98.0", "0.98.0", true],
  ];
  for (const [version, minimum, expected] of cases) {
    test(`${version} >= ${minimum} is ${expected}`, () => {
      expect(isAtLeastVersion(version, minimum)).toBe(expected);
    });
  }

  test("a prerelease sorts below its release", () => {
    // A prerelease of the first version that carries the language server cannot
    // be assumed to carry it.
    expect(isAtLeastVersion("0.98.0-next.1", "0.98.0")).toBe(false);
    expect(isAtLeastVersion("0.98.1-next.1", "0.98.0")).toBe(true);
  });

  test("unparsable input answers no rather than a confident wrong yes", () => {
    // `Internal.VERSION.core` falls back to the literal "unknown".
    expect(isAtLeastVersion("unknown", "0.98.0")).toBe(false);
    expect(isAtLeastVersion("", "0.98.0")).toBe(false);
  });
});
