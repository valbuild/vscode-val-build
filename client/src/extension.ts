import * as path from "path";
import { workspace, ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import * as vscode from "vscode";
import * as ts from "typescript";
import { getFileMetadata, getImageMetadata } from "./metadataUtils";
import { updateStatusBar } from "./login";
import { getProjectRootDir } from "./getProjectRootDir";
import { updateValConfig } from "./getValConfig";
import { uploadRemoteFileCommand } from "./commands/uploadRemoteFile";
import { loginCommand } from "./commands/loginCommand";
import { getAddMetadataFix } from "./getAddMetadataFix";

let client: LanguageClient;
let statusBarItem: vscode.StatusBarItem;
let currentProjectDir: string;

export function activate(context: ExtensionContext) {
  const currentEditor = vscode.window.activeTextEditor;
  currentProjectDir = getProjectRootDir(currentEditor.document.uri);
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "val.login";
  context.subscriptions.push(
    statusBarItem,
    vscode.languages.registerCodeActionsProvider(
      [
        { scheme: "file", language: "typescript" },
        {
          scheme: "file",
          language: "javascript",
        },
      ],
      new ValActionProvider(),
      {
        providedCodeActionKinds: ValActionProvider.providedCodeActionKinds,
      }
    ),
    vscode.commands.registerCommand(
      "val.uploadRemoteFile",
      uploadRemoteFileCommand(statusBarItem)
    ),
    vscode.commands.registerCommand("val.login", loginCommand(statusBarItem))
  );
  updateStatusBar(statusBarItem, currentProjectDir);

  vscode.window.onDidChangeActiveTextEditor(
    () => {
      const maybeNewProjectDir = getProjectRootDir(
        vscode.window.activeTextEditor.document.uri
      );
      if (maybeNewProjectDir !== currentProjectDir) {
        currentProjectDir = maybeNewProjectDir;
        updateStatusBar(statusBarItem, currentProjectDir);
        updateValConfig(currentProjectDir);
      }
    },
    null,
    context.subscriptions
  );

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "server.js")
  );

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "javascript" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher(
        "**/*.val.t{s,s},**/val.config.{t,j}s"
      ),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "valBuild",
    "Val Build IntelliSense",
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

export class ValActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): Promise<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      console.log("diag", diag);
      if (
        diag.code === "image:add-metadata" ||
        diag.code === "file:add-metadata"
      ) {
        const fix = new vscode.CodeAction(
          "Add metadata",
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        const sourceFile = ts.createSourceFile(
          "<synthetic-source-file>",
          document.getText(diag.range),
          ts.ScriptTarget.ES2015,
          true,
          ts.ScriptKind.TSX
        );

        const res = getAddMetadataFix(sourceFile, (filename: string) => {
          if (typeof diag.code === "string" && diag.code.startsWith("image")) {
            return getImageMetadata(filename, document.uri);
          } else {
            return getFileMetadata(filename, document.uri);
          }
        });
        if (res) {
          const newNodeText = res.newNodeText;
          fix.edit.replace(document.uri, diag.range, newNodeText);
          actions.push(fix);
        }
      } else if (
        typeof diag.code === "string" &&
        (diag.code.startsWith("image:upload-remote") ||
          diag.code.startsWith("file:upload-remote"))
      ) {
        // extract validation hash from diag.code. Example: image:upload-remote:91c0
        const validationBasisHash = diag.code.split(":")[2];
        if (!validationBasisHash) {
          console.error(
            "No validation basis hash found in diag.code",
            diag.code
          );
          return actions;
        }
        const fix = new vscode.CodeAction(
          "Upload to Val",
          vscode.CodeActionKind.QuickFix
        );
        fix.command = {
          title: "Upload to Val",
          command: "val.uploadRemoteFile",
          arguments: [
            {
              uri: document.uri,
              range: diag.range,
              text: document.getText(diag.range),
              code: diag.code,
              validationBasisHash,
            },
          ],
        };
        actions.push(fix);
      }
    }
    return actions;
  }
}
