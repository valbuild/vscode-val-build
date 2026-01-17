import * as vscode from "vscode";
import { isLoggedIn, loginFromVSCode, updateStatusBar } from "../login";
import { getProjectRootDir } from "../getProjectRootDir";

export const loginCommand =
  (statusBarItem: vscode.StatusBarItem) => async () => {
    console.log("Login command called");
    try {
      const editor = vscode.window.activeTextEditor;
      const docUri = editor.document.uri;
      const projectDir = getProjectRootDir(docUri);
      const loggedIn = isLoggedIn(projectDir);
      console.log("Logged in:", loggedIn);
      if (!loggedIn) {
        console.log("Logging in...");
        await loginFromVSCode(projectDir);
        console.log("Logged in successfully");
        vscode.window.showInformationMessage(
          `Logged in to Val for project at ${projectDir}`,
        );
        updateStatusBar(statusBarItem, projectDir);
        return;
      }
      console.log("Already logged in");
      vscode.window.showInformationMessage("You're already logged in.");
    } catch (err) {
      console.error("Login failed:", err);
      vscode.window.showErrorMessage(
        `Val login failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
