import * as fs from "fs";
import * as path from "path";
import { findPackageJson } from "./findPackageJson";

/**
 * Which Val packages a project has, and which of them should be carrying a
 * language server.
 *
 * The extension does not depend on a version of `@valbuild/next` or
 * `@valbuild/core`. It depends on `@valbuild/language-server` being resolvable —
 * that is the whole gate, and `resolveLanguageServer` is what checks it. This
 * module exists only to *explain* a failure: "not resolvable" covers several
 * situations whose fixes have nothing in common, and a generic "could not start
 * the Val language server" would be worse than nothing.
 *
 * Nothing here is a hard-coded list of framework packages, deliberately. Val
 * ships `@valbuild/language-server` inside whichever package a project depends
 * on directly — `@valbuild/next` today, `@valbuild/tanstackstart-react` next —
 * and a new one must work without an extension release. So the rule is inverted:
 * a small set of packages is known *never* to carry it, and everything else the
 * project depends on is assumed to.
 */

/**
 * First `@valbuild/next` / `@valbuild/cli` release that shipped
 * `@valbuild/language-server`, for the message shown to a project on an older
 * one.
 *
 * Only ever used to explain, never to gate. A package not listed in
 * {@link KNOWN_FLOORS} gets no version claimed for it, because inventing one
 * would point the user at a release that may not exist.
 */
export const MIN_VAL_VERSION = "0.98.0";

/** Packages whose first language-server release is known. */
const KNOWN_FLOORS: Record<string, string> = {
  "@valbuild/next": MIN_VAL_VERSION,
  "@valbuild/cli": MIN_VAL_VERSION,
};

/**
 * Val packages that exist to be depended on by other Val packages, and never
 * ship a language server.
 *
 * `@valbuild/core` and `@valbuild/server` could not carry it even in principle —
 * the language server depends on them, so it would be a cycle. The rest are
 * runtime or tooling libraries. Their presence still means "this is a Val
 * project", which is what separates "on an old Val" from "not a Val project".
 */
const LIBRARY_PACKAGES = new Set([
  "@valbuild/core",
  "@valbuild/server",
  "@valbuild/shared",
  "@valbuild/ui",
  "@valbuild/react",
  "@valbuild/eslint-plugin",
  "@valbuild/create",
  "@valbuild/init",
]);

export type DetectedValVersion = {
  /** For example `"0.98.0"`. */
  version: string;
  /** Which package it was read from, for the message shown to the user. */
  packageName: string;
  /**
   * Whether that package is one that should ship a language server.
   *
   * `false` means the project has Val libraries but no framework or CLI package,
   * so the fix is adding one rather than upgrading what is there.
   */
  carriesLanguageServer: boolean;
  /**
   * First version of this package known to ship the language server, or `null`
   * when there is no known floor — a package added after this extension was
   * built, or one that has shipped it since its first release.
   */
  shipsSince: string | null;
};

/**
 * Every `@valbuild/*` package the project depends on **directly**, in the order
 * its `package.json` lists them.
 *
 * Direct dependencies specifically: those are the packages that can be resolved
 * *through* under pnpm's isolated `node_modules`, and the ones whose version the
 * user can act on.
 */
export function declaredValPackages(valRoot: string): string[] {
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(valRoot, "package.json"), "utf8"),
    );
  } catch {
    return [];
  }
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ].filter(
    (name) => name.startsWith("@valbuild/") && name !== VAL_LANGUAGE_SERVER,
  );
}

export const VAL_LANGUAGE_SERVER = "@valbuild/language-server";

/**
 * The Val installed in `valRoot`, or `null` when no `@valbuild/*` resolves at
 * all — which means "not a Val project, or dependencies are not installed", and
 * is the one case where the right thing to do is say nothing.
 *
 * A package that should carry a language server is preferred over a library one,
 * because it is the package the user would act on. Resolution walks up the
 * directory tree, as Node does for the project's own code — but only that far.
 * A Val on a *global* module path is not one the project has, and treating it as
 * one would mean nagging "upgrade Val" at a project that has no Val at all; see
 * `findPackageJson`.
 */
export function detectValVersion(valRoot: string): DetectedValVersion | null {
  const read = (packageName: string): DetectedValVersion | null => {
    try {
      const pkgPath = findPackageJson(packageName, valRoot);
      if (pkgPath === null) {
        return null;
      }
      const version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
      if (typeof version !== "string" || !version) {
        return null;
      }
      return {
        version,
        packageName,
        carriesLanguageServer: !LIBRARY_PACKAGES.has(packageName),
        shipsSince: KNOWN_FLOORS[packageName] ?? null,
      };
    } catch {
      return null;
    }
  };

  // What the project actually declares comes first, so a framework package this
  // build has never heard of is still the one reported and acted on.
  const declared = declaredValPackages(valRoot);
  const candidates = [
    ...declared,
    // Fall back to the packages a Val project has one way or another, for a
    // manifest that declares its dependencies somewhere else (a monorepo root,
    // a generated package.json).
    "@valbuild/next",
    "@valbuild/cli",
    ...LIBRARY_PACKAGES,
  ];

  const found = candidates
    .map(read)
    .filter((detected): detected is DetectedValVersion => detected !== null);

  return (
    found.find((detected) => detected.carriesLanguageServer) ??
    found[0] ??
    null
  );
}

/**
 * Whether `version` is at least `minimum`.
 *
 * A deliberately small comparison rather than a `semver` dependency: the only
 * question ever asked is "is this package new enough", over versions Val itself
 * publishes. Unparsable input answers `false`, so a version this cannot read
 * produces an explanation rather than a confident wrong yes.
 *
 * A prerelease sorts *below* its release (`0.98.0-next.1` < `0.98.0`), matching
 * semver: a prerelease of the first version that carries the language server
 * cannot be assumed to carry it.
 */
export function isAtLeastVersion(version: string, minimum: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a.release[i] !== b.release[i]) {
      return a.release[i] > b.release[i];
    }
  }
  if (a.prerelease === b.prerelease) {
    return true;
  }
  // Equal release parts: whichever side lacks a prerelease is the higher one.
  if (!a.prerelease) {
    return true;
  }
  if (!b.prerelease) {
    return false;
  }
  return a.prerelease >= b.prerelease;
}

function parseVersion(
  raw: string,
): { release: [number, number, number]; prerelease: string } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? "",
  };
}

/**
 * Whether the detected package is demonstrably too old to ship a language
 * server.
 *
 * Only ever `true` when there is a known floor to compare against. A package
 * with no known floor is never called too old — that would be a guess, and the
 * honest reading of "should carry it but did not resolve" is a broken install.
 */
export function isTooOldForLanguageServer(
  detected: DetectedValVersion | null,
): boolean {
  return (
    detected !== null &&
    detected.carriesLanguageServer &&
    detected.shipsSince !== null &&
    !isAtLeastVersion(detected.version, detected.shipsSince)
  );
}
