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
