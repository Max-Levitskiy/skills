// Output schemas as Claude Code takes them (docs/spec.md, p.15 and p.19).

export type Schemas = Record<string, unknown>;

/** The one `--json-schema` of a json step: a fixed root whose `answer` has a branch per outcome. */
export function answerSchema(schemas: Schemas): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
      answer: {
        anyOf: Object.entries(schemas).map(([outcome, output]) => ({
          type: "object",
          additionalProperties: false,
          required: ["outcome", "output"],
          properties: { outcome: { const: outcome }, output },
        })),
      },
    },
  };
}

const STRICT_KEYWORDS = new Set([
  "$schema",
  "type",
  "description",
  "title",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
]);

// Claude Code's limit is 32 levels for the whole `--json-schema`; the answer wrapper takes three.
const MAX_DEPTH = 29;

const TYPES = new Set(["null", "boolean", "object", "array", "number", "string", "integer"]);
const COUNTS = ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"];
const NUMBERS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"];

/**
 * Why `schema` is not a valid JSON Schema, as "<reason> at <JSON Pointer>", or null when it is.
 * Only the values of the keywords Claude Code's meta-schema check would reject are read: claude
 * refuses such a schema before any model call, so every try would fail the same way.
 */
export function invalidSchema(schema: unknown, path = ""): string | null {
  const at = path === "" ? "(root)" : path;
  if (typeof schema === "boolean") return null;
  if (!isObject(schema)) return `a schema that is not an object at ${at}`;
  const { type } = schema;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    const unknown = types.find((one) => typeof one !== "string" || !TYPES.has(one));
    if (types.length === 0 || unknown !== undefined) return `"type" ${JSON.stringify(unknown ?? type)}, which is not a JSON type, at ${at}`;
  }
  if ("properties" in schema && !isObject(schema.properties)) return `"properties" that is not an object at ${at}`;
  if ("required" in schema && !(Array.isArray(schema.required) && schema.required.every((name) => typeof name === "string"))) {
    return `"required" that is not a list of names at ${at}`;
  }
  if ("enum" in schema && !Array.isArray(schema.enum)) return `"enum" that is not a list at ${at}`;
  for (const key of ["description", "title", "pattern"]) {
    if (key in schema && typeof schema[key] !== "string") return `"${key}" that is not text at ${at}`;
  }
  if (typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      return `"pattern" that is not a regular expression at ${at}`;
    }
  }
  for (const key of COUNTS) {
    if (key in schema && !(Number.isInteger(schema[key]) && (schema[key] as number) >= 0)) return `"${key}" that is not a count at ${at}`;
  }
  for (const key of NUMBERS) {
    if (key in schema && typeof schema[key] !== "number") return `"${key}" that is not a number at ${at}`;
  }
  const children: [string, unknown][] = [];
  if (isObject(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) children.push([`/properties/${escape(name)}`, sub]);
  }
  if (Array.isArray(schema.items)) schema.items.forEach((sub, i) => children.push([`/items/${i}`, sub]));
  else if ("items" in schema) children.push(["/items", schema.items]);
  if ("additionalProperties" in schema) children.push(["/additionalProperties", schema.additionalProperties]);
  if ("not" in schema) children.push(["/not", schema.not]);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (!(key in schema)) continue;
    const list = schema[key];
    if (!Array.isArray(list) || list.length === 0) return `"${key}" that is not a non-empty list at ${at}`;
    list.forEach((sub, i) => children.push([`/${key}/${i}`, sub]));
  }
  for (const [step, sub] of children) {
    const reason = invalidSchema(sub, path + step);
    if (reason) return reason;
  }
  return null;
}

/**
 * Why `schema` falls outside Claude Code's strict form, as "<reason> at <JSON Pointer>", or null
 * when it fits. Claude Code still checks such a schema, with repair, but without the grammar
 * guarantee, so this is a warning (C12 W02).
 */
export function notStrict(schema: unknown, path = "", depth = 1): string | null {
  if (!isObject(schema)) return null;
  const at = path === "" ? "(root)" : path;
  if (depth > MAX_DEPTH) return `nested more than ${MAX_DEPTH} levels at ${at}`;
  for (const key of Object.keys(schema)) {
    if (!STRICT_KEYWORDS.has(key)) return `keyword "${key}" at ${at}`;
  }
  if ("anyOf" in schema && Object.keys(schema).some((k) => !["anyOf", "description", "title"].includes(k))) {
    return `"anyOf" beside other keywords at ${at}`;
  }
  if (schema.type === "object" && !isObject(schema.properties)) return `an object without "properties" at ${at}`;
  if (schema.type === "array" && !isObject(schema.items)) return `an array without one "items" schema at ${at}`;
  if (Array.isArray(schema.type) && schema.type.some((one) => one === "object" || one === "array")) {
    return `a "type" list with "object" or "array" at ${at}`;
  }
  if (Array.isArray(schema.required) && isObject(schema.properties)) {
    const declared = schema.properties;
    const missing = schema.required.find((name) => typeof name !== "string" || !(name in declared));
    if (missing !== undefined) return `"required" names ${JSON.stringify(missing)}, which "properties" does not declare, at ${at}`;
  }
  if ("additionalProperties" in schema && schema.additionalProperties !== false) {
    return `"additionalProperties" other than false at ${at}`;
  }
  const children: [string, unknown][] = [];
  if (isObject(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) children.push([`/properties/${escape(name)}`, sub]);
  }
  if ("items" in schema) children.push(["/items", schema.items]);
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((sub, i) => children.push([`/anyOf/${i}`, sub]));
  for (const [step, sub] of children) {
    const reason = notStrict(sub, path + step, depth + 1);
    if (reason) return reason;
  }
  return null;
}

/** The JSON Pointer of the first number with a fraction in `value`, or null when it has none. */
export function fractionAt(value: unknown, path = ""): string | null {
  if (typeof value === "number") return Number.isInteger(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = fractionAt(value[i], `${path}/${i}`);
      if (found !== null) return found;
    }
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = fractionAt(item, `${path}/${escape(key)}`);
      if (found !== null) return found;
    }
  }
  return null;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escape(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
