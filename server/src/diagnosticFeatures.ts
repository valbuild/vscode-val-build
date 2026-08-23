/**
 * Which advertised feature flag each of this server's diagnostics belongs to.
 *
 * Used to arbitrate against the language server that ships with the user's Val:
 * a diagnostic whose flags that server already serves is dropped here, so the
 * user sees each problem once rather than twice.
 *
 * Doing this at the single publish point, keyed on the diagnostic's `code`, is
 * deliberate: threading a suppression check through the ~700 lines that build
 * these diagnostics would give many places to forget one, and forgetting one is
 * invisible (a duplicate looks like the extension is fine).
 */

/**
 * Diagnostics with no `code` at all — plain validation and schema messages, the
 * `keyOf`/`route` resolution errors — are the core of what `diagnostics` covers.
 */
const DEFAULT_FEATURES = ["diagnostics"] as const;

/**
 * Exact-match codes.
 *
 * Note the two vocabularies: `code` here is sometimes a diagnostic kind
 * (`file-not-found`) and sometimes a Val `ValidationFix` name
 * (`image:add-metadata`), because that is how this server was built. The
 * language server it defers to has one convention for each; the mapping below is
 * where the two meet.
 */
const BY_CODE: Record<string, readonly string[]> = {
  // Plain diagnostics, with no quick fix on either side.
  "file-not-found": ["diagnostics"],
  "invalid-path-location": ["diagnostics"],
  "invalid-path-directory": ["diagnostics"],

  // Reported *and* fixed here, so both flags are needed before standing down.
  // @valbuild/language-server 0.98.0 advertises `diagnostics` (it does report
  // `val/missing-module`) but not `fix/missing-module`: keying this on
  // `diagnostics` alone left the user with the problem reported and the "Add
  // module to val.modules" fix gone.
  "val:missing-module": ["diagnostics", "fix/missing-module"],

  // A metadata problem is reported as a diagnostic and fixed by a quick fix, so
  // it only stands down when the other server does both.
  "image:add-metadata": ["diagnostics", "fix/metadata"],
  "file:add-metadata": ["diagnostics", "fix/metadata"],

  // Media galleries.
  "image:add-to-gallery": ["diagnostics/gallery", "fix/gallery"],
  "file:add-to-gallery": ["diagnostics/gallery", "fix/gallery"],
  "image:move-to-gallery-directory": ["diagnostics/gallery", "fix/gallery"],
  "file:move-to-gallery-directory": ["diagnostics/gallery", "fix/gallery"],
  "image:remove-gallery-entry": ["diagnostics/gallery", "fix/gallery"],
  "file:remove-gallery-entry": ["diagnostics/gallery", "fix/gallery"],
};

/**
 * Prefix-matched codes.
 *
 * The remote-file diagnostics smuggle a validation hash through the code
 * (`` `${fix}:${hash}` ``), so they cannot be matched exactly. Replacing that
 * with `Diagnostic.data` is a coordinated change with the Val server and is not
 * attempted here.
 */
const BY_PREFIX: [string, readonly string[]][] = [
  ["image:upload-remote", ["diagnostics", "fix/upload-remote"]],
  ["file:upload-remote", ["diagnostics", "fix/upload-remote"]],
  ["image:download-remote", ["diagnostics", "fix/download-remote"]],
  ["file:download-remote", ["diagnostics", "fix/download-remote"]],
];

/**
 * The feature flags a diagnostic belongs to.
 *
 * An unrecognised code returns `[]` — never suppressed. A new diagnostic added
 * here without a mapping therefore keeps being served, which is the safe
 * direction: a duplicate is noise, a silently missing diagnostic is a bug report
 * that says "the extension stopped working".
 */
export function featuresForDiagnosticCode(
  code: string | number | undefined,
): readonly string[] {
  if (code === undefined) {
    return DEFAULT_FEATURES;
  }
  if (typeof code !== "string") {
    return [];
  }
  const exact = BY_CODE[code];
  if (exact) {
    return exact;
  }
  for (const [prefix, features] of BY_PREFIX) {
    if (code.startsWith(prefix)) {
      return features;
    }
  }
  return [];
}
