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
import { getRemoteFileFix } from "./getRemoteFileFix";
import { getFileMetadata, getImageMetadata } from "./metadataUtils";
import { uploadRemoteFile } from "./uploadRemoteFile";
import { isLoggedIn, loginFromVSCode, updateStatusBar } from "./login";
import { getProjectRootDir } from "./getProjectRootDir";
import { getValConfig, updateValConfig } from "./getValConfig";
import { getRemoteFileBucket } from "./getRemoteFileBucket";
import { getProjectSettings } from "./getProjectSettings";
import { getFileExt } from "./getFileExt";
import * as fs from "fs";

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
    vscode.commands.registerCommand("val.uploadRemoteFile", async (args) => {
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
              return vscode.window.showErrorMessage(
                `Login error: ${filename}.`
              );
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
    }),
    vscode.commands.registerCommand("val.login", async () => {
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
          `Val login failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    })
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

        let newCallExpression: ts.CallExpression;
        const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (
          context
        ) => {
          return (sourceFile) => {
            const visitor = (node: ts.Node): ts.Node => {
              if (ts.isCallExpression(node)) {
                const firstArg = node.arguments[0];
                if (ts.isStringLiteral(firstArg) && !node.arguments[1]) {
                  const metadata: Record<string, string | number> =
                    typeof diag.code === "string" &&
                    diag.code.startsWith("image")
                      ? getImageMetadata(firstArg.text, document.uri)
                      : getFileMetadata(firstArg.text, document.uri);

                  newCallExpression = ts.factory.updateCallExpression(
                    node,
                    node.expression,
                    undefined,
                    [
                      node.arguments[0],

                      ts.factory.createObjectLiteralExpression(
                        Object.entries(metadata).map(([key, value]) =>
                          ts.factory.createPropertyAssignment(
                            ts.factory.createIdentifier(key),
                            typeof value === "number"
                              ? value < 0
                                ? ts.factory.createPrefixUnaryExpression(
                                    ts.SyntaxKind.MinusToken,
                                    ts.factory.createNumericLiteral(
                                      value.toString()
                                    )
                                  )
                                : ts.factory.createNumericLiteral(
                                    value.toString()
                                  )
                              : ts.factory.createStringLiteral(value)
                          )
                        ) as ts.PropertyAssignment[],
                        true
                      ),
                    ]
                  );
                  return newCallExpression;
                }
              }
              return ts.visitEachChild(node, visitor, context);
            };

            return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
          };
        };
        const printer = ts.createPrinter();
        const result = ts.transform(sourceFile, [transformerFactory]);
        if (newCallExpression) {
          let newNodeText = printer
            .printNode(
              ts.EmitHint.Unspecified,
              result.transformed[0],
              result.transformed[0]
            )
            .trim();
          newNodeText =
            newNodeText && newNodeText.slice(-1) === ";"
              ? newNodeText.slice(0, -1) // trim trailing semicolon if exists (seems to be the case?)
              : newNodeText;
          if (newNodeText) {
            fix.edit.replace(document.uri, diag.range, newNodeText);
            actions.push(fix);
          }
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

/**
 *
 * From: https://github.com/ajafff/tsutils/blob/11da31212257466a2164ca978b782139ca3f38f5/util/util.ts#L151
 */

function getTokenAtPosition(
  parent: ts.Node,
  pos: number,
  sourceFile?: ts.SourceFile
) {
  if (pos < parent.pos || pos >= parent.end) return;
  if (isTokenKind(parent.kind)) return parent;
  if (sourceFile === undefined) sourceFile = parent.getSourceFile();
  return getTokenAtPositionWorker(parent, pos, sourceFile);
}

function getTokenAtPositionWorker(
  node: ts.Node,
  pos: number,
  sourceFile: ts.SourceFile
) {
  outer: while (true) {
    for (const child of node.getChildren(sourceFile)) {
      if (child.end > pos && child.kind !== ts.SyntaxKind.JSDocComment) {
        if (isTokenKind(child.kind)) return child;
        // next token is nested in another node
        node = child;
        continue outer;
      }
    }
    return;
  }
}

function isTokenKind(kind: ts.SyntaxKind) {
  return kind >= ts.SyntaxKind.FirstToken && kind <= ts.SyntaxKind.LastToken;
}
