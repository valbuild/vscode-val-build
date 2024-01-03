/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Service, ValModuleLoader, createService } from "@valbuild/server";
import { Internal, ModuleId, ModulePath, SourcePath } from "@valbuild/core";
import ts from "typescript";
import {
  ModulePathMap,
  createModulePathMap as createModulePathMap,
  getModulePathRange,
} from "./modulePathMap";
import { glob } from "glob";
import path from "path";
import fs from "fs";
import { stackToLine } from "./stackToLine";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
const cache = new Map<string, any>();
let valRoots: string[] = [];
let servicesByValRoot: {
  [valRoot: string]: Service;
} = {};
connection.onInitialize(async (params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  // TODO: we are using file directories etc at the FILE SYSTEM level. We could create a host FS for VS Code, but it was easier to use FS to get started
  const valConfigFiles = [];
  const packageJsonFiles = [];
  for (const workspaceFolder of params.workspaceFolders || []) {
    valConfigFiles.push(
      ...(await glob(
        `${uriToFsPath(workspaceFolder.uri)}/**/val.config.{t,j}s`,
        {}
      ))
    );
    packageJsonFiles.push(
      ...(await glob(`${uriToFsPath(workspaceFolder.uri)}/**/package.json`, {}))
    );
  }
  valRoots = getValRoots(valConfigFiles, packageJsonFiles);
  servicesByValRoot = Object.fromEntries(
    await Promise.all(
      valRoots.map(async (valRoot) => {
        console.log("Create Val Service for root: " + valRoot);
        const service = await createService(
          valRoot,
          {
            disableCache: true,
          },
          {
            ...ts.sys,
            readFile(path) {
              if (cache.has(path)) {
                return cache.get(path);
              }
              const content = fs.readFileSync(path, "utf8");
              cache.set(path, content);
              return content;
            },
            writeFile: fs.writeFileSync,
          }
        );
        return [valRoot, service];
      })
    )
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

function getValRoots(valConfigFiles: string[], packageJsonFiles: string[]) {
  // find all package json files that have a val config files in a subdirectory
  const valRoots = [];
  for (const packageJsonFile of packageJsonFiles) {
    if (
      valConfigFiles.some((valConfigFile) =>
        valConfigFile.startsWith(path.dirname(packageJsonFile))
      )
    ) {
      valRoots.push(path.dirname(packageJsonFile));
    }
  }
  return valRoots;
}

connection.onDidChangeWatchedFiles((params) => {
  params.changes.forEach((change) => {
    console.log(change);
  });
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// The example settings
interface ExampleSettings {
  maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ExampleSettings>(
      (change.settings.valBuild || defaultSettings)
    );
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "valBuild",
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  return validateTextDocument(change.document);
});

function uriToFsPath(uri: string): string {
  // TODO: use vscode.Uri or something from vscode instead
  return uri.replace("file://", "");
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);

  // The validator creates diagnostics for all uppercase words length 2 and more
  const text = textDocument.getText();
  // vs code extension get path of uri:

  const diagnostics: Diagnostic[] = [];
  const fsPath = uriToFsPath(textDocument.uri);
  const valRoot = valRoots?.find((valRoot) => fsPath.startsWith(valRoot));
  const service = valRoot ? servicesByValRoot[valRoot] : undefined;
  const isValModule = fsPath.includes(".val.ts") || fsPath.includes(".val.js");
  const isValRelatedFile =
    isValModule ||
    fsPath.includes("val.config.ts") ||
    fsPath.includes("val.config.js");
  if (isValRelatedFile) {
    cache.set(fsPath, text);
  }
  if (valRoot && service && isValModule) {
    const { source, schema, errors } = await service.get(
      fsPath
        .replace(valRoot, "")
        .replace(".val.ts", "")
        .replace(".val.js", "") as ModuleId,
      "" as ModulePath
    );
    if (errors && errors.fatal) {
      for (const error of errors.fatal || []) {
        if (error.stack) {
          const maybeLine = stackToLine(fsPath, error.stack);
          if (maybeLine !== undefined) {
            const line = Math.max(maybeLine - 1, 0);
            const diagnostic: Diagnostic = {
              severity: DiagnosticSeverity.Error,
              range: {
                start: {
                  line,
                  character: 0,
                },
                end: {
                  line,
                  character: 1000,
                },
              },
              message: error.message,
              source: "val",
            };
            diagnostics.push(diagnostic);
          }
        }
      }
    }
    if (errors && errors.validation) {
      const modulePathMap = createModulePathMap(
        ts.createSourceFile(
          uriToFsPath(textDocument.uri),
          text,
          ts.ScriptTarget.ES2015,
          true
        )
      );

      for (const [sourcePath, value] of Object.entries(errors.validation)) {
        if (value) {
          value.forEach((error) => {
            const [_, modulePath] = Internal.splitModuleIdAndModulePath(
              sourcePath as SourcePath
            );
            let range =
              modulePathMap && getModulePathRange(modulePath, modulePathMap);
            if (range && modulePathMap) {
              const valRange = getModulePathRange(
                modulePath + '."val"',
                modulePathMap
              );
              if (valRange) {
                range = valRange;
              }

              // Skipping these for now, since we do not have hot fix yet
              if (!error.fixes?.includes("image:replace-metadata")) {
                const addMetadataFix = error.fixes?.find(
                  (fix) => fix === "image:add-metadata"
                );
                const diagnostic: Diagnostic = {
                  severity: DiagnosticSeverity.Warning,
                  range,
                  message: error.message,
                  source: "val",
                };
                if (source && schema && addMetadataFix) {
                  diagnostic.code = addMetadataFix;
                  // Can't access
                  // diagnostic.data = Internal.resolvePath(
                  //   modulePath,
                  //   source,
                  //   schema
                  // );
                }
                diagnostics.push(diagnostic);
              }
            }
          });
        }
      }
    }
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received a file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = "TypeScript details";
    item.documentation = "TypeScript documentation";
  } else if (item.data === 2) {
    item.detail = "JavaScript details";
    item.documentation = "JavaScript documentation";
  }
  return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
