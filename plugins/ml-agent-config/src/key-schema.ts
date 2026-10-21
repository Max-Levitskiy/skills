// What a declared key holds, as JSON Schema: a key entry already carries `description` and
// `default`, and may add the keywords below. The CLI checks a written value against it, and the
// pane reads it to draw one field per part of the value instead of a line of JSON.
//
// No Node here: the hooks module imports this file too.
//
// A subset of JSON Schema 2020-12, the keywords a config value needs. `$ref` reaches the
// declaration's own `schema.$defs` only (`#/$defs/<name>`). Any other keyword is an annotation,
// read by neither.

// A config value. Defined here rather than in layers.ts, which needs Node; layers.ts re-exports it.
export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };

export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface ValueSchema {
  $ref?: string;
  type?: JsonType | JsonType[];
  title?: string;
  description?: string;
  default?: ConfigValue;
  enum?: ConfigValue[];
  const?: ConfigValue;
  properties?: Record<string, ValueSchema>;
  additionalProperties?: boolean | ValueSchema;
  required?: string[];
  items?: ValueSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

export type Defs = Record<string, ValueSchema>;

/** The keywords that say what a value is. A key entry with none of them is typed by its default. */
const TYPING = ["$ref", "type", "enum", "const", "properties", "additionalProperties", "items"] as const;
const TYPES: JsonType[] = ["string", "number", "integer", "boolean", "object", "array", "null"];
const REF = /^#\/\$defs\/([^/]+)$/;

/** A key entry's schema: the entry itself, less the advisory `layer` and `personal`. Null when it types nothing. */
export function keySchema(entry: ValueSchema & { layer?: string; personal?: boolean }): ValueSchema | null {
  if (!TYPING.some((keyword) => entry[keyword] !== undefined)) return null;
  const { layer: _layer, personal: _personal, ...schema } = entry;
  return schema;
}

/** A `$ref`'s name in `$defs`, and the schema it names there; no name when it is not `#/$defs/<name>`. */
function refTarget(ref: string, defs: Defs): { name?: string; target?: ValueSchema } {
  const name = REF.exec(ref)?.[1];
  if (name === undefined) return {};
  let key: string;
  try {
    key = decodeURIComponent(name);
  } catch {
    // A malformed escape names nothing; schemaProblems says so instead of the CLI crashing.
    return { name };
  }
  return { name, target: has(defs, key) ? defs[key] : undefined };
}

/** The schema a `$ref` points at, followed until it points at none. */
export function resolveRef(schema: ValueSchema, defs: Defs): ValueSchema {
  let current = schema;
  const met: string[] = [];
  for (; current.$ref !== undefined; ) {
    // A $ref met again adds nothing new: what was gathered so far is the schema.
    if (met.includes(current.$ref)) {
      const { $ref: _again, ...gathered } = current;
      return gathered;
    }
    met.push(current.$ref);
    const { target } = refTarget(current.$ref, defs);
    if (!target) return {};
    // Keywords beside the $ref still apply; the target's fill in the rest. Both schemas' fields
    // apply, so their properties and required names are joined rather than one replacing the other.
    const { $ref: _ref, ...beside } = current;
    const properties = target.properties && beside.properties ? { ...target.properties, ...beside.properties } : (beside.properties ?? target.properties);
    const required = target.required && beside.required ? [...new Set([...target.required, ...beside.required])] : (beside.required ?? target.required);
    current = { ...target, ...beside, ...(properties ? { properties } : {}), ...(required ? { required } : {}) };
  }
  return current;
}

function types(schema: ValueSchema): JsonType[] | null {
  if (schema.type === undefined) return null;
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function typeOf(value: ConfigValue): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value as JsonType;
}

function fits(value: ConfigValue, type: JsonType): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

/** A member the object holds itself, never one it inherits (`toString`, `constructor`). */
export const has = (object: object, key: string): boolean => Object.hasOwn(object, key);

const isPlainObject = (value: ConfigValue | undefined): value is { [key: string]: ConfigValue } =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

/**
 * Deep merge per ACS, as the loader merges layers: objects merge member by member, lists and
 * scalars replace, and an explicit null deletes. Here so the pane merges the same way.
 */
export function merge(base: ConfigValue | undefined, over: ConfigValue | undefined): ConfigValue | undefined {
  if (over === null) return undefined;
  if (over === undefined || !isPlainObject(over)) return over;
  const target: { [key: string]: ConfigValue } = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(over)) {
    const merged = merge(target[key], value);
    if (merged === undefined) delete target[key];
    else target[key] = merged;
  }
  return target;
}

