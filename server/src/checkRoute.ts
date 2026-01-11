import {
  filterRoutesByPatterns,
  validateRoutePatterns,
  SerializedRegExpPattern,
} from "./routeValidation";
import { ValModuleResult } from "./valModules";
import { findSimilar } from "./findSimilar";

export interface RouteValidationService {
  getAllModules: () => Promise<ValModuleResult[]>;
}

export async function checkRouteIsValid(
  route: string,
  include: SerializedRegExpPattern | undefined,
  exclude: SerializedRegExpPattern | undefined,
  service: RouteValidationService
): Promise<{ error: false } | { error: true; message: string }> {
  // 1. Get all modules with their source and schema
  const allModules = await service.getAllModules();

  // 2. Find modules with routers
  const routerModules: Record<string, Record<string, unknown>> = {};

  for (const module of allModules) {
    if (
      module.schema?.type === "record" &&
      (module.schema as any).router &&
      module.source &&
      typeof module.source === "object" &&
      !Array.isArray(module.source)
    ) {
      routerModules[module.path || ""] = module.source as Record<
        string,
        unknown
      >;
    }
  }

  // 3. Check if route exists in any router module
  let foundInModule: string | null = null;
  for (const [modulePath, source] of Object.entries(routerModules)) {
    if (route in source) {
      foundInModule = modulePath;
      break;
    }
  }

  if (!foundInModule) {
    // Route not found in any router module

    // Check if we have any router modules at all
    if (Object.keys(routerModules).length === 0) {
      return {
        error: true,
        message: `Route '${route}' could not be validated: No router modules found in the project. Use s.record(...).router(...) to define router modules.`,
      };
    }

    // We have router modules, collect all routes
    let allRoutes = Object.values(routerModules).flatMap((source) =>
      Object.keys(source)
    );

    // Filter routes by include/exclude patterns for suggestions
    allRoutes = filterRoutesByPatterns(allRoutes, include, exclude);

    const alternatives = findSimilar(route, allRoutes);

    return {
      error: true,
      message: `Route '${route}' does not exist in any router module. ${
        alternatives.length > 0
          ? `Closest match: '${
              alternatives[0].target
            }'. Other similar: ${alternatives
              .slice(1, 4)
              .map((a) => `'${a.target}'`)
              .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`
          : "No similar routes found."
      }`,
    };
  }

  // 4. Validate against include/exclude patterns
  const patternValidation = validateRoutePatterns(route, include, exclude);
  if (!patternValidation.valid) {
    return {
      error: true,
      message: patternValidation.message,
    };
  }

  return { error: false };
}
