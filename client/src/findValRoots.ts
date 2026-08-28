import * as fs from "fs";
import * as path from "path";

/**
 * Finding the Val roots in a workspace.
 *
 * A Val root is the directory of the `package.json` nearest above a
 * `val.config.{ts,js}`. One language server is started per root, because
 * different roots in a monorepo may pin different versions of Val and therefore
 * need different servers.
 *
 * *Nearest* above, rather than "any package.json with a val.config somewhere
 * beneath it": in a monorepo the latter also matches the workspace root, which
 * would start a second server whose file pattern covers every package — and two
 * servers both claiming a file is exactly the duplicate-diagnostics problem
 * this per-root scheme exists to avoid.
 */

/** Directories never worth descending into, and never a Val root. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "out",
  "build",
  "coverage",
  ".vscode-test",
]);

const VAL_CONFIG_FILES = [
  "val.config.ts",
  "val.config.js",
  "val.config.mts",
  "val.config.mjs",
];

/**
 * Depth to descend from a workspace folder.
 *
 * A bound rather than an unbounded walk: the extension host is shared with the
 * editor, and a stray `~` as a workspace folder should not turn activation into
 * a full-disk scan.
 */
const MAX_DEPTH = 8;

/**
 * The Val roots beneath `workspaceFolders`, deduplicated and sorted.
 *
 * Sorted so that a shorter (outer) root comes first, which keeps the order the
 * clients are created in — and therefore the log — stable.
 */
export function findValRoots(workspaceFolders: string[]): string[] {
  const roots = new Set<string>();
  for (const folder of workspaceFolders) {
    for (const configFile of findValConfigFiles(folder)) {
      const root = findNearestPackageRoot(path.dirname(configFile), folder);
      if (root) {
        roots.add(root);
      }
    }
  }
  return [...roots].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function findValConfigFiles(folder: string): string[] {
  const found: string[] = [];

  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is not worth failing activation over.
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && VAL_CONFIG_FILES.includes(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
    if (depth >= MAX_DEPTH) {
      return;
    }
    for (const entry of entries) {
      // `isDirectory()` is false for a symlinked directory, which is what keeps
      // this from following a link out of the workspace or into a cycle.
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
        visit(path.join(dir, entry.name), depth + 1);
      }
    }
  };

  visit(folder, 0);
  return found;
}

/**
 * Walk up from `from` to the nearest directory with a `package.json`, stopping
 * at `stopAt` so a config file can never claim a root outside the workspace.
 */
function findNearestPackageRoot(from: string, stopAt: string): string | null {
  const boundary = path.resolve(stopAt);
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    if (dir === boundary) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * The Val root that owns `fsPath`, or `null`.
 *
 * The longest matching root wins, so a nested package beats the monorepo root
 * that contains it.
 */
export function valRootFor(fsPath: string, valRoots: string[]): string | null {
  let best: string | null = null;
  for (const root of valRoots) {
    if (isInside(fsPath, root) && (best === null || root.length > best.length)) {
      best = root;
    }
  }
  return best;
}

function isInside(fsPath: string, dir: string): boolean {
  const relative = path.relative(dir, fsPath);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
