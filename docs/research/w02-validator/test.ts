import { validate, formatErrors, type Schema } from "./validate.ts";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
    console.log(`ok   - ${name}`);
  } else {
    fail++;
    console.log(`FAIL - ${name}`);
  }
}

// --- schema used throughout: a workflow node descriptor ---
const nodeSchema: Schema = {
  type: "object",
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["agent", "command"] },
    retries: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    owner: {
      type: "object",
      properties: { name: { type: "string" }, active: { type: "boolean" } },
      required: ["name"],
    },
  },
  required: ["id", "kind"],
};

// 1. valid nested object
{
  const value = { id: "n1", kind: "agent", retries: 2, tags: ["a", "b"], owner: { name: "max", active: true } };
  const r = validate(nodeSchema, value);
  check("valid nested object passes with zero errors", r.valid && r.errors.length === 0);
}

// 2. nested type mismatch (owner.name is number, not string)
{
  const value = { id: "n2", kind: "agent", owner: { name: 42 } };
  const r = validate(nodeSchema, value);
  check(
    "nested type mismatch reported at owner.name",
    !r.valid && r.errors.some((e) => e.path === "$.owner.name" && e.keyword === "type"),
  );
}

// 3. null where object expected (typeof null === "object" trap)
{
  const value = { id: "n3", kind: "agent", owner: null };
  const r = validate(nodeSchema, value);
  check(
    "null rejected where object expected",
    !r.valid && r.errors.some((e) => e.path === "$.owner" && e.keyword === "type" && e.actual.startsWith("null")),
  );
}

// 4. NaN rejected as a number
{
  const value = { id: "n4", kind: "agent", retries: NaN };
  const r = validate(nodeSchema, value);
  check(
    "NaN rejected for type number",
    !r.valid && r.errors.some((e) => e.path === "$.retries" && e.actual.startsWith("NaN")),
  );
}

// 5. Infinity rejected as a number
{
  const value = { id: "n5", kind: "agent", retries: Infinity };
  const r = validate(nodeSchema, value);
  check(
    "Infinity rejected for type number",
    !r.valid && r.errors.some((e) => e.path === "$.retries" && e.actual.startsWith("Infinity")),
  );
}

// 6. integer and float both accepted as "number" (no separate integer type in locked subset)
{
  const intOk = validate(nodeSchema, { id: "n6", kind: "agent", retries: 3 });
  const floatOk = validate(nodeSchema, { id: "n6", kind: "agent", retries: 3.5 });
  check("integer accepted as number", intOk.valid);
  check("float accepted as number", floatOk.valid);
}

// 7. array where object expected
{
  const value = { id: "n7", kind: "agent", owner: ["not", "an", "object"] };
  const r = validate(nodeSchema, value);
  check(
    "array rejected where object expected (Array.isArray guard)",
    !r.valid && r.errors.some((e) => e.path === "$.owner" && e.actual.startsWith("array")),
  );
}

// 8. object where array expected
{
  const value = { id: "n8", kind: "agent", tags: { 0: "a" } };
  const r = validate(nodeSchema, value);
  check(
    "object rejected where array expected",
    !r.valid && r.errors.some((e) => e.path === "$.tags" && e.expected === '"array"' && e.actual.startsWith("object")),
  );
}

// 9. missing required nested field (owner.name)
{
  const value = { id: "n9", kind: "agent", owner: { active: true } };
  const r = validate(nodeSchema, value);
  check(
    "missing nested required field reported",
    !r.valid && r.errors.some((e) => e.path === "$.owner.name" && e.keyword === "required"),
  );
}

// 10. missing top-level required field
{
  const value = { kind: "agent" };
  const r = validate(nodeSchema, value);
  check(
    "missing top-level required field reported",
    !r.valid && r.errors.some((e) => e.path === "$.id" && e.keyword === "required"),
  );
}

