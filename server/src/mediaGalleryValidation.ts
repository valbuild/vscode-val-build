import fs from "fs";
import path from "path";
import {
  FILE_REF_PROP,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  Source,
} from "@valbuild/core";
import { ValService } from "./ValService";
import { getModulePathRange, ModulePathMap } from "./modulePathMap";

export type MediaGalleryDiagnosticCode =
  | "image:add-to-gallery"
  | "file:add-to-gallery"
  | "image:move-to-gallery-directory"
  | "file:move-to-gallery-directory"
  | "image:remove-gallery-entry"
  | "file:remove-gallery-entry";

/**
 * Options controlling gallery-definition (record key) validation. When
 * `valRoot` (or an explicit `fileExists`) is provided, keys defined in an
 * s.images()/s.files() record are also checked for on-disk existence.
 */
export type MediaGalleryValidationOptions = {
  valRoot?: string;
  /** The file path (relative to valRoot) of the module being validated. */
  moduleFilePath?: string;
  /** Override for on-disk existence checks (relative public path -> exists). */
  fileExists?: (relPath: string) => boolean;
};

function defaultFileExists(valRoot: string, relPath: string): boolean {
  try {
    return fs.statSync(path.join(valRoot, ...relPath.split("/"))).isFile();
  } catch {
    return false;
  }
}

export type MediaGalleryDiagnostic = {
  code: MediaGalleryDiagnosticCode;
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  data: {
    path: string;
    referencedModuleFilePath: string;
    targetDirectory?: string;
    mediaType?: "files" | "images";
  };
};

type Mediakind = "image" | "file";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function isFileSource(value: unknown): value is { [k: string]: unknown } {
  return isPlainObject(value) && typeof value[FILE_REF_PROP] === "string";
}

function getReferencedDirectory(
  refSchema: SerializedSchema | undefined,
): string | undefined {
  if (!refSchema) return undefined;
  if (refSchema.type !== "record") return undefined;
  if (!("mediaType" in refSchema) || !refSchema.mediaType) return undefined;
  if (!("directory" in refSchema) || typeof refSchema.directory !== "string") {
    return undefined;
  }
  return refSchema.directory;
}

function pathIsInsideDirectory(refPath: string, directory: string): boolean {
  return refPath === directory || refPath.startsWith(directory + "/");
}

/**
 * Walks (source, schema) in parallel and emits diagnostics for c.image/c.file
 * fields whose schema references a media-gallery module (s.image(mediaVal)) but
 * whose referenced path is either missing from that gallery's source or located
 * outside the gallery's configured directory.
 *
 * The serialized schema is shaped like the structures defined in
 * @valbuild/core (object/array/record/union/image/file/...).
 */
