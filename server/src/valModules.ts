import fs from "fs";
import path from "path";
import ts from "typescript";
import { createTsVmRuntime } from "./tsRuntime";

/**
 * Result structure for a processed Val module
 */
export interface ValModuleResult {
  path: string;
  schema?: any;
  source?: any;
  validation?: any;
  runtimeError: boolean;
  defaultExport: boolean;
  message?: string;
}

/**
 * Find the val.modules file for a given valRoot
 * It should be in a subdirectory of valRoot
 */
export function findValModulesFile(
  valRoot: string,
  valModulesFiles: string[]
): string | undefined {
  return valModulesFiles.find((valModulesFile) =>
    valModulesFile.startsWith(valRoot)
  );
}

/**
 * Generate code that processes val.modules and extracts validation info
 * This matches the logic from tsRuntime.test.ts
 */
function generateModuleProcessorCode(): string {
  return `
import * as modules from "./val.modules";
import { Internal } from "@valbuild/core";

export default Promise.all(modules.default?.modules.map((module, index) => module.def().then(importedModule => {
  const valModule = importedModule.default;
  if (!valModule) {
    return {
      path: undefined,
      schema: undefined,
      source: undefined,
      validation: {
        ["/"]: [{
          message: "Module has no default export"
        }]
      },
      runtimeError: true,
      defaultExport: false,
    };
  }
  
  const path = Internal.getValPath(valModule);
  
  let schema;
  let runtimeError = false;
  try {
    schema = Internal.getSchema(valModule)['executeSerialize']();
  } catch (error) {
    console.error("Error getting schema for module at path:", path, error);
    schema = undefined;
  }
  let source;
  try {
    source = Internal.getSource(valModule);
  } catch (error) {
    console.error("Error getting source for module at path:", path, error);
    source = undefined;
  }
  let validation;
  try {
    if (source && schema) {
      validation = Internal.validate(valModule, path || "/", source);
    } else {
      validation = {
        [path || "/"]: [
          {
            message: "Could not validate module: " + (!source && !schema ? "source and schema are undefined" : !source ? "source is undefined" : "schema is undefined")
          }
        ]
      }
    }
  } catch (error) {
    console.error("Error validating module at path:", path, error);
    validation = {
      [path || "/"]: [
        {
          message: error.message,
        }
      ]
    };
  }
  return {
    path: path,
    schema,
    source,
    validation,
    runtimeError,
    defaultExport: !!importedModule.default,
  };
}).catch(error => {
  console.error("Failed to load module #" + index + ":", error.message);
  return {
    path: undefined,
    runtimeError: true,
    defaultExport: false,
    message: error.message,
    validation: {
      ["/"]: [
        {
          message: "Failed to load module: " + error.message,
        }
      ]
    },
  };
})));
`;
}

/**
 * Find tsconfig.json or jsconfig.json by walking up the directory tree
 * @param startPath - The starting directory path
 * @returns Path to tsconfig.json or jsconfig.json, or null if not found
 */
