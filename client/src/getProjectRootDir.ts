import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";

const cache = new Map<string, string>();

export const getProjectRootDir = (
  documentUri: vscode.Uri
): string | undefined => {
  if (cache.has(documentUri.fsPath)) {
    return cache.get(documentUri.fsPath);
  }
  let dir = path.dirname(documentUri.fsPath);
  const MAX_CYCLES = 200; // always stop after 200
  let i = 0;

  while (i < MAX_CYCLES) {
    i++;
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      cache.set(documentUri.fsPath, dir);
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break; // reached filesystem root
    }

    dir = parent;
  }
  if (i >= MAX_CYCLES - 1) {
    throw Error(
      "Reached max cycles while trying to get project root dir from: " + dir
    );
  }

  return undefined;
};
