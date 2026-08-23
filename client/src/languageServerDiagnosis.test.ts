import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  describeIncompatibility,
  diagnoseLanguageServer,
  MARKETPLACE_URL,
} from "./languageServerDiagnosis";
import { detectPackageManager, type PackageManager } from "./packageManager";
import type { ResolvedLanguageServer } from "./resolveLanguageServer";
import { MIN_VAL_VERSION } from "./valVersion";

const resolved: ResolvedLanguageServer = {
  entry: "/app/node_modules/@valbuild/language-server/bin.js",
  version: "0.98.0",
  via: "@valbuild/next",
  override: null,
};

describe("diagnoseLanguageServer", () => {
  test("says nothing when no @valbuild/* resolves at all", () => {
    // Every TypeScript project in the workspace hits this path. Nagging here
    // would make the extension unusable outside Val projects.
    expect(
      diagnoseLanguageServer({
        resolved: null,
        detected: null,
        packageManager: "npm",
      }),
    ).toEqual({ kind: "silent", reason: "not-a-val-project" });
  });

  test("tells the user to upgrade Val when Val is too old", () => {
    // The common case, and the one that must never surface as "not found".
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: { version: "0.97.7", packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
      packageManager: "pnpm",
    });
    expect(result.kind).toBe("problem");
    if (result.kind !== "problem") {
      return;
    }
    expect(result.reason).toBe("val-too-old");
    expect(result.message).toContain(MIN_VAL_VERSION);
    expect(result.message).toContain("0.97.7");
    // An upgrade of a package the project already has, not an add of a new one.
    expect(result.actions).toEqual([
      {
        title: "Upgrade @valbuild/next",
        kind: "run-command",
        value: "pnpm update @valbuild/next@latest",
      },
    ]);
  });

  test("suggests reinstalling when Val is new enough but the server is missing", () => {
    // Yarn PnP, a hand-pruned node_modules, a broken install. Upgrading is first
    // because this build may simply not know when that package started shipping
    // the server; reinstalling addresses a broken tree; the direct add is a last
    // resort.
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: { version: "0.98.0", packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
      packageManager: "yarn",
    });
    expect(result.kind).toBe("problem");
    if (result.kind !== "problem") {
      return;
    }
    expect(result.reason).toBe("server-unresolvable");
    expect(result.message).toContain("valBuild.languageServerPath");
    expect(result.actions.map((a) => a.value)).toEqual([
      "yarn up @valbuild/next",
      "yarn install",
      "yarn add @valbuild/language-server",
    ]);
  });

  test("names @valbuild/language-server as the requirement, not a Val version", () => {
    // The extension does not depend on @valbuild/next or @valbuild/core at any
    // version. It depends on @valbuild/language-server being resolvable, and the
    // message has to say so — otherwise a project on a framework package with a
    // different version line reads a floor that does not apply to it.
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: {
        version: "0.97.7",
        packageName: "@valbuild/next",
        carriesLanguageServer: true,
        shipsSince: "0.98.0",
      },
      packageManager: "npm",
    });
    expect(result.kind === "problem" && result.message).toContain(
      "@valbuild/language-server",
    );
  });

  test("points an unknown framework package at itself, with no invented floor", () => {
    // A package released after this build: there is no version to name, so the
    // message must not claim one, and upgrading it is the first thing to try.
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: {
        version: "1.4.0",
        packageName: "@valbuild/tanstackstart-react",
        carriesLanguageServer: true,
        shipsSince: null,
      },
      packageManager: "pnpm",
    });
    expect(result.kind).toBe("problem");
    if (result.kind !== "problem") {
      return;
    }
    expect(result.reason).toBe("server-unresolvable");
    expect(result.message).toContain("@valbuild/tanstackstart-react 1.4.0");
    expect(result.message).not.toContain("0.98.0");
    expect(result.actions[0]).toEqual({
      title: "Upgrade @valbuild/tanstackstart-react",
      kind: "run-command",
      value: "pnpm update @valbuild/tanstackstart-react@latest",
    });
  });

  test("a core-only project is told to add a package, not to upgrade one", () => {
    // Val does not version @valbuild/core in lockstep: @valbuild/next@0.98.0,
    // the first release that ships the language server, depends on
    // @valbuild/core@0.97.7. So "upgrade @valbuild/core to 0.98.0" would point
    // at a version that may never exist. The real fix is adding a package that
    // carries a server.
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: {
        version: "0.97.7",
        packageName: "@valbuild/core",
        carriesLanguageServer: false,
        shipsSince: null,
      },
      packageManager: "pnpm",
    });
    expect(result.kind).toBe("problem");
    if (result.kind !== "problem") {
      return;
    }
    expect(result.reason).toBe("no-carrier-package");
    expect(result.message).not.toContain(MIN_VAL_VERSION);
    // Named so a Next.js or TanStack Start project knows which one it wants.
    expect(result.message).toContain("@valbuild/next");
    expect(result.message).toContain("@valbuild/tanstackstart-react");
    expect(result.actions).toEqual([
      {
        title: "Add @valbuild/cli",
        kind: "run-command",
        value: "pnpm add @valbuild/cli",
      },
    ]);
  });

  test("a core at the same version as a good Val is still not a carrier", () => {
    // The regression guard: a naive version-only check would call this fine.
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: {
        version: "0.99.0",
        packageName: "@valbuild/core",
        carriesLanguageServer: false,
        shipsSince: null,
      },
      packageManager: "npm",
    });
    expect(result.kind === "problem" && result.reason).toBe(
      "no-carrier-package",
    );
  });

  test("a Val at exactly the minimum is not too old", () => {
    const result = diagnoseLanguageServer({
      resolved: null,
      detected: { version: MIN_VAL_VERSION, packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
      packageManager: "npm",
    });
    expect(result.kind === "problem" && result.reason).toBe(
      "server-unresolvable",
    );
  });

  test("resolution succeeding wins over any version check", () => {
    // An override may point at an unreleased build whose version says nothing
    // useful; if it resolved, use it.
    const result = diagnoseLanguageServer({
      resolved,
      detected: { version: "0.97.7", packageName: "@valbuild/next", carriesLanguageServer: true,
    shipsSince: "0.98.0",
  },
      packageManager: "npm",
    });
    expect(result.kind).toBe("ok");
  });
});

