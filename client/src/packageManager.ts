import * as fs from "fs";
import * as path from "path";

/**
 * Which package manager a project uses, and the command that upgrades Val with
 * it.
 *
 * Only ever used to *show* a command on a notification: an install is never run
 * without the user invoking it, and the exact command is shown before it runs.
 */
export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

/**
 * Lockfiles in check order. pnpm and yarn come first deliberately: repos that
 * migrated away from npm often still carry a stale `package-lock.json`, and
 * checking that first would suggest the wrong command.
 */
const LOCKFILES: { file: string; manager: PackageManager }[] = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
];

/**
 * Detect the package manager from the lockfile, walking up from `valRoot` so a
 * package inside a monorepo finds the lockfile at the workspace root.
 *
 * Falls back to npm, which is the safe default: it is the one manager that is
 * always present.
 */
export function detectPackageManager(valRoot: string): PackageManager {
  let dir = path.resolve(valRoot);
  // Bounded rather than `while (true)`: a symlink loop should not hang the
  // extension host.
  for (let i = 0; i < 64; i++) {
    for (const { file, manager } of LOCKFILES) {
      if (fs.existsSync(path.join(dir, file))) {
        return manager;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return "npm";
}

/** The command that upgrades an already-declared dependency to its latest. */
export function upgradeCommand(
  manager: PackageManager,
  packageName: string,
): string {
  switch (manager) {
    case "pnpm":
      return `pnpm update ${packageName}@latest`;
    case "yarn":
      return `yarn up ${packageName}`;
    case "bun":
      return `bun update ${packageName}`;
    case "npm":
      return `npm install ${packageName}@latest`;
  }
}

/** The command that adds a package that is not declared yet. */
export function addCommand(
  manager: PackageManager,
  packageName: string,
): string {
  switch (manager) {
    case "pnpm":
      return `pnpm add ${packageName}`;
    case "yarn":
      return `yarn add ${packageName}`;
    case "bun":
      return `bun add ${packageName}`;
    case "npm":
      return `npm install ${packageName}`;
  }
}

/** The command that reinstalls everything, for a broken `node_modules`. */
export function installCommand(manager: PackageManager): string {
  return manager === "npm" ? "npm install" : `${manager} install`;
}
