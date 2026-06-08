import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getProjectRootDir } from "../getProjectRootDir";
import { resolveInsideRoot } from "../safePath";

export type MoveArgs = {
  uri: vscode.Uri;
  range: vscode.Range;
  data: {
    path: string;
    targetDirectory: string;
    referencedModuleFilePath: string;
  };
};

export const moveFileToGalleryDirectoryCommand = async (args: MoveArgs) => {
  if (!args || !args.uri || !args.range || !args.data) {
    vscode.window.showErrorMessage(
      "Invalid arguments provided to moveFileToGalleryDirectoryCommand",
    );
    return;
  }
  const { uri, range, data } = args;
  const valRoot = getProjectRootDir(uri);
  if (!valRoot) {
    vscode.window.showErrorMessage(
      "Could not determine the Val project root for this file.",
    );
    return;
  }

  const srcAbs = resolveInsideRoot(valRoot, data.path);
  if (!srcAbs) {
    vscode.window.showErrorMessage(
      `Cannot move ${data.path}: path escapes the Val project root.`,
    );
    return;
  }
  if (!fs.existsSync(srcAbs)) {
    vscode.window.showErrorMessage(
      `Cannot move ${data.path}: file does not exist at ${srcAbs}.`,
    );
    return;
  }

  const baseName = path.basename(data.path);
  const newRelPath = `${data.targetDirectory}/${baseName}`;
  const dstAbs = resolveInsideRoot(valRoot, newRelPath);
  if (!dstAbs) {
    vscode.window.showErrorMessage(
      `Cannot move ${data.path}: target ${newRelPath} escapes the Val project root.`,
    );
    return;
  }
  if (fs.existsSync(dstAbs)) {
    vscode.window.showErrorMessage(
      `Cannot move ${data.path}: ${newRelPath} already exists. Resolve the conflict manually.`,
    );
    return;
  }

  const srcUri = vscode.Uri.file(srcAbs);
  const dstUri = vscode.Uri.file(dstAbs);
  try {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(path.dirname(dstAbs)),
    );
    await vscode.workspace.fs.rename(srcUri, dstUri, { overwrite: false });
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to move file: ${(err as Error).message}`,
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const existing = document.getText(range);
  // existing is the string literal text including its quotes (e.g. "/public/val/foo.png")
  const quote = existing.startsWith('"') || existing.startsWith("'")
    ? existing[0]
    : '"';
  const replacement = `${quote}${newRelPath}${quote}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, replacement);
  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    vscode.window.showErrorMessage(
      `Moved file to ${newRelPath} but failed to update reference in source.`,
    );
    return;
  }
  await document.save();
  vscode.window.showInformationMessage(
    `Moved ${data.path} to ${newRelPath} and updated reference.`,
  );
};
