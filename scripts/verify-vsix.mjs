/**
 * Check what a packaged VSIX actually contains.
 *
 * This script used to launch the bundled language server out of the archive,
 * because that server was plain `tsc` output that `require`d `@valbuild/core`,
 * `typescript`, `glob` and `image-size` at runtime: if the packaging rules
 * dropped one, the published extension's server died on its first require and
 * the user silently lost every diagnostic and completion. That happened twice
 * (`image-size` and `typescript`).
 *
 * There is no bundled server any more, so the failure it guarded against cannot
 * happen. What can happen is the two mistakes the new design makes possible, and
 * both are silent, so both are checked here:
 *
 *  1. **The server comes back.** A `server/` directory in the VSIX would mean a
 *     second implementation of Val shipped alongside the user's own.
 *  2. **The type-only contract leaks into the bundle.** `@valbuild/language-server`
 *     is a devDependency imported with `import type`, which erases at build
 *     time. A plain `import` instead would pull the whole server —
 *     `vscode-languageserver` and all — into `client/out/extension.js`, silently
 *     doubling the VSIX and pinning the extension to one version of Val, which
 *     is the exact coupling this design exists to remove.
 *
 * Usage: node scripts/verify-vsix.mjs [path/to/extension.vsix]
 * With no argument it packages one into a temporary directory first.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-vsix-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}: ${result.stderr}`,
    );
  }
  return result.stdout;
}

function fail(message) {
  console.error(`\nverify-vsix: ${message}`);
  process.exitCode = 1;
}

let vsix = process.argv[2];
if (!vsix) {
  vsix = path.join(workDir, "extension.vsix");
  console.log("Packaging a VSIX to verify...");
  run("npx", ["vsce", "package", "--out", vsix]);
}
if (!fs.existsSync(vsix)) {
  throw new Error(`No such VSIX: ${vsix}`);
}

// Reading the archive rather than `vsce ls`, so this is honest about the file
// that was actually produced rather than about the packaging rules. `unzip` is
// the system binary, not an npm package -- `npx unzip` silently resolves to
// nothing.
const listing = capture("unzip", ["-Z1", vsix]).split("\n");
const entries = listing.map((line) => line.trim()).filter(Boolean);

console.log(`\n${entries.length} entries in ${path.basename(vsix)}`);

const serverEntries = entries.filter((entry) =>
  /(^|\/)extension\/server\//.test(entry),
);
if (serverEntries.length > 0) {
  fail(
    `the VSIX ships a bundled language server (${serverEntries.length} files under server/). ` +
      `The project's own @valbuild/language-server is the only one that should run.`,
  );
}

const bundle = entries.find((entry) => entry.endsWith("client/out/extension.js"));
if (!bundle) {
  fail("the VSIX has no client/out/extension.js — did `npm run compile` run?");
} else {
  const bundlePath = path.join(workDir, "bundle");
  run("unzip", ["-o", "-q", vsix, bundle, "-d", bundlePath]);
  const contents = fs.readFileSync(path.join(bundlePath, bundle), "utf8");
  if (contents.includes("vscode-languageserver/node")) {
    fail(
      "the bundle contains vscode-languageserver/node, so a value import of " +
        "@valbuild/language-server leaked in. It must be imported with `import type`.",
    );
  } else {
    console.log("The bundle does not pull in the language server. Good.");
  }
  const sizeMb = (contents.length / 1024 / 1024).toFixed(2);
  console.log(`Bundle size: ${sizeMb} MB`);
}

if (process.exitCode) {
  console.error("\nverify-vsix: FAILED");
} else {
  console.log("\nverify-vsix: ok");
}
