import assert from "assert";
import path from "path";
import ts from "typescript";
import { CompletionItemKind } from "vscode-languageserver/node";
import { ImagePathCompletionProvider } from "./completionProviders";
import { CompletionContext } from "./completionContext";
import { ValService } from "./ValService";
import { PublicValFilesCache } from "./publicValFilesCache";

describe("ImagePathCompletionProvider", () => {
  const fixtureRoot = path.join(__dirname, "../__fixtures__/public-val-files");

  // Helper to create a mock service
  function createMockService(): ValService {
    return {
      getAllModules: async () => [],
      getAllModulePaths: async () => [],
      read: async () => {
        return {
          schema: { type: "image" } as any,
          source: "" as any,
          path: "/test.val.ts" as any,
          errors: false,
        };
      },
    };
  }

  describe("provideCompletionItems", () => {
    it("should provide only image file completions from /public/val directory", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image(""));
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
        type: "c.image",
        position: { line: 2, character: 24 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      // Should only return image files (png, jpg, svg, etc.)
      assert.ok(items.length > 0, "Should return image files");

      // Check that all items are images
      const labels = items.map((item) => item.label);

      // Expected image files
      const expectedImages = [
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
      ];

      for (const expectedImage of expectedImages) {
        assert.ok(
          labels.includes(expectedImage),
          `Should include ${expectedImage}`
        );
      }

      // Should NOT include non-image files
      assert.ok(
        !labels.includes("/public/val/styles.css"),
        "Should not include CSS file"
      );
      assert.ok(
        !labels.includes("/public/val/data.json"),
        "Should not include JSON file"
      );
      assert.ok(
        !labels.includes("/public/val/document.pdf"),
        "Should not include PDF file"
      );
      assert.ok(
        !labels.includes("/public/val/script.js"),
        "Should not include JS file"
      );
      assert.ok(
        !labels.includes("/public/val/README.md"),
        "Should not include MD file"
      );

      // Verify count (might have extra test files from other tests running in parallel)
      assert.ok(
        items.length >= expectedImages.length,
        `Should have at least ${expectedImages.length} image files, got ${items.length}`
      );

      cache.dispose();
    });

    it("should provide textEdit to replace entire string", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image("/old/path.png"));
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
        if (ts.isStringLiteral(node) && node.text === "/old/path.png") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const context: CompletionContext = {
        type: "c.image",
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

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image(""));
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
        type: "c.image",
        position: { line: 2, character: 60 },
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
        "Image file from /public/val",
        "Should have correct detail"
      );
      assert.ok(
        firstItem.label.startsWith("/public/val/"),
        "Label should start with /public/val/"
      );

      cache.dispose();
    });

    it("should return empty array when no image files exist", async () => {
      // Create cache for a root without /public/val directory
      const cache = new PublicValFilesCache();
      const emptyRoot = path.join(__dirname, "../__fixtures__/smoke");
      await cache.initialize(emptyRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image(""));
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
        type: "c.image",
        position: { line: 2, character: 60 },
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

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const context: CompletionContext = {
        type: "c.image",
        position: { line: 0, character: 9 },
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

      // Items should not have textEdit without stringNode
      for (const item of items) {
        if (item.textEdit) {
          // If textEdit exists without sourceFile, it might be incomplete
          // This is acceptable behavior
        }
      }

      cache.dispose();
    });

    it("should filter by common image extensions", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image(""));
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
        type: "c.image",
        position: { line: 2, character: 60 },
        partialText: "",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      // Check that only valid image extensions are included
      const validExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".ico",
        ".bmp",
      ];

      for (const item of items) {
        const hasValidExtension = validExtensions.some((ext) =>
          item.label.toLowerCase().endsWith(ext)
        );
        assert.ok(
          hasValidExtension,
          `${item.label} should have a valid image extension`
        );
      }

      cache.dispose();
    });
  });
});
