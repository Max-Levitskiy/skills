// A key's JSON Schema: what the CLI refuses to write, what describe tells an editor, and how an
// editor reads it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { check, emptyOf, kindOf, type Defs, type ValueSchema } from "./key-schema";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

const DEFS: Defs = {
  rules: {
    type: "object",
    properties: { include: { type: "array", items: { type: "string" } }, exclude: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
  project: {
    type: "object",
    required: ["label"],
    properties: {
      label: { type: "string" },
      title: { $ref: "#/$defs/rules" },
      fallback: { enum: ["undecided", "include", "exclude"], default: "undecided" },
    },
  },
};
const PROJECTS: ValueSchema = { type: "object", additionalProperties: { $ref: "#/$defs/project" } };

describe("checking a value", () => {
  test("a value that fits says nothing", () => {
    expect(check({ acme: { label: "Acme", title: { include: ["Acme"] } } }, PROJECTS, DEFS, "projects")).toEqual([]);
  });

  test("each wrong part is named by where it sits", () => {
    expect(check({ acme: { label: 3, title: { include: "Acme", other: [] }, fallback: "maybe" } }, PROJECTS, DEFS, "projects")).toEqual([
      "projects.acme.label should be text, not a whole number",
      "projects.acme.title.include should be a list, not text",
      "projects.acme.title.other is not a key it takes",
      'projects.acme.fallback should be one of "undecided", "include", "exclude"',
    ]);
  });

  test("a layer may leave out a required field, and block with null", () => {
    expect(check({ acme: { title: null } }, PROJECTS, DEFS, "projects", true)).toEqual([]);
    expect(check({ acme: {} }, PROJECTS, DEFS, "projects")).toEqual(["projects.acme.label is required"]);
  });
});

describe("checking against the spec's own rules", () => {
  test("a list replaces the one under it, so its items are checked whole even in a layer", () => {
    expect(check(["ok", null], { type: "array", items: { type: "string" } }, {}, "tags", true)).toEqual(["tags[1] should be text, not null"]);
  });

  test("objects in an enum are equal whatever their members' order", () => {
    expect(check({ b: 2, a: 1 }, { enum: [{ a: 1, b: 2 }] }, {}, "x")).toEqual([]);
    expect(check([2, 1], { enum: [[1, 2]] }, {}, "x")).toEqual(["x should be one of [1,2]"]);
  });

  test("keywords beside a $ref apply as well as it, never instead", () => {
    expect(check(15, { $ref: "#/$defs/small", maximum: 20 }, { small: { maximum: 10 } }, "n")).toEqual(["n should be at most 10"]);
  });
});

describe("how an editor reads a schema", () => {
  test("each shape gets its own kind of field", () => {
    expect(kindOf(PROJECTS, DEFS)).toBe("map");
    expect(kindOf({ $ref: "#/$defs/project" }, DEFS)).toBe("fields");
    expect(kindOf(DEFS.rules!.properties!.include, DEFS)).toBe("list");
    expect(kindOf(DEFS.project!.properties!.fallback, DEFS)).toBe("enum");
    expect(kindOf({ type: ["integer", "null"] }, DEFS)).toBe("integer");
    expect(kindOf({ type: "array", items: { $ref: "#/$defs/project" } }, DEFS)).toBe("entries");
    expect(kindOf({ type: "object" }, DEFS)).toBe("json");
    expect(kindOf(null, DEFS)).toBe("json");
  });

  test("a new part starts as its default, else empty of its kind", () => {
    expect(emptyOf({ $ref: "#/$defs/project" }, DEFS)).toEqual({});
    expect(emptyOf(DEFS.project!.properties!.fallback!, DEFS)).toBe("undecided");
    expect(emptyOf(DEFS.rules!.properties!.include!, DEFS)).toEqual([]);
  });
});

/** A component declaring `projects` as above, and a run of the CLI against it. */
function component(schema: object) {
  const root = mkdtempSync(join(tmpdir(), "acs-key-schema-"));
  const home = join(root, "home");
  const dir = join(root, "demo");
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-config.json"), JSON.stringify({ version: 2, name: "demo", schema }));
  return (args: string[], stdin?: string) => {
    const result = Bun.spawnSync([BIN, ...args, "--from", dir], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1" },
      cwd: home,
      stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
    });
    return { code: result.exitCode, json: JSON.parse(result.stdout.toString() || "null"), stderr: result.stderr.toString() };
  };
}

const DECLARED = {
  version: 1,
  keys: { projects: { description: "Projects", default: {}, ...PROJECTS } },
  $defs: DEFS,
};

describe("the CLI", () => {
  test("write refuses a value its key's schema refuses, and says where", () => {
    const run = component(DECLARED);
    const refused = run(["write", "demo", "--layer", "global"], JSON.stringify({ projects: { acme: { label: 3 } } }));
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("not written: projects.acme.label should be text, not a whole number");
    expect(run(["write", "demo", "--layer", "global"], JSON.stringify({ projects: { acme: { title: { include: ["A"] } } } })).code).toBe(0);
  });

  test("describe gives each key its schema and the shared $defs; a merged value missing a field is a problem", () => {
    const run = component(DECLARED);
    run(["write", "demo", "--layer", "global"], JSON.stringify({ projects: { acme: { title: { include: ["A"] } } } }));
    const described = run(["describe", "demo"]).json;
    expect(described.keys[0].schema).toEqual({ description: "Projects", default: {}, ...PROJECTS });
    expect(described.defs).toEqual(DEFS);
    expect(described.problems).toEqual([{ code: "invalid-value", message: "projects.acme.label is required", keys: ["projects"] }]);
    // Said, not planned for: the component is still ready.
    expect(run(["start", "demo"]).json.ready).toBe(true);
  });

  test("a key with no type keyword is left to its default, as before", () => {
    const run = component({ version: 1, keys: { mode: { description: "Mode", default: "fast" } } });
    expect(run(["describe", "demo"]).json.keys[0].schema).toBeNull();
    expect(run(["write", "demo", "--layer", "global"], JSON.stringify({ mode: 3 })).code).toBe(0);
  });

  test("a default is checked whole, and a key cannot hold null", () => {
    const missing = component({
      version: 1,
      keys: { owner: { description: "O", type: "object", required: ["name"], properties: { name: { type: "string" } }, default: {} } },
    });
    expect(missing(["describe", "demo"]).stderr).toContain('key "owner" has a default its schema refuses: owner.name is required');
    const nullable = component({ version: 1, keys: { tag: { description: "T", type: ["string", "null"] } } });
    expect(nullable(["describe", "demo"]).stderr).toContain("a key cannot hold null");
  });

  test("a declaration whose $ref names nothing, or whose default its schema refuses, is an error", () => {
    const dangling = component({ version: 1, keys: { projects: { description: "P", $ref: "#/$defs/nothing" } } });
    expect(dangling(["describe", "demo"]).stderr).toContain('$ref "#/$defs/nothing" names no entry in schema.$defs');
    const wrong = component({ version: 1, keys: { count: { description: "C", type: "integer", default: "three" } } });
    expect(wrong(["describe", "demo"]).stderr).toContain('key "count" has a default its schema refuses');
  });
});
