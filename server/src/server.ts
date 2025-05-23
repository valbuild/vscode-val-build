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
import { Service, createService } from "@valbuild/server";
import {
  FILE_REF_PROP,
  FileSource,
  Internal,
  ModuleFilePath,
  ModulePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import ts from "typescript";
import { createModulePathMap, getModulePathRange } from "./modulePathMap";
import { glob } from "glob";
import path from "path";
import fs from "fs";
import { stackToLine } from "./stackToLine";
import { error } from "console";
import { getFileExt } from "./getFileExt";

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
      valRoots
        .filter((valRoot) => !valRoot.includes("node_modules"))
        .map(async (valRoot) => {
          console.log("Initializing Val Service for: '" + valRoot + "'...");
          const service = await createService(
            valRoot,
            {
              disableCache: true,
            },
            {
              ...ts.sys,
              rmFile: fs.unlinkSync,
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
          console.log("Created Val Service! Root: '" + valRoot + "'");
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

const textEncoder = new TextEncoder();
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const text = textDocument.getText();
  let diagnostics: Diagnostic[] = [];
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
      fsPath.replace(valRoot, "") as ModuleFilePath,
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
          for (const error of value) {
            const [_, modulePath] = Internal.splitModuleFilePathAndModulePath(
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
              if (
                source &&
                schema &&
                // We have replaced image:replace-metadata with image:check-metadata, leaving this here for now, but this can be removed
                (error.fixes?.includes("image:replace-metadata" as any) ||
                  error.fixes?.includes("image:check-metadata") ||
                  error.fixes?.includes("file:check-metadata") ||
                  error.fixes?.includes("image:add-metadata") ||
                  error.fixes?.includes("image:add-metadata") ||
                  error.fixes?.includes("image:upload-remote") ||
                  error.fixes?.includes("file:upload-remote"))
              ) {
                const { source: sourceAtPath } = Internal.resolvePath(
                  modulePath,
                  source,
                  schema
                );
                const ref = (sourceAtPath as FileSource)[FILE_REF_PROP];
                const absFilePath = path.join(valRoot, ...ref.split("/"));
                if (!fs.existsSync(absFilePath)) {
                  const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range,
                    code: "file-not-found",
                    message: "File " + absFilePath + " does not exist",
                    source: "val",
                  };
                  diagnostics = [diagnostic];
                  connection.sendDiagnostics({
                    uri: textDocument.uri,
                    diagnostics,
                  });
                  return;
                }
              }
              // Skipping these for now, since we do not have hot fix yet
              if (
                // We have replaced image:replace-metadata with image:check-metadata, leaving this here for now, but this can be removed
                !error.fixes?.includes("image:replace-metadata" as any) &&
                !error.fixes?.includes("image:check-metadata") &&
                !error.fixes?.includes("file:check-metadata") &&
                !error.fixes?.includes("image:check-remote") &&
                !error.fixes?.includes("file:check-remote")
              ) {
                const addMetadataFix = error.fixes?.find(
                  (fix) =>
                    fix === "image:add-metadata" || fix === "file:add-metadata"
                );
                const keyOfFix = error.fixes?.find(
                  (fix) => fix === "keyof:check-keys"
                );
                const uploadRemoteFileFix = error.fixes?.find(
                  (fix) =>
                    fix === "file:upload-remote" ||
                    fix === "image:upload-remote"
                );
                const downloadRemoteFileFix = error.fixes?.find(
                  (fix) =>
                    fix === "file:download-remote" ||
                    fix === "image:download-remote"
                );
                const diagnostic: Diagnostic = {
                  severity: DiagnosticSeverity.Warning,
                  range,
                  message: error.message,
                  source: "val",
                };
                if (source && schema && keyOfFix) {
                  if (
                    typeof error.value === "object" &&
                    error.value &&
                    "key" in error.value &&
                    typeof error.value.key === "string" &&
                    "sourcePath" in error.value &&
                    typeof error.value.sourcePath === "string"
                  ) {
                    const key = error.value.key;
                    const sourcePath = error.value.sourcePath;
                    const [moduleFilePath, modulePath] =
                      Internal.splitModuleFilePathAndModulePath(
                        sourcePath as SourcePath
                      );
                    const refModule = await service.get(
                      moduleFilePath,
                      modulePath
                    );
                    const res = checkKeyOf(key, refModule);
                    if (res.error) {
                      diagnostic.message = res.message;
                      diagnostics.push(diagnostic);
                    }
                  } else {
                    console.error(
                      "Expected error.value to be an object with key property and sourcePath property"
                    );
                    // NOTE: this ignores error
                  }
                } else if (source && schema && addMetadataFix) {
                  diagnostic.code = addMetadataFix;
                  // TODO: this doesn't seem to work
                  // diagnostic.data = Internal.resolvePath(
                  //   modulePath,
                  //   source,
                  //   schema
                  // );
                  diagnostics.push(diagnostic);
                } else if (source && schema && uploadRemoteFileFix) {
                  const {
                    source: resolvedSourceAtPath,
                    schema: resolvedSchemaAtPath,
                  } = Internal.resolvePath(modulePath, source, schema);
                  const filePath = (resolvedSourceAtPath as any)?.[
                    FILE_REF_PROP
                  ];
                  if (typeof filePath !== "string") {
                    console.error(
                      "Expected filePath to be a string, but found " +
                        typeof filePath,
                      "in",
                      JSON.stringify(source)
                    );
                    return;
                  }
                  if (
                    resolvedSchemaAtPath.type !== "file" &&
                    resolvedSchemaAtPath.type !== "image"
                  ) {
                    console.error(
                      "Expected schema to be a file or image, but found " +
                        resolvedSchemaAtPath.type,
                      "in",
                      JSON.stringify(source)
                    );
                    return;
                  }
                  const fileExt = getFileExt(filePath);
                  const metadata = (resolvedSourceAtPath as any).metadata;
                  const fileHash = Internal.remote.getFileHash(
                    fs.readFileSync(
                      path.join(valRoot, ...filePath.split("/"))
                    ) as Buffer
                  );
                  diagnostic.code =
                    uploadRemoteFileFix +
                    ":" +
                    // TODO: figure out a different way to send the ValidationHash - we need it when creating refs in the client extension which is why we do it like this now...
                    Internal.remote.getValidationHash(
                      Internal.VERSION.core || "unknown",
                      resolvedSchemaAtPath as
                        | SerializedFileSchema
                        | SerializedImageSchema,
                      fileExt,
                      metadata,
                      fileHash,
                      textEncoder
                    );
                  diagnostic.message = "Expected remote file, but found local";
                  diagnostics.push(diagnostic);
                } else if (source && schema && downloadRemoteFileFix) {
                  diagnostic.message = "Expected locale file, but found remote";
                  diagnostic.code = downloadRemoteFileFix;
                  diagnostics.push(diagnostic);
                } else {
                  diagnostics.push(diagnostic);
                }
              }
            }
          }
        }
      }
    }
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// GPT generated levenshtein distance algorithm:
const levenshtein = (a: string, b: string): number => {
  const [m, n] = [a.length, b.length];
  if (!m || !n) return Math.max(m, n);

  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;

    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev + 1, dp[i - 1] + 1, dp[i] + 1);
      prev = temp;
    }
  }

  return dp[m];
};