function findConfigFile(startPath: string): string | null {
  // Determine if startPath is a directory or file
  let currentDir: string;
  try {
    const stats = fs.statSync(startPath);
    currentDir = stats.isDirectory() ? startPath : path.dirname(startPath);
  } catch {
    // If stat fails, assume it's a file path
    currentDir = path.dirname(startPath);
  }

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

/**
 * Create a Val modules runtime with a custom file system host
 * @param host - TypeScript ParseConfigHost for file system operations
 * @param configPath - Path to tsconfig.json or jsconfig.json
 * @returns A configured runtime instance
 */
export function createValModulesRuntime(
  host: ts.ParseConfigHost,
  configPath: string
): ReturnType<typeof createTsVmRuntime> {
  // Read the tsconfig to get compiler options
  const configFile = ts.readConfigFile(configPath, host.readFile);
  if (configFile.error) {
    throw new Error(`Error reading tsconfig: ${configFile.error.messageText}`);
  }

  const basePath = path.dirname(configPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    host,
    basePath
  );

  // Ensure baseUrl is set if paths are configured
  if (parsedConfig.options.paths && !parsedConfig.options.baseUrl) {
    parsedConfig.options.baseUrl = basePath;
  }

  // Debug: Log if paths are configured
  if (parsedConfig.options.paths) {
    console.log(
      "TypeScript path mappings found:",
      Object.keys(parsedConfig.options.paths)
    );
    console.log("Base URL:", parsedConfig.options.baseUrl);
  }

  const runtime = createTsVmRuntime({
    compilerOptions: parsedConfig.options,
    host: host,
  });

  return runtime;
}

/**
 * Generate code that processes a single module by index
 */
function generateSingleModuleProcessorCode(index: number): string {
  return `
import * as modules from "./val.modules";
import { Internal } from "@valbuild/core";

const targetModule = modules.default?.modules[${index}];
if (!targetModule) {
  throw new Error("Module at index ${index} does not exist");
}

export default targetModule.def().then(importedModule => {
  const valModule = importedModule.default;
  if (!valModule) {
    return {
      path: undefined,
      schema: undefined,
      source: undefined,
      validation: {
        ["/"]: [{
          message: "Module has no default export"
        }]
      },
      runtimeError: true,
      defaultExport: false,
    };
  }
  
  const path = Internal.getValPath(valModule);
  
  let schema;
  let runtimeError = false;
  try {
    schema = Internal.getSchema(valModule)['executeSerialize']();
  } catch (error) {
    console.error("Error getting schema for module at path:", path, error);
    schema = undefined;
  }
  let source;
  try {
    source = Internal.getSource(valModule);
  } catch (error) {
    console.error("Error getting source for module at path:", path, error);
    source = undefined;
  }
  let validation;
  try {
    if (source && schema) {
      validation = Internal.validate(valModule, path || "/", source);
    } else {
      validation = {
        [path || "/"]: [
          {
            message: "Could not validate module: " + (!source && !schema ? "source and schema are undefined" : !source ? "source is undefined" : "schema is undefined")
          }
        ]
      }
    }
  } catch (error) {
    console.error("Error validating module at path:", path, error);
    validation = {
      [path || "/"]: [
        {
          message: error.message,
        }
      ]
    };
  }
  return {
    path: path,
    schema,
    source,
    validation,
    runtimeError,
    defaultExport: !!importedModule.default,
  };
}).catch(error => {
  console.error("Failed to load module #${index}:", error.message);
  return {
    path: undefined,
    runtimeError: true,
    defaultExport: false,
    message: error.message,
    validation: {
      ["/"]: [
        {
          message: "Failed to load module: " + error.message,
        }
      ]
    },
  };
});
`;
}

/**
 * Evaluate a val.modules file using a provided runtime
 * @param runtime - The runtime instance to use for evaluation
 * @param valModulesFilePath - Path to the val.modules file
 * @returns Processed module information including validation results
 */
export async function evaluateValModulesFile(
  runtime: ReturnType<typeof createTsVmRuntime>,
  valModulesFilePath: string
): Promise<ValModuleResult[] | null> {
  try {
    // Get the directory containing val.modules file
    const valModulesDir = path.dirname(valModulesFilePath);

    // Generate and run the module processor code
    const moduleCode = generateModuleProcessorCode();
    const result = await runtime.run(
      moduleCode,
      path.join(valModulesDir, "<system>.ts")
    );

    // The module exports a Promise as default, so await it
    const processedModules = await result.default;

    return processedModules;
  } catch (err) {
    console.error(
      `Error evaluating val.modules file: ${valModulesFilePath}`,
      err
    );
    return null;
  }
}

/**
 * Evaluate a single module by index from val.modules file
 * @param runtime - The runtime instance to use for evaluation
 * @param valModulesFilePath - Path to the val.modules file
 * @param index - Index of the module to evaluate
 * @returns Processed module information or null if failed
 */
export async function evaluateSingleModule(
  runtime: ReturnType<typeof createTsVmRuntime>,
  valModulesFilePath: string,
  index: number
): Promise<ValModuleResult | null> {
  try {
    // Get the directory containing val.modules file
    const valModulesDir = path.dirname(valModulesFilePath);

    // Generate and run the single module processor code
    const moduleCode = generateSingleModuleProcessorCode(index);
    const result = await runtime.run(
      moduleCode,
      path.join(valModulesDir, `<system-${index}>.ts`)
    );

    // The module exports a Promise as default, so await it
    const processedModule = await result.default;

    return processedModule;
  } catch (err) {
    console.error(
      `Error evaluating module at index ${index} from ${valModulesFilePath}`,
      err
    );
    return null;
  }
}

/**
 * Convenience function to evaluate a val.modules file using the real file system
 * Finds the tsconfig, creates a runtime, and evaluates the modules
 * @param filePath - Path to the val.modules file
 * @returns Processed module information including validation results
 */
export async function evaluateValModulesFileWithFileSystem(
  filePath: string
): Promise<ValModuleResult[] | null> {
  try {
    // Find tsconfig.json or jsconfig.json
    const configPath = findConfigFile(filePath);
    if (!configPath) {
      console.error(`No tsconfig.json or jsconfig.json found for: ${filePath}`);
      return null;
    }

    // Create runtime with real file system host
    const host: ts.ParseConfigHost = {
      readDirectory: (
        rootDir: string,
        extensions: readonly string[],
        excludes: readonly string[] | undefined,
        includes: readonly string[],
        depth?: number
      ) => {
        return ts.sys.readDirectory(
          rootDir,
          extensions,
          excludes,
          includes,
          depth
        );
      },
      fileExists: (fileName: string) => {
        return ts.sys.fileExists(fileName);
      },
      readFile: (fileName: string) => {
        return ts.sys.readFile(fileName);
      },
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    };

    const runtime = createValModulesRuntime(host, configPath);
    return await evaluateValModulesFile(runtime, filePath);
  } catch (err) {
    console.error(`Error evaluating val.modules file: ${filePath}`, err);
    return null;
  }
}

/**
 * Get evaluated and processed modules for a given valRoot using the file system
 * @param valRoot - The root directory to look for val.modules file
 * @param valModulesFilesByValRoot - Map of valRoot to val.modules file paths
 * @returns The processed module results or null if not found
 */
export async function getValModules(
  valRoot: string,
  valModulesFilesByValRoot: { [valRoot: string]: string }
): Promise<ValModuleResult[] | null> {
  const valModulesFile = valModulesFilesByValRoot[valRoot];
  if (!valModulesFile) {
    return null;
  }
  return await evaluateValModulesFileWithFileSystem(valModulesFile);
}