/** JSON equality: an object's members in any order, a list's items in theirs. */
export function same(a: ConfigValue, b: ConfigValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((one, index) => same(one, b[index]!));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => has(b, key) && same(a[key]!, b[key]!));
}

/**
 * Where a value breaks its schema, one line each, `at` naming the part. A layer may leave out what
 * another layer gives and holds null where it blocks the levels under it, so `partial` lets both
 * through; the merged value is checked whole.
 */
export function check(value: ConfigValue, schema: ValueSchema, defs: Defs, at: string, partial = false, followed: string[] = []): string[] {
  if (schema.$ref === undefined) return checkOne(value, schema, defs, at, partial);
  // Keywords beside a $ref apply as well as the schema it names, never instead of it.
  const { $ref, ...beside } = schema;
  // A $ref met again on the same value is a cycle that checks nothing new.
  const { target } = followed.includes($ref) ? {} : refTarget($ref, defs);
  const problems = [...(target ? check(value, target, defs, at, partial, [...followed, $ref]) : []), ...checkOne(value, beside, defs, at, partial)];
  return [...new Set(problems)];
}

function checkOne(value: ConfigValue, s: ValueSchema, defs: Defs, at: string, partial: boolean): string[] {
  if (value === null && partial) return [];
  const shape = inferred(s);
  const wanted = types(s) ?? (shape ? [shape] : null);
  if (wanted && !wanted.some((type) => fits(value, type))) return [`${at} should be ${wanted.map(article).join(" or ")}, not ${article(typeOf(value))}`];
  // An object in a layer may be a part of the whole that the layers merge into, so enum and const
  // are held to the merged value only.
  const isFragment = partial && isPlainObject(value);
  if (s.enum && !isFragment && !s.enum.some((one) => same(one, value))) return [`${at} should be one of ${s.enum.map((one) => JSON.stringify(one)).join(", ")}`];
  if (s.const !== undefined && !isFragment && !same(s.const, value)) return [`${at} should be ${JSON.stringify(s.const)}`];
  const problems: string[] = [];
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) problems.push(`${at} should be at least ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) problems.push(`${at} should be at most ${s.maximum}`);
  }
  if (typeof value === "string") {
    // Characters as JSON Schema counts them: code points, not UTF-16 units.
    const length = [...value].length;
    if (s.minLength !== undefined && length < s.minLength) problems.push(`${at} should be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && length > s.maxLength) problems.push(`${at} should be at most ${s.maxLength} characters`);
    if (s.pattern !== undefined && !new RegExp(s.pattern, "u").test(value)) problems.push(`${at} should match ${s.pattern}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) problems.push(`${at} should hold at least ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) problems.push(`${at} should hold at most ${s.maxItems} items`);
    // A list replaces the one under it whole, so each item is checked complete, even in a layer.
    if (s.items) value.forEach((item, index) => problems.push(...check(item, s.items!, defs, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (!partial) for (const name of s.required ?? []) if (!has(value, name)) problems.push(`${at}.${name} is required`);
    for (const [name, child] of Object.entries(value)) {
      const declared = s.properties && has(s.properties, name) ? s.properties[name] : undefined;
      if (declared) problems.push(...check(child, declared, defs, `${at}.${name}`, partial));
      // A null in a layer only removes a member beneath, so it may name one the schema no longer takes.
      else if (s.additionalProperties === false && !(partial && child === null)) problems.push(`${at}.${name} is not a key it takes`);
      else if (typeof s.additionalProperties === "object") problems.push(...check(child, s.additionalProperties, defs, `${at}.${name}`, partial));
    }
  }
  return problems;
}

function article(type: JsonType): string {
  return { string: "text", number: "a number", integer: "a whole number", boolean: "true or false", object: "an object", array: "a list", null: "null" }[type];
}

/**
 * Where a key's own schema cannot hold: besides what `schemaProblems` finds, a key cannot hold null,
 * which in a layer blocks the layers under it and in the merged config means the key is not set.
 */
export function keySchemaProblems(schema: ValueSchema, defs: Defs, at: string): string[] {
  const problems = schemaProblems(schema, defs, at);
  if (problems.length > 0) return problems;
  return nullProblems(schema, defs, at, new Set());
}

/**
 * Null in a layer removes what is beneath, at a key and at every object member under it, since
 * objects merge; so neither may hold null. A list replaces whole, so its items may.
 */
function nullProblems(schema: ValueSchema, defs: Defs, at: string, seen: Set<ValueSchema>): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const resolved = resolveRef(schema, defs);
  const own = types(resolved) ?? [];
  const forcesNull = resolved.const === null || (Array.isArray(resolved.enum) && resolved.enum.includes(null));
  const problems = own.includes("null") || forcesNull ? [`${at}: cannot hold null, which in a layer removes what is beneath; leave it unset instead`] : [];
  for (const [name, child] of Object.entries(resolved.properties ?? {})) problems.push(...nullProblems(child, defs, `${at}.${name}`, seen));
  if (typeof resolved.additionalProperties === "object") problems.push(...nullProblems(resolved.additionalProperties, defs, `${at}.*`, seen));
  return problems;
}

