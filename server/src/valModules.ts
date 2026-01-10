import fs from "fs";
import path from "path";
import { createTsVmRuntime } from "./tsRuntime";

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
 * Evaluate a TypeScript or JavaScript file and return its exports
 * Uses tsRuntime to compile and execute the code with proper TypeScript support
 */
export async function evaluateValModulesFile(filePath: string): Promise<any> {
  try {
    // Find tsconfig.json or jsconfig.json
    const configPath = findConfigFile(filePath);
    if (!configPath) {
      console.error(`No tsconfig.json or jsconfig.json found for: ${filePath}`);
      return null;
    }

    // Create runtime and execute
    const runtime = createTsVmRuntime({
      tsconfigPath: configPath,
      entry: filePath,
    });

    console.log("Running runtime...");
    const namespace = await runtime.run();

    // Return the module namespace
    console.log("Module namespace:", namespace);
    console.log("Module keys:", Object.keys(namespace));
    const moduleExports = namespace as any;
    if (moduleExports.default) {
      console.log("Module default export:", moduleExports.default);
      console.log(
        "Module default keys:",
        typeof moduleExports.default === "object"
          ? Object.keys(moduleExports.default)
          : typeof moduleExports.default
      );
    }
    return namespace;
  } catch (err) {
    console.error(`Error evaluating val.modules file: ${filePath}`, err);
    return null;
  }
}

/**
 * Get evaluated modules for a given valRoot
 * @param valRoot - The root directory to look for val.modules file
 * @param valModulesFilesByValRoot - Map of valRoot to val.modules file paths
 * @returns The evaluated modules or null if not found
 */
export async function getValModules(
  valRoot: string,
  valModulesFilesByValRoot: { [valRoot: string]: string }
): Promise<any> {
  const valModulesFile = valModulesFilesByValRoot[valRoot];
  if (!valModulesFile) {
    return null;
  }
  return await evaluateValModulesFile(valModulesFile);
}
