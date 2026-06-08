import { describe, expect, it } from "@jest/globals";
import { SerializedSchema } from "@valbuild/core";
import {
  resolveRichtextHrefSchema,
  resolveSchemaAtFieldPath,
} from "./completionFieldSchema";

const routeSchema = { type: "route", opt: false } as SerializedSchema;
const stringSchema = { type: "string", opt: false } as SerializedSchema;
const imageSchema = {
  type: "image",
  opt: false,
  referencedModule: "/m.val.ts",
} as unknown as SerializedSchema;

function object(items: Record<string, SerializedSchema>): SerializedSchema {
  return { type: "object", items, opt: false } as unknown as SerializedSchema;
}
function array(item: SerializedSchema): SerializedSchema {
  return { type: "array", item, opt: false } as unknown as SerializedSchema;
}
function record(item: SerializedSchema): SerializedSchema {
  return { type: "record", item, opt: false } as unknown as SerializedSchema;
}
function union(options: SerializedSchema[]): SerializedSchema {
  return { type: "union", options, opt: false } as unknown as SerializedSchema;
}
function richtext(
  options: { inline?: { a?: unknown } } | undefined,
): SerializedSchema {
  return {
    type: "richtext",
    opt: false,
    options,
  } as unknown as SerializedSchema;
}

describe("resolveSchemaAtFieldPath", () => {
  it("resolves a top-level object property", () => {
    const schema = object({ slug: routeSchema });
    expect(resolveSchemaAtFieldPath(schema, ["slug"])?.type).toBe("route");
  });

  it("steps through array transparently to find route in object property", () => {
    // s.array(s.object({ href: s.route() })) — path ["href"] (array index not in path).
    const schema = array(object({ href: routeSchema }));
    expect(resolveSchemaAtFieldPath(schema, ["href"])?.type).toBe("route");
  });

  it("steps through nested object → array → object", () => {
    // s.object({ links: s.array(s.object({ href: s.route() })) })
    const schema = object({ links: array(object({ href: routeSchema })) });
    expect(resolveSchemaAtFieldPath(schema, ["links", "href"])?.type).toBe(
      "route",
    );
  });

  it("steps through array of union of objects (richtext-shaped custom)", () => {
    const schema = array(
      union([
        object({ type: stringSchema, href: routeSchema }),
        object({ type: stringSchema, value: stringSchema }),
      ]),
    );
    expect(resolveSchemaAtFieldPath(schema, ["href"])?.type).toBe("route");
  });

  it("returns record's item schema when its key has been consumed", () => {
    // s.record(s.image()) with content { "/foo": c.image(...) } — path ["/foo"].
    const schema = record(imageSchema);
    expect(resolveSchemaAtFieldPath(schema, ["/foo"])?.type).toBe("image");
  });

  it("returns undefined for an object property that does not exist", () => {
    const schema = object({ a: stringSchema });
    expect(resolveSchemaAtFieldPath(schema, ["missing"])).toBeUndefined();
  });
});

describe("resolveRichtextHrefSchema", () => {
  it("returns route schema for inline.a === true", () => {
    const schema = object({ body: richtext({ inline: { a: true } }) });
    const out = resolveRichtextHrefSchema(schema, ["body", "children", "href"]);
    expect(out?.type).toBe("route");
  });

  it("returns undefined when inline.a is missing", () => {
    const schema = object({ body: richtext({ inline: {} }) });
    expect(
      resolveRichtextHrefSchema(schema, ["body", "children", "href"]),
    ).toBeUndefined();
  });

  it("returns undefined when inline.a === false", () => {
    const schema = object({ body: richtext({ inline: { a: false } }) });
    expect(
      resolveRichtextHrefSchema(schema, ["body", "children", "href"]),
    ).toBeUndefined();
  });

  it("returns undefined when the path does not end in 'href'", () => {
    const schema = object({ body: richtext({ inline: { a: true } }) });
    expect(
      resolveRichtextHrefSchema(schema, ["body", "children"]),
    ).toBeUndefined();
  });

  it("returns undefined when no richtext exists on the path", () => {
    const schema = object({ link: object({ href: stringSchema }) });
    expect(
      resolveRichtextHrefSchema(schema, ["link", "href"]),
    ).toBeUndefined();
  });

  it("passes through a serialized schema in inline.a (future shape)", () => {
    // If val core later allows inline.a to carry a SerializedSchema, the
    // helper hands it back so the caller can branch on its type.
    const schema = object({ body: richtext({ inline: { a: stringSchema } }) });
    const out = resolveRichtextHrefSchema(schema, ["body", "children", "href"]);
    expect(out?.type).toBe("string");
  });

  it("treats inline.a = s.route() as route (future shape)", () => {
    const schema = object({ body: richtext({ inline: { a: routeSchema } }) });
    const out = resolveRichtextHrefSchema(schema, ["body", "children", "href"]);
    expect(out?.type).toBe("route");
  });
});
