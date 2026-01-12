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
  CodeAction,
  CodeActionKind,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
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
import { getFileExt } from "./getFileExt";
import { SerializedRegExpPattern } from "./routeValidation";
import { checkRouteIsValid } from "./checkRoute";
import { findSimilar } from "./findSimilar";
import { levenshtein } from "./levenshtein";
import {
  findValModulesFile,
  createValModulesRuntime,
  evaluateValModulesFile,
  evaluateSingleModule,
  ValModuleResult,
} from "./valModules";
import { isFileInValModulesAST } from "./isFileInValModulesAST";
import { detectCompletionContext, isValFile } from "./completionContext";
import { CompletionProviderRegistry } from "./completionProviders";
import { ValService } from "./ValService";
import { PublicValFilesCache } from "./publicValFilesCache";

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
  [valRoot: string]: ValService;
} = {};
let valModulesFilesByValRoot: {
  [valRoot: string]: string;
} = {};
let runtimesByValRoot: {
  [valRoot: string]: ReturnType<typeof createValModulesRuntime>;
} = {};
// Store index -> path mappings for each val root for optimized validation
let moduleIndexMappingsByValRoot: {
  [valRoot: string]: Map<string, number>; // path -> index
} = {};
// Initialize public val files cache
const publicValFilesCache = new PublicValFilesCache();
// Initialize completion provider registry
const completionProviderRegistry = new CompletionProviderRegistry(
  publicValFilesCache
);

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
  const valModulesFiles = [];
  const packageJsonFiles = [];
  for (const workspaceFolder of params.workspaceFolders || []) {
    valConfigFiles.push(
      ...(await glob(
        `${uriToFsPath(workspaceFolder.uri)}/**/val.config.{t,j}s`,
        {}
      ))
    );
    valModulesFiles.push(
      ...(await glob(
        `${uriToFsPath(workspaceFolder.uri)}/**/val.modules.{t,j}s`,
        {}
      ))
    );
    packageJsonFiles.push(
      ...(await glob(`${uriToFsPath(workspaceFolder.uri)}/**/package.json`, {}))
    );
  }
  valRoots = getValRoots(valConfigFiles, packageJsonFiles);

  // Map val.modules files to their respective valRoots
  valModulesFilesByValRoot = {};
  for (const valRoot of valRoots) {
    const valModulesFile = findValModulesFile(valRoot, valModulesFiles);
    if (valModulesFile) {
      valModulesFilesByValRoot[valRoot] = valModulesFile;
      console.log(
        `Found val.modules file for root '${valRoot}': ${valModulesFile}`
      );
    }
  }

  // Create file system abstraction for Val services
  const cachedFileSystem = createCachedFileSystem(cache);

  // Initialize services for each Val root
  servicesByValRoot = Object.fromEntries(
    await Promise.all(
      valRoots
        .filter((valRoot) => !valRoot.includes("node_modules"))
        .map(async (valRoot) => {
          const service = await initializeService(valRoot, cachedFileSystem);
          return [valRoot, service];
        })
    )
  );

  // Initialize public val files cache for each Val root
  for (const valRoot of valRoots.filter(
    (valRoot) => !valRoot.includes("node_modules")
  )) {
    await publicValFilesCache.initialize(valRoot);
    console.log(`Initialized public val files cache for root: ${valRoot}`);
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
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

// File system operations abstraction for Val service
interface ValFileSystem {
  readFile: (path: string) => string | undefined;
  writeFile: (fileName: string, data: string | Buffer, encoding?: any) => void;
  rmFile: (path: string) => void;
}

// Create a cached file system implementation
function createCachedFileSystem(cache: Map<string, any>): ValFileSystem {
  return {
    readFile(filePath: string): string | undefined {
      if (cache.has(filePath)) {
        return cache.get(filePath);
      }
      const content = fs.readFileSync(filePath, "utf8");
      cache.set(filePath, content);
      return content;
    },
    writeFile(fileName: string, data: string | Buffer, encoding?: any): void {
      if (typeof data !== "string") {
        fs.writeFileSync(fileName, data.toString("utf-8"), encoding as any);
      } else {
        fs.writeFileSync(fileName, data, encoding as any);
      }
    },
    rmFile: fs.unlinkSync,
  };
}

// Initialize a service for a given root directory
async function initializeService(
  valRoot: string,
  fileSystem: ValFileSystem
): Promise<ValService> {
  console.log("Initializing Val Service for: '" + valRoot + "'...");

  // Find tsconfig.json or jsconfig.json
  const configPath = findConfigFile(valRoot);
  if (!configPath) {
    console.error(`No tsconfig.json or jsconfig.json found for: ${valRoot}`);
    throw new Error(`No config file found for Val root: ${valRoot}`);
  }

  // Create custom host that uses our cached file system
  const host: ts.ParseConfigHost = {
    readDirectory: ts.sys.readDirectory,
    fileExists: (fileName: string) => {
      try {
        return ts.sys.fileExists(fileName);
      } catch {
        return false;
      }
    },
    readFile: (fileName: string) => {
      try {
        return fileSystem.readFile(fileName);
      } catch {
        return undefined;
      }
    },
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };

  // Create runtime with custom host
  const runtime = createValModulesRuntime(host, configPath);

  // Store runtime for cache invalidation
  runtimesByValRoot[valRoot] = runtime;

  // Get val.modules file path
  const valModulesFile = valModulesFilesByValRoot[valRoot];
  if (!valModulesFile) {
    console.error(`No val.modules file found for: ${valRoot}`);
    throw new Error(`No val.modules file found for Val root: ${valRoot}`);
  }

  console.log("Created Val Service! Root: '" + valRoot + "'");

  // Initialize index mapping
  if (!moduleIndexMappingsByValRoot[valRoot]) {
    moduleIndexMappingsByValRoot[valRoot] = new Map();
  }

  // Helper to get all modules and build index mapping
  const getAllModulesAndBuildIndex = async (): Promise<
    ValModuleResult[] | null
  > => {
    const modules = await evaluateValModulesFile(runtime, valModulesFile);
    if (modules) {
      // Build index mapping: path -> index
      const indexMapping = moduleIndexMappingsByValRoot[valRoot];
      indexMapping.clear();
      modules.forEach((module, index) => {
        if (module.path) {
          indexMapping.set(module.path, index);
        }
      });
    }
    return modules;
  };

  // Helper to get a single module by path using index
  const getSingleModuleByPath = async (
    path: string
  ): Promise<{ module: ValModuleResult; fromIndex: boolean } | null> => {
    const indexMapping = moduleIndexMappingsByValRoot[valRoot];
    const index = indexMapping.get(path);

    if (index !== undefined) {
      // Try to evaluate by index
      const module = await evaluateSingleModule(runtime, valModulesFile, index);

      if (module && module.path === path) {
        // Index is still valid
        return { module, fromIndex: true };
      }

      // Index is invalid, need to rebuild
      console.log(`Index mapping invalid for ${path}, rebuilding...`);
    }

    // Fall back to full evaluation
    const modules = await getAllModulesAndBuildIndex();
    if (!modules) {
      return null;
    }

    const foundModule = modules.find((m) => m.path === path);
    return foundModule ? { module: foundModule, fromIndex: false } : null;
  };

  // Return service interface
  return {
    getAllModulePaths: async () => {
      const modules = await getAllModulesAndBuildIndex();
      if (!modules) {
        return [];
      }
      return modules
        .filter((m) => m.path !== undefined)
        .map((m) => m.path as string);
    },
    getAllModules: async () => {
      const modules = await getAllModulesAndBuildIndex();
      return modules || [];
    },
    read: async (moduleFilePath, modulePath, options) => {
      try {
        // Find the matching module
        const normalizedModuleFilePath = moduleFilePath.startsWith("/")
          ? moduleFilePath
          : "/" + moduleFilePath;

        const result = await getSingleModuleByPath(normalizedModuleFilePath);

        if (!result) {
          return {
            path: (moduleFilePath + modulePath) as SourcePath,
            errors: {
              invalidModulePath: moduleFilePath,
            },
          };
        }

        const matchingModule = result.module;

        // Check for runtime errors
        if (matchingModule.runtimeError) {
          return {
            path: (moduleFilePath + modulePath) as SourcePath,
            errors: {
              fatal: [
                {
                  message: matchingModule.message || "Runtime error in module",
                },
              ],
            },
          };
        }

        // Check if there are validation errors
        const hasValidationErrors =
          matchingModule.validation &&
          Object.keys(matchingModule.validation).length > 0;

        // Return result with or without validation errors
        if (matchingModule.schema && matchingModule.source) {
          return {
            source: matchingModule.source,
            schema: matchingModule.schema,
            path: (moduleFilePath + modulePath) as SourcePath,
            errors: hasValidationErrors
              ? {
                  validation: matchingModule.validation,
                }
              : false,
          };
        }

        // Return result with validation errors (when schema or source is missing)
        return {
          source: matchingModule.source,
          schema: matchingModule.schema,
          path: (moduleFilePath + modulePath) as SourcePath,
          errors: {
            validation: matchingModule.validation || false,
          },
        };
      } catch (err) {
        console.error("Error reading module:", err);
        return {
          path: (moduleFilePath + modulePath) as SourcePath,
          errors: {
            fatal: [
              {
                message: err instanceof Error ? err.message : "Unknown error",
                stack: err instanceof Error ? err.stack : undefined,
              },
            ],
          },
        };
      }
    },
  };
}

// Find tsconfig.json or jsconfig.json by walking up the directory tree
function findConfigFile(startPath: string): string | null {
  let currentDir = startPath;

  // Walk up the directory tree
  while (true) {
    // Check for tsconfig.json first
    const tsconfigPath = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }

    // Check for jsconfig.json
    const jsconfigPath = path.join(currentDir, "jsconfig.json");
    if (fs.existsSync(jsconfigPath)) {
      return jsconfigPath;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);

    // If we've reached the root, stop
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

// Helper function to check if a file exports default c.define()
// Returns the position of the export statement if found
function hasDefaultCDefineExport(fileContent: string): {
  found: boolean;
  line?: number;
  character?: number;
  endLine?: number;
  endCharacter?: number;
  valPath?: string;
  isValid?: boolean;
} {
  try {
    const sourceFile = ts.createSourceFile(
      "temp.ts",
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const expression = statement.expression;
        if (
          ts.isCallExpression(expression) &&
          ts.isPropertyAccessExpression(expression.expression)
        ) {
          const obj = expression.expression.expression;
          const method = expression.expression.name;
          if (
            ts.isIdentifier(obj) &&
            obj.text === "c" &&
            ts.isIdentifier(method) &&
            method.text === "define"
          ) {
            // Check that c.define has exactly 3 arguments
            if (expression.arguments.length !== 3) {
              return { found: false, isValid: false };
            }

            // Check that the first argument is a string literal
            const firstArg = expression.arguments[0];
            if (!ts.isStringLiteral(firstArg)) {
              return { found: false, isValid: false };
            }

            const valPath = firstArg.text;

            // Get the position of the export statement
            const start = sourceFile.getLineAndCharacterOfPosition(
              statement.getStart(sourceFile)
            );
            const end = sourceFile.getLineAndCharacterOfPosition(
              statement.getEnd()
            );
            return {
              found: true,
              line: start.line,
              character: start.character,
              endLine: end.line,
              endCharacter: end.character,
              valPath: valPath,
              isValid: true,
            };
          }
        }
      }
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

const textEncoder = new TextEncoder();

// Track documents currently being validated to prevent cascading revalidations
const validatingDocuments = new Set<string>();

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const text = textDocument.getText();
  let diagnostics: Diagnostic[] = [];
  const fsPath = decodeURIComponent(uriToFsPath(textDocument.uri));

  // Prevent cascading revalidations
  if (validatingDocuments.has(fsPath)) {
    console.log(
      `Skipping revalidation for ${fsPath} - already being validated`
    );
    return;
  }

  // Mark as being validated
  validatingDocuments.add(fsPath);

  try {
    await validateTextDocumentInternal(textDocument, text, fsPath, diagnostics);
  } finally {
    // Always remove from the set when done
    validatingDocuments.delete(fsPath);
  }
}

async function validateTextDocumentInternal(
  textDocument: TextDocument,
  text: string,
  fsPath: string,
  diagnostics: Diagnostic[]
): Promise<void> {
  const valRoot = valRoots?.find((valRoot) => fsPath.startsWith(valRoot));
  const service = valRoot ? servicesByValRoot[valRoot] : undefined;
  const isValModule = fsPath.includes(".val.ts") || fsPath.includes(".val.js");

  const isValRelatedFile =
    isValModule ||
    fsPath.includes("val.config.ts") ||
    fsPath.includes("val.config.js") ||
    fsPath.includes("val.modules.ts") ||
    fsPath.includes("val.modules.js");

  if (isValRelatedFile) {
    cache.set(fsPath, text);

    // Invalidate runtime cache for this file
    if (valRoot && runtimesByValRoot[valRoot]) {
      runtimesByValRoot[valRoot].invalidateFile(fsPath);

      // Also invalidate the system file that runs validation
      // This ensures validation is re-run with fresh data
      const valModulesFile = valModulesFilesByValRoot[valRoot];
      if (valModulesFile) {
        const valModulesDir = path.dirname(valModulesFile);
        const systemFile = path.join(valModulesDir, "<system>.ts");
        runtimesByValRoot[valRoot].invalidateFile(systemFile);

        // Invalidate all system files for index-based validation
        for (let i = 0; i < 100; i++) {
          const indexSystemFile = path.join(valModulesDir, `<system-${i}>.ts`);
          runtimesByValRoot[valRoot].invalidateFile(indexSystemFile);
        }
      }

      // If val.modules file itself changed, clear the index mapping
      if (fsPath.includes("val.modules")) {
        console.log(
          `val.modules changed, clearing index mapping for: ${valRoot}`
        );
        if (moduleIndexMappingsByValRoot[valRoot]) {
          moduleIndexMappingsByValRoot[valRoot].clear();
        }

        // Revalidate all open .val.ts files since they might now be included/excluded
        console.log(`Revalidating all open .val.ts files for: ${valRoot}`);
        documents.all().forEach((doc) => {
          const docPath = decodeURIComponent(uriToFsPath(doc.uri));
          if (
            docPath.startsWith(valRoot) &&
            (docPath.includes(".val.ts") || docPath.includes(".val.js"))
          ) {
            // Don't await - let them validate in parallel
            validateTextDocument(doc);
          }
        });
      } else if (isValModule) {
        // If a .val file changed, revalidate all other open .val files
        // since they might depend on this file's schema (e.g., via keyOf)
        console.log(
          `Val module changed: ${fsPath}, revalidating dependent files for: ${valRoot}`
        );
        documents.all().forEach((doc) => {
          const docPath = decodeURIComponent(uriToFsPath(doc.uri));
          // Skip the current file (it will be validated anyway)
          // and only revalidate other .val files in the same valRoot
          if (
            docPath !== fsPath &&
            docPath.startsWith(valRoot) &&
            (docPath.includes(".val.ts") || docPath.includes(".val.js"))
          ) {
            // Don't await - let them validate in parallel
            validateTextDocument(doc);
          }
        });
      }
    }
  }
  if (valRoot && service && isValModule) {
    const { source, schema, errors } = await service.read(
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
                try {
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
                } catch (err) {
                  console.error(
                    `[ERROR] Failed to resolve path for modulePath: ${modulePath}`,
                    err
                  );
                  // Don't crash - just skip this diagnostic
                  continue;
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
                const routerFix = error.fixes?.find(
                  (fix) => fix === "router:check-route"
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
                    const refModule = await service.read(
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
                } else if (source && schema && routerFix) {
                  // Validate route existence and patterns
                  console.log(
                    "[DEBUG router:check-route] error.value:",
                    error.value,
                    "type:",
                    typeof error.value
                  );

                  // Extract route and patterns from error.value
                  let route: string;
                  let include: SerializedRegExpPattern | undefined;
                  let exclude: SerializedRegExpPattern | undefined;

                  if (typeof error.value === "string") {
                    // Old format: just a string
                    route = error.value;
                    // Extract router configuration from schema
                    if ("router" in schema && schema.router) {
                      const routerConfig = schema.router as any;
                      include = routerConfig.include as
                        | SerializedRegExpPattern
                        | undefined;
                      exclude = routerConfig.exclude as
                        | SerializedRegExpPattern
                        | undefined;
                    }
                  } else if (
                    typeof error.value === "object" &&
                    error.value &&
                    "route" in error.value &&
                    typeof error.value.route === "string"
                  ) {
                    // New format: object with route, include, exclude
                    route = error.value.route;
                    include = error.value.include as
                      | SerializedRegExpPattern
                      | undefined;
                    exclude = error.value.exclude as
                      | SerializedRegExpPattern
                      | undefined;
                  } else {
                    console.error(
                      "[ERROR router:check-route] Expected error.value to be a string or object with route property, but got:",
                      typeof error.value,
                      error.value
                    );
                    // NOTE: this ignores error - same as keyof:check-keys handling
                    continue;
                  }

                  console.log(
                    "[DEBUG router:check-route] Validating route:",
                    route,
                    "include:",
                    include,
                    "exclude:",
                    exclude
                  );

                  // Validate route existence and patterns
                  const validationResult = await checkRouteIsValid(
                    route,
                    include,
                    exclude,
                    service
                  );

                  console.log(
                    "[DEBUG router:check-route] Validation result:",
                    validationResult
                  );

                  if (validationResult.error) {
                    diagnostic.message = validationResult.message;
                    diagnostics.push(diagnostic);
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
                  try {
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
                      continue;
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
                    diagnostic.message =
                      "Expected remote file, but found local";
                    diagnostics.push(diagnostic);
                  } catch (err) {
                    console.error(
                      `[ERROR] Failed to resolve path for uploadRemoteFileFix - modulePath: ${modulePath}`,
                      err
                    );
                    // Don't crash - just skip this diagnostic
                    continue;
                  }
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

  // Check if this is a .val.ts file with c.define export that's not in val.modules
  if (isValModule && valRoot && text && service) {
    const valModulesFile = valModulesFilesByValRoot[valRoot];
    if (valModulesFile) {
      const exportInfo = hasDefaultCDefineExport(text);
      const expectedModulePath = fsPath.replace(valRoot, "");
      if (
        exportInfo.found &&
        exportInfo.isValid &&
        exportInfo.valPath === expectedModulePath
      ) {
        // Check the AST to see if the file is already in val.modules
        // This prevents false positives when there are runtime errors
        const isInModules = isFileInValModulesAST(
          fsPath,
          valRoot,
          valModulesFile
        );
        if (!isInModules) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: {
              start: {
                line: exportInfo.line || 0,
                character: exportInfo.character || 0,
              },
              end: {
                line: exportInfo.endLine || exportInfo.line || 0,
                character: exportInfo.endCharacter || Number.MAX_VALUE,
              },
            },
            message:
              "This Val module is not registered in val.modules. Add it to val.modules to use it.",
            source: "val",
            code: "val:missing-module",
            data: {
              filePath: fsPath,
              valRoot: valRoot,
              valModulesFile: valModulesFile,
            },
          };
          diagnostics.push(diagnostic);
        }
      }
    }
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
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
  async (
    textDocumentPosition: TextDocumentPositionParams
  ): Promise<CompletionItem[]> => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document) {
      return [];
    }

    const fsPath = decodeURIComponent(
      uriToFsPath(textDocumentPosition.textDocument.uri)
    );

    // Only provide completion for .val.ts or .val.js files
    if (!isValFile(fsPath)) {
      return [];
    }

    const valRoot = valRoots?.find((valRoot) => fsPath.startsWith(valRoot));
    if (!valRoot) {
      return [];
    }

    const service = servicesByValRoot[valRoot];
    if (!service) {
      return [];
    }

    const text = document.getText();
    const position = textDocumentPosition.position;

    // Parse the document to detect context
    const sourceFile = ts.createSourceFile(
      fsPath,
      text,
      ts.ScriptTarget.Latest,
      true
    );

    // Detect the completion context
    const context = detectCompletionContext(sourceFile, position);

    console.log("[onCompletion] Context detected:", {
      type: context.type,
      modulePath: context.modulePath,
      partialText: context.partialText,
      hasStringNode: !!context.stringNode,
    });

    // Get completion items from the appropriate provider
    // The context detection already checks if it's a router schema for router completion
    if (context.type !== "none") {
      console.log(
        "[onCompletion] Getting completion items for type:",
        context.type
      );
      const items = await completionProviderRegistry.getCompletionItems(
        context,
        service,
        valRoot,
        sourceFile
      );
      console.log("[onCompletion] Returning", items.length, "items");
      return items;
    }

    console.log("[onCompletion] No completion context detected");
    return [];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
  async (item: CompletionItem): Promise<CompletionItem> => {
    // Check if this is an image or file completion item
    if (
      item.data &&
      typeof item.data === "object" &&
      (item.data.type === "image" || item.data.type === "file")
    ) {
      const { type, filePath, valRoot } = item.data;

      try {
        // Construct absolute file path
        const absoluteFilePath = path.join(valRoot, filePath);

        // Get metadata based on type
        let metadata: Record<string, string | number> = {};
        if (type === "image") {
          const { getImageMetadata } = await import("./metadataUtils");
          const imageMetadata = getImageMetadata(absoluteFilePath);
          if (imageMetadata) {
            metadata = imageMetadata as unknown as Record<
              string,
              string | number
            >;
          }
        } else if (type === "file") {
          const { getFileMetadata } = await import("./metadataUtils");
          const fileMetadata = getFileMetadata(absoluteFilePath);
          if (fileMetadata) {
            metadata = fileMetadata as unknown as Record<
              string,
              string | number
            >;
          }
        }

        if (metadata && Object.keys(metadata).length > 0) {
          // If there's existing metadata, parse it and preserve custom properties
          const existingCustomProps: Record<string, string> = {};
          if (item.data.existingMetadataText) {
            try {
              // Parse the existing metadata object
              const existingSourceFile = ts.createSourceFile(
                "temp.ts",
                `const x = ${item.data.existingMetadataText}`,
                ts.ScriptTarget.Latest,
                true
              );

              // Find the object literal
              const varStatement = existingSourceFile.statements[0];
              if (
                ts.isVariableStatement(varStatement) &&
                varStatement.declarationList.declarations[0]
              ) {
                const init =
                  varStatement.declarationList.declarations[0].initializer;
                if (init && ts.isObjectLiteralExpression(init)) {
                  // Extract all properties
                  for (const prop of init.properties) {
                    if (
                      ts.isPropertyAssignment(prop) &&
                      ts.isIdentifier(prop.name)
                    ) {
                      const propName = prop.name.text;
                      // Define auto-generated properties to exclude
                      const autoGeneratedProps =
                        type === "image"
                          ? ["width", "height", "mimeType"]
                          : ["mimeType"];

                      // Keep only custom properties (not auto-generated)
                      if (!autoGeneratedProps.includes(propName)) {
                        // Store the text of the initializer for later re-parsing
                        // This ensures proper serialization in the new context
                        existingCustomProps[propName] =
                          prop.initializer.getText(existingSourceFile);
                      }
                    }
                  }
                }
              }
            } catch (error) {
              console.error("Error parsing existing metadata:", error);
            }
          }

          // Merge new metadata with existing custom properties
          const metadataProperties = [
            // First, add new auto-generated metadata
            ...Object.entries(metadata).map(([key, value]) =>
              ts.factory.createPropertyAssignment(
                ts.factory.createIdentifier(key),
                typeof value === "number"
                  ? ts.factory.createNumericLiteral(value)
                  : ts.factory.createStringLiteral(value)
              )
            ),
            // Then, add preserved custom properties
            ...Object.entries(existingCustomProps).map(([key, valueText]) => {
              // Parse to understand the value type, then create a fresh node using factory
              const tempSource = ts.createSourceFile(
                "temp-value.ts",
                `const x = ${valueText}`,
                ts.ScriptTarget.Latest,
                true
              );
              const tempVar = tempSource.statements[0] as ts.VariableStatement;
              const tempInit =
                tempVar.declarationList.declarations[0].initializer;

              if (!tempInit) {
                console.error(`Failed to parse value for ${key}: ${valueText}`);
                return ts.factory.createPropertyAssignment(
                  ts.factory.createIdentifier(key),
                  ts.factory.createStringLiteral(valueText)
                );
              }

              // Create a completely fresh node based on the type
              // This ensures nodes work properly across different source file contexts
              let freshNode: ts.Expression;
              if (ts.isStringLiteral(tempInit)) {
                // For string literals, extract the text value (without quotes) and create new
                freshNode = ts.factory.createStringLiteral(tempInit.text);
              } else if (ts.isNumericLiteral(tempInit)) {
                freshNode = ts.factory.createNumericLiteral(tempInit.text);
              } else if (tempInit.kind === ts.SyntaxKind.TrueKeyword) {
                freshNode = ts.factory.createTrue();
              } else if (tempInit.kind === ts.SyntaxKind.FalseKeyword) {
                freshNode = ts.factory.createFalse();
              } else if (tempInit.kind === ts.SyntaxKind.NullKeyword) {
                freshNode = ts.factory.createNull();
              } else {
                // For complex expressions (objects, arrays, etc.), fallback to identifier
                console.warn(
                  `Complex value for ${key}, may not serialize correctly: ${valueText}`
                );
                freshNode = ts.factory.createIdentifier(valueText);
              }

              return ts.factory.createPropertyAssignment(
                ts.factory.createIdentifier(key),
                freshNode
              );
            }),
          ];

          const metadataObject = ts.factory.createObjectLiteralExpression(
            metadataProperties,
            true // multiline
          );

          // Print the metadata object to text
          const printer = ts.createPrinter({
            newLine: ts.NewLineKind.LineFeed,
          });
          const sourceFile = ts.createSourceFile(
            "temp.ts",
            "",
            ts.ScriptTarget.Latest,
            false,
            ts.ScriptKind.TS
          );
          const metadataText = printer.printNode(
            ts.EmitHint.Unspecified,
            metadataObject,
            sourceFile
          );

          // Add additionalTextEdits to insert metadata after the file path
          // The textEdit from the provider already handles replacing the file path
          // We need to add the metadata as the second argument
          if (item.textEdit && "range" in item.textEdit) {
            const range = item.textEdit.range;
            const edits = [];

            // If there's an existing second argument, we need to remove it first
            if (item.data.hasSecondArgument && item.data.secondArgumentRange) {
              const secondArgRange = item.data.secondArgumentRange;
              // Delete from the comma before the second argument to the end of the second argument
              // We need to go back one character from the start to include the comma and any whitespace
              edits.push(
                TextEdit.del({
                  start: {
                    line: range.end.line,
                    character: range.end.character + 1, // +1 to be after the closing quote (at comma)
                  },
                  end: {
                    line: secondArgRange.end.line,
                    character: secondArgRange.end.character,
                  },
                })
              );
            }

            // Insert the new metadata after the closing quote of the file path
            edits.push(
              TextEdit.insert(
                {
                  line: range.end.line,
                  character: range.end.character + 1, // +1 to be after the closing quote
                },
                `, ${metadataText}`
              )
            );

            item.additionalTextEdits = edits;

            const customPropsCount = Object.keys(existingCustomProps).length;
            console.log(
              `[onCompletionResolve] ${
                item.data.hasSecondArgument ? "Replaced" : "Added"
              } metadata for ${type}${
                customPropsCount > 0
                  ? ` (preserved ${customPropsCount} custom properties)`
                  : ""
              }: ${metadataText}`
            );
          }
        }
      } catch (error) {
        console.error(`Error resolving metadata for ${type}:`, error);
        // Return item without metadata on error
      }
    }

    return item;
  }
);

// Code action handler for automatic fixes
connection.onCodeAction((params) => {
  const diagnostics = params.context.diagnostics;
  const codeActions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "val:missing-module" && diagnostic.data) {
      const { filePath, valRoot, valModulesFile } = diagnostic.data as {
        filePath: string;
        valRoot: string;
        valModulesFile: string;
      };

      try {
        const valModulesContent = fs.readFileSync(valModulesFile, "utf-8");
        const relativePath = path
          .relative(path.dirname(valModulesFile), filePath)
          .replace(/\\/g, "/")
          .replace(/\.val\.ts$/, ".val")
          .replace(/\.val\.js$/, ".val");

        // Parse the val.modules file to find where to insert the new module
        const sourceFile = ts.createSourceFile(
          valModulesFile,
          valModulesContent,
          ts.ScriptTarget.Latest,
          true
        );

        let insertPosition: { line: number; character: number } | null = null;
        let modulesArrayNode: ts.ArrayLiteralExpression | null = null;
        let indentation = "    "; // Default indentation

        // Find the modules array in the config.modules([...])
        ts.forEachChild(sourceFile, function visit(node) {
          if (ts.isCallExpression(node)) {
            if (
              ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "modules" &&
              node.arguments.length > 0
            ) {
              const firstArg = node.arguments[0];
              if (ts.isArrayLiteralExpression(firstArg)) {
                modulesArrayNode = firstArg;
                // Find the last element in the array
                if (firstArg.elements.length > 0) {
                  const lastElement =
                    firstArg.elements[firstArg.elements.length - 1];
                  const pos = sourceFile.getLineAndCharacterOfPosition(
                    lastElement.end
                  );
                  insertPosition = pos;

                  // Detect indentation from the first element
                  const firstElement = firstArg.elements[0];
                  const firstElementPos =
                    sourceFile.getLineAndCharacterOfPosition(
                      firstElement.getStart(sourceFile)
                    );
                  indentation = " ".repeat(firstElementPos.character);
                } else {
                  // Empty array - insert at array start
                  const arrayStart = sourceFile.getLineAndCharacterOfPosition(
                    firstArg.getStart(sourceFile) + 1 // After the '['
                  );
                  insertPosition = arrayStart;
                }
              }
            }
          }
          ts.forEachChild(node, visit);
        });

        if (insertPosition !== null && modulesArrayNode !== null) {
          // Generate the import statement
          const importStatement = `import("./${relativePath}")`;

          // Determine if we need a comma before or after
          const arrayNode = modulesArrayNode as ts.ArrayLiteralExpression;
          const hasElements = arrayNode.elements.length > 0;
          const newText = hasElements
            ? `,\n${indentation}${importStatement}`
            : `\n${indentation}${importStatement}\n${indentation.slice(2)}`;

          // Create a workspace edit to add the module
          const textDocumentUri = `file://${valModulesFile}`;
          const edit = {
            changes: {
              [textDocumentUri]: [
                {
                  range: {
                    start: insertPosition,
                    end: insertPosition,
                  },
                  newText: newText,
                },
              ],
            },
          };

          const action: CodeAction = {
            title: "Add module to val.modules",
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: edit,
          };

          codeActions.push(action);
        }
      } catch (error) {
        console.error(
          "Failed to create code action for missing module:",
          error
        );
      }
    }
  }

  return codeActions;
});

// Clean up resources on shutdown
connection.onShutdown(() => {
  console.log("Shutting down server, cleaning up resources...");
  publicValFilesCache.dispose();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
