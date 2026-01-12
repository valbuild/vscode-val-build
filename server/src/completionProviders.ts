import {
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  Range,
  Position,
} from "vscode-languageserver/node";
import { CompletionContext } from "./completionContext";
import { ValService } from "./types";
import ts from "typescript";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
} from "@valbuild/core";
import {
  filterRoutesByPatterns,
  SerializedRegExpPattern,
} from "./routeValidation";
import { PublicValFilesCache } from "./publicValFilesCache";

/**
 * Get sourcePath from a keyOf schema
 */
function getKeyOfSourcePath(
  schema: SerializedSchema | undefined
): string | undefined {
  if (!schema) return undefined;

  if (schema.type === "keyOf") {
    // Check for path property (most common)
    if ("path" in schema && typeof schema.path === "string") {
      return schema.path;
    }
    // Check for sourcePath property (alternative structure)
    if ("sourcePath" in schema && typeof schema.sourcePath === "string") {
      return schema.sourcePath;
    }
    // Check for record property (alternative structure)
    if ("record" in schema && typeof schema.record === "string") {
      return schema.record;
    }
  }

  return undefined;
}

/**
 * Base interface for completion providers
 */
export interface CompletionProvider {
  /**
   * The type of context this provider handles
   */
  contextType: CompletionContext["type"];

  /**
   * Provide completion items for the given context
   */
  provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]>;
}

/**
 * Route completion provider
 * Provides autocomplete for route values in fields with s.route() schema
 */
