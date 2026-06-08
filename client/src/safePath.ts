import * as path from "path";

/**
 * Resolve a "/"-separated path coming from the language server / .val source
 * against the project root. Returns the absolute path only if it stays inside
 * `root` — `..` segments or absolute paths that escape are rejected with null.
 */
export function resolveInsideRoot(
  root: string,
  relPath: string,
): string | null {
  const rootAbs = path.resolve(root);
  const joined = path.join(rootAbs, ...relPath.split("/"));
  const resolved = path.resolve(joined);
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) {
    return null;
  }
  return resolved;
}
