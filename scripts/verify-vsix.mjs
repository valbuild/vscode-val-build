/**
 * Prove that the language server inside a packaged VSIX can actually start.
 *
 * The bundled server is not bundled by esbuild: `tsc -b` emits plain CJS that
 * `require`s `@valbuild/core`, `typescript`, `glob`, `image-size` and
 * `vscode-languageserver/node` at runtime. If any of those is missing from the
 * VSIX, the published extension's server dies on its first require and the user
 * loses every diagnostic and completion — with no error surfaced anywhere,
 * because a server that exits during startup just closes its stream. That has
 * happened twice in this repo (`image-size` and `typescript`, both imported but
 * never declared).
 *
 * `server/src/runtimeDependencies.test.ts` guards the declaration statically and
 * runs in CI. This goes further and launches the real thing out of the real
 * archive, which is the only way to catch a packaging rule that drops a file the
 * declaration check is happy about.
 *
 * Usage: node scripts/verify-vsix.mjs [path/to/extension.vsix]
 * With no argument it packages one into a temporary directory first.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require_ = createRequire(
  path.join(process.cwd(), "client", "node_modules", "x.js"),
);
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } =
  require_("vscode-jsonrpc/node");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-vsix-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

let vsix = process.argv[2];
if (!vsix) {
  vsix = path.join(workDir, "extension.vsix");
  console.log("Packaging...");
  run("npx", ["vsce", "package", "--out", vsix]);
}

const extracted = path.join(workDir, "extracted");
fs.mkdirSync(extracted);
run("unzip", ["-q", path.resolve(vsix), "-d", extracted]);

const entry = path.join(extracted, "extension", "server", "out", "server.js");
if (!fs.existsSync(entry)) {
  throw new Error(`the VSIX has no ${path.relative(extracted, entry)}`);
}

// stdio rather than IPC, so this can run outside an extension host. The launch
// path is otherwise identical to what LanguageClient does.
const child = spawn(process.execPath, [entry, "--stdio"], {
  cwd: path.join(extracted, "extension"),
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk));

const connection = createMessageConnection(
  new StreamMessageReader(child.stdout),
  new StreamMessageWriter(child.stdin),
);
// The server logs through window/logMessage, which this bare client does not
// implement.
connection.onUnhandledNotification(() => {});
connection.listen();

// A server that crashes on startup neither answers nor rejects: its stream just
// closes. Without a deadline this hangs instead of failing.
const timeout = setTimeout(() => {
  console.error("FAILED: the server did not answer `initialize` within 30s.");
  console.error(stderr || "(nothing on stderr — it probably died on a require)");
  child.kill();
  process.exit(1);
}, 30_000);

try {
  const result = await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    workspaceFolders: [],
  });
  clearTimeout(timeout);
  console.log(
    `initialize OK — capabilities: ${Object.keys(result.capabilities).join(", ")}`,
  );
  // Editors treat stderr noise from a language server as a startup failure, so
  // this is the cheapest possible regression test for the launch path.
  if (stderr !== "") {
    console.error(`FAILED: the server wrote to stderr on a clean start:\n${stderr}`);
    process.exitCode = 1;
  } else {
    console.log("stderr was empty, as it must be.");
  }
} catch (error) {
  clearTimeout(timeout);
  console.error("FAILED:", error instanceof Error ? error.message : error);
  console.error(stderr);
  process.exitCode = 1;
} finally {
  // Never end or destroy the streams, and never send `exit`: the server
  // registers `end`/`close` handlers that call process.exit().
  connection.dispose();
  child.kill();
  fs.rmSync(workDir, { recursive: true, force: true });
}