export async function findMediaGalleryIssues(
  source: Source,
  schema: SerializedSchema,
  modulePathMap: ModulePathMap | undefined,
  service: ValService,
  options?: MediaGalleryValidationOptions,
): Promise<MediaGalleryDiagnostic[]> {
  const diagnostics: MediaGalleryDiagnostic[] = [];

  const fileExists: ((relPath: string) => boolean) | undefined =
    options?.fileExists ??
    (options?.valRoot
      ? (relPath: string) =>
          defaultFileExists(options.valRoot as string, relPath)
      : undefined);
  const moduleFilePath = options?.moduleFilePath ?? "";

  // Cache referenced module reads so we don't re-read for every entry
  const referencedModuleCache = new Map<
    string,
    {
      source?: Source;
      schema?: SerializedSchema;
    } | null
  >();

  async function readReferencedModule(referencedModule: string) {
    if (referencedModuleCache.has(referencedModule)) {
      return referencedModuleCache.get(referencedModule);
    }
    try {
      const result = await service.read(
        referencedModule as ModuleFilePath,
        "" as ModulePath,
      );
      const value = {
        source: "source" in result ? (result.source as Source) : undefined,
        schema:
          "schema" in result
            ? (result.schema as SerializedSchema)
            : undefined,
      };
      referencedModuleCache.set(referencedModule, value);
      return value;
    } catch (err) {
      console.error(
        "[mediaGalleryValidation] Failed to read referenced module:",
        referencedModule,
        err,
      );
      referencedModuleCache.set(referencedModule, null);
      return null;
    }
  }

  async function checkImageOrFileField(
    modulePath: string,
    src: Source,
    fieldSchema: SerializedSchema,
    kind: Mediakind,
  ) {
    const referencedModule =
      "referencedModule" in fieldSchema
        ? (fieldSchema as { referencedModule?: string }).referencedModule
        : undefined;
    if (!referencedModule) {
      return;
    }
    if (!isFileSource(src)) {
      return;
    }
    const refPath = src[FILE_REF_PROP] as string;

    const referenced = await readReferencedModule(referencedModule);
    if (!referenced) {
      return;
    }
    const directory = getReferencedDirectory(referenced.schema);
    const range =
      modulePathMap &&
      getModulePathRange(
        `${modulePath}.${JSON.stringify(FILE_REF_PROP)}`,
        modulePathMap,
      );
    if (!range) {
      return;
    }

    if (directory && !pathIsInsideDirectory(refPath, directory)) {
      const mediaLabel = kind === "image" ? "image" : "file";
      diagnostics.push({
        code:
          kind === "image"
            ? "image:move-to-gallery-directory"
            : "file:move-to-gallery-directory",
        message: `${refPath} is not inside the gallery directory ${directory}. Move the ${mediaLabel} into the gallery directory.`,
        range,
        data: {
          path: refPath,
          referencedModuleFilePath: referencedModule,
          targetDirectory: directory,
        },
      });
      return;
    }

    const refSource = referenced.source;
    const registered =
      isPlainObject(refSource) &&
      Object.prototype.hasOwnProperty.call(refSource, refPath);
    if (!registered) {
      const mediaType =
        referenced.schema &&
        referenced.schema.type === "record" &&
        "mediaType" in referenced.schema &&
        (referenced.schema.mediaType === "images" ||
          referenced.schema.mediaType === "files")
          ? referenced.schema.mediaType
          : kind === "image"
            ? "images"
            : "files";
      diagnostics.push({
        code:
          kind === "image"
            ? "image:add-to-gallery"
            : "file:add-to-gallery",
        message: `${refPath} is not registered in the media gallery ${referencedModule}. Add it to the gallery to define its metadata.`,
        range,
        data: {
          path: refPath,
          referencedModuleFilePath: referencedModule,
          mediaType,
        },
      });
    }
  }

  function checkGalleryKey(
    recordModulePath: string,
    key: string,
    directory: string,
    mediaType: "images" | "files",
  ) {
    // Remote refs and other non-local keys are not on-disk paths.
    if (!key.startsWith("/")) {
      return;
    }
    // The key is a record property whose name is a file path containing dots
    // (the file extension). getModulePathRange() splits the module path on
    // ".", which mangles such keys, so look the key up directly in the map.
    const range = getGalleryKeyRange(modulePathMap, recordModulePath, key);
    if (!range) {
      return;
    }
    const kind: Mediakind = mediaType === "images" ? "image" : "file";

    if (fileExists && !fileExists(key)) {
      diagnostics.push({
        code:
          kind === "image"
            ? "image:remove-gallery-entry"
            : "file:remove-gallery-entry",
        message: `${key} does not exist on disk. Remove it from the gallery or add the file.`,
        range,
        data: {
          path: key,
          referencedModuleFilePath: moduleFilePath,
          targetDirectory: directory,
          mediaType,
        },
      });
      return;
    }

    if (!pathIsInsideDirectory(key, directory)) {
      diagnostics.push({
        code:
          kind === "image"
            ? "image:move-to-gallery-directory"
            : "file:move-to-gallery-directory",
        message: `${key} is not inside the gallery directory ${directory}. Move the ${kind} into the gallery directory.`,
        range,
        data: {
          path: key,
          referencedModuleFilePath: moduleFilePath,
          targetDirectory: directory,
          mediaType,
        },
      });
    }
  }

  async function walk(
    modulePath: string,
    src: Source,
    sch: SerializedSchema,
  ): Promise<void> {
    if (src === null || src === undefined) {
      return;
    }
    if (sch.type === "image" || sch.type === "file") {
      await checkImageOrFileField(modulePath, src, sch, sch.type);
      return;
    }
    if (sch.type === "object") {
      const items =
        "items" in sch && isPlainObject(sch.items)
          ? (sch.items as Record<string, SerializedSchema>)
          : undefined;
      if (!items || !isPlainObject(src)) return;
      for (const key of Object.keys(items)) {
        const childSchema = items[key];
        const childSrc = (src as Record<string, unknown>)[key] as Source;
        if (childSrc === undefined) continue;
        const childPath = appendSegment(modulePath, key);
        await walk(childPath, childSrc, childSchema);
      }
      return;
    }
    if (sch.type === "array") {
      const item =
        "item" in sch ? (sch.item as SerializedSchema | undefined) : undefined;
      if (!item || !Array.isArray(src)) return;
      for (let i = 0; i < src.length; i++) {
        const childPath = appendSegment(modulePath, i);
        await walk(childPath, src[i] as Source, item);
      }
      return;
    }
    if (sch.type === "record") {
      const directory = getReferencedDirectory(sch);
      const mediaType =
        "mediaType" in sch &&
        (sch.mediaType === "images" || sch.mediaType === "files")
          ? (sch.mediaType as "images" | "files")
          : undefined;
      // This record is itself an s.images()/s.files() gallery definition — its
      // keys are file paths that must live inside the configured directory.
      if (directory && mediaType && isPlainObject(src)) {
        for (const key of Object.keys(src)) {
          checkGalleryKey(modulePath, key, directory, mediaType);
        }
      }
      const item =
        "item" in sch ? (sch.item as SerializedSchema | undefined) : undefined;
      if (!item || !isPlainObject(src)) return;
      for (const key of Object.keys(src)) {
        const childPath = appendSegment(modulePath, key);
        await walk(childPath, (src as Record<string, unknown>)[key] as Source, item);
      }
      return;
    }
    if (sch.type === "union") {
      const options =
        ("options" in sch && Array.isArray((sch as { options?: unknown }).options)
          ? (sch as { options: SerializedSchema[] }).options
          : undefined) ||
        ("items" in sch && Array.isArray((sch as { items?: unknown }).items)
          ? (sch as { items: SerializedSchema[] }).items
          : undefined);
      if (!options) return;
      // Pick the option that matches the source shape, if we can; otherwise try all.
      const objectOptions = options.filter((o) => o.type === "object");
      const candidates = objectOptions.length > 0 ? objectOptions : options;
      for (const opt of candidates) {
        await walk(modulePath, src, opt);
      }
      return;
    }
    // unknown / leaf schema — nothing to do
  }

  await walk("", source, schema);
  return diagnostics;
}

