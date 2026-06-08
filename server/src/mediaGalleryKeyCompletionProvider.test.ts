import assert from "assert";
import path from "path";
import ts from "typescript";
import { CompletionItemKind } from "vscode-languageserver/node";
import { MediaGalleryKeyCompletionProvider } from "./completionProviders";
import { CompletionContext } from "./completionContext";
import { ValService } from "./ValService";
import { PublicValFilesCache } from "./publicValFilesCache";
import { SerializedSchema, Source } from "@valbuild/core";

describe("MediaGalleryKeyCompletionProvider", () => {
  const fixtureRoot = path.join(__dirname, "../__fixtures__/public-val-files");

  function galleryService(
    mediaType: "images" | "files",
    directory: string,
    source: Source = {} as Source,
  ): ValService {
    const schema = {
      type: "record",
      opt: false,
      item: { type: "object", items: {}, opt: false },
      mediaType,
      accept: mediaType === "images" ? "image/*" : "application/pdf",
      directory,
    } as unknown as SerializedSchema;
    return {
      getAllModules: async () => [],
      getAllModulePaths: async () => [],
      read: async () => ({
        schema,
        source,
        path: "/content/media.val.ts" as any,
        errors: false,
      }),
    } as unknown as ValService;
  }

  function keyContext(code: string): {
    context: CompletionContext;
    sourceFile: ts.SourceFile;
  } {
    const sourceFile = ts.createSourceFile(
      "media.val.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
    );
    let stringNode: ts.StringLiteral | undefined;
    function find(node: ts.Node) {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isStringLiteral(node.name) &&
        node.name.text === ""
      ) {
        stringNode = node.name;
      }
      ts.forEachChild(node, find);
    }
    find(sourceFile);
    assert.ok(stringNode, "should find the empty property-key string");
    return {
      sourceFile,
      context: {
        type: "content-property-key",
        position: { line: 0, character: 0 },
        modulePath: "/content/media.val.ts",
        stringNode,
      },
    };
  }

  it("suggests image files from the gallery directory", async () => {
    const cache = new PublicValFilesCache();
    const provider = new MediaGalleryKeyCompletionProvider(cache);
    const service = galleryService("images", "/public/val/images");
    const { context, sourceFile } = keyContext(
      `export default c.define("/content/media.val.ts", schema, { "": {} });`,
    );

    const items = await provider.provideCompletionItems(
      context,
      service,
      fixtureRoot,
      sourceFile,
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("/public/val/images/product1.png"));
    assert.ok(labels.includes("/public/val/images/product2.jpg"));
    assert.strictEqual(items[0].kind, CompletionItemKind.File);
    assert.ok(items[0].textEdit, "should provide a textEdit");
    cache.dispose();
  });

  it("suggests files (any extension) for a files gallery", async () => {
    const cache = new PublicValFilesCache();
    const provider = new MediaGalleryKeyCompletionProvider(cache);
    const service = galleryService("files", "/public/val/documents");
    const { context, sourceFile } = keyContext(
      `export default c.define("/content/media.val.ts", schema, { "": {} });`,
    );

    const items = await provider.provideCompletionItems(
      context,
      service,
      fixtureRoot,
      sourceFile,
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("/public/val/documents/manual.pdf"));
    assert.ok(labels.includes("/public/val/documents/report.txt"));
    cache.dispose();
  });

  it("excludes keys already registered in the gallery", async () => {
    const cache = new PublicValFilesCache();
    const provider = new MediaGalleryKeyCompletionProvider(cache);
    const service = galleryService("images", "/public/val/images", {
      "/public/val/images/product1.png": {},
    } as unknown as Source);
    const { context, sourceFile } = keyContext(
      `export default c.define("/content/media.val.ts", schema, { "/public/val/images/product1.png": {}, "": {} });`,
    );

    const items = await provider.provideCompletionItems(
      context,
      service,
      fixtureRoot,
      sourceFile,
    );
    const labels = items.map((i) => i.label);
    assert.ok(!labels.includes("/public/val/images/product1.png"));
    assert.ok(labels.includes("/public/val/images/product2.jpg"));
    cache.dispose();
  });

  it("returns nothing for a non-gallery record", async () => {
    const cache = new PublicValFilesCache();
    const provider = new MediaGalleryKeyCompletionProvider(cache);
    const schema = {
      type: "record",
      opt: false,
      item: { type: "string", opt: false },
    } as unknown as SerializedSchema;
    const service = {
      read: async () => ({
        schema,
        source: {} as Source,
        path: "/content/media.val.ts" as any,
        errors: false,
      }),
    } as unknown as ValService;
    const { context, sourceFile } = keyContext(
      `export default c.define("/content/media.val.ts", schema, { "": "x" });`,
    );

    const items = await provider.provideCompletionItems(
      context,
      service,
      fixtureRoot,
      sourceFile,
    );
    assert.strictEqual(items.length, 0);
    cache.dispose();
  });
});
