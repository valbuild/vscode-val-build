import ts from "typescript";
import { findMediaGalleryIssues } from "./mediaGalleryValidation";
import { createModulePathMap } from "./modulePathMap";
import {
  FILE_REF_PROP,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { ValService } from "./ValService";

const FILE_VAL_EXT = { [Symbol.for("ValExtension")]: "file" } as const;

function makeFileSource(ref: string) {
  return {
    [FILE_REF_PROP]: ref,
    _type: "file",
  } as unknown as Source;
}

function makeService(
  modules: Record<
    string,
    { source: Source; schema: SerializedSchema }
  >,
): ValService {
  return {
    async read(
      moduleFilePath: ModuleFilePath,
      _modulePath: ModulePath,
    ) {
      const m = modules[moduleFilePath];
      if (!m) {
        return {
          path: "" as SourcePath,
          errors: { fatal: [{ message: "not found" }] },
        };
      }
      return {
        source: m.source,
        schema: m.schema,
        path: "" as SourcePath,
        errors: false,
      };
    },
    async getAllModulePaths() {
      return Object.keys(modules);
    },
    async getAllModules() {
      return Object.entries(modules).map(([path, m]) => ({
        path: path as SourcePath,
        source: m.source,
        schema: m.schema,
      }));
    },
  } as unknown as ValService;
}

const galleryModulePath = "/content/media.val.ts";

function imagesGallery(
  registered: Record<string, unknown>,
  directory = "/public/val/images",
): { source: Source; schema: SerializedSchema } {
  return {
    source: registered as Source,
    schema: {
      type: "record",
      item: { type: "object", items: {}, opt: false } as SerializedSchema,
      opt: false,
      mediaType: "images",
      accept: "image/*",
      directory,
    } as unknown as SerializedSchema,
  };
}

function authorsSchema(): SerializedSchema {
  return {
    type: "record",
    opt: false,
    item: {
      type: "object",
      opt: false,
      items: {
        name: { type: "string", opt: false } as SerializedSchema,
        image: {
          type: "image",
          opt: true,
          referencedModule: galleryModulePath,
        } as SerializedSchema,
      },
    } as SerializedSchema,
  } as unknown as SerializedSchema;
}

describe("findMediaGalleryIssues", () => {
  it("emits no diagnostic when the referenced path is registered in the gallery", async () => {
    const service = makeService({
      [galleryModulePath]: imagesGallery({
        "/public/val/images/logo.png": {
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      }),
    });
    const source = {
      teddy: {
        name: "Teddy",
        image: makeFileSource("/public/val/images/logo.png"),
      },
    } as unknown as Source;
    const map = createModulePathMap(
      ts.createSourceFile(
        "authors.val.ts",
        `export default c.define("/content/authors.val.ts", schema, {
  teddy: { name: "Teddy", image: c.image("/public/val/images/logo.png") },
});`,
        ts.ScriptTarget.ES2015,
        true,
      ),
    );
    const diagnostics = await findMediaGalleryIssues(
      source,
      authorsSchema(),
      map,
      service,
    );
    expect(diagnostics).toEqual([]);
  });

  it("emits image:add-to-gallery when the referenced path is missing from the gallery", async () => {
    const service = makeService({
      [galleryModulePath]: imagesGallery({}),
    });
    const source = {
      teddy: {
        name: "Teddy",
        image: makeFileSource("/public/val/images/avatar.png"),
      },
    } as unknown as Source;
    const map = createModulePathMap(
      ts.createSourceFile(
        "authors.val.ts",
        `export default c.define("/content/authors.val.ts", schema, {
  teddy: { name: "Teddy", image: c.image("/public/val/images/avatar.png") },
});`,
        ts.ScriptTarget.ES2015,
        true,
      ),
    );
    const diagnostics = await findMediaGalleryIssues(
      source,
      authorsSchema(),
      map,
      service,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("image:add-to-gallery");
    expect(diagnostics[0].data.path).toBe("/public/val/images/avatar.png");
    expect(diagnostics[0].data.referencedModuleFilePath).toBe(
      galleryModulePath,
    );
    expect(diagnostics[0].data.mediaType).toBe("images");
  });

  it("emits image:move-to-gallery-directory when the path is outside the gallery directory", async () => {
    const service = makeService({
      [galleryModulePath]: imagesGallery({}, "/public/val/images"),
    });
    const source = {
      teddy: {
        name: "Teddy",
        image: makeFileSource("/public/val/avatar.png"),
      },
    } as unknown as Source;
    const map = createModulePathMap(
      ts.createSourceFile(
        "authors.val.ts",
        `export default c.define("/content/authors.val.ts", schema, {
  teddy: { name: "Teddy", image: c.image("/public/val/avatar.png") },
});`,
        ts.ScriptTarget.ES2015,
        true,
      ),
    );
    const diagnostics = await findMediaGalleryIssues(
      source,
      authorsSchema(),
      map,
      service,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("image:move-to-gallery-directory");
    expect(diagnostics[0].data.targetDirectory).toBe("/public/val/images");
  });

  it("does not emit anything for image fields without referencedModule", async () => {
    const schema: SerializedSchema = {
      type: "object",
      opt: false,
      items: {
        image: { type: "image", opt: false } as SerializedSchema,
      },
    } as unknown as SerializedSchema;
    const source = {
      image: makeFileSource("/public/val/foo.png"),
    } as unknown as Source;
    const service = makeService({});
    const map = createModulePathMap(
      ts.createSourceFile(
        "doc.val.ts",
        `export default c.define("/x.val.ts", schema, { image: c.image("/public/val/foo.png") });`,
        ts.ScriptTarget.ES2015,
        true,
      ),
    );
    const diagnostics = await findMediaGalleryIssues(source, schema, map, service);
    expect(diagnostics).toEqual([]);
  });
});
