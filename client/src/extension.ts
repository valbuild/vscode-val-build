import * as path from "path";
import type { ExtensionContext } from "vscode";
import { workspace } from "vscode";
import type {
  LanguageClientOptions,
  ServerOptions} from "vscode-languageclient/node";
import {
  LanguageClient,
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
import { downloadRemoteFileCommand } from "./commands/downloadRemoteFile";
import { addModuleToValModulesCommand } from "./commands/addModuleToValModules";
import { addToMediaGalleryCommand } from "./commands/addToMediaGallery";
import { moveFileToGalleryDirectoryCommand } from "./commands/moveFileToGalleryDirectory";
import { removeGalleryEntryCommand } from "./commands/removeGalleryEntry";
import { findValRoots } from "./findValRoots";
import { formatLanguageServerInfo } from "./languageServerInfo";
import { ProjectLanguageServers } from "./projectLanguageServers";
import { VAL_SUPPRESS_FEATURES_NOTIFICATION } from "./valSuppressFeatures";

let client: LanguageClient;
let statusBarItem: vscode.StatusBarItem;
let currentProjectDir: string;
/**
 * The language servers that ship with the Val in the user's own project.
 *
 * Only created when `valBuild.useProjectLanguageServer` is on; the bundled
 * `server/` handles everything by default.
 */
let projectServers: ProjectLanguageServers | undefined;
let output: vscode.OutputChannel;
/** Where the language clients and their servers log. See ProjectLanguageServers. */
let serverOutput: vscode.LogOutputChannel;

export function activate(context: ExtensionContext) {
  output = vscode.window.createOutputChannel("Val Build");
  serverOutput = vscode.window.createOutputChannel("Val Language Server", {
    log: true,
  });
  const currentEditor = vscode.window.activeTextEditor;
  if (currentEditor) {
    currentProjectDir = getProjectRootDir(currentEditor.document.uri);
  }
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "val.login";
  context.subscriptions.push(
    output,
    serverOutput,
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
      },
    ),
    vscode.commands.registerCommand(
      "val.uploadRemoteFile",
      uploadRemoteFileCommand(statusBarItem),
    ),
    vscode.commands.registerCommand(
      "val.downloadRemoteFile",
      downloadRemoteFileCommand,
    ),
    vscode.commands.registerCommand("val.login", loginCommand(statusBarItem)),
    vscode.commands.registerCommand(
      "val.addModuleToValModules",
      addModuleToValModulesCommand,
    ),
    vscode.commands.registerCommand(
      "val.addToMediaGallery",
      addToMediaGalleryCommand,
    ),
    vscode.commands.registerCommand(
      "val.moveFileToGalleryDirectory",
      moveFileToGalleryDirectoryCommand,
    ),
    vscode.commands.registerCommand(
      "val.removeGalleryEntry",
      removeGalleryEntryCommand,
    ),
    vscode.commands.registerCommand("val.showLanguageServerInfo", () => {
      const report = formatLanguageServerInfo({
        enabled: useProjectLanguageServer(),
        sessions: projectServers?.sessions() ?? [],
        workspaceRoots: findValRoots(workspaceFolderPaths()),
      });
      output.clear();
      output.appendLine(report);
      output.show(true);
      // Returned as well as shown: an output channel's contents cannot be read
      // back through the extension API, so this is what makes the report
      // assertable from an integration test.
      return report;
    }),
  );
  updateStatusBar(statusBarItem, currentProjectDir);

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (!editor) {
        return;
      }
      const maybeNewProjectDir = getProjectRootDir(editor.document.uri);
      if (maybeNewProjectDir && maybeNewProjectDir !== currentProjectDir) {
        currentProjectDir = maybeNewProjectDir;
        updateStatusBar(statusBarItem, currentProjectDir);
        updateValConfig(currentProjectDir);
      }
    },
    null,
    context.subscriptions,
  );

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "server.js"),
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
      // Three patterns, not one comma-joined string: a comma has no meaning
      // between top-level braces, so the single string was read as one literal
      // path ending in `val.modules.ts` and matched no `.val.ts` file at all —
      // which left `onDidChangeWatchedFiles`, the retry hook for a Val root that
      // failed to initialise, never firing.
      fileEvents: [
        workspace.createFileSystemWatcher("**/*.val.{ts,js}"),
        workspace.createFileSystemWatcher("**/val.config.{ts,js}"),
        workspace.createFileSystemWatcher("**/val.modules.{ts,js}"),
      ],
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "valBuild",
    "Val Build IntelliSense",
    serverOptions,
    clientOptions,
  );

  // Start the client. This will also launch the server
  client.start();

  // The project's own Val language server, if the user has opted in. Started
  // after the bundled client so that a project server which fails to resolve
  // cannot delay the diagnostics the bundled one already provides.
  void startProjectServers(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("valBuild.useProjectLanguageServer") ||
        event.affectsConfiguration("valBuild.languageServerPath")
      ) {
        void restartProjectServers(context);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // A folder added to the workspace may be a Val root of its own, and it may
      // pin a different Val than every other root.
      void projectServers?.start();
    }),
  );
}