export class RouteCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "unknown-string";

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    try {
      console.log("[RouteCompletionProvider] Starting completion");

      // We need to:
      // 1. Read the module to get its schema
      // 2. Find the field path where the cursor is
      // 3. Check if that field's schema type is "route"
      // 4. Get include/exclude patterns from the route schema
      // 5. Collect all routes from router modules
      // 6. Filter by include/exclude patterns

      if (!context.modulePath || !context.stringNode || !sourceFile) {
        console.log("[RouteCompletionProvider] Missing required context");
        return [];
      }

      // Read the current module to get its schema
      const moduleFilePath = context.modulePath as any;
      console.log("[RouteCompletionProvider] Reading module:", moduleFilePath);
      const result = await service.read(moduleFilePath, "" as any);

      if (!result || !result.schema) {
        console.log("[RouteCompletionProvider] No schema found in result");
        return [];
      }

      // Find which field in the content object the user is editing
      const fieldName = this.findFieldName(context.stringNode, sourceFile);
      console.log("[RouteCompletionProvider] Field name:", fieldName);

      if (!fieldName) {
        console.log("[RouteCompletionProvider] Could not determine field name");
        return [];
      }

      // Get the schema for this specific field (handles nested fields)
      const fieldSchema = this.getFieldSchemaRecursive(
        result.schema,
        fieldName
      );
      console.log(
        "[RouteCompletionProvider] Field schema type:",
        fieldSchema?.type
      );

      if (!fieldSchema || fieldSchema.type !== "route") {
        console.log("[RouteCompletionProvider] Not a route field, skipping");
        return []; // Not a route field
      }

      // Extract include/exclude patterns from the route schema
      const includePattern = (
        "include" in fieldSchema ? fieldSchema.include : undefined
      ) as SerializedRegExpPattern | undefined;
      const excludePattern = (
        "exclude" in fieldSchema ? fieldSchema.exclude : undefined
      ) as SerializedRegExpPattern | undefined;
      console.log("[RouteCompletionProvider] Patterns:", {
        includePattern,
        excludePattern,
      });

      // Get all modules
      console.log("[RouteCompletionProvider] Getting all modules");
      const allModules = await service.getAllModules();
      console.log(
        "[RouteCompletionProvider] Found",
        allModules.length,
        "total modules"
      );

      // Find modules with routers and collect their routes (use Set for deduplication)
      const routesSet = new Set<string>();

      for (const module of allModules) {
        if (
          module.schema?.type === "record" &&
          "router" in module.schema &&
          module.schema.router &&
          module.source &&
          typeof module.source === "object" &&
          !Array.isArray(module.source)
        ) {
          // Add all routes from this router module
          const source = module.source as Record<string, unknown>;
          const routes = Object.keys(source);
          console.log(
            "[RouteCompletionProvider] Found router module:",
            module.path,
            "with routes:",
            routes
          );
          for (const route of routes) {
            routesSet.add(route);
          }
        }
      }

      // Convert Set to array for filtering
      const allRoutes = Array.from(routesSet);
      console.log(
        "[RouteCompletionProvider] Total unique routes collected:",
        allRoutes.length,
        allRoutes
      );

      // Filter routes by include/exclude patterns
      const filteredRoutes = filterRoutesByPatterns(
        allRoutes,
        includePattern,
        excludePattern
      );
      console.log(
        "[RouteCompletionProvider] Filtered routes:",
        filteredRoutes.length,
        filteredRoutes
      );

      // Calculate the range to replace (the entire string content, excluding quotes)
      let replaceRange: Range | undefined;
      if (context.stringNode && sourceFile) {
        const stringStart = context.stringNode.getStart(sourceFile);
        const stringEnd = context.stringNode.getEnd();

        // +1 to skip opening quote, -1 to skip closing quote
        const contentStart = stringStart + 1;
        const contentEnd = stringEnd - 1;

        const startPos = sourceFile.getLineAndCharacterOfPosition(contentStart);
        const endPos = sourceFile.getLineAndCharacterOfPosition(contentEnd);

        replaceRange = Range.create(
          Position.create(startPos.line, startPos.character),
          Position.create(endPos.line, endPos.character)
        );
      }

      // Convert filtered routes to completion items
      const items: CompletionItem[] = filteredRoutes.map((route) => {
        const item: CompletionItem = {
          label: route,
          kind: CompletionItemKind.Value,
          detail: "Route",
          documentation: `Available route: ${route}`,
        };

        // Add textEdit to replace the entire string content
        if (replaceRange) {
          item.textEdit = TextEdit.replace(replaceRange, route);
        }

        return item;
      });

      console.log(
        "[RouteCompletionProvider] Returning",
        items.length,
        "completion items"
      );
      return items;
    } catch (error) {
      console.error("Error providing route completion:", error);
      return [];
    }
  }

  /**
   * Find the field name in the content object where the cursor is positioned
   */
  private findFieldName(
    stringNode: ts.StringLiteral,
    sourceFile: ts.SourceFile
  ): string | undefined {
    // Walk up the AST to find the property assignment
    let parent = stringNode.parent;
    while (parent) {
      if (ts.isPropertyAssignment(parent)) {
        const name = parent.name;
        if (ts.isIdentifier(name)) {
          return name.text;
        } else if (ts.isStringLiteral(name)) {
          return name.text;
        }
      }
      parent = parent.parent;
    }
    return undefined;
  }

  /**
   * Get the schema for a specific field in the content object
   */
  private getFieldSchema(
    schema: SerializedSchema,
    fieldName: string
  ): SerializedSchema | undefined {
    if (schema.type === "object") {
      const items = "items" in schema ? schema.items : undefined;
      if (items && typeof items === "object" && fieldName in items) {
        return items[fieldName] as SerializedSchema;
      }
    }
    return undefined;
  }

  /**
   * Recursively search for a field with the given name in nested schemas
   * This handles fields nested in arrays and objects
   */
  private getFieldSchemaRecursive(
    schema: SerializedSchema,
    fieldName: string,
    depth: number = 0
  ): SerializedSchema | undefined {
    const indent = "  ".repeat(depth);
    console.log(
      `${indent}[RouteCompletionProvider.recurse] type: ${schema.type}, looking for: "${fieldName}"`
    );

    // Check if this is an object with the field
    if (schema.type === "object") {
      const items = "items" in schema ? schema.items : undefined;
      if (items && typeof items === "object") {
        console.log(`${indent}  Object fields:`, Object.keys(items));
        if (fieldName in items) {
          console.log(`${indent}  ✓ Found "${fieldName}"!`);
          return items[fieldName] as SerializedSchema;
        }
        // Recursively search in nested objects
        for (const key in items) {
          const result = this.getFieldSchemaRecursive(
            items[key] as SerializedSchema,
            fieldName,
            depth + 1
          );
          if (result) return result;
        }
      }
    }

    // Check if this is an array, search in its items
    if (schema.type === "array") {
      const item = "item" in schema ? schema.item : undefined;
      if (item) {
        console.log(`${indent}  Searching array item`);
        return this.getFieldSchemaRecursive(
          item as SerializedSchema,
          fieldName,
          depth + 1
        );
      }
    }

    // Check if this is a record, search in its items
    if (schema.type === "record") {
      const item = "item" in schema ? schema.item : undefined;
      if (item) {
        console.log(`${indent}  Searching record item`);
        return this.getFieldSchemaRecursive(
          item as SerializedSchema,
          fieldName,
          depth + 1
        );
      }
    }

    // Check if this is a union, search in all options/items
    if (schema.type === "union") {
      // Union can have either "options" or "items" property depending on the version
      const unionItems =
        ("options" in schema ? schema.options : undefined) ||
        ("items" in schema ? schema.items : undefined);

      if (unionItems && Array.isArray(unionItems)) {
        console.log(
          `${indent}  Union with ${unionItems.length} items, searching each`
        );
        for (let i = 0; i < unionItems.length; i++) {
          const option = unionItems[i];
          console.log(
            `${indent}  Searching union item ${i + 1}/${
              unionItems.length
            } (type: ${(option as SerializedSchema).type})`
          );
          const result = this.getFieldSchemaRecursive(
            option as SerializedSchema,
            fieldName,
            depth + 1
          );
          if (result) return result;
        }
      } else {
        console.log(
          `${indent}  ⚠️  Union doesn't have valid options/items array!`
        );
      }
    }

    return undefined;
  }
}