/** A chain of schemas that are only a $ref each, leading back to one already met: it describes nothing. */
function refLoops(ref: string, defs: Defs): boolean {
  const met: string[] = [];
  for (let next: string | undefined = ref; next !== undefined; ) {
    if (met.includes(next)) return true;
    met.push(next);
    // A schema that adds any keyword beside its $ref says something, so the chain is not empty.
    const target: ValueSchema | undefined = refTarget(next, defs).target;
    next = target && Object.keys(target).length === 1 ? target.$ref : undefined;
  }
  return false;
}

/** Where a declaration's schema cannot be read: an unknown type, or a `$ref` to nothing. */
export function schemaProblems(schema: ValueSchema, defs: Defs, at: string, seen = new Set<ValueSchema>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const problems: string[] = [];
  if (schema.$ref !== undefined) {
    const { name, target } = refTarget(schema.$ref, defs);
    if (target && refLoops(schema.$ref, defs)) problems.push(`${at}: $ref "${schema.$ref}" leads back to itself through $refs alone`);
    if (name === undefined) problems.push(`${at}: $ref "${schema.$ref}" should be #/$defs/<name>`);
    else if (!target) problems.push(`${at}: $ref "${schema.$ref}" names no entry in schema.$defs`);
    else problems.push(...schemaProblems(target, defs, `$defs.${name}`, seen));
  }
  for (const type of types(schema) ?? []) if (!TYPES.includes(type)) problems.push(`${at}: unknown type "${type}"`);
  // The declaration is JSON from a plugin, so each keyword's own shape is checked before it is read.
  const isMap = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (schema.enum !== undefined && !(Array.isArray(schema.enum) && schema.enum.length > 0)) problems.push(`${at}: enum should be a list of at least one value`);
  if (schema.pattern !== undefined && typeof schema.pattern !== "string") problems.push(`${at}: pattern should be text`);
  for (const bound of ["minimum", "maximum"] as const) {
    if (schema[bound] !== undefined && typeof schema[bound] !== "number") problems.push(`${at}: ${bound} should be a number`);
  }
  for (const bound of ["minLength", "maxLength", "minItems", "maxItems"] as const) {
    const n = schema[bound];
    if (n !== undefined && !(typeof n === "number" && Number.isInteger(n) && n >= 0)) problems.push(`${at}: ${bound} should be a whole number, 0 or more`);
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((one) => typeof one === "string"))) problems.push(`${at}: required should be a list of names`);
  if (schema.properties !== undefined && !isMap(schema.properties)) problems.push(`${at}: properties should be an object`);
  if (schema.items !== undefined && !isMap(schema.items)) problems.push(`${at}: items should be a schema`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean" && !isMap(schema.additionalProperties)) problems.push(`${at}: additionalProperties should be true, false or a schema`);
  if (problems.length > 0) return problems;
  if (schema.pattern !== undefined) {
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      problems.push(`${at}: pattern ${schema.pattern} is not a regular expression`);
    }
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    if (!isMap(child)) problems.push(`${at}.${name}: a property's schema should be an object`);
    else problems.push(...schemaProblems(child, defs, `${at}.${name}`, seen));
  }
  if (typeof schema.additionalProperties === "object") problems.push(...schemaProblems(schema.additionalProperties, defs, `${at}.*`, seen));
  if (schema.items) problems.push(...schemaProblems(schema.items, defs, `${at}[]`, seen));
  return problems;
}

