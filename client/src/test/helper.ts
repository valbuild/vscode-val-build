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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
