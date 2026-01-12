import ts from "typescript";
import { createTsVmRuntime } from "./tsRuntime";
import path from "path";
import fs from "fs";

describe("tsRuntime", () => {
  test("should compile and execute TypeScript in memory", async () => {
    // Use the actual fixture directory so it can access real node_modules
    const fixtureRoot = path.join(__dirname, "../__fixtures__/smoke");
    const { files, directories } = readFakeFiles(fixtureRoot, fixtureRoot);
    const fakeHost = {
      readDirectory: (path: string) => directories.get(path) || [],
      fileExists: (path: string) => files[path] !== undefined,
      readFile: (path: string) => files[path] || "",
      useCaseSensitiveFileNames: false,
    };
    const compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    };
    const runtime = createTsVmRuntime({
      compilerOptions: compilerOptions,
      host: fakeHost,
    });
    const result = await runtime.run(
      `import * as modules from "./val.modules";
      import { Internal } from "@valbuild/core";
      
      export default Promise.all(modules.default?.modules.map(module => module.def().then(importedModule => {
        const valModule = importedModule.default;
        const path = Internal.getValPath(valModule) || "/";
        let schema;
        let runtimeError = false;
        try {
          source = Internal.getSource(valModule);
        } catch (error) {
          schema = undefined;
        }
        let source;
        try {
          source = Internal.getSource(valModule);
        } catch (error) {
          source = undefined;
        }
        let validation;
        try {
          if (source && schema) {
            validation = Internal.validate(valModule, path || "/",
              source
            );
          } else {
            validation = {
              [path]: [
                {
                  message: "Could not validate module: " + (!source && !schema ? "source and schema are undefined" : !source ? "source is undefined" : "schema is undefined")
                }
              ]
            }
          }
        } catch (error) {
          validation = {
            [path]: [
              {
                message: error.message,
              }
            ]
          };
        }
        return {
          path,
          schema,
          source,
          validation,
          runtimeError,
          defaultExport: !!importedModule.default,
        };
      }).catch(error => ({
        runtimeError: true,
        message: error.message,
        validation: {
          ["/"]: [
            {
              message: error.message,
            }
          ]
        },
      })));
      `,
      path.join(fixtureRoot, "<system>.ts")
    );

    // The module exports a Promise as default, so await it
    const resolved = await result.default;
    console.log(resolved);
  });
});

function readFakeFiles(
  dir: string,
  root: string
): {
  files: Record<string, string>;
  directories: Map<string, string[]>;
} {
  const files: Record<string, string> = {};
  const directories: Map<string, string[]> = new Map();
  function recursiveRead(dir: string, root: string): string[] {
    const dirFiles = fs.readdirSync(dir);
    for (const file of dirFiles) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        directories.set(
          path.join(root, file),
          recursiveRead(filePath, path.join(root, file))
        );
      } else {
        files[path.join(root, file)] = fs.readFileSync(filePath, "utf-8");
      }
    }
    return dirFiles;
  }
  directories.set(path.join(root), recursiveRead(dir, root));
  return { files, directories };
}
