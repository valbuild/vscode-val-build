import ts from "typescript";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

export function loadTsConfig(tsconfigPath: string, host: ts.ParseConfigHost) {
  const configFile = ts.readConfigFile(tsconfigPath, host.readFile);
  if (configFile.error) throw configFile.error;

  return ts.parseJsonConfigFileContent(
    configFile.config,
    host,
    path.dirname(tsconfigPath)
  );
}

export function createTsVmRuntime(opts: {
  compilerOptions: ts.CompilerOptions;
  host: ts.ParseConfigHost;
}) {
  const compilerOptions = {
    ...opts.compilerOptions,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, // Use CommonJS for in-memory execution
    // Preserve original moduleResolution if set, otherwise use NodeNext
    moduleResolution:
      opts.compilerOptions.moduleResolution || ts.ModuleResolutionKind.NodeNext,
    noEmit: false, // Override noEmit from tsconfig
    noEmitOnError: false,
    sourceMap: false,
  };

  const moduleCache = new Map<string, any>();
  const jsCodeCache = new Map<string, string>();
  const getJsCode = (fileName: string) => {
    let jsFile = fileName;
    if (shouldTranspileFile(fileName)) {
      const content = opts.host.readFile(fileName);
      if (!content) {
        throw new Error(`Module not found: ${fileName}`);
      }
      const cachedCode = jsCodeCache.get(fileName);
      if (cachedCode) {
        jsFile = cachedCode;
      } else {
        const transpiled = ts.transpileModule(content, {
          compilerOptions,
          fileName: fileName,
        });
        let code = transpiled.outputText;

        // Replace dynamic import() with __import__() for VM compatibility
        code = code.replace(/\bimport\s*\(/g, "__import__(");

        jsCodeCache.set(fileName, code);
        jsFile = code;
      }
    }
    return jsFile;
  };

  function createModuleContext(filename: string) {
    const moduleExports = {};
    const moduleObject = {
      exports: moduleExports,
      filename,
      id: filename,
      loaded: false,
    };

    // Create a require function that resolves from the project directory
    const projectRequire = createRequire(filename);

    const customRequire = (specifier: string) => {
      // Handle node: protocol
      if (specifier.startsWith("node:")) {
        return require(specifier);
      }

      // First, try TypeScript module resolution for all specifiers
      // This handles relative paths, absolute paths, AND path mappings (like @/...)
      const resolved = ts.resolveModuleName(
        specifier,
        filename,
        compilerOptions,
        opts.host
      );

      // Debug: Log resolution attempts for path-mapped modules
      if (resolved.resolvedModule) {
        console.log(
          `Resolved ${specifier} to ${resolved.resolvedModule.resolvedFileName}`
        );
      } else if (
        compilerOptions.paths &&
        !specifier.startsWith(".") &&
        !specifier.startsWith("node:")
      ) {
        console.log(`Failed to resolve ${specifier} from ${filename}`);
        console.log(
          `Available paths:`,
          Object.keys(compilerOptions.paths || {})
        );
        console.log(`Base URL:`, compilerOptions.baseUrl);
      }

      // If TypeScript resolved it to a file, load it
      if (resolved.resolvedModule) {
        const resolvedFile = path.normalize(
          resolved.resolvedModule.resolvedFileName
        );

        // If it resolved to a .d.ts file from node_modules, use projectRequire
        // because we need the actual implementation, not the type definitions
        if (
          (resolvedFile.endsWith(".d.ts") ||
            resolvedFile.endsWith(".d.mts") ||
            resolvedFile.endsWith(".d.cts")) &&
          resolvedFile.includes("node_modules") &&
          !specifier.startsWith(".") &&
          !path.isAbsolute(specifier)
        ) {
          try {
            return projectRequire(specifier);
          } catch (error) {
            throw new Error(
              `Cannot load module '${specifier}' - TypeScript resolved to ${resolvedFile} but the implementation could not be loaded. ` +
                `Error: ${
                  error instanceof Error ? error.message : String(error)
                }`
            );
          }
        }

        const code = getJsCode(resolvedFile);
        return loadModule(code, resolvedFile);
      }

      // If TypeScript couldn't resolve it and it's not a relative/absolute path,
      // try loading it as an external module from node_modules
      if (!specifier.startsWith(".") && !path.isAbsolute(specifier)) {
        try {
          return projectRequire(specifier);
        } catch (error) {
          // If module can't be found in project, throw a clear error
          throw new Error(
            `Cannot find module '${specifier}' from ${filename}. ` +
              `Make sure the module is installed in the project's node_modules.`
          );
        }
      }

      // If we get here, we couldn't resolve it
      throw new Error(`Cannot resolve module: ${specifier} from ${filename}`);
    };

    const customImport = (specifier: string) => {
      // Custom async import function that mimics import() behavior
      return Promise.resolve(customRequire(specifier));
    };

    const sandbox = {
      console,
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      require: customRequire,
      __import__: customImport,
      module: moduleObject,
      exports: moduleExports,
      __filename: filename,
      __dirname: path.dirname(filename),
      global: undefined as any,
    };

    // Circular reference
    sandbox.global = sandbox;

    return { sandbox, moduleObject };
  }

  function loadModule(code: string, filename: string): any {
    const normalized = path.normalize(filename);

    if (moduleCache.has(normalized)) {
      return moduleCache.get(normalized);
    }

    const { sandbox, moduleObject } = createModuleContext(normalized);

    // Wrap in CommonJS wrapper
    const wrapped = `(function(exports, require, module, __filename, __dirname) {
${code}
});`;

    const script = new vm.Script(wrapped, {
      filename: normalized,
    });

    const context = vm.createContext(sandbox);
    const compiledWrapper = script.runInContext(context);

    compiledWrapper(
      moduleObject.exports,
      sandbox.require,
      moduleObject,
      normalized,
      path.dirname(normalized)
    );

    moduleObject.loaded = true;

    moduleCache.set(normalized, moduleObject.exports);

    return moduleObject.exports;
  }

  return {
    run(code: string, fileName: string) {
      let jsCode = shouldTranspileFile(fileName)
        ? ts.transpileModule(code, { compilerOptions, fileName }).outputText
        : code;

      // Replace dynamic import() with __import__() for VM compatibility
      jsCode = jsCode.replace(/\bimport\s*\(/g, "__import__(");

      jsCodeCache.set(fileName, jsCode);
      return loadModule(jsCode, fileName);
    },
    invalidateFile: (fileName: string) => {
      jsCodeCache.delete(fileName);
      moduleCache.delete(fileName);
    },
    clearAllCaches: () => {
      jsCodeCache.clear();
      moduleCache.clear();
    },
  };
}

function shouldTranspileFile(fileName: string) {
  // Don't transpile .d.ts files (type declarations)
  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".d.mts") ||
    fileName.endsWith(".d.cts")
  ) {
    return false;
  }
  return (
    fileName.endsWith(".ts") ||
    fileName.endsWith(".tsx") ||
    fileName.endsWith(".mts")
  );
}
