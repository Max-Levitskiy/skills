// `claude-spore check <folder>` (docs/spec.md, p.15), driven through the executable.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELPER, remove, scratch } from "./helpers.ts";

const SUMMARY = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };

let folder: string;
beforeEach(() => {
  folder = scratch();
});
afterEach(() => remove(folder));

type Node = Record<string, unknown>;

/** A folder with one Claude step `review` (outcomes as given) beside a plain command `test`. */
function workflow(input: Record<string, unknown>, options: { outcomes?: string[]; node?: Node; argv?: string[] } = {}) {
  const settings = {
    format: "runspore.workflow/0.2",
    actions: {
      review: {
        kind: "command",
        argv: options.argv ?? ["claude-spore", "run"],
        output: "result",
        effect: "idempotent",
        ...(options.outcomes ? { outcomes: options.outcomes } : {}),
      },
      test: { kind: "command", argv: ["npm", "test"], outcomes: ["ok"] },
    },
    nodes: {
      review: { action: "review", outputSchemas: { ok: SUMMARY }, input, ...options.node },
      test: { action: "test", input: { anything: { $get: ["input"] } } },
    },
  };
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
}

function check(...args: string[]) {
  const child = Bun.spawnSync([HELPER, "check", folder, ...args]);
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

function codes(): string[] {
  const { stdout } = check("--json");
  const report = JSON.parse(stdout);
  return [...report.errors, ...report.warnings].map((p: { code: string }) => p.code);
}

const JSON_STEP = { format: { $literal: "json" }, schema: { $outputSchemas: {} }, context: { tests: { $get: ["nodes", "test", "output"] } } };

test("a folder whose Claude steps are right passes, and plain commands are not Claude steps", () => {
  workflow({ ...JSON_STEP, model: { $literal: "opus" }, tools: { $literal: ["Read", "Grep", "mcp__github__get_issue"] }, skill: { $literal: "ml-grilling:questions" } });
  const { exitCode, stdout } = check();

  expect(stdout).toBe(`${folder}: 1 Claude step checked, no errors\n`);
  expect(exitCode).toBe(0);
});

test("--json prints one object, problems with their node, code and message", () => {
  workflow({ ...JSON_STEP, prompt: { $literal: "hi" } });
  const { exitCode, stdout } = check("--json");

  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout)).toEqual({
    ok: false,
    errors: [{ node: "review", code: "params.unknown", message: expect.stringContaining('"prompt" is not a node parameter') }],
    warnings: [],
  });
});

describe("the closed parameter set", () => {
  test("a key outside it is an error", () => {
    workflow({ ...JSON_STEP, prompt: { $literal: "hi" } });
    const { exitCode, stdout } = check();

    expect(exitCode).toBe(2);
    expect(stdout).toStartWith('error: review: "prompt" is not a node parameter');
  });

  test("a parameter other than context must be a $literal", () => {
    workflow({ ...JSON_STEP, model: "opus" });
    expect(codes()).toEqual(["params.not-literal"]);
  });

  test("context may be any mapping", () => {
    workflow({ ...JSON_STEP, context: { $get: ["input"] } });
    expect(codes()).toEqual([]);
  });

  test("an interactive step is checked the same way", () => {
    workflow({ ...JSON_STEP, prompt: { $literal: "hi" } }, { argv: ["/opt/plugin/bin/claude-spore", "start"] });
    expect(codes()).toEqual(["params.unknown"]);
  });
});

describe("json steps", () => {
  test("format defaults to json, which needs a schema", () => {
    workflow({ context: {} });
    expect(codes()).toEqual(["params.schema-missing"]);
  });

  test("$outputSchemas on a node without outputSchemas is an error", () => {
    workflow(JSON_STEP, { node: { outputSchemas: undefined } });
    expect(codes()).toEqual(["params.schema-missing"]);
  });

  test("every outcome has a schema", () => {
    workflow(JSON_STEP, { outcomes: ["ok", "changes"] });
    const { exitCode, stdout } = check();

    expect(exitCode).toBe(2);
    expect(stdout).toContain('error: review: outcome "changes" has no schema');
  });

  test("a schema for an outcome the action does not declare is an error", () => {
    workflow({ ...JSON_STEP, schema: { $literal: { ok: SUMMARY, maybe: SUMMARY } } });
    expect(codes()).toEqual(["params.schema-outcome"]);
  });

  test("a $literal schema map works like $outputSchemas", () => {
    workflow({ ...JSON_STEP, schema: { $literal: { approved: SUMMARY, changes: SUMMARY } } }, { outcomes: ["approved", "changes"] });
    expect(codes()).toEqual([]);
  });
});

describe("text steps", () => {
  test("need outcome", () => {
    workflow({ format: { $literal: "text" } });
    expect(codes()).toEqual(["params.outcome"]);
  });

  test("end only with that outcome", () => {
    workflow({ format: { $literal: "text" }, outcome: { $literal: "ok" } }, { outcomes: ["ok", "red"] });
    const { stdout } = check();
    expect(stdout).toContain('a text step ends only with its "outcome" "ok", but the action declares "ok", "red"');
  });

  test("whose outcome is the action's only one pass", () => {
    workflow({ format: { $literal: "text" }, outcome: { $literal: "approved" } }, { outcomes: ["approved"] });
    expect(check().exitCode).toBe(0);
  });
});

test("tool names must be Claude Code tools", () => {
  workflow({ ...JSON_STEP, tools: { $literal: ["Read", "Raed", "mcp__bad"] } });
  const { stdout } = check();

  expect(stdout).toContain('"Raed" is not a Claude Code tool');
  expect(stdout).toContain('"mcp__bad" is not a Claude Code tool');
  expect(codes()).toEqual(["params.tools", "params.tools"]);
});

describe("schemas outside Claude Code's strict form warn but pass", () => {
  for (const [name, schema, reason] of [
    ["a length bound", { type: "object", properties: { s: { type: "string", minLength: 1 } } }, 'keyword "minLength" at /properties/s'],
    ["an object without properties", { type: "object" }, 'an object without "properties" at (root)'],
    ["an open object", { type: "object", properties: {}, additionalProperties: true }, '"additionalProperties" other than false at (root)'],
    ["anyOf beside type", { type: "object", anyOf: [SUMMARY] }, '"anyOf" beside other keywords at (root)'],
  ] as const) {
    test(name, () => {
      workflow(JSON_STEP, { node: { outputSchemas: { ok: schema } } });
      const { exitCode, stdout } = check();

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`warning: review: the schema of outcome "ok" is outside Claude Code's strict form (${reason})`);
    });
  }
});

test("a folder without a readable settings.json exits 2", () => {
  const { exitCode, stdout } = check();
  expect(exitCode).toBe(2);
  expect(stdout).toStartWith(`error: ${folder}: cannot read`);
});

test("without a folder it prints its usage and exits 2", () => {
  const child = Bun.spawnSync([HELPER, "check"]);
  expect(child.exitCode).toBe(2);
  expect(child.stderr.toString()).toContain("usage: claude-spore check <folder>");
});
