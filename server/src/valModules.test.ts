import assert from "assert";
import path from "path";
import ts from "typescript";
import {
  findValModulesFile,
  evaluateValModulesFile,
  evaluateValModulesFileWithFileSystem,
  createValModulesRuntime,
  getValModules,
} from "./valModules";

describe("valModules", () => {
  const fixturesDir = path.join(__dirname, "../__fixtures__", "smoke");
  const valModulesPath = path.join(fixturesDir, "val.modules.ts");

  // describe("findValModulesFile", () => {
  //   it("should find val.modules file for a given valRoot", () => {
  //     const valRoot = fixturesDir;
  //     const valModulesFiles = [
  //       valModulesPath,
  //       "/some/other/path/val.modules.ts",
  //     ];

  //     const result = findValModulesFile(valRoot, valModulesFiles);

  //     assert.strictEqual(result, valModulesPath);
  //   });

  //   it("should return undefined if no val.modules file exists for valRoot", () => {
  //     const valRoot = "/non/existent/path";
  //     const valModulesFiles = [valModulesPath];

  //     const result = findValModulesFile(valRoot, valModulesFiles);

  //     assert.strictEqual(result, undefined);
  //   });
  // });

  // describe("evaluateValModulesFile", () => {
  //   it("should evaluate TypeScript val.modules file and return exports", () => {
  //     const result = evaluateValModulesFile(valModulesPath);

  //     assert.ok(result, "Should return evaluated exports");
  //     assert.ok(result.default, "Should have default export");
  //     assert.ok(result.default.testOne, "Should have testOne module");
  //     assert.ok(result.default.testTwo, "Should have testTwo module");
  //   });

  //   it("should handle evaluation errors gracefully", () => {
  //     const invalidPath = path.join(fixturesDir, "non-existent.ts");

  //     const result = evaluateValModulesFile(invalidPath);

  //     assert.strictEqual(result, null, "Should return null on error");
  //   });

  //   it("should support .ts extension", () => {
  //     const tsFile = path.join(fixturesDir, "val.modules.ts");

  //     const result = evaluateValModulesFile(tsFile);

  //     assert.ok(result, "Should evaluate .ts file");
  //   });

  //   // Infrastructure for future tests with different file types
  //   describe("file type support", () => {
  //     it("should handle .ts files", () => {
  //       // Already tested above, but can be expanded
  //       const result = evaluateValModulesFile(valModulesPath);
  //       assert.ok(result);
  //     });

  //     // TODO: Add .mts test when fixture is created
  //     it.skip("should handle .mts files", () => {
  //       const mtsFile = path.join(fixturesDir, "val.modules.mts");
  //       const result = evaluateValModulesFile(mtsFile);
  //       assert.ok(result);
  //     });

  //     // TODO: Add .cts test when fixture is created
  //     it.skip("should handle .cts files", () => {
  //       const ctsFile = path.join(fixturesDir, "val.modules.cts");
  //       const result = evaluateValModulesFile(ctsFile);
  //       assert.ok(result);
  //     });

  //     // TODO: Add .js test when fixture is created
  //     it.skip("should handle .js files", () => {
  //       const jsFile = path.join(fixturesDir, "val.modules.js");
  //       const result = evaluateValModulesFile(jsFile);
  //       assert.ok(result);
  //     });
  //   });
  // });

  describe("getValModules", () => {
    it("should get evaluated and processed modules for a valRoot", async () => {
      const valRoot = fixturesDir;
      const valModulesFilesByValRoot = {
        [valRoot]: valModulesPath,
      };

      const result = await getValModules(valRoot, valModulesFilesByValRoot);

      assert.ok(result, "Should return processed modules");
      assert.ok(Array.isArray(result), "Should return an array");
      assert.strictEqual(result.length, 2, "Should have 2 modules");

      // Check first module
      const module1 = result.find((m) => m.path.includes("test-one"));
      assert.ok(module1, "Should have test-one module");
      assert.ok(module1.schema, "Should have schema");
      assert.ok(module1.source, "Should have source");
      assert.strictEqual(
        module1.runtimeError,
        false,
        "Should not have runtime error",
      );
      assert.strictEqual(
        module1.defaultExport,
        true,
        "Should have default export",
      );

      // Check second module
      const module2 = result.find((m) => m.path.includes("test-two"));
      assert.ok(module2, "Should have test-two module");
      assert.ok(module2.schema, "Should have schema");
      assert.ok(module2.source, "Should have source");
      assert.strictEqual(
        module2.runtimeError,
        false,
        "Should not have runtime error",
      );
      assert.strictEqual(
        module2.defaultExport,
        true,
        "Should have default export",
      );
    });

    it("should return null if no val.modules file exists for valRoot", async () => {
      const valRoot = "/non/existent/path";
      const valModulesFilesByValRoot = {};

      const result = await getValModules(valRoot, valModulesFilesByValRoot);

      assert.strictEqual(result, null, "Should return null when not found");
    });
  });

  describe("evaluateValModulesFile", () => {
    it("should evaluate and process val.modules file with runtime", async () => {
      // Find tsconfig and create runtime
      const configPath = path.join(fixturesDir, "../../tsconfig.json");
      const host: ts.ParseConfigHost = {
        readDirectory: ts.sys.readDirectory,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      };

      const runtime = createValModulesRuntime(host, configPath);
      const result = await evaluateValModulesFile(runtime, valModulesPath);

      assert.ok(result, "Should return processed modules");
      assert.ok(Array.isArray(result), "Should return an array");
      assert.strictEqual(result.length, 2, "Should have 2 modules");

      // Verify each module has the expected structure
      for (const module of result) {
        assert.ok(module.path, "Module should have path");
        assert.ok(
          typeof module.runtimeError === "boolean",
          "Should have runtimeError flag",
        );
        assert.ok(
          typeof module.defaultExport === "boolean",
          "Should have defaultExport flag",
        );

        if (!module.runtimeError) {
          assert.ok(module.schema, "Non-error module should have schema");
          assert.ok(module.source, "Non-error module should have source");
        }
      }
    });
  });

  describe("evaluateValModulesFileWithFileSystem", () => {
    it("should evaluate and process val.modules file using file system", async () => {
      const result = await evaluateValModulesFileWithFileSystem(valModulesPath);

      assert.ok(result, "Should return processed modules");
      assert.ok(Array.isArray(result), "Should return an array");
      assert.strictEqual(result.length, 2, "Should have 2 modules");

      // Verify each module has the expected structure
      for (const module of result) {
        assert.ok(module.path, "Module should have path");
        assert.ok(
          typeof module.runtimeError === "boolean",
          "Should have runtimeError flag",
        );
        assert.ok(
          typeof module.defaultExport === "boolean",
          "Should have defaultExport flag",
        );

        if (!module.runtimeError) {
          assert.ok(module.schema, "Non-error module should have schema");
          assert.ok(module.source, "Non-error module should have source");
        }
      }
    });

    it("should return null if config file not found", async () => {
      const invalidPath = "/tmp/non-existent-file.ts";
      const result = await evaluateValModulesFileWithFileSystem(invalidPath);

      assert.strictEqual(
        result,
        null,
        "Should return null when config not found",
      );
    });
  });

  describe("createValModulesRuntime", () => {
    it("should create a runtime with custom host", () => {
      const configPath = path.join(fixturesDir, "../../tsconfig.json");
      const host: ts.ParseConfigHost = {
        readDirectory: ts.sys.readDirectory,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      };

      const runtime = createValModulesRuntime(host, configPath);

      assert.ok(runtime, "Should return a runtime instance");
      assert.ok(
        typeof runtime.run === "function",
        "Runtime should have run method",
      );
      assert.ok(
        typeof runtime.invalidateFile === "function",
        "Runtime should have invalidateFile method",
      );
    });

    it("should throw error if config file is invalid", () => {
      const invalidConfigPath = "/tmp/invalid-tsconfig.json";
      const host: ts.ParseConfigHost = {
        readDirectory: ts.sys.readDirectory,
        fileExists: () => true,
        readFile: () => "invalid json {{{",
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      };

      assert.throws(() => {
        createValModulesRuntime(host, invalidConfigPath);
      }, /Error reading tsconfig/);
    });
  });

  // // Infrastructure for integration tests
  // describe("integration", () => {
  //   it("smoke test: should load and evaluate complete val.modules structure", () => {
  //     // This is the main smoke test that verifies the entire flow works
  //     const valRoot = fixturesDir;
  //     const valModulesFiles = [valModulesPath];

  //     // Step 1: Find the val.modules file
  //     const foundFile = findValModulesFile(valRoot, valModulesFiles);
  //     assert.ok(foundFile, "Should find val.modules file");

  //     // Step 2: Evaluate it
  //     const evaluated = evaluateValModulesFile(foundFile);
  //     assert.ok(evaluated, "Should evaluate val.modules file");

  //     // Step 3: Verify structure
  //     assert.ok(evaluated.default, "Should have default export");
  //     assert.strictEqual(
  //       typeof evaluated.default,
  //       "object",
  //       "Default should be an object"
  //     );

  //     // Step 4: Verify modules are present
  //     const modules = evaluated.default;
  //     assert.ok(modules.testOne, "Should have testOne module");
  //     assert.ok(modules.testTwo, "Should have testTwo module");

  //     // Step 5: Verify module structure (they should be schema definitions)
  //     assert.strictEqual(
  //       typeof modules.testOne,
  //       "object",
  //       "testOne should be an object"
  //     );
  //     assert.strictEqual(
  //       typeof modules.testTwo,
  //       "object",
  //       "testTwo should be an object"
  //     );

  //     console.log("✓ Smoke test passed: val.modules loaded successfully");
  //   });
  // });
});
