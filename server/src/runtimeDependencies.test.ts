import { createRequire } from "node:module";
import * as fs from "fs";
import * as path from "path";

/**
 * Every package this server requires at runtime must be declared here *and*
 * installed under `server/node_modules`.
 *
 * This server is not bundled: `tsc -b` emits plain CJS that `require`s its
 * dependencies by name at runtime. Two things then have to hold, and neither is
 * checked by `tsc` or by any other test:
 *
 *  1. The package is declared in `server/package.json`. An undeclared import
 *     still compiles and still runs in the repo, because Node walks up to the
 *     root `node_modules` and finds a copy hoisted there by some other
 *     dependency.
 *  2. It resolves to a copy *inside* `server/node_modules`. `vsce` ships this
 *     directory wholesale but ships none of the root's devDependencies, so a
 *     package that only ever resolved from the root is simply absent from the
 *     VSIX.
 *
 * When that fails, the published extension's language server dies on its first
 * `require` and the user loses every diagnostic and completion — with no error
 * anywhere, because a server that exits during startup just closes its stream.
 *
 * Two real bugs of this shape were live in this repo: `image-size` (declared
 * nowhere, resolved from `client/`) and `typescript` (imported by eight files,
 * declared nowhere, and supplied only as a transitive of a `@valbuild/server`
 * dependency that nothing imported).
 */

const serverDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(serverDir, "package.json"), "utf8"),
);
const declared = new Set(Object.keys(packageJson.dependencies ?? {}));

/**
 * Bare specifiers imported by the server's own sources, excluding tests.
 *
 * A regex over the source rather than the TypeScript API: this needs to see what
 * the *emitted* JavaScript will require, and the set of import forms in this
 * codebase is small enough that the parse adds nothing.
 */
function runtimeImports(): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();
  for (const file of fs.readdirSync(path.join(serverDir, "src"))) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
      continue;
    }
    const source = fs.readFileSync(path.join(serverDir, "src", file), "utf8");
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1];
      // Relative imports need no declaration; `node:` is always available.
      if (specifier.startsWith(".") || specifier.startsWith("node:")) {
        continue;
      }
      // `vscode-languageserver/node` is a subpath of one package; scoped names
      // keep two segments.
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      byPackage.set(name, [...(byPackage.get(name) ?? []), file]);
    }
  }
  return byPackage;
}

/** Node builtins imported without the `node:` prefix. */
const BUILTINS = new Set(["fs", "path", "os", "url", "util", "vm", "crypto"]);

describe("runtime dependencies", () => {
  const imports = runtimeImports();

  test("the scan found the imports it is supposed to check", () => {
    // Guards the regex itself: an empty result would make every assertion below
    // pass while checking nothing.
    expect(imports.has("typescript")).toBe(true);
    expect(imports.has("@valbuild/core")).toBe(true);
    expect(imports.size).toBeGreaterThan(3);
  });

  test("every imported package is declared in server/package.json", () => {
    const undeclared = [...imports.entries()]
      .filter(([name]) => !BUILTINS.has(name) && !declared.has(name))
      .map(([name, files]) => `${name} (imported by ${files.join(", ")})`);
    expect(undeclared).toEqual([]);
  });

  test("every declared dependency resolves inside server/node_modules", () => {
    // The condition for being in the VSIX. Resolving from the repo root works in
    // development and ships nothing.
    const require_ = createRequire(path.join(serverDir, "out", "server.js"));
    const elsewhere: string[] = [];
    for (const name of declared) {
      let resolved: string;
      try {
        resolved = require_.resolve(`${name}/package.json`);
      } catch {
        // Not every package exports ./package.json; fall back to its entry.
        try {
          resolved = require_.resolve(name);
        } catch (error) {
          elsewhere.push(`${name}: does not resolve at all`);
          continue;
        }
      }
      if (!resolved.startsWith(path.join(serverDir, "node_modules"))) {
        elsewhere.push(`${name}: resolves to ${resolved}`);
      }
    }
    expect(elsewhere).toEqual([]);
  });

  test("nothing is declared that nothing imports", () => {
    // A dead dependency is not harmless: `@valbuild/server` dragged in
    // @valbuild/shared and @valbuild/ui, pinned a third copy of @valbuild/core,
    // and was the only thing supplying `typescript`.
    const unused = [...declared].filter((name) => !imports.has(name));
    expect(unused).toEqual([]);
  });
});
