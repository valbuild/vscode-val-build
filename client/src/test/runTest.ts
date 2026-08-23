import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Run the integration suite in a real VS Code instance.
 *
 * `launchArgs` opens the Val fixture as the workspace: the launcher path is
 * per-Val-root, so a suite with no workspace folder would exercise none of it.
 */
async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../../");
    // With the `.js`, not bare: VS Code 1.110+ loads the test entry through
    // `import()`, and ESM resolution does not guess extensions.
    const extensionTestsPath = path.resolve(__dirname, "./index.js");
    // A multi-root workspace on purpose: the launcher is per-Val-root, and the
    // two roots are in deliberately different states — one with no @valbuild/*
    // anywhere above it, one a real project on a Val that ships a language
    // server.
    const workspace = path.resolve(
      __dirname,
      "../../../fixtures/e2e.code-workspace",
    );

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace,
        // Another extension publishing diagnostics for the same fixture would
        // make the "no noise" assertion flaky.
        "--disable-extensions",
      ],
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
