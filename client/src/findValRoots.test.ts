import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findValRoots, valRootFor } from "./findValRoots";

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "val-roots-")));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(relative: string, content = ""): string {
  const file = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("findValRoots", () => {
  test("finds a single-package project", () => {
    write("package.json", "{}");
    write("val.config.ts");
    expect(findValRoots([tmp])).toEqual([tmp]);
  });

  test("finds a val.config nested below the package root", () => {
    write("package.json", "{}");
    write("src/content/val.config.ts");
    expect(findValRoots([tmp])).toEqual([tmp]);
  });

  test("picks the nearest package.json, not the monorepo root", () => {
    // Two servers claiming the same file is the duplicate-diagnostics failure
    // this rule exists to prevent.
    write("package.json", "{}");
    write("packages/web/package.json", "{}");
    write("packages/web/val.config.ts");
    expect(findValRoots([tmp])).toEqual([path.join(tmp, "packages/web")]);
  });

  test("finds one root per package in a monorepo", () => {
    write("package.json", "{}");
    write("apps/site/package.json", "{}");
    write("apps/site/val.config.ts");
    write("apps/docs/package.json", "{}");
    write("apps/docs/val.config.js");
    expect(findValRoots([tmp])).toEqual([
      path.join(tmp, "apps/docs"),
      path.join(tmp, "apps/site"),
    ]);
  });

  test("deduplicates several config files under one root", () => {
    write("package.json", "{}");
    write("val.config.ts");
    write("src/val.config.js");
    expect(findValRoots([tmp])).toEqual([tmp]);
  });

  test("ignores everything under node_modules", () => {
    // Val's own packages ship val.config files in their fixtures; picking those
    // up would start a server per dependency.
    write("package.json", "{}");
    write("node_modules/@valbuild/core/package.json", "{}");
    write("node_modules/@valbuild/core/__fixtures__/val.config.ts");
    expect(findValRoots([tmp])).toEqual([]);
  });

  test("ignores build output directories", () => {
    write("package.json", "{}");
    write("dist/val.config.js");
    write(".next/val.config.js");
    expect(findValRoots([tmp])).toEqual([]);
  });

  test("returns nothing for a val.config with no package.json above it", () => {
    write("val.config.ts");
    expect(findValRoots([tmp])).toEqual([]);
  });

  test("handles several workspace folders", () => {
    write("a/package.json", "{}");
    write("a/val.config.ts");
    write("b/package.json", "{}");
    write("b/val.config.ts");
    expect(findValRoots([path.join(tmp, "a"), path.join(tmp, "b")])).toEqual([
      path.join(tmp, "a"),
      path.join(tmp, "b"),
    ]);
  });

  test("does not throw on a missing workspace folder", () => {
    expect(findValRoots([path.join(tmp, "gone")])).toEqual([]);
  });
});

describe("valRootFor", () => {
  test("the longest matching root wins", () => {
    const roots = ["/repo", "/repo/packages/web"];
    expect(valRootFor("/repo/packages/web/content/page.val.ts", roots)).toBe(
      "/repo/packages/web",
    );
    expect(valRootFor("/repo/content/page.val.ts", roots)).toBe("/repo");
  });

  test("a file outside every root belongs to none", () => {
    expect(valRootFor("/elsewhere/page.val.ts", ["/repo"])).toBeNull();
  });

  test("a sibling directory sharing a name prefix is not inside", () => {
    // "/repo-two/x" starts with "/repo" as a string but is not under it.
    expect(valRootFor("/repo-two/page.val.ts", ["/repo"])).toBeNull();
  });
});
