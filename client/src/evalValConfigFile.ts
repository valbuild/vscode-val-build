import * as path from "path";
import * as fs from "fs/promises";
import * as vm from "node:vm";
import * as ts from "typescript";
import { createRequire } from "node:module";

export type EvaluatedValConfig = {
  project?: string;
};

export async function evalValConfigFile(
  projectRoot: string,
  configFileName: string,
): Promise<EvaluatedValConfig | null> {
  const valConfigPath = path.join(projectRoot, configFileName);

  let code: string | null = null;
  try {
    code = await fs.readFile(valConfigPath, "utf-8");
  } catch (err) {
    //
  }
  if (!code) {
    return null;
  }

  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: valConfigPath,
  });

  const userRequire = createRequire(valConfigPath);
  const exportsObj = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: userRequire, // NOTE: this is a security risk, but this code is running in the users own environment at the CLI level
    __filename: valConfigPath,
    __dirname: path.dirname(valConfigPath),
    console,
    process,
  };
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(transpiled.outputText, {
    filename: valConfigPath,
  });
  script.runInContext(context);
  const valConfig = sandbox.module.exports.config;
  if (!valConfig) {
    throw Error(
      `Val config file at path: '${valConfigPath}' must export a config object. Got: ${valConfig}`,
    );
  }
  if (typeof valConfig !== "object") {
    throw Error(
      `Val config file at path: '${valConfigPath}' must export a config object. Got: ${valConfig}`,
    );
  }
  if ("project" in valConfig && typeof valConfig?.project !== "string") {
    throw Error(
      `Val config file at path: '${valConfigPath}' must export a config object with a 'project' property of type string. Got: ${valConfig.project}`,
    );
  }
  console.log("Found val config", valConfig);
  return valConfig as EvaluatedValConfig;
}
