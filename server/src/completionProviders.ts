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
  contextType: CompletionContext["type"] = "route";

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    try {
      // We need to:
      // 1. Read the module to get its schema
      // 2. Find the field path where the cursor is
      // 3. Check if that field's schema type is "route"
      // 4. Get include/exclude patterns from the route schema
      // 5. Collect all routes from router modules
      // 6. Filter by include/exclude patterns

      if (!context.modulePath) {
        return [];
      }

      // Read the current module to get its schema
      const moduleFilePath = context.modulePath as any;
      const result = await service.read(moduleFilePath, "" as any);

      if (!result || !result.schema) {
        return [];
      }

      // For now, we'll collect all routes from all router modules
      // TODO: We should traverse the schema to find the specific field
      // and get its include/exclude patterns

      // Get all modules
      const allModules = await service.getAllModules();

      // Find modules with routers and collect their routes
      const routes = new Set<string>();

      for (const module of allModules) {
        if (
          module.schema?.type === "record" &&
          (module.schema as any).router &&
          module.source &&
          typeof module.source === "object" &&
          !Array.isArray(module.source)
        ) {
          // Add all routes from this router module
          const source = module.source as Record<string, unknown>;
          for (const route of Object.keys(source)) {
            routes.add(route);
          }
        }
      }

      // TODO: Apply include/exclude patterns from the route schema
      // For now, return all routes

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

      // Convert routes to completion items
      const items: CompletionItem[] = Array.from(routes).map((route) => {
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

      return items;
    } catch (error) {
      console.error("Error providing route completion:", error);
      return [];
    }
  }
}

/**
 * KeyOf completion provider
 * Provides autocomplete for keys when using c.keyOf()
 */
export class KeyOfCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "keyOf";

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    // TODO: Implement keyOf completion
    // This will need to:
    // 1. Find the second argument to c.keyOf (the module reference)
    // 2. Load that module's source
    // 3. Return the keys as completion items
    return [];
  }
}

/**
 * File path completion provider for c.image()
 * Provides autocomplete for file paths in c.image() first argument
 */
export class ImagePathCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "c.image";

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    // TODO: Implement image path completion
    // This could scan the public directory or configured asset directories
    // and provide file paths as completion items
    return [];
  }
}

/**
 * File path completion provider for c.file()
 * Provides autocomplete for file paths in c.file() first argument
 */
export class FilePathCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "c.file";

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    // TODO: Implement file path completion
    // Similar to image path completion
    return [];
  }
}

/**
 * Registry of all completion providers
 */
export class CompletionProviderRegistry {
  private providers: Map<CompletionContext["type"], CompletionProvider>;

  constructor() {
    this.providers = new Map();

    // Register default providers
    this.register(new RouteCompletionProvider());
    this.register(new KeyOfCompletionProvider());
    this.register(new ImagePathCompletionProvider());
    this.register(new FilePathCompletionProvider());
  }

  /**
   * Register a completion provider
   */
  register(provider: CompletionProvider): void {
    this.providers.set(provider.contextType, provider);
  }

  /**
   * Get completion items for a given context
   */
  async getCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile
  ): Promise<CompletionItem[]> {
    const provider = this.providers.get(context.type);
    if (!provider) {
      return [];
    }

    return await provider.provideCompletionItems(
      context,
      service,
      valRoot,
      sourceFile
    );
  }
}