describe("describeIncompatibility", () => {
  const versions = { core: "0.99.0", languageServer: "0.99.0" };

  test("client-too-old points at the extension, not at Val", () => {
    const { message, actions } = describeIncompatibility(
      {
        status: "client-too-old",
        server: { min: 2, max: 2 },
        client: { min: 1, max: 1 },
      },
      versions,
      "npm",
    );
    expect(message).toContain("Update the Val extension");
    expect(actions).toEqual([
      { title: "Open Marketplace", kind: "open-url", value: MARKETPLACE_URL },
    ]);
  });

  test("server-too-old points at Val in the project, not at the extension", () => {
    const { message, actions } = describeIncompatibility(
      {
        status: "server-too-old",
        server: { min: 1, max: 1 },
        client: { min: 2, max: 3 },
      },
      versions,
      "pnpm",
    );
    expect(message).toContain("Update Val in this project");
    expect(actions[0].value).toBe("pnpm update @valbuild/next@latest");
  });

  test("both versions are in the message, so a bug report carries them", () => {
    const { message } = describeIncompatibility(
      {
        status: "client-too-old",
        server: { min: 3, max: 5 },
        client: { min: 1, max: 1 },
      },
      versions,
      "npm",
    );
    expect(message).toContain("0.99.0");
    expect(message).toContain("v3-v5");
    expect(message).toContain("v1");
  });

  test("survives a server that could not report its own version", () => {
    // `Internal.VERSION.core` can be absent, and the message still has to read.
    const { message } = describeIncompatibility(
      {
        status: "client-too-old",
        server: { min: 2, max: 2 },
        client: { min: 1, max: 1 },
      },
      { core: null, languageServer: null },
      "npm",
    );
    expect(message).toContain("unknown version");
  });
});

describe("detectPackageManager", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "val-pm-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const cases: [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [lockfile, expected] of cases) {
    test(`${lockfile} means ${expected}`, () => {
      fs.writeFileSync(path.join(tmp, lockfile), "");
      expect(detectPackageManager(tmp)).toBe(expected);
    });
  }

  test("prefers pnpm over a stale package-lock.json", () => {
    // Repos that migrated off npm often still carry one; suggesting `npm
    // install` there would leave the user with two lockfiles.
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });

  test("finds the lockfile at a monorepo root", () => {
    const pkg = path.join(tmp, "packages", "web");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(pkg)).toBe("pnpm");
  });

  test("falls back to npm, the one manager that is always present", () => {
    expect(detectPackageManager(tmp)).toBe("npm");
  });
});