/**
 * KeyOf completion provider
 * Provides autocomplete for keys from referenced modules using s.keyOf()
 */
export class KeyOfCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "unknown-string"; // Handle content object strings

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    try {
      if (!context.modulePath || !context.stringNode || !sourceFile) {
        return [];
      }

      // Read the current module to get its schema
      const moduleFilePath = context.modulePath as any;
      const result = await service.read(moduleFilePath, "" as any);

      if (!result || !result.schema) {
        return [];
      }

      // Find which field in the content object the user is editing
      const fieldName = this.findFieldName(context.stringNode, sourceFile);

      if (!fieldName) {
        return [];
      }

      // Get the schema for this specific field (handles nested fields)
      const fieldSchema = this.getFieldSchemaRecursive(
        result.schema,
        fieldName
      );

      if (!fieldSchema || fieldSchema.type !== "keyOf") {
        return []; // Not a keyOf field
      }

      // Get the sourcePath from the keyOf schema
      const sourcePath = getKeyOfSourcePath(fieldSchema);

      if (!sourcePath) {
        return [];
      }

      // Read the referenced module
      const [refModuleFilePath, refModulePath] =
        Internal.splitModuleFilePathAndModulePath(sourcePath as any);

      const refModule = await service.read(refModuleFilePath, refModulePath);

      if (
        !refModule.source ||
        typeof refModule.source !== "object" ||
        Array.isArray(refModule.source)
      ) {
        return [];
      }

      // Get all keys from the referenced module
      const keys = Object.keys(refModule.source);

      // Calculate the range to replace (the entire string content, excluding quotes)
      let replaceRange: Range | undefined;
      if (context.stringNode && sourceFile) {
        const stringStart = context.stringNode.getStart(sourceFile);
        const stringEnd = context.stringNode.getEnd();

        // +1 to skip opening quote, -1 to skip closing quote
        const contentStart = stringStart + 1;
        const contentEnd = stringEnd - 1;

        const startPos = sourceFile.getLineAndCharacterOfPosition(contentStart);
        const endPos = sourceFile.getLineAndCharacterOfPosition(contentEnd);

        replaceRange = Range.create(
          Position.create(startPos.line, startPos.character),
          Position.create(endPos.line, endPos.character)
        );
      }

      // Convert keys to completion items
      const items: CompletionItem[] = keys.map((key) => {
        const item: CompletionItem = {
          label: key,
          kind: CompletionItemKind.Value,
          detail: "Key",
          documentation: `Available key from ${refModule.path}`,
        };

        // Add textEdit to replace the entire string content
        if (replaceRange) {
          item.textEdit = TextEdit.replace(replaceRange, key);
        }

        return item;
      });

      return items;
    } catch (error) {
      console.error("Error providing keyOf completion:", error);
      return [];
    }
  }

  /**
   * Find the field name in the content object where the cursor is positioned
   */
  private findFieldName(
    stringNode: ts.StringLiteral,
    sourceFile: ts.SourceFile
  ): string | undefined {
    // Walk up the AST to find the property assignment
    let parent = stringNode.parent;
    while (parent) {
      if (ts.isPropertyAssignment(parent)) {
        const name = parent.name;
        if (ts.isIdentifier(name)) {
          return name.text;
        } else if (ts.isStringLiteral(name)) {
          return name.text;
        }
      }
      parent = parent.parent;
    }
    return undefined;
  }

  /**
   * Get the schema for a specific field in the content object
   */
  private getFieldSchema(
    schema: SerializedSchema,
    fieldName: string
  ): SerializedSchema | undefined {
    if (schema.type === "object") {
      const items = "items" in schema ? schema.items : undefined;
      if (items && typeof items === "object" && fieldName in items) {
        return items[fieldName] as SerializedSchema;
      }
    }
    return undefined;
  }

  /**
   * Recursively search for a field with the given name in nested schemas
   * This handles fields nested in arrays and objects
   */
  private getFieldSchemaRecursive(
    schema: SerializedSchema,
    fieldName: string
  ): SerializedSchema | undefined {
    // Check if this is an object with the field
    if (schema.type === "object") {
      const items = "items" in schema ? schema.items : undefined;
      if (items && typeof items === "object") {
        if (fieldName in items) {
          return items[fieldName] as SerializedSchema;
        }
        // Recursively search in nested objects
        for (const key in items) {
          const result = this.getFieldSchemaRecursive(
            items[key] as SerializedSchema,
            fieldName
          );
          if (result) return result;
        }
      }
    }

    // Check if this is an array, search in its items
    if (schema.type === "array") {
      const item = "item" in schema ? schema.item : undefined;
      if (item) {
        return this.getFieldSchemaRecursive(
          item as SerializedSchema,
          fieldName
        );
      }
    }

    // Check if this is a record, search in its items
    if (schema.type === "record") {
      const item = "item" in schema ? schema.item : undefined;
      if (item) {
        return this.getFieldSchemaRecursive(
          item as SerializedSchema,
          fieldName
        );
      }
    }

    // Check if this is a union, search in all options/items
    if (schema.type === "union") {
      // Union can have either "options" or "items" property depending on the version
      const unionItems =
        ("options" in schema ? schema.options : undefined) ||
        ("items" in schema ? schema.items : undefined);
      if (unionItems && Array.isArray(unionItems)) {
        for (const option of unionItems) {
          const result = this.getFieldSchemaRecursive(
            option as SerializedSchema,
            fieldName
          );
          if (result) return result;
        }
      }
    }

    return undefined;
  }
}

