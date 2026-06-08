import {
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  Range,
  Position,
} from "vscode-languageserver/node";
import { CompletionContext } from "./completionContext";
import { ValService } from "./ValService";
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
import {
  getFieldPathFromCDefine,
  resolveRichtextHrefSchema,
  resolveSchemaAtFieldPath,
} from "./completionFieldSchema";

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
];

/**
 * Get sourcePath from a keyOf schema
 */
function getKeyOfSourcePath(
  schema: SerializedSchema | undefined,
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
    sourceFile?: ts.SourceFile,
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
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    try {
      if (!context.modulePath || !context.stringNode || !sourceFile) {
        return [];
      }

      const moduleFilePath = context.modulePath as any;
      const result = await service.read(moduleFilePath, "" as any);

      if (!result || !result.schema) {
        return [];
      }

      const fieldInfo = getFieldPathFromCDefine(context.stringNode);
      if (!fieldInfo) {
        return [];
      }

      let fieldSchema = resolveSchemaAtFieldPath(
        result.schema,
        fieldInfo.fieldPath,
      );
      if (!fieldSchema || fieldSchema.type !== "route") {
        fieldSchema = resolveRichtextHrefSchema(
          result.schema,
          fieldInfo.fieldPath,
        );
      }
      if (!fieldSchema || fieldSchema.type !== "route") {
        return [];
      }

      const includePattern = (
        "include" in fieldSchema ? fieldSchema.include : undefined
      ) as SerializedRegExpPattern | undefined;
      const excludePattern = (
        "exclude" in fieldSchema ? fieldSchema.exclude : undefined
      ) as SerializedRegExpPattern | undefined;

      const allModules = await service.getAllModules();

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
          const source = module.source as Record<string, unknown>;
          for (const route of Object.keys(source)) {
            routesSet.add(route);
          }
        }
      }

      const allRoutes = Array.from(routesSet);
      const filteredRoutes = filterRoutesByPatterns(
        allRoutes,
        includePattern,
        excludePattern,
      );

      let replaceRange: Range | undefined;
      if (context.stringNode && sourceFile) {
        const stringStart = context.stringNode.getStart(sourceFile);
        const stringEnd = context.stringNode.getEnd();
        const contentStart = stringStart + 1;
        const contentEnd = stringEnd - 1;
        const startPos = sourceFile.getLineAndCharacterOfPosition(contentStart);
        const endPos = sourceFile.getLineAndCharacterOfPosition(contentEnd);
        replaceRange = Range.create(
          Position.create(startPos.line, startPos.character),
          Position.create(endPos.line, endPos.character),
        );
      }

      return filteredRoutes.map((route) => {
        const item: CompletionItem = {
          label: route,
          kind: CompletionItemKind.Value,
          detail: "Route",
          documentation: `Available route: ${route}`,
        };
        if (replaceRange) {
          item.textEdit = TextEdit.replace(replaceRange, route);
        }
        return item;
      });
    } catch (error) {
      console.error("Error providing route completion:", error);
      return [];
    }
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
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    try {
      if (!context.modulePath || !context.stringNode || !sourceFile) {
        return [];
      }

      const moduleFilePath = context.modulePath as any;
      const result = await service.read(moduleFilePath, "" as any);

      if (!result || !result.schema) {
        return [];
      }

      const fieldInfo = getFieldPathFromCDefine(context.stringNode);
      if (!fieldInfo) {
        return [];
      }

      const fieldSchema = resolveSchemaAtFieldPath(
        result.schema,
        fieldInfo.fieldPath,
      );

      if (!fieldSchema || fieldSchema.type !== "keyOf") {
        return [];
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
          Position.create(endPos.line, endPos.character),
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
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    console.log("[ImagePathCompletionProvider] Starting completion");

    const galleryInfo = await resolveReferencedGallery(
      context,
      sourceFile,
      service,
    );

    // Get all files from /public/val directory
    let files = this.cache.getFiles(valRoot);
    console.log(
      `[ImagePathCompletionProvider] Found ${files.length} files in cache`,
    );

    if (galleryInfo) {
      const prefix = galleryInfo.directory + "/";
      files = files.filter(
        (f) => f === galleryInfo.directory || f.startsWith(prefix),
      );
      console.log(
        `[ImagePathCompletionProvider] Filtered to gallery directory ${galleryInfo.directory}: ${files.length} files`,
      );
    }

    // Filter to image files only (common image extensions)
    const imageExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".webp",
      ".avif",
      ".ico",
      ".bmp",
    ];
    const imageFiles = files.filter((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext)),
    );

    console.log(
      `[ImagePathCompletionProvider] Found ${imageFiles.length} image files`,
    );

    // Create completion items
    const items: CompletionItem[] = imageFiles.map((file) => {
      const detail = galleryInfo
        ? galleryInfo.registered.has(file)
          ? `Already in gallery ${galleryInfo.referencedModuleFilePath}`
          : `Not yet in gallery — fix will add it to ${galleryInfo.referencedModuleFilePath}`
        : "Image file from /public/val";
      const item: CompletionItem = {
        label: file,
        kind: CompletionItemKind.File,
        detail,
        data: {
          type: "image",
          filePath: file,
          valRoot: valRoot,
          hasSecondArgument: context.hasSecondArgument || false,
        },
      };

      // Add textEdit to replace the entire string if we have the string node
      if (context.stringNode && sourceFile) {
        const start = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getStart() + 1,
        ); // +1 to skip opening quote
        const end = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getEnd() - 1,
        ); // -1 to skip closing quote

        item.textEdit = TextEdit.replace(
          Range.create(
            Position.create(start.line, start.character),
            Position.create(end.line, end.character),
          ),
          file,
        );
      }

      // If there's a second argument (metadata), store its range and text for merging
      if (context.hasSecondArgument && context.callExpression && sourceFile) {
        const secondArg = context.callExpression.arguments[1];
        if (secondArg) {
          const start = sourceFile.getLineAndCharacterOfPosition(
            secondArg.getStart(sourceFile),
          );
          const end = sourceFile.getLineAndCharacterOfPosition(
            secondArg.getEnd(),
          );
          item.data.secondArgumentRange = {
            start,
            end,
          };
          // Store the text of the existing metadata for merging
          item.data.existingMetadataText = secondArg.getText(sourceFile);
        }
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
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    console.log("[FilePathCompletionProvider] Starting completion");

    const galleryInfo = await resolveReferencedGallery(
      context,
      sourceFile,
      service,
    );

    // Get all files from /public/val directory
    let files = this.cache.getFiles(valRoot);
    console.log(
      `[FilePathCompletionProvider] Found ${files.length} files in cache`,
    );

    if (galleryInfo) {
      const prefix = galleryInfo.directory + "/";
      files = files.filter(
        (f) => f === galleryInfo.directory || f.startsWith(prefix),
      );
      console.log(
        `[FilePathCompletionProvider] Filtered to gallery directory ${galleryInfo.directory}: ${files.length} files`,
      );
    }

    // Create completion items for all files
    const items: CompletionItem[] = files.map((file) => {
      const detail = galleryInfo
        ? galleryInfo.registered.has(file)
          ? `Already in gallery ${galleryInfo.referencedModuleFilePath}`
          : `Not yet in gallery — fix will add it to ${galleryInfo.referencedModuleFilePath}`
        : "File from /public/val";
      const item: CompletionItem = {
        label: file,
        kind: CompletionItemKind.File,
        detail,
        data: {
          type: "file",
          filePath: file,
          valRoot: valRoot,
          hasSecondArgument: context.hasSecondArgument || false,
        },
      };

      // Add textEdit to replace the entire string if we have the string node
      if (context.stringNode && sourceFile) {
        const start = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getStart() + 1,
        ); // +1 to skip opening quote
        const end = sourceFile.getLineAndCharacterOfPosition(
          context.stringNode.getEnd() - 1,
        ); // -1 to skip closing quote

        item.textEdit = TextEdit.replace(
          Range.create(
            Position.create(start.line, start.character),
            Position.create(end.line, end.character),
          ),
          file,
        );
      }

      // If there's a second argument (metadata), store its range and text for merging
      if (context.hasSecondArgument && context.callExpression && sourceFile) {
        const secondArg = context.callExpression.arguments[1];
        if (secondArg) {
          const start = sourceFile.getLineAndCharacterOfPosition(
            secondArg.getStart(sourceFile),
          );
          const end = sourceFile.getLineAndCharacterOfPosition(
            secondArg.getEnd(),
          );
          item.data.secondArgumentRange = {
            start,
            end,
          };
          // Store the text of the existing metadata for merging
          item.data.existingMetadataText = secondArg.getText(sourceFile);
        }
      }

      return item;
    });

    return items;
  }
}