// 11. enum violation (primitive)
{
  const value = { id: "n11", kind: "background-job" };
  const r = validate(nodeSchema, value);
  check(
    "enum violation reported for primitive",
    !r.valid && r.errors.some((e) => e.path === "$.kind" && e.keyword === "enum"),
  );
}

// 12. enum with non-primitive members, deep equality
{
  const shapeSchema: Schema = { enum: [{ x: 1, y: 2 }, { x: 0, y: 0 }] };
  const match = validate(shapeSchema, { y: 2, x: 1 }); // key order differs, must still match
  const mismatch = validate(shapeSchema, { x: 1, y: 3 });
  check("enum deep-equality matches object regardless of key order", match.valid);
  check("enum deep-equality rejects near-miss object", !mismatch.valid);
}

// 13. unknown/extra properties: reported as info, does NOT fail (width subtyping)
{
  const value = { id: "n13", kind: "agent", extra: "surprise", another: 1 };
  const r = validate(nodeSchema, value);
  const infos = r.errors.filter((e) => e.severity === "info");
  check(
    "extra properties are reported but do not fail validation",
    r.valid && infos.some((e) => e.path === "$.extra") && infos.some((e) => e.path === "$.another"),
  );
}

// 14. items: wrong element type inside array
{
  const value = { id: "n14", kind: "agent", tags: ["ok", 42, "fine"] };
  const r = validate(nodeSchema, value);
  check(
    "wrong array element type reported at indexed path",
    !r.valid && r.errors.some((e) => e.path === "$.tags[1]" && e.keyword === "type"),
  );
}

// 15. empty schema accepts anything
{
  const emptySchema: Schema = {};
  check("empty schema accepts a string", validate(emptySchema, "anything").valid);
  check("empty schema accepts null", validate(emptySchema, null).valid);
  check("empty schema accepts an array", validate(emptySchema, [1, 2, 3]).valid);
  check("empty schema accepts an object", validate(emptySchema, { a: 1 }).valid);
}

// 16. error accumulation: multiple independent violations all collected, not fail-fast
{
  const value = { retries: "not-a-number" }; // missing id, missing kind, wrong type on retries
  const r = validate(nodeSchema, value);
  const keywords = r.errors.map((e) => `${e.path}:${e.keyword}`);
  check(
    "multiple errors accumulated in one pass (not fail-fast)",
    keywords.includes("$.id:required") && keywords.includes("$.kind:required") && keywords.includes("$.retries:type"),
  );
  check("accumulation yields at least 3 distinct errors", r.errors.length >= 3);
}

// --- error string showcase (verbatim, printed for the report) ---
console.log("\n--- verbatim error strings ---");

const s1 = validate(nodeSchema, { id: "n2", kind: "agent", owner: { name: 42 } });
console.log("[nested type mismatch]  " + formatErrors(s1.errors));

const s2 = validate(nodeSchema, { kind: "agent" });
console.log("[missing required]      " + formatErrors(s2.errors).split("\n")[0]);

const s3 = validate(nodeSchema, { id: "n11", kind: "background-job" });
console.log("[enum violation]        " + formatErrors(s3.errors));

const s4 = validate(nodeSchema, { id: "n14", kind: "agent", tags: ["ok", 42] });
console.log("[wrong array element]   " + formatErrors(s4.errors));

const s5 = validate(nodeSchema, { id: "n3", kind: "agent", owner: null });
console.log("[null where object]     " + formatErrors(s5.errors));

console.log("\n--- full repair message example ---\n");
const broken = { id: 7, owner: { active: "yes" } };
const full = validate(nodeSchema, broken);
const repairMessage =
  `Validation failed against schema:\n${JSON.stringify(nodeSchema, null, 2)}\n\n` +
  `Errors:\n${formatErrors(full.errors)}\n\n` +
  `Fix the output and resubmit.`;
console.log(repairMessage);

console.log(`\n--- summary: ${pass} passed, ${fail} failed (${pass + fail} total) ---`);
if (fail > 0) process.exit(1);
