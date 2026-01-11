import assert from "assert";
import { checkRouteIsValid, RouteValidationService } from "./checkRoute";
import { ValModuleResult } from "./valModules";

describe("checkRoute", () => {
  describe("checkRouteIsValid", () => {
    // Helper to create a mock service
    function createMockService(
      modules: ValModuleResult[]
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
          })
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
        service
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
          })
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
        service
      );

      assert.strictEqual(
        result.error,
        true,
        "Should fail for non-existent route"
      );
      if (result.error) {
        assert.ok(
          result.message.includes("does not exist"),
          "Should mention route doesn't exist"
        );
        assert.ok(
          result.message.includes("Closest match"),
          "Should suggest closest match"
        );
      }
    });
  });
});
