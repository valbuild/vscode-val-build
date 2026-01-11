import assert from "assert";
import path from "path";
import fs from "fs";
import os from "os";
import { isFileInValModulesAST } from "./isFileInValModulesAST";

describe("isFileInValModulesAST", () => {
  let tempDir: string;
  let valModulesFile: string;
  let valRoot: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-test-"));
    valRoot = tempDir;
    valModulesFile = path.join(tempDir, "val.modules.ts");
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return true when file is in val.modules (config.modules format)", () => {
    // Create a val.modules file with config.modules format
    const valModulesContent = `
import { initVal } from "@valbuild/core";

const { config } = initVal();

export default config.modules([
  import("./src/test.val"),
  import("./src/another.val"),
]);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "test.val.ts");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(result, true, "Should find the file in val.modules");
  });

  it("should return true when file is in val.modules (modules(config) format with def)", () => {
    // Create a val.modules file with modules(config, [...]) format
    const valModulesContent = `
import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./src/test.val") },
  { def: () => import("./src/another.val") },
]);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "test.val.ts");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(result, true, "Should find the file in val.modules");
  });

  it("should return false when file is not in val.modules", () => {
    // Create a val.modules file without the target import
    const valModulesContent = `
import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./src/another.val") },
]);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "test.val.ts");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(result, false, "Should not find the file in val.modules");
  });

  it("should handle empty modules array", () => {
    // Create a val.modules file with empty array
    const valModulesContent = `
import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, []);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "test.val.ts");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(
      result,
      false,
      "Should return false for empty modules array"
    );
  });

  it("should normalize paths correctly", () => {
    // Create a val.modules file with different path formats
    const valModulesContent = `
import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./src/dir/test.val") },
]);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "dir", "test.val.ts");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(
      result,
      true,
      "Should handle nested directory paths correctly"
    );
  });

  it("should handle .val.js files", () => {
    // Create a val.modules file with .val import
    const valModulesContent = `
import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./src/test.val") },
]);
`;
    fs.writeFileSync(valModulesFile, valModulesContent);

    const testFilePath = path.join(tempDir, "src", "test.val.js");
    const result = isFileInValModulesAST(testFilePath, valRoot, valModulesFile);

    assert.strictEqual(
      result,
      true,
      "Should handle .val.js files correctly"
    );
  });

  it("should return false when val.modules file doesn't exist", () => {
    const nonExistentFile = path.join(tempDir, "non-existent.ts");
    const testFilePath = path.join(tempDir, "src", "test.val.ts");
    const result = isFileInValModulesAST(
      testFilePath,
      valRoot,
      nonExistentFile
    );

    assert.strictEqual(
      result,
      false,
      "Should return false when val.modules doesn't exist"
    );
  });
});
