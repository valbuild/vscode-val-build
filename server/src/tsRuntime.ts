import ts from "typescript";
import path from "node:path";
import vm from "node:vm";

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
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
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

    const customRequire = (specifier: string) => {
      if (
        specifier.startsWith("node:") ||
        (!specifier.startsWith(".") && !path.isAbsolute(specifier))
      ) {
        return require(specifier);
      }

      const resolved = ts.resolveModuleName(
        specifier,
        filename,
        compilerOptions,
        opts.host
      );

      if (!resolved.resolvedModule) {
        throw new Error(`Cannot resolve module: ${specifier} from ${filename}`);
      }

      const resolvedFile = path.normalize(
        resolved.resolvedModule.resolvedFileName
      );
      const code = getJsCode(resolvedFile);
      return loadModule(code, resolvedFile);
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
  };
}

function shouldTranspileFile(fileName: string) {
  return (
    fileName.endsWith(".ts") ||
    fileName.endsWith(".tsx") ||
    fileName.endsWith(".mts")
  );
}
