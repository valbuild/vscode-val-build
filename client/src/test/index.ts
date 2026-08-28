import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";

/**
 * Entry point for the integration suite, run inside a real VS Code instance by
 * `runTest.ts`.
 *
 * `import Mocha` rather than `import * as Mocha` (a namespace object is not
 * constructible), and `readdirSync` rather than `glob`: this file was written
 * against glob's callback API, removed in v10, and `glob` was never a dependency
 * of `client/` at all — it resolved from the repo root, so which API it got
 * depended on what npm happened to hoist. Both are part of why this suite had
 * been commented out rather than fixed.
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true });
  // Activating the extension resolves and launches one language server per Val
  // root in the workspace, and the fixtures are real installs.
  mocha.timeout(100000);

  const testsRoot = __dirname;
  for (const file of fs.readdirSync(testsRoot).sort()) {
    if (file.endsWith(".test.js")) {
      mocha.addFile(path.resolve(testsRoot, file));
    }
  }

  const failures = await new Promise<number>((resolve) => mocha.run(resolve));
  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}
