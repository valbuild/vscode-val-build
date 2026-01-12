import assert from "assert";
import path from "path";
import ts from "typescript";
import { CompletionItemKind } from "vscode-languageserver/node";
import { FilePathCompletionProvider } from "./completionProviders";
import { CompletionContext } from "./completionContext";
import { ValService } from "./types";
import { PublicValFilesCache } from "./publicValFilesCache";

describe("FilePathCompletionProvider", () => {
  const fixtureRoot = path.join(__dirname, "../__fixtures__/public-val-files");

  // Helper to create a mock service
  function createMockService(): ValService {
    return {
      getAllModules: async () => [],
      getAllModulePaths: async () => [],
      read: async () => {
        return {
          schema: { type: "file" } as any,
          source: "" as any,
          path: "/test.val.ts" as any,
          errors: false,
        };
      },
    };
  }

  describe("provideCompletionItems", () => {
    it("should provide all file completions from /public/val directory", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file(""));
      `;

      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Find the empty string literal
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the empty string literal");

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 2, character: 23 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      // Should return all files (images and non-images)
      assert.ok(items.length > 0, "Should return files");

      // Check that all expected files are present
      const labels = items.map((item) => item.label);

      // Expected all files from fixture
      const expectedFiles = [
        // Image files
        "/public/val/logo.png",
        "/public/val/icon.svg",
        "/public/val/banner.jpg",
        "/public/val/favicon.ico",
        "/public/val/photo.webp",
        "/public/val/header.gif",
        "/public/val/thumbnail.bmp",
        "/public/val/images/product1.png",
        "/public/val/images/product2.jpg",
        "/public/val/nested/deep/deep-image.png",
        // Non-image files
        "/public/val/styles.css",
        "/public/val/data.json",
        "/public/val/document.pdf",
        "/public/val/script.js",
        "/public/val/README.md",
        "/public/val/documents/manual.pdf",
        "/public/val/documents/report.txt",
      ];

      for (const expectedFile of expectedFiles) {
        assert.ok(
          labels.includes(expectedFile),
          `Should include ${expectedFile}`
        );
      }

      // Verify count (might have extra test files from other tests running in parallel)
      assert.ok(
        items.length >= expectedFiles.length,
        `Should have at least ${expectedFiles.length} files, got ${items.length}`
      );

      cache.dispose();
    });

    it("should provide textEdit to replace entire string", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file("/old/path.pdf"));
      `;

      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Find the string literal
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/old/path.pdf") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 0, character: 15 },
        partialText: "/old",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      // All items should have textEdit
      for (const item of items) {
        assert.ok(item.textEdit, "Item should have textEdit");
        if (item.textEdit && "newText" in item.textEdit) {
          // Verify it replaces with the full path
          assert.ok(
            item.textEdit.newText.startsWith("/public/val/"),
            "Should replace with full path"
          );
        }
      }

      cache.dispose();
    });

    it("should have correct completion item properties", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file(""));
      `;

      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 2, character: 58 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      // Check first item properties
      const firstItem = items[0];
      assert.strictEqual(
        firstItem.kind,
        CompletionItemKind.File,
        "Should be of kind File"
      );
      assert.strictEqual(
        firstItem.detail,
        "File from /public/val",
        "Should have correct detail"
      );
      assert.ok(
        firstItem.label.startsWith("/public/val/"),
        "Label should start with /public/val/"
      );

      cache.dispose();
    });

    it("should return empty array when no files exist", async () => {
      // Create cache for a root without /public/val directory
      const cache = new PublicValFilesCache();
      const emptyRoot = path.join(__dirname, "../__fixtures__/smoke");
      await cache.initialize(emptyRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file(""));
      `;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 2, character: 58 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        emptyRoot,
        sourceFile
      );

      assert.strictEqual(items.length, 0, "Should return empty array");

      cache.dispose();
    });

    it("should handle context without stringNode", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 0, character: 8 },
        partialText: "",
        // No stringNode provided
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot
      );

      // Should still return items, but without textEdit
      assert.ok(items.length > 0, "Should return items");

      cache.dispose();
    });

    it("should include both image and non-image files", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file(""));
      `;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 2, character: 58 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      const labels = items.map((item) => item.label);

      // Should include image files
      assert.ok(
        labels.includes("/public/val/logo.png"),
        "Should include PNG image"
      );
      assert.ok(
        labels.includes("/public/val/icon.svg"),
        "Should include SVG image"
      );

      // Should include non-image files
      assert.ok(
        labels.includes("/public/val/styles.css"),
        "Should include CSS file"
      );
      assert.ok(
        labels.includes("/public/val/data.json"),
        "Should include JSON file"
      );
      assert.ok(
        labels.includes("/public/val/document.pdf"),
        "Should include PDF file"
      );
      assert.ok(
        labels.includes("/public/val/script.js"),
        "Should include JS file"
      );

      cache.dispose();
    });

    it("should include files from nested directories", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new FilePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file(""));
      `;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 2, character: 58 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      const labels = items.map((item) => item.label);

      // Should include files from nested directories
      assert.ok(
        labels.includes("/public/val/images/product1.png"),
        "Should include file from images/ directory"
      );
      assert.ok(
        labels.includes("/public/val/documents/manual.pdf"),
        "Should include file from documents/ directory"
      );
      assert.ok(
        labels.includes("/public/val/nested/deep/deep-image.png"),
        "Should include file from deeply nested directory"
      );

      cache.dispose();
    });
  });
});
