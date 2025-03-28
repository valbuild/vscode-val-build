import * as path from "path";
import * as vscode from "vscode";
import { readFileSync } from "fs";
import sizeOf from "image-size";
import * as ts from "typescript";
import { filenameToMimeType } from "./mimeType/convertMimeType";

export function getImageMetadata(imageFilename: string, document: vscode.Uri) {
  const resolvedFile = getAbsoluteFilePath(imageFilename, document);
  if (resolvedFile.status === "ok") {
    if (resolvedFile.buffer) {
      const res = sizeOf(resolvedFile.buffer);
      if (res.type) {
        let mimeType = `image/${res.type}`;
        if (res.type === "svg") {
          mimeType = "image/svg+xml";
        }
        return {
          width: res.width,
          height: res.height,
          mimeType,
        };
      }
    }
  }
  console.warn("Could not find metadata for image:", imageFilename);
  return {};
}

export function getFileMetadata(filename: string, document: vscode.Uri) {
  const resolvedFile = getAbsoluteFilePath(filename, document);
  if (resolvedFile.status === "ok") {
    const mimeType = filenameToMimeType(filename);
    if (mimeType) {
      return {
        mimeType,
      };
    }
  }
  console.warn("Could not find metadata for image:", filename);
  return {};
}

function getAbsoluteFilePath(relativePath: string, document: vscode.Uri) {
  let rootPath = document.fsPath;
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(document).uri.fsPath;
  let iterations = 0;
  // TODO: this can't be the best way to find the root of the project we are in?
  while (workspaceFolder !== rootPath && iterations < 100) {
    rootPath = path.dirname(rootPath);
    iterations++;
    try {
      // check if file exists

      const absPath = path.join(rootPath, relativePath);
      const fileBuffer = readFileSync(absPath);
      if (fileBuffer) {
        return {
          status: "ok",
          path: absPath,
          buffer: fileBuffer,
        };
      }
    } catch (e) {}
  }
  return {
    status: "error",
  };
}