/**
 * If the c.image/c.file call expression in `context` lives under a c.define
 * whose field schema references a media gallery module (s.image(mediaVal)),
 * return the gallery directory and registered file set so the caller can
 * filter completions.
 */
async function resolveReferencedGallery(
  context: CompletionContext,
  sourceFile: ts.SourceFile | undefined,
  service: ValService,
): Promise<
  | {
      referencedModuleFilePath: string;
      directory: string;
      registered: Set<string>;
    }
  | undefined
> {
  if (!sourceFile || !context.callExpression) return undefined;
  const fieldInfo = getFieldPathFromCDefine(context.callExpression);
  if (!fieldInfo || !fieldInfo.moduleFilePath) return undefined;

  let containingModule: { schema?: SerializedSchema; source?: unknown };
  try {
    containingModule = await service.read(
      fieldInfo.moduleFilePath as ModuleFilePath,
      "" as ModulePath,
    );
  } catch (err) {
    console.error(
      "[completionProviders] Failed to read containing module for gallery resolution:",
      err,
    );
    return undefined;
  }
  if (!containingModule.schema) return undefined;
  const fieldSchema = resolveSchemaAtFieldPath(
    containingModule.schema,
    fieldInfo.fieldPath,
  );
  if (!fieldSchema) return undefined;
  if (fieldSchema.type !== "image" && fieldSchema.type !== "file") {
    return undefined;
  }
  const referencedModule = (fieldSchema as { referencedModule?: string })
    .referencedModule;
  if (!referencedModule) return undefined;

  let referenced: { schema?: SerializedSchema; source?: unknown };
  try {
    referenced = await service.read(
      referencedModule as ModuleFilePath,
      "" as ModulePath,
    );
  } catch (err) {
    console.error(
      "[completionProviders] Failed to read referenced gallery module:",
      err,
    );
    return undefined;
  }
  const refSchema = referenced.schema;
  if (!refSchema || refSchema.type !== "record") return undefined;
  if (!("directory" in refSchema) || typeof refSchema.directory !== "string") {
    return undefined;
  }
  const directory = refSchema.directory;
  const registered = new Set<string>();
  if (
    referenced.source &&
    typeof referenced.source === "object" &&
    !Array.isArray(referenced.source)
  ) {
    for (const key of Object.keys(referenced.source)) {
      registered.add(key);
    }
  }
  return {
    referencedModuleFilePath: referencedModule,
    directory,
    registered,
  };
}