/**
 * How an editor draws a value: on/off, a pick among fixed values, a typed scalar, a list of
 * scalars typed as `a, b`, an object's fields, a map of named entries, a list of entries, or, for
 * anything else, JSON.
 */
export type Kind = "boolean" | "enum" | "number" | "integer" | "string" | "list" | "fields" | "map" | "entries" | "json";

export function kindOf(schema: ValueSchema | null | undefined, defs: Defs): Kind {
  if (!schema) return "json";
  const s = resolveRef(schema, defs);
  if (s.enum) return "enum";
  const wanted = (types(s) ?? []).filter((type) => type !== "null");
  const type = wanted.length === 1 ? wanted[0] : wanted.length === 0 ? inferred(s) : undefined;
  if (type === "boolean" || type === "number" || type === "integer" || type === "string") return type;
  if (type === "array") {
    const item = s.items ? kindOf(s.items, defs) : "json";
    if (item === "string" || item === "number" || item === "integer") return "list";
    return item === "fields" ? "entries" : "json";
  }
  if (type === "object") {
    if (s.properties && Object.keys(s.properties).length > 0) return "fields";
    if (typeof s.additionalProperties === "object" || s.additionalProperties === true) return "map";
    return "json";
  }
  return "json";
}

function inferred(s: ValueSchema): JsonType | undefined {
  if (s.properties || s.additionalProperties !== undefined) return "object";
  if (s.items) return "array";
  return undefined;
}

/** The schema of one part of a value: a property, a map entry, or a list item. */
export function childSchema(schema: ValueSchema | null | undefined, defs: Defs, part: string): ValueSchema | null {
  if (!schema) return null;
  const s = resolveRef(schema, defs);
  const isList = (types(s) ?? (inferred(s) ? [inferred(s)!] : [])).includes("array");
  if (s.items && isList && /^\d+$/.test(part)) return s.items;
  const declared = s.properties && has(s.properties, part) ? s.properties[part] : undefined;
  if (declared) return declared;
  return typeof s.additionalProperties === "object" ? s.additionalProperties : null;
}

/** What a new part starts as: its default, else empty of its kind. */
export function emptyOf(schema: ValueSchema | null, defs: Defs): ConfigValue {
  const s = schema ? resolveRef(schema, defs) : {};
  if (s.default !== undefined) return structuredClone(s.default);
  const kind = kindOf(s, defs);
  if (kind === "fields" || kind === "map") return {};
  if (kind === "list" || kind === "entries") return [];
  if (kind === "boolean") return false;
  if (kind === "enum") return s.enum![0] ?? null;
  // Never null, which in a layer removes what is beneath: an unconstrained part starts as empty text.
  return "";
}

/** The values a part may take, when its schema names them. */
export function enumOf(schema: ValueSchema | null, defs: Defs): ConfigValue[] {
  return (schema ? resolveRef(schema, defs).enum : undefined) ?? [];
}