function appendSegment(modulePath: string, segment: string | number): string {
  const encoded = JSON.stringify(segment);
  return modulePath ? `${modulePath}.${encoded}` : encoded;
}

/**
 * Resolve the source range of a record `key` (a file path that may contain
 * dots) without round-tripping through getModulePathRange's dot-splitting.
 * Gallery records are defined at the module root, so the key is a direct child
 * of the content object; for the (uncommon) nested case we fall back to the
 * record's node found via getModulePathRange on the record path itself.
 */
function getGalleryKeyRange(
  modulePathMap: ModulePathMap | undefined,
  recordModulePath: string,
  key: string,
):
  | {
      start: { line: number; character: number };
      end: { line: number; character: number };
    }
  | undefined {
  if (!modulePathMap) {
    return undefined;
  }
  let nodeMap: ModulePathMap = modulePathMap;
  if (recordModulePath !== "") {
    // Best-effort navigation for nested records; the record path segments are
    // schema field names which do not normally contain dots.
    const range = getModulePathRange(recordModulePath, modulePathMap);
    if (!range) {
      return undefined;
    }
    let cursor: ModulePathMap[string] | undefined;
    for (const segment of recordModulePath
      .split(".")
      .map((s) => JSON.parse(s) as string | number)) {
      cursor = cursor ? cursor.children?.[segment] : modulePathMap[segment];
      if (!cursor) {
        return undefined;
      }
    }
    nodeMap = (cursor?.children ?? {}) as ModulePathMap;
  }
  const entry = nodeMap[key];
  return entry?.start && entry?.end
    ? { start: entry.start, end: entry.end }
    : undefined;
}
