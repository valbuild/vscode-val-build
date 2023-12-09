/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { workspace, ExtensionContext } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import * as vscode from "vscode";
import { fstatSync, readFileSync } from "fs";
import sizeOf from "image-size";
import { match } from "assert";
import { get } from "http";
import { getSHA256Hash } from "./getSha256";
import { TextEncoder } from "util";

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
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (diag.code === "image:add-metadata") {
        const fix = new vscode.CodeAction(
          "Add metadata to image",
          vscode.CodeActionKind.QuickFix
        );

        fix.edit = new vscode.WorkspaceEdit();
        const matches = document
          .getText(diag.range)
          .match(/('|"|`)(.*)('|"|`)/); // TODO: this reg ex could be improved. Also is there a better way to get the data?
        if (!matches && matches[2]) {
          continue;
        }
        const metadata = getImageMetadata(matches[2], document.uri);
        if (metadata) {
          fix.edit.insert(
            document.uri,
            diag.range.end.translate(0, -1),
            `,${JSON.stringify(metadata)}`
          );
          actions.push(fix);
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
  while (workspaceFolder !== path.dirname(rootPath) && iterations < 100) {
    rootPath = path.dirname(rootPath);
    iterations++;
    try {
      const fileBuffer = readFileSync(path.join(rootPath, imageFilename));
      if (fileBuffer) {
        const res = sizeOf(fileBuffer);
        if (res.type) {
          return {
            width: res.width,
            height: res.height,
            sha256: getSHA256Hash(
              textEncoder.encode(
                `data:${mimeTypeToFileExt(
                  res.type
                )};base64,${fileBuffer.toString("base64")}`
              )
            ),
          };
        }
      }
    } catch (e) {}
  }
}

export function mimeTypeToFileExt(type: string) {
  if (type === "svg") {
    return "image/svg+xml";
  }
  if (type === "ico") {
    return "image/vnd.microsoft.icon";
  }
  return `image/${type}`;
}
