import * as fs from "fs";
import * as path from "path";

/**
 * `<name>/package.json` in the nearest `node_modules` above `fromDir`, as a real
 * path — the walk Node performs for a bare specifier, minus its global folders.
 *
 * That subtraction is the whole reason this exists. Node appends `$NODE_PATH`,
 * `~/.node_modules`, `~/.node_libraries` and `$PREFIX/lib/node` to *every*
 * bare-specifier lookup, and `createRequire` is no exception. A Val found in one
 * of those belongs to no project: its version has nothing to do with the Val the
 * project depends on, and a project with no Val installed — which must stay
 * silent, and which `fixtures/no-val` exists to pin — would be handed a language
 * server anyway. Node offers no way to opt out, so the walk happens here.
 *
 * It needs none of the rest of Node's algorithm. The only thing ever asked for
 * is a `package.json`: no extensions to try, no directory main to read, and no
 * `exports` map to satisfy — which is what the previous implementation depended
 * on Val's packages exposing `./package.json` for.
 *
 * The result is a real path because callers continue the walk from it. Under
 * pnpm the entry in a project's `node_modules` is a symlink into the store, and
 * it is the store location, not the symlink, that a package's own transitive
 * dependencies are reachable from.
 */
export function findPackageJson(
  name: string,
  fromDir: string,
): string | null {
  const segments = name.split("/");
  let current = path.resolve(fromDir);
  for (;;) {
    // Node skips a directory that is itself `node_modules` rather than looking
    // for `node_modules/node_modules`, and pnpm's layout depends on it: the
    // store's `<pkg>@<version>/node_modules` is where that package's own
    // dependencies live.
    if (path.basename(current) !== "node_modules") {
      try {
        return fs.realpathSync(
          path.join(current, "node_modules", ...segments, "package.json"),
        );
      } catch {
        // Not in this one. Keep walking up.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
