import * as fs from "fs";
import * as path from "path";
import { findPackageJson } from "./findPackageJson";
import { declaredValPackages, VAL_LANGUAGE_SERVER } from "./valVersion";

/**
 * Resolving `@valbuild/language-server` out of the user's project.
 *
 * The package ships *with Val* — it is a dependency of `@valbuild/next` and
 * `@valbuild/cli` — so any project on a recent enough Val already has it and the
 * user installs nothing. This module is deliberately free of `vscode` imports so
 * it can be unit-tested against real `node_modules` layouts.
 */

/** Where a path came from, when it did not come from resolution. */
export type LanguageServerOverride = {
  kind: "setting" | "env";
  /** `valBuild.languageServerPath` or `VAL_LANGUAGE_SERVER_PATH`. */
  source: string;
  path: string;
};

export type ResolvedLanguageServer = {
  /** Absolute path to the server entry, for `LanguageClient`'s `module`. */
  entry: string;
  /** Version of the resolved package, or `null` if it could not be read. */
  version: string | null;
  /** Which anchor package it was found through, for diagnostics. */
  via: string;
  /** Set when a setting or environment variable supplied the path. */
  override: LanguageServerOverride | null;
};

const PACKAGE_NAME = VAL_LANGUAGE_SERVER;
const BIN_NAME = "val-language-server";

/**
 * Packages to resolve *through*, most specific first.
 *
 * `null` means "straight from the project root", which is all that is needed
 * when the tree is hoisted. The rest are the project's own direct `@valbuild/*`
 * dependencies, because under pnpm's isolated `node_modules` a transitive
 * dependency is reachable *only* through the package that depends on it.
 *
 * Taken from the project's `package.json` rather than from a list baked in here.
 * Val ships the language server inside whichever package a project depends on
 * directly — `@valbuild/next` today, `@valbuild/tanstackstart-react` next — and
 * a hard-coded list would mean a project on a new framework package silently
 * failing to resolve under pnpm until the extension shipped an update. Which is
 * exactly the coupling this whole migration exists to remove.
 *
 * `@valbuild/next` and `@valbuild/cli` are appended as a fallback for a manifest
 * that declares its dependencies elsewhere (a monorepo root, a generated
 * package.json). An anchor that is not installed simply does not resolve, and
 * the next one is tried.
 */
function anchorsFor(valRoot: string): (string | null)[] {
  const declared = declaredValPackages(valRoot);
  const ordered = [
    null,
    ...declared,
    ...["@valbuild/next", "@valbuild/cli"].filter(
      (name) => !declared.includes(name),
    ),
  ];
  return ordered;
}

/**
 * Find the language server that ships with the Val installed in `valRoot`.
 *
 * Resolution goes *through* an anchor package rather than straight from the
 * project root, and that is the load-bearing detail: under pnpm's isolated
 * `node_modules` a transitive dependency is not resolvable from the root at all.
 * A naive `require.resolve(PACKAGE_NAME, { paths: [valRoot] })` passes under npm
 * and yarn and fails under pnpm, because the root only holds the project's
 * direct dependencies.
 *
 * Returns `null` when nothing resolves. That is not one situation — see
 * `diagnoseLanguageServer` for telling "needs a Val upgrade" apart from
 * "broken install".
 */
export function resolveLanguageServer(
  valRoot: string,
  overrides?: {
    /** `valBuild.languageServerPath`. */
    settingPath?: string | null;
    /** `VAL_LANGUAGE_SERVER_PATH`. */
    envPath?: string | null;
  },
): ResolvedLanguageServer | null {
  // Both overrides take precedence over resolution — that is their whole point
  // (Yarn PnP has no `node_modules` for path resolution to walk, and pointing at
  // a local monorepo checkout is how you test against an unreleased Val).
  const override = readOverride(overrides);
  if (override) {
    return {
      entry: override.path,
      version: readVersionNear(override.path),
      via: override.source,
      override,
    };
  }

  for (const anchor of anchorsFor(valRoot)) {
    try {
      // Where the search for the server starts: the project itself, or the
      // directory of the anchor package. Under pnpm the anchor's directory is
      // inside the store, and that is the only place its own transitive
      // dependencies are reachable from.
      let searchFrom: string | null = valRoot;
      if (anchor !== null) {
        const anchorPkg = findPackageJson(anchor, valRoot);
        searchFrom = anchorPkg === null ? null : path.dirname(anchorPkg);
      }
      if (searchFrom === null) {
        continue;
      }
      const pkgPath = findPackageJson(PACKAGE_NAME, searchFrom);
      if (pkgPath === null) {
        continue;
      }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const binRel = pkg.bin?.[BIN_NAME];
      if (!binRel) {
        // A package.json without the binary is not something to fall back on
        // silently, but the next anchor may resolve a different copy.
        continue;
      }
      return {
        entry: path.resolve(path.dirname(pkgPath), binRel),
        version: typeof pkg.version === "string" ? pkg.version : null,
        via: anchor ?? "direct dependency",
        override: null,
      };
    } catch {
      // An unreadable or malformed package.json. Try the next anchor.
    }
  }
  return null;
}

/**
 * The override to use, if any. A setting wins over the environment: it is the
 * more specific and the more visible of the two.
 */
function readOverride(overrides?: {
  settingPath?: string | null;
  envPath?: string | null;
}): LanguageServerOverride | null {
  const setting = overrides?.settingPath?.trim();
  if (setting) {
    return {
      kind: "setting",
      source: "valBuild.languageServerPath",
      path: setting,
    };
  }
  const env = overrides?.envPath?.trim();
  if (env) {
    return { kind: "env", source: "VAL_LANGUAGE_SERVER_PATH", path: env };
  }
  return null;
}

/**
 * Best-effort version for an overridden path, read from the `package.json`
 * beside the entry. An override may point anywhere — including a bundled file
 * with no package around it — so this is display-only and never gates
 * behaviour.
 */
function readVersionNear(entry: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