/**
 * File path completion provider for c.image()
 * Provides autocomplete for image file paths in c.image() first argument
 */
export class ImagePathCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "c.image";
  private cache: PublicValFilesCache;

  constructor(cache: PublicValFilesCache) {
    this.cache = cache;
  }

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    console.log("[ImagePathCompletionProvider] Starting completion");

    // Get all files from /public/val directory
    const files = this.cache.getFiles(valRoot);
    console.log(
      `[ImagePathCompletionProvider] Found ${files.length} files in cache`
    );

    // Filter to image files only (common image extensions)
    const imageExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".webp",
      ".ico",
      ".bmp",
    ];
    const imageFiles = files.filter((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    );

    console.log(
      `[ImagePathCompletionProvider] Found ${imageFiles.length} image files`
    );

    // Create completion items
    const items: CompletionItem[] = imageFiles.map((file) => {
      const item: CompletionItem = {
        label: file,
        kind: CompletionItemKind.File,
        detail: "Image file from /public/val",
      };

      // Add textEdit to replace the entire string if we have the string node
      if (context.stringNode && sourceFile) {
        const start = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getStart() + 1
        ); // +1 to skip opening quote
        const end = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getEnd() - 1
        ); // -1 to skip closing quote

        item.textEdit = TextEdit.replace(
          Range.create(
            Position.create(start.line, start.character),
            Position.create(end.line, end.character)
          ),
          file
        );
      }

      return item;
    });

    return items;
  }
}

