import assert from "assert";
import { CompletionItemKind } from "vscode-languageserver/node";
import {
  RouteCompletionProvider,
  KeyOfCompletionProvider,
  CompletionProviderRegistry,
} from "./completionProviders";
import { CompletionContext } from "./completionContext";
import { ValService } from "./ValService";
import { ValModuleResult } from "./valModules";
import { PublicValFilesCache } from "./publicValFilesCache";
import ts from "typescript";

// Helper to create a mock cache
function createMockCache(): PublicValFilesCache {
  const cache = new PublicValFilesCache();
  // Mock the getFiles method to return empty array by default
  cache.getFiles = () => [];
  return cache;
}

// Helper to create a mock service
function createMockService(
  modules: ValModuleResult[],
  readResult?: any,
): ValService {
  return {
    getAllModules: async () => modules,
    getAllModulePaths: async () =>
      modules.map((m) => m.path).filter(Boolean) as string[],
    read: async () => {
      if (readResult) {
        return readResult;
      }
      // Return a default result instead of throwing
      return {
        schema: { type: "object" },
        source: {},
        path: "/test.val.ts" as any,
        errors: false as any,
      };
    },
  };
}

describe("completionProviders", () => {
  describe("RouteCompletionProvider", () => {
    it("should provide completion items for routes from router modules", async () => {
      // Create a mock service with router modules
      const { initVal } = await import("@valbuild/core");
      const { s } = initVal();

      const fakeNextAppRouter = {
        getRouterId: () => "next-app-router",
        validate: () => [],
      };

      const schema = s
        .router(
          fakeNextAppRouter,
          s.object({
            title: s.string(),
          }),
        )
        ["executeSerialize"]();

      // Create a mock read result for the module being edited
      const readResult: any = {
        schema: {
          type: "object",
          items: {
            myRoute: {
              type: "route",
            },
          },
        },
        source: {},
        path: "/test.val.ts",
        errors: false,
      };

      const service = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home" },
              "/about": { title: "About" },
              "/contact": { title: "Contact" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      // Create a test source file with a route field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/home" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/home" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/home") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 18 },
        partialText: "/h",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      assert.strictEqual(items.length, 3);
      assert.ok(items.some((item) => item.label === "/home"));
      assert.ok(items.some((item) => item.label === "/about"));
      assert.ok(items.some((item) => item.label === "/contact"));
      assert.ok(items.every((item) => item.kind === CompletionItemKind.Value));
      assert.ok(items.every((item) => item.detail === "Route"));
    });

    it("should return empty array when no router modules exist", async () => {
      const readResult: any = {
        schema: {
          type: "object",
          items: {
            myRoute: {
              type: "route",
            },
          },
        },
        source: {},
        path: "/test.val.ts",
        errors: false,
      };

      const service = createMockService(
        [
          {
            path: "/src/content.val.ts",
            schema: { type: "string" } as any,
            source: "Hello World",
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      // Create a test source file with a route field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      assert.strictEqual(items.length, 0);
    });

    it("should deduplicate routes from multiple router modules", async () => {
      const { initVal } = await import("@valbuild/core");
      const { s } = initVal();

      const fakeNextAppRouter = {
        getRouterId: () => "next-app-router",
        validate: () => [],
      };

      const schema = s
        .router(
          fakeNextAppRouter,
          s.object({
            title: s.string(),
          }),
        )
        ["executeSerialize"]();

      const readResult: any = {
        schema: {
          type: "object",
          items: {
            myRoute: {
              type: "route",
            },
          },
        },
        source: {},
        path: "/test.val.ts",
        errors: false,
      };

      const service = createMockService(
        [
          {
            path: "/src/app/routes1.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home" },
              "/about": { title: "About" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
          {
            path: "/src/app/routes2.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home Page" }, // Duplicate route
              "/contact": { title: "Contact" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      // Create a test source file with a route field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should have 3 unique routes (/home, /about, /contact)
      assert.strictEqual(items.length, 3);
      assert.ok(items.some((item) => item.label === "/home"));
      assert.ok(items.some((item) => item.label === "/about"));
      assert.ok(items.some((item) => item.label === "/contact"));
    });

    it("should handle errors gracefully", async () => {
      const service: ValService = {
        getAllModules: async () => {
          throw new Error("Test error");
        },
        getAllModulePaths: async () => [],
        read: async () => {
          throw new Error("Not implemented");
        },
      };

      // Create a test source file with a route field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should return empty array on error
      assert.strictEqual(items.length, 0);
    });

    it("should provide textEdit to replace entire string when sourceFile is provided", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            myRoute: { type: "route" as const },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home" },
              "/about": { title: "About" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      // Create a test source file with a string literal
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/old" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/old" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/old") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 18 },
        partialText: "/old",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should have routes
      assert.ok(items.length > 0);

      // Each item should have a textEdit
      for (const item of items) {
        assert.ok(item.textEdit, "Item should have textEdit");
        assert.strictEqual(
          (item.textEdit as any).newText,
          item.label,
          "textEdit should replace with the route label",
        );
      }
    });

    it("should filter routes by include pattern", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            myRoute: {
              type: "route" as const,
              include: { source: "^/admin", flags: "" },
            },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/admin/users": { title: "Users" },
              "/admin/settings": { title: "Settings" },
              "/public/home": { title: "Home" },
              "/public/about": { title: "About" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route().include(/^\\/admin/) }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should only return routes matching /^\/admin/
      assert.strictEqual(items.length, 2);
      assert.ok(items.some((item) => item.label === "/admin/users"));
      assert.ok(items.some((item) => item.label === "/admin/settings"));
      assert.ok(!items.some((item) => item.label === "/public/home"));
      assert.ok(!items.some((item) => item.label === "/public/about"));
    });

    it("should filter routes by exclude pattern", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            myRoute: {
              type: "route" as const,
              exclude: { source: "^/admin", flags: "" },
            },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/admin/users": { title: "Users" },
              "/admin/settings": { title: "Settings" },
              "/public/home": { title: "Home" },
              "/public/about": { title: "About" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route().exclude(/^\\/admin/) }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should only return routes NOT matching /^\/admin/
      assert.strictEqual(items.length, 2);
      assert.ok(!items.some((item) => item.label === "/admin/users"));
      assert.ok(!items.some((item) => item.label === "/admin/settings"));
      assert.ok(items.some((item) => item.label === "/public/home"));
      assert.ok(items.some((item) => item.label === "/public/about"));
    });

    it("should filter routes by both include and exclude patterns", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            myRoute: {
              type: "route" as const,
              include: { source: "^/api", flags: "" },
              exclude: { source: "/admin", flags: "" },
            },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/api/users": { title: "Users API" },
              "/api/admin/users": { title: "Admin Users API" },
              "/api/posts": { title: "Posts API" },
              "/public/home": { title: "Home" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route().include(/^\\/api/).exclude(/\\/admin/) }),
  { myRoute: "/" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 17 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should only return routes matching /^\/api/ but NOT matching /\/admin/
      assert.strictEqual(items.length, 2);
      assert.ok(items.some((item) => item.label === "/api/users"));
      assert.ok(items.some((item) => item.label === "/api/posts"));
      assert.ok(!items.some((item) => item.label === "/api/admin/users"));
      assert.ok(!items.some((item) => item.label === "/public/home"));
    });

    it("should find route fields nested in union types", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      // Schema with a union containing different section types
      // One union option has a route field, others don't
      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            sections: {
              type: "array" as const,
              item: {
                type: "union" as const,
                options: [
                  {
                    type: "object" as const,
                    items: {
                      type: { type: "literal" as const, value: "hero" },
                      title: { type: "string" as const },
                      description: { type: "string" as const },
                    },
                  },
                  {
                    type: "object" as const,
                    items: {
                      type: { type: "literal" as const, value: "cta" },
                      label: { type: "string" as const },
                      href: { type: "route" as const },
                    },
                  },
                  {
                    type: "object" as const,
                    items: {
                      type: { type: "literal" as const, value: "text" },
                      content: { type: "string" as const },
                    },
                  },
                ],
              },
            },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home" },
              "/about": { title: "About" },
              "/contact": { title: "Contact" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({
    sections: s.array(
      s.union(
        "type",
        s.object({ type: s.literal("hero"), title: s.string(), description: s.string() }),
        s.object({ type: s.literal("cta"), label: s.string(), href: s.route() }),
        s.object({ type: s.literal("text"), content: s.string() })
      )
    )
  }),
  {
    sections: [
      { type: "cta", label: "Click me", href: "/" }
    ]
  }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/" in the href field
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          // Make sure it's the href value, not the path
          let parent = node.parent;
          while (parent) {
            if (
              ts.isPropertyAssignment(parent) &&
              ts.isIdentifier(parent.name) &&
              parent.name.text === "href"
            ) {
              stringNode = node;
              break;
            }
            parent = parent.parent;
          }
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the href string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 11, character: 58 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should find the route field inside the union and provide all routes
      assert.strictEqual(items.length, 3);
      assert.ok(items.some((item) => item.label === "/home"));
      assert.ok(items.some((item) => item.label === "/about"));
      assert.ok(items.some((item) => item.label === "/contact"));
    });

    it("should handle deeply nested routes in union within array within object", async () => {
      const schema: any = {
        type: "record" as const,
        router: true,
        items: {
          type: "object" as const,
          items: {
            title: { type: "string" as const },
          },
        },
      };

      const readResult: any = {
        schema: {
          type: "object" as const,
          items: {
            page: {
              type: "object" as const,
              items: {
                sections: {
                  type: "array" as const,
                  item: {
                    type: "union" as const,
                    options: [
                      {
                        type: "object" as const,
                        items: {
                          type: { type: "literal" as const, value: "link" },
                          href: {
                            type: "route" as const,
                            exclude: { source: "/admin", flags: "" },
                          },
                        },
                      },
                      {
                        type: "object" as const,
                        items: {
                          type: { type: "literal" as const, value: "button" },
                          label: { type: "string" as const },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService(
        [
          {
            path: "/src/app/routes.val.ts",
            schema: schema,
            source: {
              "/home": { title: "Home" },
              "/admin/dashboard": { title: "Dashboard" },
              "/about": { title: "About" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult,
      );

      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({
    page: s.object({
      sections: s.array(s.union("type",
        s.object({ type: s.literal("link"), href: s.route().exclude(/\\/admin/) }),
        s.object({ type: s.literal("button"), label: s.string() })
      ))
    })
  }),
  {
    page: {
      sections: [
        { type: "link", href: "/" }
      ]
    }
  }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/") {
          let parent = node.parent;
          while (parent) {
            if (
              ts.isPropertyAssignment(parent) &&
              ts.isIdentifier(parent.name) &&
              parent.name.text === "href"
            ) {
              stringNode = node;
              break;
            }
            parent = parent.parent;
          }
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the href string literal");

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 13, character: 35 },
        partialText: "/",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should find the nested route field and apply exclude pattern
      assert.strictEqual(items.length, 2);
      assert.ok(items.some((item) => item.label === "/home"));
      assert.ok(items.some((item) => item.label === "/about"));
      assert.ok(!items.some((item) => item.label === "/admin/dashboard"));
    });
  });

  describe("KeyOfCompletionProvider", () => {
    it("should provide keys from referenced module for keyOf fields", async () => {
      // Create a mock record schema that will be referenced by keyOf
      const recordSchema: any = {
        type: "record",
        item: {
          type: "object",
          items: {
            name: { type: "string" },
          },
        },
        opt: false,
      };

      // Create a keyOf schema that references the record module
      const keyOfSchema: any = {
        type: "object",
        items: {
          author: {
            type: "keyOf",
            sourcePath: "/authors.val.ts#/",
          },
        },
      };

      const readResult: any = {
        schema: keyOfSchema,
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService([], readResult);

      // Override read to return the referenced module when requested
      const originalRead = service.read;
      service.read = async (moduleFilePath: any, modulePath: any) => {
        if (moduleFilePath === "/authors.val.ts#/") {
          return {
            schema: recordSchema,
            source: {
              user1: { name: "Alice" },
              user2: { name: "Bob" },
              user3: { name: "Charlie" },
            },
            path: "/authors.val.ts#/" as any,
            errors: false as any,
          };
        }
        return originalRead(moduleFilePath, modulePath);
      };

      // Create a test source file with a keyOf field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ author: s.keyOf(authorsVal) }),
  { author: "user1" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "user1" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "user1") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new KeyOfCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 18 },
        partialText: "user1",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should have 3 keys (user1, user2, user3)
      assert.strictEqual(items.length, 3);
      assert.ok(items.some((item) => item.label === "user1"));
      assert.ok(items.some((item) => item.label === "user2"));
      assert.ok(items.some((item) => item.label === "user3"));

      // Each item should be marked as a "Key"
      for (const item of items) {
        assert.strictEqual(item.detail, "Key");
        assert.strictEqual(item.kind, CompletionItemKind.Value);
      }
    });

    it("should return empty array when schema has no keyOf fields", async () => {
      const schema: any = {
        type: "object",
        items: {
          title: { type: "string" },
        },
      };

      const readResult: any = {
        schema: schema,
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService([], readResult);

      // Create a test source file with a string field (not keyOf)
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ title: s.string() }),
  { title: "test" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "test" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "test") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new KeyOfCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 15 },
        partialText: "test",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should return empty array when field is not keyOf
      assert.strictEqual(items.length, 0);
    });

    it("should handle errors gracefully", async () => {
      const service: ValService = {
        getAllModules: async () => [],
        getAllModulePaths: async () => [],
        read: async () => {
          throw new Error("Test error");
        },
      };

      // Create a test source file
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ author: s.keyOf(authorsVal) }),
  { author: "test" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "test" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "test") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new KeyOfCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 15 },
        partialText: "test",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should return empty array on error
      assert.strictEqual(items.length, 0);
    });

    it("should provide textEdit to replace entire string when sourceFile is provided", async () => {
      const recordSchema: any = {
        type: "record",
        item: {
          type: "object",
          items: {
            name: { type: "string" },
          },
        },
        opt: false,
      };

      const keyOfSchema: any = {
        type: "object",
        items: {
          author: {
            type: "keyOf",
            sourcePath: "/authors.val.ts#/",
          },
        },
      };

      const readResult: any = {
        schema: keyOfSchema,
        source: {},
        validation: {},
        runtimeError: false,
      };

      const service: ValService = createMockService([], readResult);

      const originalRead = service.read;
      service.read = async (moduleFilePath: any, modulePath: any) => {
        if (moduleFilePath === "/authors.val.ts#/") {
          return {
            schema: recordSchema as any,
            source: {
              user1: { name: "Alice" },
              user2: { name: "Bob" },
            },
            path: "/authors.val.ts#/" as any,
            errors: false as any,
          };
        }
        return originalRead(moduleFilePath, modulePath);
      };

      // Create a test source file with a string literal
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ author: s.keyOf(authorsVal) }),
  { author: "old" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "old" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "old") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const provider = new KeyOfCompletionProvider();
      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 18 },
        partialText: "old",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should have keys
      assert.ok(items.length > 0);

      // Each item should have a textEdit
      for (const item of items) {
        assert.ok(item.textEdit, "Item should have textEdit");
        assert.strictEqual(
          (item.textEdit as any).newText,
          item.label,
          "textEdit should replace with the key label",
        );
      }
    });
  });

  describe("CompletionProviderRegistry", () => {
    it("should register and retrieve providers", () => {
      const cache = createMockCache();
      const registry = new CompletionProviderRegistry(cache);

      // Registry should have default providers
      assert.ok(registry);
    });

    it("should return empty array for unknown context type", async () => {
      const cache = createMockCache();
      const registry = new CompletionProviderRegistry(cache);

      const service: ValService = {
        getAllModules: async () => [],
        getAllModulePaths: async () => [],
        read: async () => {
          throw new Error("Not implemented");
        },
      };

      const context: CompletionContext = {
        type: "none",
        position: { line: 0, character: 0 },
      };

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
      );

      assert.strictEqual(items.length, 0);
    });

    it("should get completion items from registered provider", async () => {
      const { initVal } = await import("@valbuild/core");
      const { s } = initVal();

      const fakeNextAppRouter = {
        getRouterId: () => "next-app-router",
        validate: () => [],
      };

      const schema = s
        .router(
          fakeNextAppRouter,
          s.object({
            title: s.string(),
          }),
        )
        ["executeSerialize"]();

      const service: ValService = {
        getAllModules: async () => [
          {
            path: "/src/routes.val.ts",
            schema: schema,
            source: {
              "/test": { title: "Test" },
            },
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        getAllModulePaths: async () => ["/src/routes.val.ts"],
        read: async () => {
          return {
            schema: {
              type: "object",
              items: {
                myRoute: {
                  type: "route",
                },
              },
            } as any,
            source: {},
            path: "/test.val.ts" as any,
            errors: false as any,
          };
        },
      };

      // Create a test source file with a route field
      const testCode = `
export default c.define(
  "/test.val.ts",
  s.object({ myRoute: s.route() }),
  { myRoute: "/test" }
);`.trim();

      const sourceFile = ts.createSourceFile(
        "/test.val.ts",
        testCode,
        ts.ScriptTarget.Latest,
        true,
      );

      // Find the string literal "/test" in the source
      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text === "/test") {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      assert.ok(stringNode, "Should find the string literal");

      const cache = createMockCache();
      const registry = new CompletionProviderRegistry(cache);

      const context: CompletionContext = {
        type: "unknown-string",
        position: { line: 3, character: 20 },
        partialText: "/t",
        modulePath: "/test.val.ts",
        stringNode: stringNode,
      };

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].label, "/test");
    });
  });

  describe("ImagePathCompletionProvider", () => {
    it("should provide image file paths from /public/val directory", async () => {
      // Create a mock cache with some image files
      const mockCache = createMockCache();
      mockCache.getFiles = () => [
        "/public/val/logo.png",
        "/public/val/icon.svg",
        "/public/val/banner.jpg",
        "/public/val/styles.css", // Not an image
        "/public/val/images/photo.webp",
      ];

      const registry = new CompletionProviderRegistry(mockCache);

      const code = `
import { c } from "@valbuild/core";
export default c.image("");
      `;

      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
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

      const service = createMockService([]);

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should only return image files (4 images, not the CSS file)
      assert.strictEqual(items.length, 4);

      // Check that all items are images
      const labels = items.map((item) => item.label);
      assert.ok(labels.includes("/public/val/logo.png"));
      assert.ok(labels.includes("/public/val/icon.svg"));
      assert.ok(labels.includes("/public/val/banner.jpg"));
      assert.ok(labels.includes("/public/val/images/photo.webp"));
      assert.ok(!labels.includes("/public/val/styles.css"));

      // Check that items have textEdit
      assert.ok(items[0].textEdit);
    });

    it("should return empty array when no image files exist", async () => {
      const mockCache = createMockCache();
      mockCache.getFiles = () => ["/public/val/document.pdf"];

      const registry = new CompletionProviderRegistry(mockCache);

      const code = `c.image("")`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node)) {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.image",
        position: { line: 0, character: 9 },
        partialText: "",
        stringNode: stringNode,
      };

      const service = createMockService([]);

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      assert.strictEqual(items.length, 0);
    });
  });

  describe("FilePathCompletionProvider", () => {
    it("should provide all file paths from /public/val directory", async () => {
      // Create a mock cache with various files
      const mockCache = createMockCache();
      mockCache.getFiles = () => [
        "/public/val/document.pdf",
        "/public/val/data.json",
        "/public/val/logo.png",
        "/public/val/docs/manual.pdf",
        "/public/val/scripts/app.js",
      ];

      const registry = new CompletionProviderRegistry(mockCache);

      const code = `
import { c } from "@valbuild/core";
export default c.file("");
      `;

      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
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

      const service = createMockService([]);

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      // Should return all 5 files
      assert.strictEqual(items.length, 5);

      // Check that all items are present
      const labels = items.map((item) => item.label);
      assert.ok(labels.includes("/public/val/document.pdf"));
      assert.ok(labels.includes("/public/val/data.json"));
      assert.ok(labels.includes("/public/val/logo.png"));
      assert.ok(labels.includes("/public/val/docs/manual.pdf"));
      assert.ok(labels.includes("/public/val/scripts/app.js"));

      // Check that items have textEdit
      assert.ok(items[0].textEdit);
    });

    it("should return empty array when no files exist", async () => {
      const mockCache = createMockCache();
      mockCache.getFiles = () => [];

      const registry = new CompletionProviderRegistry(mockCache);

      const code = `c.file("")`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
      );

      let stringNode: ts.StringLiteral | undefined;
      function findString(node: ts.Node) {
        if (ts.isStringLiteral(node)) {
          stringNode = node;
        }
        ts.forEachChild(node, findString);
      }
      findString(sourceFile);

      const context: CompletionContext = {
        type: "c.file",
        position: { line: 0, character: 8 },
        partialText: "",
        stringNode: stringNode,
      };

      const service = createMockService([]);

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root",
        sourceFile,
      );

      assert.strictEqual(items.length, 0);
    });
  });
});
