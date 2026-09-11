// Zero-dependency JSON Schema (locked subset) validator for W02(b).
// Subset: type in {object,array,string,number,boolean}, properties, required, enum, items.
// Explicitly NOT implemented: $ref, oneOf, allOf, anyOf, additionalProperties, patternProperties,
// minLength/maxLength/pattern, minimum/maximum, minItems/maxItems, tuple-form items, const.

export type SchemaType = "object" | "array" | "string" | "number" | "boolean";

export type Schema = {
  type?: SchemaType;
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: unknown[];
  items?: Schema;
};

export type ValidationError = {
  /** JS-path-style pointer, e.g. "$.items[2].name" */
  path: string;
  keyword: "type" | "required" | "enum" | "properties";
  expected: string;
  actual: string;
  /** "info" = reported but does not fail validation (width subtyping: extra props are legal) */
  severity?: "error" | "info";
};

export type ValidationResult = { valid: boolean; errors: ValidationError[] };

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return "Infinity";
    return "number";
  }
  return typeof value; // "object" | "string" | "boolean" | "undefined" | ...
}

function describeValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? describe(value) : `${describe(value)} (${json})`;
  } catch {
    return describe(value);
  }
}

function matchesType(type: SchemaType, value: unknown): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value); // rejects NaN/Infinity
    case "boolean":
      return typeof value === "boolean";
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    return ak.length === bk.length && ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function walk(schema: Schema, value: unknown, path: string, errors: ValidationError[]): void {
  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    errors.push({ path, keyword: "type", expected: `"${schema.type}"`, actual: describeValue(value) });
    return; // structural keywords below assume the shape type() would have guaranteed
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push({
      path,
      keyword: "enum",
      expected: schema.enum.map((v) => JSON.stringify(v)).join(" | "),
      actual: describeValue(value),
    });
  }

  const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);

  if (schema.properties !== undefined && isPlainObject) {
    const obj = value as Record<string, unknown>;
    for (const [key, subschema] of Object.entries(schema.properties)) {
      if (key in obj) walk(subschema, obj[key], `${path}.${key}`, errors);
    }
    for (const key of Object.keys(obj)) {
      if (!(key in schema.properties)) {
        errors.push({
          path: `${path}.${key}`,
          keyword: "properties",
          expected: "undeclared property (width subtyping: extra fields are legal)",
          actual: describeValue(obj[key]),
          severity: "info",
        });
      }
    }
  }

  if (schema.required !== undefined && isPlainObject) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required) {
      if (!(key in obj)) {
        errors.push({ path: `${path}.${key}`, keyword: "required", expected: "present", actual: "missing" });
      }
    }
  }

  if (schema.items !== undefined && Array.isArray(value)) {
    value.forEach((el, i) => walk(schema.items as Schema, el, `${path}[${i}]`, errors));
  }
}

export function validate(schema: Schema, value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  walk(schema, value, "$", errors);
  const valid = errors.every((e) => e.severity === "info");
  return { valid, errors };
}

export function formatErrors(errors: ValidationError[]): string {
  const fatal = errors.filter((e) => e.severity !== "info");
  if (fatal.length === 0) return "No validation errors.";
  return fatal
    .map((e) => {
      if (e.keyword === "required") return `${e.path}: missing required property`;
      if (e.keyword === "enum") return `${e.path}: expected one of ${e.expected}, got ${e.actual}`;
      return `${e.path}: expected type ${e.expected}, got ${e.actual}`;
    })
    .join("\n");
}
