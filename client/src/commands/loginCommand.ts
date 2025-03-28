import * as vscode from "vscode";
import { isLoggedIn, loginFromVSCode, updateStatusBar } from "../login";
import { getProjectRootDir } from "../getProjectRootDir";

export const loginCommand =
  (statusBarItem: vscode.StatusBarItem) => async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      const docUri = editor.document.uri;
      const projectDir = getProjectRootDir(docUri);
      const loggedIn = isLoggedIn(projectDir);
      if (!loggedIn) {
        await loginFromVSCode(projectDir);
        vscode.window.showInformationMessage(
          `Logged in to Val for project at ${projectDir}`
        );
        updateStatusBar(statusBarItem, projectDir);
        return;
      }
      vscode.window.showInformationMessage("You're already logged in.");
    } catch (err) {
      vscode.window.showErrorMessage(
        `Val login failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
