import ts from "typescript";
import { SerializedSchema } from "@valbuild/core";

/**
 * Walk up from a node to find the enclosing c.define(...) call.
 * Returns the call expression, or undefined if not under c.define.
 */
export function findEnclosingCDefine(
  node: ts.Node,
): ts.CallExpression | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "c" &&
      ts.isIdentifier(current.expression.name) &&
      current.expression.name.text === "define"
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Collect the sequence of property assignment names from `node` up to the
 * enclosing c.define call's third argument. The path is returned in
 * outermost-to-innermost order — i.e. the path you would follow into the
 * c.define content object to reach `node`.
 *
 * Returns undefined if `node` is not under a c.define call's content arg.
 */
export function getFieldPathFromCDefine(node: ts.Node):
  | {
      fieldPath: string[];
      moduleFilePath: string | undefined;
      cDefine: ts.CallExpression;
    }
  | undefined {
  const cDefine = findEnclosingCDefine(node);
  if (!cDefine) return undefined;

  const contentArg = cDefine.arguments[2];
  if (!contentArg) return undefined;

  // Collect property assignment names walking up from node, stopping at the
  // content argument of c.define.
  const path: string[] = [];
  let current: ts.Node | undefined = node;
  while (current && current !== contentArg) {
    if (ts.isPropertyAssignment(current)) {
      const name = current.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        path.unshift(name.text);
      } else {
        return undefined;
      }
    }
    current = current.parent;
  }
  if (!current) return undefined;

  const firstArg = cDefine.arguments[0];
  const moduleFilePath =
    firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : undefined;

  return { fieldPath: path, moduleFilePath, cDefine };
}

/**
 * Walk a serialized schema in parallel with an AST-derived path of property
 * names. For object schemas, the path segment is matched against `items`.
 * For record/array schemas, the path segment represents a dynamic key/index
 * and we descend into `item`. Union types are handled by trying each option.
 */
export function resolveSchemaAtFieldPath(
  schema: SerializedSchema,
  fieldPath: string[],
): SerializedSchema | undefined {
  let current: SerializedSchema | undefined = schema;
  for (const segment of fieldPath) {
    current = stepIntoSchema(current, segment);
    if (!current) return undefined;
  }
  return current;
}

/**
 * If `fieldPath` ends in "href" and crosses a richtext schema, return the
 * effective schema for that href slot based on `options.inline.a`.
 *
 * `a === true` is shorthand for `s.route()` with no include/exclude patterns.
 * If val core later allows `a` to carry a SerializedSchema, that schema is
 * returned as-is so the caller can branch on its type.
 */
export function resolveRichtextHrefSchema(
  schema: SerializedSchema,
  fieldPath: string[],
): SerializedSchema | undefined {
  if (fieldPath.length === 0) return undefined;
  if (fieldPath[fieldPath.length - 1] !== "href") return undefined;
  for (let i = fieldPath.length - 1; i >= 1; i--) {
    const prefix = fieldPath.slice(0, i);
    const resolved = resolveSchemaAtFieldPath(schema, prefix);
    if (!resolved) continue;
    if (resolved.type === "richtext") {
      const a = (resolved as { options?: { inline?: { a?: unknown } } })
        .options?.inline?.a;
      if (a === true) {
        return { type: "route", opt: false } as SerializedSchema;
      }
      if (a && typeof a === "object") {
        return a as SerializedSchema;
      }
      return undefined;
    }
  }
  return undefined;
}

function stepIntoSchema(
  schema: SerializedSchema | undefined,
  segment: string,
): SerializedSchema | undefined {
  if (!schema) return undefined;
  if (schema.type === "object") {
    const items =
      "items" in schema && schema.items
        ? (schema.items as Record<string, SerializedSchema>)
        : undefined;
    if (items && segment in items) {
      return items[segment];
    }
    return undefined;
  }
  if (schema.type === "array") {
    // Array elements are not property assignments, so they contribute no
    // segment to the AST-derived path. Treat array as transparent and try to
    // step into its item with the same segment.
    const item =
      "item" in schema
        ? (schema as { item?: SerializedSchema }).item
        : undefined;
    return stepIntoSchema(item, segment);
  }
  if (schema.type === "record") {
    // Record entries are property assignments, so the record key has already
    // consumed this step — return the item without re-matching the segment.
    return "item" in schema
      ? (schema as { item?: SerializedSchema }).item
      : undefined;
  }
  if (schema.type === "union") {
    const options =
      ("options" in schema && Array.isArray((schema as { options?: unknown }).options)
        ? (schema as { options: SerializedSchema[] }).options
        : undefined) ||
      ("items" in schema && Array.isArray((schema as { items?: unknown }).items)
        ? (schema as { items: SerializedSchema[] }).items
        : undefined);
    if (!options) return undefined;
    for (const opt of options) {
      const res = stepIntoSchema(opt, segment);
      if (res) return res;
    }
    return undefined;
  }
  return undefined;
}