/**
 * Media gallery key completion provider
 * Provides autocomplete for the keys of an s.images()/s.files() record
 * (c.define content object). Keys are file paths that must live inside the
 * gallery's configured `directory`, so we suggest the real files found there.
 */
export class MediaGalleryKeyCompletionProvider implements CompletionProvider {
  contextType: CompletionContext["type"] = "content-property-key";
  private cache: PublicValFilesCache;

  constructor(cache: PublicValFilesCache) {
    this.cache = cache;
  }

  async provideCompletionItems(
    context: CompletionContext,
    service: ValService,
    valRoot: string,
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    try {
      if (!context.modulePath || !context.stringNode || !sourceFile) {
        return [];
      }

      const result = await service.read(
        context.modulePath as ModuleFilePath,
        "" as ModulePath,
      );
      if (!result || !result.schema) {
        return [];
      }

      const fieldInfo = getFieldPathFromCDefine(context.stringNode);
      if (!fieldInfo) {
        return [];
      }

      // The field path includes the key currently being typed as its last
      // segment — drop it to resolve the schema of the *containing* record.
      const containerPath = fieldInfo.fieldPath.slice(0, -1);
      const containerSchema = resolveSchemaAtFieldPath(
        result.schema,
        containerPath,
      );
      if (!containerSchema || containerSchema.type !== "record") {
        return [];
      }
      const mediaType =
        "mediaType" in containerSchema &&
        (containerSchema.mediaType === "images" ||
          containerSchema.mediaType === "files")
          ? (containerSchema.mediaType as "images" | "files")
          : undefined;
      const directory =
        "directory" in containerSchema &&
        typeof containerSchema.directory === "string"
          ? containerSchema.directory
          : undefined;
      if (!mediaType || !directory) {
        return [];
      }

      let files = await this.cache.listFilesInDirectory(valRoot, directory);
      if (mediaType === "images") {
        files = files.filter((file) =>
          IMAGE_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)),
        );
      }

      // Exclude keys already registered in the gallery.
      if (
        result.source &&
        typeof result.source === "object" &&
        !Array.isArray(result.source)
      ) {
        const registered = new Set(Object.keys(result.source));
        files = files.filter((file) => !registered.has(file));
      }

      const stringStart = context.stringNode.getStart(sourceFile);
      const stringEnd = context.stringNode.getEnd();
      const startPos = sourceFile.getLineAndCharacterOfPosition(stringStart + 1);
      const endPos = sourceFile.getLineAndCharacterOfPosition(stringEnd - 1);
      const replaceRange = Range.create(
        Position.create(startPos.line, startPos.character),
        Position.create(endPos.line, endPos.character),
      );

      return files.map((file) => {
        const item: CompletionItem = {
          label: file,
          kind: CompletionItemKind.File,
          detail:
            mediaType === "images"
              ? `Image in gallery directory ${directory}`
              : `File in gallery directory ${directory}`,
        };
        item.textEdit = TextEdit.replace(replaceRange, file);
        return item;
      });
    } catch (error) {
      console.error("Error providing media gallery key completion:", error);
      return [];
    }
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
    this.register(new MediaGalleryKeyCompletionProvider(cache));
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
    sourceFile?: ts.SourceFile,
  ): Promise<CompletionItem[]> {
    const providers = this.providers.get(context.type);
    console.log(
      "[CompletionProviderRegistry] Found",
      providers?.length || 0,
      "providers for context type:",
      context.type,
    );

    if (!providers || providers.length === 0) {
      return [];
    }

    // Call all providers and merge results
    const allItems: CompletionItem[] = [];
    for (const provider of providers) {
      console.log(
        "[CompletionProviderRegistry] Calling provider:",
        provider.constructor.name,
      );
      const items = await provider.provideCompletionItems(
        context,
        service,
        valRoot,
        sourceFile,
      );
      allItems.push(...items);
    }

    return allItems;
  }
}