/**
 * File path completion provider for c.file()
 * Provides autocomplete for file paths in c.file() first argument
 */
export class FilePathCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "c.file";
  private cache: PublicValFilesCache;

  constructor(cache: PublicValFilesCache) {
    this.cache = cache;
  }

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    console.log("[FilePathCompletionProvider] Starting completion");

    // Get all files from /public/val directory
    const files = this.cache.getFiles(valRoot);
    console.log(
      `[FilePathCompletionProvider] Found ${files.length} files in cache`
    );

    // Create completion items for all files
    const items: CompletionItem[] = files.map((file) => {
      const item: CompletionItem = {
        label: file,
        kind: CompletionItemKind.File,
        detail: "File from /public/val",
      };

      // Add textEdit to replace the entire string if we have the string node
      if (context.stringNode && sourceFile) {
        const start = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getStart() + 1
        ); // +1 to skip opening quote
        const end = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getEnd() - 1
        ); // -1 to skip closing quote

        item.textEdit = TextEdit.replace(
          Range.create(
            Position.create(start.line, start.character),
            Position.create(end.line, end.character)
          ),
          file
        );
      }

      return item;
    });

    return items;
  }
}

/**
 * Registry of all completion providers
 */
export class CompletionProviderRegistry {
  private providers: Map<CompletionContext["type"], CompletionProvider[]>;

  constructor(cache: PublicValFilesCache) {
    this.providers = new Map();

    // Register default providers
    this.register(new RouteCompletionProvider());
    this.register(new KeyOfCompletionProvider());
    this.register(new ImagePathCompletionProvider(cache));
    this.register(new FilePathCompletionProvider(cache));
  }

  /**
   * Register a completion provider
   */
  register(provider: CompletionProvider): void {
    const existing = this.providers.get(provider.contextType) || [];
    existing.push(provider);
    this.providers.set(provider.contextType, existing);
  }

  /**
   * Get completion items for a given context
   * Calls all registered providers for the context type and merges results
   */
  async getCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    const providers = this.providers.get(context.type);
    console.log(
      "[CompletionProviderRegistry] Found",
      providers?.length || 0,
      "providers for context type:",
      context.type
    );

    if (!providers || providers.length === 0) {
      return [];
    }

    // Call all providers and merge results
    const allItems: CompletionItem[] = [];
    for (const provider of providers) {
      console.log(
        "[CompletionProviderRegistry] Calling provider:",
        provider.constructor.name
      );
      const items = await provider.provideCompletionItems(
        context,
        service,
        valRoot,
        sourceFile
      );
      allItems.push(...items);
    }

    return allItems;
  }
}
