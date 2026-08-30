import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findPackageJson } from "./findPackageJson";

/**
 * The walk that replaced `createRequire(...).resolve()`.
 *
 * It exists for one reason: Node appends its global folders — `$NODE_PATH`,
 * `~/.node_modules`, `~/.node_libraries`, `$PREFIX/lib/node` — to every
 * bare-specifier lookup, with no way to opt out. A Val found in one of those is
 * not the project's Val, and serving a project from it is worse than serving it
 * from nothing. So what it *does* search is the contract, and is pinned here:
 * `<ancestor>/node_modules`, from the starting directory upwards, and nowhere
 * else.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "val-find-pkg-")));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writePackage(dir: string, version: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "package.json");
  fs.writeFileSync(file, JSON.stringify({ name: "@scope/pkg", version }));
  return file;
}

describe("findPackageJson", () => {
  test("finds a package in the starting directory's own node_modules", () => {
    const file = writePackage(
      path.join(tmp, "node_modules", "@scope", "pkg"),
      "1.0.0",
    );
    expect(findPackageJson("@scope/pkg", tmp)).toBe(file);
  });

  test("walks up, so a monorepo's hoisted install is found from a package", () => {
    const file = writePackage(
      path.join(tmp, "node_modules", "@scope", "pkg"),
      "1.0.0",
    );
    const app = path.join(tmp, "apps", "web");
    fs.mkdirSync(app, { recursive: true });
    expect(findPackageJson("@scope/pkg", app)).toBe(file);
  });

  test("prefers the nearest one", () => {
    writePackage(path.join(tmp, "node_modules", "@scope", "pkg"), "1.0.0");
    const app = path.join(tmp, "apps", "web");
    const near = writePackage(
      path.join(app, "node_modules", "@scope", "pkg"),
      "2.0.0",
    );
    expect(findPackageJson("@scope/pkg", app)).toBe(near);
  });

  test("returns a real path, so the caller can keep walking from it", () => {
    // pnpm links a project's dependencies into `node_modules` as symlinks into
    // its store, and a package's own transitive dependencies are reachable only
    // from the store location. Following the link is what makes the anchor walk
    // work at all.
    const store = writePackage(
      path.join(tmp, "store", "@scope+pkg@1.0.0", "node_modules", "@scope", "pkg"),
      "1.0.0",
    );
    fs.mkdirSync(path.join(tmp, "app", "node_modules", "@scope"), {
      recursive: true,
    });
    fs.symlinkSync(
      path.dirname(store),
      path.join(tmp, "app", "node_modules", "@scope", "pkg"),
    );
    expect(findPackageJson("@scope/pkg", path.join(tmp, "app"))).toBe(store);
  });

  test("does not search a directory that is not a node_modules", () => {
    // The whole point. A copy sitting somewhere Node's *global* folders would
    // have reached — $NODE_PATH names a directory that is used as a
    // node_modules directly — is not the project's, and is not found.
    writePackage(path.join(tmp, "elsewhere", "@scope", "pkg"), "9.9.9");
    expect(findPackageJson("@scope/pkg", tmp)).toBeNull();
  });

  test("does not look for node_modules inside node_modules", () => {
    // Node skips a directory that is itself `node_modules`, and pnpm's store
    // layout depends on it: `<pkg>@<version>/node_modules` is where a package's
    // own dependencies live, reached from the package directory above it.
    writePackage(
      path.join(tmp, "node_modules", "node_modules", "@scope", "pkg"),
      "1.0.0",
    );
    expect(
      findPackageJson("@scope/pkg", path.join(tmp, "node_modules")),
    ).toBeNull();
  });

  test("returns null rather than throwing when the directory does not exist", () => {
    expect(findPackageJson("@scope/pkg", path.join(tmp, "nope"))).toBeNull();
  });

  test("handles an unscoped name", () => {
    fs.mkdirSync(path.join(tmp, "node_modules", "pkg"), { recursive: true });
    const file = path.join(tmp, "node_modules", "pkg", "package.json");
    fs.writeFileSync(file, JSON.stringify({ name: "pkg", version: "1.0.0" }));
    expect(findPackageJson("pkg", tmp)).toBe(file);
  });
});