/** `valBuild.useProjectLanguageServer`. Off by default. */
function useProjectLanguageServer(): boolean {
  return (
    vscode.workspace
      .getConfiguration("valBuild")
      .get<boolean>("useProjectLanguageServer") ?? false
  );
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => folder.uri.fsPath);
}

async function startProjectServers(context: ExtensionContext): Promise<void> {
  if (!useProjectLanguageServer() || projectServers) {
    return;
  }
  projectServers = new ProjectLanguageServers(
    output,
    serverOutput,
    suppressInBundledServer,
  );
  context.subscriptions.push(projectServers);
  await projectServers.start();
}

async function restartProjectServers(context: ExtensionContext): Promise<void> {
  const existing = projectServers;
  projectServers = undefined;
  existing?.dispose();
  await startProjectServers(context);
}

/**
 * Tell the bundled server to stop serving what the project's server now serves.
 *
 * Sent as a notification rather than passed in `initializationOptions`, because
 * the feature list only exists once the project server's handshake has completed
 * — which is necessarily after the bundled server's own `initialize`.
 */
function suppressInBundledServer(valRoot: string, features: string[]): void {
  if (!client) {
    return;
  }
  void client
    .sendNotification(VAL_SUPPRESS_FEATURES_NOTIFICATION, {
      valRoot,
      features,
    })
    .catch((error: unknown) => {
      // The bundled server not yet being ready is not worth surfacing: it reads
      // the same list again on the next change.
      output.appendLine(
        `Could not tell the bundled server about ${valRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
}

export function deactivate(): Thenable<void> | undefined {
  projectServers?.dispose();
  projectServers = undefined;
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
    context: vscode.CodeActionContext,
  ): Promise<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (
        diag.code === "image:add-metadata" ||
        diag.code === "file:add-metadata"
      ) {
        const fix = new vscode.CodeAction(
          "Add metadata",
          vscode.CodeActionKind.QuickFix,
        );
        fix.edit = new vscode.WorkspaceEdit();
        const sourceFile = ts.createSourceFile(
          "<synthetic-source-file>",
          document.getText(diag.range),
          ts.ScriptTarget.ES2015,
          true,
          ts.ScriptKind.TSX,
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
            diag.code,
          );
          return actions;
        }
        const fix = new vscode.CodeAction(
          "Upload to Val",
          vscode.CodeActionKind.QuickFix,
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
      } else if (
        typeof diag.code === "string" &&
        (diag.code.startsWith("image:download-remote") ||
          diag.code.startsWith("file:download-remote"))
      ) {
        const fix = new vscode.CodeAction(
          "Download and create local file",
          vscode.CodeActionKind.QuickFix,
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.command = {
          title: "Download and create local file",
          command: "val.downloadRemoteFile",
          arguments: [
            {
              uri: document.uri,
              range: diag.range,
              text: document.getText(diag.range),
              code: diag.code,
            },
          ],
        };
        actions.push(fix);
      } else if (diag.code === "val:missing-module") {
        const fix = new vscode.CodeAction(
          "Add module to val.modules",
          vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
          title: "Add module to val.modules",
          command: "val.addModuleToValModules",
          arguments: [(diag as any).data],
        };
        actions.push(fix);
      } else if (
        diag.code === "image:add-to-gallery" ||
        diag.code === "file:add-to-gallery"
      ) {
        const fix = new vscode.CodeAction(
          "Add to media gallery",
          vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
          title: "Add to media gallery",
          command: "val.addToMediaGallery",
          arguments: [
            {
              uri: document.uri,
              data: (diag as any).data,
            },
          ],
        };
        actions.push(fix);
      } else if (
        diag.code === "image:move-to-gallery-directory" ||
        diag.code === "file:move-to-gallery-directory"
      ) {
        const fix = new vscode.CodeAction(
          "Move file into gallery directory",
          vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
          title: "Move file into gallery directory",
          command: "val.moveFileToGalleryDirectory",
          arguments: [
            {
              uri: document.uri,
              range: diag.range,
              data: (diag as any).data,
            },
          ],
        };
        actions.push(fix);
      } else if (
        diag.code === "image:remove-gallery-entry" ||
        diag.code === "file:remove-gallery-entry"
      ) {
        const fix = new vscode.CodeAction(
          "Remove entry from gallery",
          vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
          title: "Remove entry from gallery",
          command: "val.removeGalleryEntry",
          arguments: [
            {
              uri: document.uri,
              data: (diag as any).data,
            },
          ],
        };
        actions.push(fix);
      }
    }
    return actions;
  }
}
