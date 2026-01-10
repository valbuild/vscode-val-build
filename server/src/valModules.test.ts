import assert from "assert";
import path from "path";
import {
  findValModulesFile,
  evaluateValModulesFile,
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
    it("should get evaluated modules for a valRoot", async () => {
      const valRoot = fixturesDir;
      const valModulesFilesByValRoot = {
        [valRoot]: valModulesPath,
      };

      const result = await getValModules(valRoot, valModulesFilesByValRoot);

      assert.ok(result, "Should return evaluated modules");
      assert.ok(result.default, "Should have default export");
      assert.ok(result.default.testOne, "Should have testOne module");
      assert.ok(result.default.testTwo, "Should have testTwo module");
    });

    it("should return null if no val.modules file exists for valRoot", async () => {
      const valRoot = "/non/existent/path";
      const valModulesFilesByValRoot = {};

      const result = await getValModules(valRoot, valModulesFilesByValRoot);

      assert.strictEqual(result, null, "Should return null when not found");
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
