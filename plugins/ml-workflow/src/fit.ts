// Whether data fits a schema, as spore checks a step's output (runspore spec/schema.md §3), so
// `report` refuses what spore would and says so the same way.
import { isObject } from "./schema.ts";

export type DataError = { path: string; message: string };

const MAX_ERRORS = 16;

/** Up to 16 places where `data` does not fit `schema`; empty when it fits. */
export function misfits(data: unknown, schema: unknown): DataError[] {
  const errors: DataError[] = [];
  check(data, schema, "", errors);
  return errors.slice(0, MAX_ERRORS);
}

/** Errors one per line, path first, `(root)` for the whole value. */
export function printErrors(errors: DataError[]): string {
  return errors.map((e) => `${e.path === "" ? "(root)" : e.path}: ${e.message}`).join("\n");
}

function check(data: unknown, schema: unknown, path: string, errors: DataError[]) {
  if (!isObject(schema) || errors.length >= MAX_ERRORS) return;
  const fail = (message: string) => errors.push({ path, message });

  if (Array.isArray(schema.anyOf)) {
    const fits = schema.anyOf.some((branch) => {
      const inner: DataError[] = [];
      check(data, branch, path, inner);
      return inner.length === 0;
    });
    if (!fits) fail(`fits none of the ${schema.anyOf.length} allowed shapes, got ${shown(data)}`);
    return;
  }
  if ("const" in schema && !same(data, schema.const)) {
    fail(`expected ${JSON.stringify(schema.const)}, got ${shown(data)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => same(data, v))) {
    fail(`expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}, got ${shown(data)}`);
    return;
  }
  if (typeof schema.type === "string" && typeOf(data) !== schema.type) {
    fail(`expected type "${schema.type}", got ${shown(data)}`);
    return;
  }

  if (typeof data === "string") {
    const length = [...data].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      fail(`expected at least ${schema.minLength} characters, got ${length}`);
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) {
      fail(`expected at most ${schema.maxLength} characters, got ${length}`);
    }
  } else if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) fail(`expected at least ${schema.minimum}, got ${data}`);
    if (typeof schema.maximum === "number" && data > schema.maximum) fail(`expected at most ${schema.maximum}, got ${data}`);
  } else if (Array.isArray(data)) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      fail(`expected at least ${schema.minItems} items, got ${data.length}`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      fail(`expected at most ${schema.maxItems} items, got ${data.length}`);
    }
    data.forEach((item, i) => check(item, schema.items, `${path}/${i}`, errors));
  } else if (isObject(data)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof name === "string" && !(name in data)) errors.push({ path: `${path}/${escape(name)}`, message: "required, but missing" });
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in properties) check(value, properties[key], `${path}/${escape(key)}`, errors);
      else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}/${escape(key)}`, message: "not allowed: the schema names no such property" });
      }
    }
  }
}

function typeOf(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  if (typeof data === "number") return Number.isInteger(data) ? "integer" : "number";
  return typeof data;
}

function shown(data: unknown): string {
  const type = typeOf(data);
  if (type === "string") {
    const text = data as string;
    const chars = [...text];
    return `string (${JSON.stringify(chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : text)})`;
  }
  if (type === "object" || type === "array" || type === "null") return type;
  return `${type} (${JSON.stringify(data)})`;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function escape(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
