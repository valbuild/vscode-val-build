import assert from "assert";
import { CompletionItemKind } from "vscode-languageserver/node";
import {
  RouteCompletionProvider,
  CompletionProviderRegistry,
} from "./completionProviders";
import { CompletionContext } from "./completionContext";
import { ValService } from "./types";
import { ValModuleResult } from "./valModules";

describe("completionProviders", () => {
  describe("RouteCompletionProvider", () => {
    // Helper to create a mock service
    function createMockService(
      modules: ValModuleResult[],
      readResult?: any
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
          })
        )
        ["executeSerialize"]();

      // Create a mock read result for the module being edited
      const readResult = {
        schema: {
          type: "object",
          properties: {
            route: {
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
        readResult
      );

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "route",
        position: { line: 0, character: 24 },
        partialText: "/h",
        modulePath: "/test.val.ts",
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root"
      );

      assert.strictEqual(items.length, 3);
      assert.ok(items.some((item) => item.label === "/home"));
      assert.ok(items.some((item) => item.label === "/about"));
      assert.ok(items.some((item) => item.label === "/contact"));
      assert.ok(items.every((item) => item.kind === CompletionItemKind.Value));
      assert.ok(items.every((item) => item.detail === "Route"));
    });

    it("should return empty array when no router modules exist", async () => {
      const readResult = {
        schema: {
          type: "object",
          properties: {
            route: {
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
            schema: { type: "string" },
            source: "Hello World",
            validation: {},
            runtimeError: false,
            defaultExport: true,
          },
        ],
        readResult
      );

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "route",
        position: { line: 0, character: 24 },
        partialText: "/",
        modulePath: "/test.val.ts",
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root"
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
          })
        )
        ["executeSerialize"]();

      const readResult = {
        schema: {
          type: "object",
          properties: {
            route: {
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
        readResult
      );

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "route",
        position: { line: 0, character: 24 },
        partialText: "/",
        modulePath: "/test.val.ts",
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root"
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

      const provider = new RouteCompletionProvider();
      const context: CompletionContext = {
        type: "route",
        position: { line: 0, character: 24 },
        partialText: "/",
        modulePath: "/test.val.ts",
      };

      const items = await provider.provideCompletionItems(
        context,
        service,
        "/test/root"
      );

      // Should return empty array on error
      assert.strictEqual(items.length, 0);
    });
  });

  describe("CompletionProviderRegistry", () => {
    it("should register and retrieve providers", () => {
      const registry = new CompletionProviderRegistry();

      // Registry should have default providers
      assert.ok(registry);
    });

    it("should return empty array for unknown context type", async () => {
      const registry = new CompletionProviderRegistry();

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
        "/test/root"
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
          })
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
              properties: {
                route: {
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

      const registry = new CompletionProviderRegistry();

      const context: CompletionContext = {
        type: "route",
        position: { line: 0, character: 24 },
        partialText: "/t",
        modulePath: "/test.val.ts",
      };

      const items = await registry.getCompletionItems(
        context,
        service,
        "/test/root"
      );

      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].label, "/test");
    });
  });
});
