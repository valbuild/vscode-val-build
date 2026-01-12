import { describe, it, expect } from "@jest/globals";

// Mock vscode module
jest.mock("vscode", () => ({}), { virtual: true });

import {
  calculateRelativePath,
  findInsertionPoint,
  generateInsertText,
} from "./addModuleToValModules";

describe("addModuleToValModules helpers", () => {
  describe("calculateRelativePath", () => {
    it("should calculate relative path and replace extension", () => {
      const valModulesFile = "/project/src/val.modules.ts";
      const filePath = "/project/src/components/Button.val.ts";
      const result = calculateRelativePath(valModulesFile, filePath);
      expect(result).toBe("components/Button.val");
    });

    it("should handle paths in the same directory", () => {
      const valModulesFile = "/project/src/val.modules.ts";
      const filePath = "/project/src/Test.val.ts";
      const result = calculateRelativePath(valModulesFile, filePath);
      expect(result).toBe("Test.val");
    });

    it("should handle nested paths", () => {
      const valModulesFile = "/project/src/val.modules.ts";
      const filePath = "/project/src/deep/nested/path/Module.val.ts";
      const result = calculateRelativePath(valModulesFile, filePath);
      expect(result).toBe("deep/nested/path/Module.val");
    });
  });

  describe("findInsertionPoint", () => {
    it("should find insertion point after last element", () => {
      const content = `
import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./test1.val") },
  { def: () => import("./test2.val") }
]);
      `.trim();
      const result = findInsertionPoint(content, "val.modules.ts");
      expect(result.insertPosition).not.toBeNull();
      expect(result.indentation).toBe("  ");
    });

    it("should handle empty array", () => {
      const content = `
import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, []);
      `.trim();
      const result = findInsertionPoint(content, "val.modules.ts");
      expect(result.insertPosition).not.toBeNull();
    });

    it("should detect custom indentation", () => {
      const content = `
import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
    { def: () => import("./test1.val") },
]);
      `.trim();
      const result = findInsertionPoint(content, "val.modules.ts");
      expect(result.indentation).toBe("    ");
    });

    it("should return null for invalid content", () => {
      const content = `
export default {};
      `.trim();
      const result = findInsertionPoint(content, "val.modules.ts");
      expect(result.insertPosition).toBeNull();
    });
  });

  describe("generateInsertText", () => {
    it("should generate text with comma for existing elements", () => {
      const result = generateInsertText("test.val", "  ", true);
      expect(result).toBe(',\n  { def: () => import("./test.val") }');
    });

    it("should generate text without comma for empty array", () => {
      const result = generateInsertText("test.val", "  ", false);
      expect(result).toBe('\n  { def: () => import("./test.val") }\n');
    });

    it("should use custom indentation", () => {
      const result = generateInsertText("test.val", "    ", true);
      expect(result).toBe(',\n    { def: () => import("./test.val") }');
    });
  });

  describe("integration", () => {
    it("should correctly insert into a typical val.modules file", () => {
      const valModulesContent = `
import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./test1.val") },
  { def: () => import("./test2.val") }
]);
      `.trim();

      const { insertPosition, indentation } = findInsertionPoint(
        valModulesContent,
        "val.modules.ts"
      );
      expect(insertPosition).not.toBeNull();

      const relativePath = "components/Button.val";
      const hasExisting = valModulesContent.includes("import(");
      const insertText = generateInsertText(
        relativePath,
        indentation,
        hasExisting
      );

      const result =
        valModulesContent.slice(0, insertPosition!) +
        insertText +
        valModulesContent.slice(insertPosition!);

      expect(result).toContain('{ def: () => import("./test1.val") }');
      expect(result).toContain('{ def: () => import("./test2.val") }');
      expect(result).toContain(
        '{ def: () => import("./components/Button.val") }'
      );
      expect(
        result.indexOf('{ def: () => import("./test2.val") }')
      ).toBeLessThan(
        result.indexOf('{ def: () => import("./components/Button.val") }')
      );
    });
  });
});
