/**
 * Shared route validation utilities
 */

export type RouteMode = "directory" | "source";

export type SerializedRegExpPattern = {
  source: string;
  flags: string;
};

const REGEXP_MODES: Record<
  RouteMode,
  { pathPart: RegExp; pathPartNoParams: RegExp }
> = {
  directory: {
    pathPart: /^[a-z0-9_\-\.~!\$&'\(\)\*\+,;=:@%]+$/i,
    pathPartNoParams: /^[a-z0-9_\-\.~!\$&'\(\)\*\+,;=:@%]+$/i,
  },
  source: {
    pathPart: /^[a-z0-9_\-\.~!\$&'\(\)\*\+,;=:@%\[\]]+$/i,
    pathPartNoParams: /^[a-z0-9_\-\.~!\$&'\(\)\*\+,;=:@%]+$/i,
  },
};

export function validateRoute(
  route: string,
  mode: RouteMode
): { valid: true } | { valid: false; message: string } {
  if (!route.startsWith("/")) {
    return {
      valid: false,
      message: `Route must start with '/'. Got: '${route}'`,
    };
  }

  if (route === "/") {
    return { valid: true };
  }

  // Split into parts and validate each
  const parts = route.split("/").slice(1); // Remove empty first element from leading /

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "") {
      return {
        valid: false,
        message: `Route cannot have empty parts (double slashes). Got: '${route}'`,
      };
    }

    // Check if part is a catch-all
    if (part.startsWith("[...") && part.endsWith("]")) {
      // Catch-all must be the last part
      if (i !== parts.length - 1) {
        return {
          valid: false,
          message: `Catch-all parameter '[...${part.slice(
            4,
            -1
          )}]' must be the last part of the route. Got: '${route}'`,
        };
      }

      const paramName = part.slice(4, -1);
      if (!REGEXP_MODES[mode].pathPartNoParams.test(paramName)) {
        return {
          valid: false,
          message: `Invalid catch-all parameter name '${paramName}' in route '${route}'. Parameter names must match ${REGEXP_MODES[mode].pathPartNoParams}`,
        };
      }

      continue;
    }

    // Check if part is a dynamic parameter
    if (part.startsWith("[") && part.endsWith("]")) {
      const paramName = part.slice(1, -1);
      if (!REGEXP_MODES[mode].pathPartNoParams.test(paramName)) {
        return {
          valid: false,
          message: `Invalid parameter name '${paramName}' in route '${route}'. Parameter names must match ${REGEXP_MODES[mode].pathPartNoParams}`,
        };
      }

      continue;
    }

    // Check if part is a group (Next.js style)
    if (part.startsWith("(") && part.endsWith(")")) {
      // Groups are allowed, just validate the content
      const groupName = part.slice(1, -1);
      if (!REGEXP_MODES[mode].pathPartNoParams.test(groupName)) {
        return {
          valid: false,
          message: `Invalid group name '${groupName}' in route '${route}'. Group names must match ${REGEXP_MODES[mode].pathPartNoParams}`,
        };
      }

      continue;
    }

    // Regular part - validate against the full regexp
    if (!REGEXP_MODES[mode].pathPart.test(part)) {
      return {
        valid: false,
        message: `Invalid route part '${part}' in route '${route}'. Route parts must match ${REGEXP_MODES[mode].pathPart}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a route schema and return errors if any
 */
export function validateRouteSchema(
  schema: { currentRouter?: { mode?: RouteMode } } | undefined,
  route: string
): { valid: true } | { valid: false; message: string } {
  const mode = schema?.currentRouter?.mode || "source";
  return validateRoute(route, mode);
}

/**
 * Filter routes by include/exclude patterns
 */
export function filterRoutesByPatterns(
  routes: string[],
  includePattern?: SerializedRegExpPattern,
  excludePattern?: SerializedRegExpPattern
): string[] {
  // Validate patterns upfront and warn about issues
  let includeRegex: RegExp | null = null;
  let excludeRegex: RegExp | null = null;

  if (includePattern) {
    try {
      includeRegex = new RegExp(includePattern.source, includePattern.flags);
    } catch (e) {
      console.warn(
        `[Val] Invalid include pattern: /${includePattern.source}/${includePattern.flags}`,
        `\nError: ${e instanceof Error ? e.message : String(e)}`,
        `\nAll routes will be filtered out due to malformed include pattern.`
      );
    }
  }

  if (excludePattern) {
    try {
      excludeRegex = new RegExp(excludePattern.source, excludePattern.flags);
    } catch (e) {
      console.warn(
        `[Val] Invalid exclude pattern: /${excludePattern.source}/${excludePattern.flags}`,
        `\nError: ${e instanceof Error ? e.message : String(e)}`,
        `\nAll routes will be filtered out due to malformed exclude pattern.`
      );
    }
  }

  return routes.filter((route) => {
    // Check include pattern
    if (includePattern) {
      if (!includeRegex) {
        // Pattern creation failed, filter out this route
        return false;
      }
      if (!includeRegex.test(route)) {
        return false;
      }
    }

    // Check exclude pattern
    if (excludePattern) {
      if (!excludeRegex) {
        // Pattern creation failed, filter out this route
        return false;
      }
      if (excludeRegex.test(route)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Validate a single route against include/exclude patterns
 */
export function validateRoutePatterns(
  route: string,
  includePattern?: SerializedRegExpPattern,
  excludePattern?: SerializedRegExpPattern
): { valid: true } | { valid: false; message: string } {
  // Validate include pattern
  if (includePattern) {
    try {
      const regex = new RegExp(includePattern.source, includePattern.flags);
      if (!regex.test(route)) {
        return {
          valid: false,
          message: `Route '${route}' does not match include pattern: /${includePattern.source}/${includePattern.flags}`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: `Invalid include pattern: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  // Validate exclude pattern
  if (excludePattern) {
    try {
      const regex = new RegExp(excludePattern.source, excludePattern.flags);
      if (regex.test(route)) {
        return {
          valid: false,
          message: `Route '${route}' matches exclude pattern: /${excludePattern.source}/${excludePattern.flags}`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: `Invalid exclude pattern: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  return { valid: true };
}
