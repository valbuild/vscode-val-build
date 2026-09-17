import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** `publisher.name` from the root package.json. */
export const EXTENSION_ID = "valbuild.vscode-val-build";

/**
 * Activate the extension, and optionally open a fixture file.
 *
 * Returns the opened document so a test can assert against it, rather than
 * publishing it through module-level mutable state as this helper used to —
 * which made every test depend on the order the others ran in.
 */
export async function activate(): Promise<void>;
export async function activate(
  fixturePath: string,
): Promise<vscode.TextDocument>;
export async function activate(
  fixturePath?: string,
): Promise<vscode.TextDocument | void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (!extension) {
    throw new Error(`${EXTENSION_ID} is not installed`);
  }
  await extension.activate();

  if (fixturePath === undefined) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(
    getDocUri(fixturePath),
  );
  await vscode.window.showTextDocument(document);
  // The language server debounces validation and evaluates the whole project on
  // first request, so diagnostics are not published by the time
  // `showTextDocument` resolves.
  await sleep(3000);
  return document;
}

/**
 * Open a file in a named Val root, without waiting for anything.
 *
 * Separate from `activate`'s fixed sleep because what a caller is waiting for
 * differs — see `waitForValDiagnostics`.
 */
export async function openDocument(
  valRoot: string,
  relativePath: string,
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(valRoot, relativePath)),
  );
  await vscode.window.showTextDocument(document);
  return document;
}

/**
 * Wait for the language server's diagnostics to reach the editor.
 *
 * Polled rather than slept on: the server evaluates the whole project on the
 * first request, so how long the first publish takes depends on the machine, and
 * a sleep long enough for CI would be one nobody wants to wait for locally.
 * Returns whatever Val published, or an empty array if it published nothing in
 * time — the assertion belongs to the caller.
 */
export async function waitForValDiagnostics(
  uri: vscode.Uri,
  timeoutMs = 30000,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fromVal = vscode.languages
      .getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === "val");
    if (fromVal.length > 0 || Date.now() > deadline) {
      return fromVal;
    }
    await sleep(250);
  }
}

/**
 * The `showLanguageServerInfo` section for `valRoot`, once its session has
 * reached `running`.
 *
 * Polled rather than read once. A session starts asynchronously, and anything
 * that changes `valBuild.*` configuration restarts every one of them — so
 * whether a given root is `running` at the moment a test asks depends on which
 * tests ran before it, which is not something a test should be asserting on.
 * Returns the section as it last looked if the deadline passes, so the failure
 * names the state it was actually in.
 */
export async function waitForRunningSession(
  valRoot: string,
  timeoutMs = 30000,
): Promise<string> {
  const marker = `--- ${valRoot} ---`;
  const deadline = Date.now() + timeoutMs;
  let section = "";
  for (;;) {
    const report = await vscode.commands.executeCommand<string>(
      "valBuild.showLanguageServerInfo",
    );
    if (report && report.includes(marker)) {
      section = report.slice(report.indexOf(marker));
      if (/state: +running/.test(section)) {
        return section;
      }
    }
    if (Date.now() > deadline) {
      return section;
    }
    await sleep(250);
  }
}

export const getDocPath = (p: string): string =>
  path.resolve(__dirname, "../../../fixtures/no-val", p);

export const getDocUri = (p: string): vscode.Uri =>
  vscode.Uri.file(getDocPath(p));

/** The Val root with nothing installed: `fixtures/no-val`. */
export const noValRoot = (): string =>
  path.resolve(__dirname, "../../../fixtures/no-val");

/** The root on a Val older than the language server: `fixtures/old-val`. */
export const oldValRoot = (): string =>
  path.resolve(__dirname, "../../../fixtures/old-val");

/** The real-Val root in the workspace: `fixtures/npm`. */
export const realValRoot = (): string =>
  path.resolve(__dirname, "../../../fixtures/npm");

/**
 * The TanStack Start root in the workspace: `fixtures/tanstack`.
 *
 * A real project on `@valbuild/tanstack`, installed with pnpm. It is in the
 * workspace so one run proves the launcher is not a Next.js launcher: the
 * language server ships inside whichever package a project depends on directly,
 * and nothing in this fixture has heard of `@valbuild/next`.
 */
export const tanstackValRoot = (): string =>
  path.resolve(__dirname, "../../../fixtures/tanstack");

/**
 * Whether the real-Val fixture has been installed.
 *
 * Its `node_modules` is not committed (`npm run install-fixtures` creates it),
 * so tests that need a running project server skip rather than fail on a fresh
 * checkout.
 */
export function hasRealValFixture(): boolean {
  return fs.existsSync(
    path.join(realValRoot(), "node_modules", "@valbuild", "language-server"),
  );
}

/** Whether the older-Val fixture has been installed. */
export function hasOldValFixture(): boolean {
  return fs.existsSync(
    path.join(oldValRoot(), "node_modules", "@valbuild", "next"),
  );
}

/**
 * Whether the TanStack fixture has been installed.
 *
 * Checked on `@valbuild/tanstack` rather than on the language server: under
 * pnpm's isolated layout the server is deliberately *not* at the project root,
 * which is the whole reason this fixture uses pnpm.
 */
export function hasTanstackFixture(): boolean {
  return fs.existsSync(
    path.join(tanstackValRoot(), "node_modules", "@valbuild", "tanstack"),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
