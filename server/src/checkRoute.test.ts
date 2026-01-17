import assert from "assert";
import { checkRouteIsValid, RouteValidationService } from "./checkRoute";
import { ValModuleResult } from "./valModules";

describe("checkRoute", () => {
  describe("checkRouteIsValid", () => {
    // Helper to create a mock service
    function createMockService(
      modules: ValModuleResult[],
    ): RouteValidationService {
      return {
        getAllModules: async () => modules,
      };
    }

    it("should validate existing route in router module", async () => {
      // Use initVal to build the schema
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

      const service = createMockService([
        {
          path: "/src/app/[slug]/page.val.ts",
          schema: schema,
          source: {
            "/my-slug": { title: "My Title" },
            "/another-slug": { title: "Another Title" },
          },
          validation: {},
          runtimeError: false,
          defaultExport: true,
        },
      ]);

      const result = await checkRouteIsValid(
        "/my-slug",
        undefined,
        undefined,
        service,
      );

      assert.strictEqual(result.error, false, "Should validate existing route");
    });

    it("should fail when route doesn't exist", async () => {
      // Use initVal to build the schema
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

      const service = createMockService([
        {
          path: "/src/app/[slug]/page.val.ts",
          schema: schema,
          source: {
            "/my-slug": { title: "My Title" },
            "/another-slug": { title: "Another Title" },
          },
          validation: {},
          runtimeError: false,
          defaultExport: true,
        },
      ]);

      const result = await checkRouteIsValid(
        "/non-existent-slug",
        undefined,
        undefined,
        service,
      );

      assert.strictEqual(
        result.error,
        true,
        "Should fail for non-existent route",
      );
      if (result.error) {
        assert.ok(
          result.message.includes("does not exist"),
          "Should mention route doesn't exist",
        );
        assert.ok(
          result.message.includes("Closest match"),
          "Should suggest closest match",
        );
      }
    });

    it("should validate route with include pattern", async () => {
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

      const service = createMockService([
        {
          path: "/src/app/[slug]/page.val.ts",
          schema: schema,
          source: {
            "/api/users": { title: "Users API" },
            "/blog/post": { title: "Blog Post" },
          },
          validation: {},
          runtimeError: false,
          defaultExport: true,
        },
      ]);

      const includePattern = { source: "^/api/", flags: "" };
      const result = await checkRouteIsValid(
        "/api/users",
        includePattern,
        undefined,
        service,
      );

      assert.strictEqual(
        result.error,
        false,
        "Should validate route matching include pattern",
      );
    });

    it("should fail route with exclude pattern", async () => {
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

      const service = createMockService([
        {
          path: "/src/app/[slug]/page.val.ts",
          schema: schema,
          source: {
            "/admin/dashboard": { title: "Admin Dashboard" },
            "/public/page": { title: "Public Page" },
          },
          validation: {},
          runtimeError: false,
          defaultExport: true,
        },
      ]);

      const excludePattern = { source: "^/admin/", flags: "" };
      const result = await checkRouteIsValid(
        "/admin/dashboard",
        undefined,
        excludePattern,
        service,
      );

      assert.strictEqual(
        result.error,
        true,
        "Should fail route matching exclude pattern",
      );
      if (result.error) {
        assert.ok(
          result.message.includes("matches exclude pattern"),
          "Should mention exclude pattern",
        );
      }
    });

    it("should validate route with both include and exclude patterns", async () => {
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

      const service = createMockService([
        {
          path: "/src/app/[slug]/page.val.ts",
          schema: schema,
          source: {
            "/api/users": { title: "Users API" },
            "/api/admin": { title: "Admin API" },
            "/blog/post": { title: "Blog Post" },
          },
          validation: {},
          runtimeError: false,
          defaultExport: true,
        },
      ]);

      const includePattern = { source: "^/api/", flags: "" };
      const excludePattern = { source: "/admin$", flags: "" };
      const result = await checkRouteIsValid(
        "/api/users",
        includePattern,
        excludePattern,
        service,
      );

      assert.strictEqual(
        result.error,
        false,
        "Should validate route matching include and not matching exclude",
      );
    });
  });
});
