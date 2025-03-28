import * as path from "path";
import * as vscode from "vscode";
import * as ts from "typescript";
import { getRemoteFileFix } from "../getRemoteFileFix";
import { getFileMetadata, getImageMetadata } from "../metadataUtils";
import { uploadRemoteFile } from "../uploadRemoteFile";
import { isLoggedIn, loginFromVSCode, updateStatusBar } from "../login";
import { getProjectRootDir } from "../getProjectRootDir";
import { getValConfig } from "../getValConfig";
import { getRemoteFileBucket } from "../getRemoteFileBucket";
import { getProjectSettings } from "../getProjectSettings";
import { getFileExt } from "../getFileExt";
import * as fs from "fs";

export const uploadRemoteFileCommand =
  (statusBarItem: vscode.StatusBarItem) => async (args) => {
    let coreVersion = "unknown";
    let Internal: Awaited<typeof import("@valbuild/core")>["Internal"] =
      undefined;
    try {
      const valbuildCore = await import("@valbuild/core");
      coreVersion = valbuildCore.Internal.VERSION.core;
      Internal = valbuildCore.Internal;
    } catch (err) {
      vscode.window.showErrorMessage(
        "Val Build core not found. Please install the Val Build core package."
      );
      return;
    }
    const { uri, range, text, code, validationBasisHash } = args;
    try {
      const projectDirOfDocumentUri = getProjectRootDir(uri);
      const valConfig = await getValConfig(projectDirOfDocumentUri);
      const projectName = valConfig.project;
      if (projectName === undefined) {
        return {
          status: "error",
          message: `Could not find the 'project' field in the '${path.join(
            projectDirOfDocumentUri,
            "val.config.{ts,js}"
          )}' file. Please specify the project name like this: { project: 'example-org/example-name' }`,
        };
      }
      const bucketRes = await getRemoteFileBucket(
        projectDirOfDocumentUri,
        projectName
      );
      if (bucketRes.status !== "success") {
        return bucketRes;
      }
      const bucket = bucketRes.data;
      const projectDir = getProjectRootDir(uri);
      const loggedIn = isLoggedIn(projectDir);
      if (!loggedIn) {
        const shouldLogin = await vscode.window.showInformationMessage(
          `You're not logged in to Val for project "${path.basename(
            projectDir
          )}".`,
          "Log in",
          "Cancel"
        );
        if (shouldLogin === "Log in") {
          try {
            await loginFromVSCode(projectDir);
            updateStatusBar(statusBarItem, projectDir);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Login failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
            return;
          }
        }
      }
      const finalLoggedInCheck = isLoggedIn(projectDir);
      if (!finalLoggedInCheck) {
        vscode.window.showErrorMessage(
          `Login failed: ${projectDir} is not logged in.`
        );
        return;
      }
      const projectSettingsRes = await getProjectSettings(
        projectDir,
        projectName
      );
      if (projectSettingsRes.status !== "success") {
        // We have already checked for login, so if there's a login error here, something else is wrong
        vscode.window.showErrorMessage(
          `Project settings not found for project "${projectName}". Error: ${projectSettingsRes.status}`
        );
        return;
      }
      const projectSettings = projectSettingsRes.data;
      const publicProjectId = projectSettings.publicProjectId;

      const sourceFile = ts.createSourceFile(
        "<synthetic-source-file>",
        text,
        ts.ScriptTarget.ES2015,
        true,
        ts.ScriptKind.TSX
      );
      const remoteFileFixRes = getRemoteFileFix(
        Internal,
        bucket,
        coreVersion,
        validationBasisHash,
        publicProjectId,
        sourceFile,
        (filename: string) => {
          if (typeof code === "string" && code.startsWith("image")) {
            return getImageMetadata(filename, uri);
          } else {
            return getFileMetadata(filename, uri);
          }
        },
        (filename) => {
          return fs.readFileSync(
            path.join(projectDir, ...filename.split("/"))
          ) as Buffer;
        }
      );
      if (remoteFileFixRes === null) {
        vscode.window.showErrorMessage(
          "Unexpected error: could not create remote file fix"
        );
        return;
      }
      const newNodeText = remoteFileFixRes.newNodeText;
      const filename = remoteFileFixRes.foundFilename;
      const fileHash = remoteFileFixRes.fileHash;
      const fileExt = getFileExt(filename);
      const fileBuffer = remoteFileFixRes.fileBuffer;
      if (!newNodeText) {
        vscode.window.showErrorMessage(
          `Could not create new node text for code snippet: '${text}'`
        );
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Uploading file",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: "Uploading..." });
          const uploadRes = await uploadRemoteFile(
            projectDir,
            bucket,
            fileExt,
            fileHash,
            fileBuffer,
            (bytesSent, totalBytes) => {
              progress.report({
                increment: Math.round((bytesSent / totalBytes) * 100),
                message: `Uploading ${filename} (${Math.round(
                  (bytesSent / totalBytes) * 100
                )}%)`,
              });
            }
          );
          progress.report({
            increment: 100,
            message: `Upload complete`,
          });
          if (uploadRes.status === "login-required") {
            return vscode.window.showErrorMessage(`Login error: ${filename}.`);
          } else if (
            uploadRes.status === "success" ||
            uploadRes.status === "file-already-exists"
          ) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, range, newNodeText);
            await vscode.workspace.applyEdit(edit);
            if (uploadRes.status === "file-already-exists") {
              vscode.window.showInformationMessage(
                `Code fix applied (file ${filename} already exists)`
              );
            } else {
              vscode.window.showInformationMessage(
                `File uploaded ${filename} and code fix has been applied`
              );
            }
          } else {
            vscode.window.showErrorMessage(
              `Upload failed for ${filename}. Error: ${uploadRes.message}`
            );
          }
        }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Upload failed: ${err}`);
    }
  };
