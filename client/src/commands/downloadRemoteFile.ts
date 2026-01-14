import * as path from "path";
import * as vscode from "vscode";
import * as ts from "typescript";
import { getFileMetadata, getImageMetadata } from "../metadataUtils";
import { uploadRemoteFile } from "../uploadRemoteFile";
import { isLoggedIn, loginFromVSCode, updateStatusBar } from "../login";
import { getProjectRootDir } from "../getProjectRootDir";
import { getValConfig } from "../getValConfig";
import { getRemoteFileBucket } from "../getRemoteFileBucket";
import { getProjectSettings } from "../getProjectSettings";
import { getFileExt } from "../getFileExt";
import * as fs from "fs";
import { getRemoteDownloadFileFix } from "../getRemoteDownloadFileFix";
import * as https from "https";
import * as http from "http";

export const downloadRemoteFileCommand = async (args) => {
  const { uri, text, range, code } = args;

  try {
    const projectDirOfDocumentUri = getProjectRootDir(uri);
    if (!projectDirOfDocumentUri) {
      vscode.window.showErrorMessage(
        "Could not find project root. This file does not seem to be in a Val project (no package.json file found in parent directories)."
      );
      return;
    }
    // Load @valbuild/core from the user's project node_modules
    let Internal: Awaited<typeof import("@valbuild/core")>["Internal"] =
      undefined;
    try {
      const corePath = require.resolve("@valbuild/core", {
        paths: [projectDirOfDocumentUri],
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const valbuildCore = require(corePath);
      Internal = valbuildCore.Internal;
    } catch (err) {
      vscode.window.showErrorMessage(
        "Val Build core not found in your project. Please install @valbuild/core in your project."
      );
      return;
    }
    let newType: "image" | "file";
    if (code === "image:download-remote") {
      newType = "image";
    } else if (code === "file:download-remote") {
      newType = "file";
    } else {
      vscode.window.showErrorMessage("Unexpected diagnostics code: " + code);
      return;
    }
    const sourceFile = ts.createSourceFile(
      "<synthetic-source-file>",
      text,
      ts.ScriptTarget.ES2015,
      true,
      ts.ScriptKind.TSX
    );
    const fixRes = getRemoteDownloadFileFix(Internal, newType, sourceFile);
    if (!fixRes) {
      vscode.window.showErrorMessage("No fix found for: " + text);
      return;
    }
    const { newNodeText, newLocalFilePath, foundRemoteRef } = fixRes;
    if (!newLocalFilePath.startsWith("public")) {
      vscode.window.showErrorMessage(
        "File path (the part after the '/p' part of the remote URL) must start with /public"
      );
      return;
    }
    const absFilePath = path.join(
      projectDirOfDocumentUri,
      ...newLocalFilePath.split("/")
    );
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Downloading file",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: "Downloading..." });
        downloadFile(
          foundRemoteRef,
          absFilePath,
          (bytesReceived, totalBytes) => {
            const progressMessage = `Downloading ${path.basename(
              newLocalFilePath
            )} (${
              totalBytes !== undefined && totalBytes > 0
                ? `${Math.round((bytesReceived / totalBytes) * 100)}%`
                : `${bytesReceived} bytes`
            })`;
            progress.report({
              increment:
                totalBytes && Math.round((bytesReceived / totalBytes) * 100),
              message: progressMessage,
            });
          }
        )
          .then(() => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, range, newNodeText);
            vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(
              `Downloaded ${path.basename(newLocalFilePath)}`
            );
          })
          .catch((err) => {
            vscode.window.showErrorMessage(`Download failed: ${err}`);
          });
      }
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Download failed: ${err}`);
  }
};

type ProgressCallback = (
  bytesReceived: number,
  totalBytes: number | undefined
) => void;

export function downloadFile(
  fileUrl: string,
  filePath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(fileUrl);
    const client = urlObj.protocol === "https:" ? https : http;

    const req = client.get(urlObj, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Download failed. Status code: ${res.statusCode}`));
        return;
      }

      const contentLengthHeader = Number(res.headers["content-length"]);
      const totalBytes = !Number.isNaN(contentLengthHeader)
        ? contentLengthHeader
        : undefined;
      let receivedBytes = 0;

      const dir = path.dirname(filePath);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        if (err.code !== "EEXIST") {
          reject(new Error(`Failed to create directory: ${dir}`));
          return;
        }
      }
      const fileStream = fs.createWriteStream(filePath);

      res.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (onProgress) {
          onProgress(receivedBytes, totalBytes || undefined);
        }
      });

      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });

      fileStream.on("error", (err) => {
        fs.unlink(filePath, () => reject(err));
      });
    });

    req.on("error", reject);
  });
}
