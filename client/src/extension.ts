import * as path from "path";
import { workspace, ExtensionContext } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import * as vscode from "vscode";
import { readFileSync } from "fs";
import sizeOf from "image-size";
import { getSHA256Hash } from "./getSha256";
import { TextEncoder } from "util";
import * as ts from "typescript";
import {
  filenameToMimeType,
  mimeTypeToFileExt,
} from "./mimeType/convertMimeType";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  context.subscriptions.push(
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
    )
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

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
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
                              ? ts.factory.createNumericLiteral(
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
      }
    }
    return actions;
  }
}
const textEncoder = new TextEncoder();
function getImageMetadata(imageFilename: string, document: vscode.Uri) {
  let rootPath = document.fsPath;
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(document).uri.fsPath;
  let iterations = 0;
  // TODO: this can't be the best way to find the root of the project we are in?
  while (workspaceFolder !== rootPath && iterations < 100) {
    rootPath = path.dirname(rootPath);
    iterations++;
    try {
      const fileBuffer = readFileSync(path.join(rootPath, imageFilename));
      if (fileBuffer) {
        const res = sizeOf(fileBuffer);
        if (res.type) {
          const mimeType = `image/${res.type}`;
          return {
            width: res.width,
            height: res.height,
            mimeType: `image/${res.type}`,
            sha256: getSHA256Hash(
              textEncoder.encode(
                `data:${mimeType};base64,${fileBuffer.toString("base64")}`
              )
            ),
          };
        }
      }
    } catch (e) {}
  }
}

function getFileMetadata(filename: string, document: vscode.Uri) {
  let rootPath = document.fsPath;
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(document).uri.fsPath;
  let iterations = 0;
  // TODO: this can't be the best way to find the root of the project we are in?
  while (workspaceFolder !== path.dirname(rootPath) && iterations < 100) {
    rootPath = path.dirname(rootPath);
    iterations++;
    try {
      const fileBuffer = readFileSync(path.join(rootPath, filename));
      const mimeType = filenameToMimeType(filename);
      if (fileBuffer) {
        return {
          mimeType,
          sha256: getSHA256Hash(
            textEncoder.encode(
              `data:${mimeType};base64,${fileBuffer.toString("base64")}`
            )
          ),
        };
      }
    } catch (e) {}
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