function findSimilar(key: string, targets: string[]) {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}

function checkKeyOf(
  key: string,
  refModule: {
    source?: Source;
    schema?: SerializedSchema;
    path: SourcePath;
  }
):
  | {
      error: true;
      message: string;
    }
  | { error: false } {
  const schema = refModule.schema;
  const source = refModule.source;
  const path = refModule.path;
  if (schema) {
    if (schema.type !== "record") {
      return {
        error: true,
        message: "Expected schema to be a record",
      };
    } else {
      if (schema.opt) {
        return {
          error: true,
          message: "keyOf cannot be used on optional records",
        };
      }
      if (typeof source !== "object") {
        return {
          error: true,
          message: "keyOf must be used on records, found " + typeof source,
        };
      }
      if (Array.isArray(source)) {
        return {
          error: true,
          message: "keyOf must be used on records, found array",
        };
      }
      if (source === null) {
        return {
          error: true,
          message: "keyOf cannot be used on null",
        };
      }
      if (!source) {
        return {
          error: true,
          message: "Could not find source content",
        };
      }
      if (key in source) {
        return {
          error: false,
        };
      }
      const alternatives = findSimilar(key, Object.keys(source));
      return {
        error: true,
        message: `Key '${key}' does not exist in ${path}. Closest match: '${
          alternatives[0].target
        }'. Other similar: ${alternatives
          .slice(1, 4)
          .map((a) => `'${a.target}'`)
          .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`,
      };
    }
  } else {
    return {
      error: true,
      message: "Could not find schema. Check that this Val module exists",
    };
  }
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
