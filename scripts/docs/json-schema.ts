/**
 * Flatten a JSON Schema (as produced by zod-to-json-schema) into reference
 * table rows: one row per property path, with type, requiredness, default,
 * and constraints.
 */

import { DocsScriptError } from "./lib";

export interface SchemaRow {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue: string;
  readonly constraints: string;
}

type JsonSchema = Readonly<Record<string, unknown>>;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchemaList(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.filter(isSchema) : [];
}

/** The non-null branches of a union, or the schema itself. */
function branches(schema: JsonSchema): JsonSchema[] {
  const union = [...asSchemaList(schema.anyOf), ...asSchemaList(schema.oneOf)];
  return union.length > 0 ? union.filter((branch) => branch.type !== "null") : [schema];
}

function isNullable(schema: JsonSchema): boolean {
  const union = [...asSchemaList(schema.anyOf), ...asSchemaList(schema.oneOf)];
  if (union.some((branch) => branch.type === "null")) {
    return true;
  }
  return Array.isArray(schema.type) && schema.type.includes("null");
}

export function typeName(schema: JsonSchema): string {
  const union = branches(schema);
  if (union.length > 1 || union[0] !== schema) {
    const names = [...new Set(union.map(typeName))];
    return `${names.join(" or ")}${isNullable(schema) ? " or null" : ""}`;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" or ");
  }
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType === undefined ? [] : [rawType];
  const named = types
    .filter((type): type is string => typeof type === "string")
    .map((type) => {
      if (type === "array" && isSchema(schema.items)) {
        return `${typeName(schema.items)}[]`;
      }
      return type;
    });
  return named.length > 0 ? named.join(" or ") : "any";
}

function constraintsOf(schema: JsonSchema): string {
  const parts: string[] = [];
  const add = (key: string, label: string): void => {
    const value = schema[key];
    if (typeof value === "number" || typeof value === "string") {
      parts.push(`${label} ${value}`);
    }
  };
  add("minLength", "min length");
  add("maxLength", "max length");
  add("minimum", "≥");
  add("maximum", "≤");
  add("exclusiveMinimum", ">");
  add("exclusiveMaximum", "<");
  add("minItems", "min items");
  add("maxItems", "max items");
  if (typeof schema.pattern === "string") {
    parts.push(`pattern \`${schema.pattern}\``);
  }
  add("format", "format");
  if (schema.type === "integer") {
    parts.push("integer");
  }
  return parts.join(", ");
}

/** Constraints of an array's items, folded into the parent row. */
function itemConstraints(schema: JsonSchema): string {
  if (schema.type !== "array" || !isSchema(schema.items)) {
    return "";
  }
  const item = branches(schema.items)[0];
  if (item === undefined || item.type === "object") {
    return "";
  }
  const inner = constraintsOf(item);
  return inner.length > 0 ? `each item: ${inner}` : "";
}

/** The object schema to descend into, if this property is (an array of) objects. */
function nestedObject(
  schema: JsonSchema,
): { readonly schema: JsonSchema; readonly suffix: string } | null {
  for (const branch of branches(schema)) {
    if (branch.type === "object" && isSchema(branch.properties)) {
      return { schema: branch, suffix: "" };
    }
    if (branch.type === "array" && isSchema(branch.items)) {
      const item = branches(branch.items)[0];
      if (item !== undefined && item.type === "object" && isSchema(item.properties)) {
        return { schema: item, suffix: "[]" };
      }
    }
  }
  return null;
}

export function flattenSchema(schema: unknown, prefix = ""): SchemaRow[] {
  if (!isSchema(schema)) {
    throw new DocsScriptError(`Expected a JSON Schema object at "${prefix || "<root>"}"`);
  }
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const rows: SchemaRow[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isSchema(property)) {
      continue;
    }
    const path = prefix.length > 0 ? `${prefix}.${name}` : name;
    const constraints = [
      constraintsOf(branches(property)[0] ?? property),
      itemConstraints(property),
    ]
      .filter((part) => part.length > 0)
      .join("; ");
    rows.push({
      path,
      type: typeName(property),
      required: required.has(name),
      defaultValue: property.default === undefined ? "" : JSON.stringify(property.default),
      constraints,
    });
    const nested = nestedObject(property);
    if (nested !== null) {
      rows.push(...flattenSchema(nested.schema, `${path}${nested.suffix}`));
    }
  }
  return rows;
}
