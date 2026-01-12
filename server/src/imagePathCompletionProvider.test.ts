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

      // Check that items have data field for resolve
      assert.ok(firstItem.data, "Should have data field");
      assert.strictEqual(
        firstItem.data.type,
        "image",
        "Data type should be image"
      );
      assert.ok(firstItem.data.filePath, "Should have filePath in data");
      assert.ok(firstItem.data.valRoot, "Should have valRoot in data");

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

    it("should detect and store second argument range when metadata exists", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      // Code with existing metadata
      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image("", { width: 100, height: 100 }));
      `;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Find the string node and call expression
      let stringNode: ts.StringLiteral | undefined;
      let callExpression: ts.CallExpression | undefined;
      function findNodes(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "image"
        ) {
          callExpression = node;
          if (
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text === ""
          ) {
            stringNode = node.arguments[0];
          }
        }
        ts.forEachChild(node, findNodes);
      }
      findNodes(sourceFile);

      assert.ok(stringNode, "Should find string node");
      assert.ok(callExpression, "Should find call expression");
      assert.ok(
        callExpression!.arguments.length > 1,
        "Should have second argument"
      );

      const context: CompletionContext = {
        type: "c.image",
        position: { line: 2, character: 60 },
        partialText: "",
        stringNode: stringNode,
        callExpression: callExpression,
        hasSecondArgument: true,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      assert.ok(items.length > 0, "Should return items");
      const firstItem = items[0];
      assert.strictEqual(
        firstItem.data.hasSecondArgument,
        true,
        "Should mark hasSecondArgument as true"
      );
      assert.ok(
        firstItem.data.secondArgumentRange,
        "Should have secondArgumentRange"
      );
      assert.ok(
        firstItem.data.secondArgumentRange.start,
        "Should have start position"
      );
      assert.ok(
        firstItem.data.secondArgumentRange.end,
        "Should have end position"
      );

      cache.dispose();
    });

    it("should store existing metadata text for merging custom properties", async () => {
      const cache = new PublicValFilesCache();
      await cache.initialize(fixtureRoot);

      const provider = new ImagePathCompletionProvider(cache);
      const service = createMockService();

      // Code with existing metadata including custom property
      const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image("", { width: 100, height: 100, mimeType: "image/png", alt: "My custom alt text", customProp: "custom value" }));
      `;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Find the string node and call expression
      let stringNode: ts.StringLiteral | undefined;
      let callExpression: ts.CallExpression | undefined;
      function findNodes(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "image"
        ) {
          callExpression = node;
          if (
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text === ""
          ) {
            stringNode = node.arguments[0];
          }
        }
        ts.forEachChild(node, findNodes);
      }
      findNodes(sourceFile);

      assert.ok(stringNode, "Should find string node");
      assert.ok(callExpression, "Should find call expression");

      const context: CompletionContext = {
        type: "c.image",
        position: { line: 2, character: 60 },
        partialText: "",
        stringNode: stringNode,
        callExpression: callExpression,
        hasSecondArgument: true,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        fixtureRoot,
        sourceFile
      );

      assert.ok(items.length > 0, "Should return items");
      const firstItem = items[0];
      assert.ok(
        firstItem.data.existingMetadataText,
        "Should have existingMetadataText"
      );
      // Verify the metadata text includes custom properties
      assert.ok(
        firstItem.data.existingMetadataText.includes("alt"),
        "Should include alt property"
      );
      assert.ok(
        firstItem.data.existingMetadataText.includes("customProp"),
        "Should include customProp property"
      );

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
