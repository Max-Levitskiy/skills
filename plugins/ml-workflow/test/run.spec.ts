// `claude-spore run`, the background Claude step (docs/spec.md, p.16, p.18–p.20), driven through
// the executable with the fake `claude` first on PATH.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { answered, FakeClaude, flag, remove, runStep, scratch } from "./helpers.ts";

const SUMMARY = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
const JSON_PARAMS = { format: "json", schema: { ok: SUMMARY }, context: { issue: 7 } };

let fake: FakeClaude;
let work: string;
beforeEach(() => {
  fake = new FakeClaude();
  work = scratch();
});
afterEach(() => {
  fake.dispose();
  remove(work);
});

function nonRetryable(code: string) {
  return { error: { code, message: expect.any(String) }, retryable: false };
}

describe("the session table", () => {
  test("no session, visit 1: starts the session with the instructions and the input", () => {
    fake.answers(answered("ok", { summary: "fixed" }));
    const step = runStep(fake, { params: { ...JSON_PARAMS, skill: "tdd" }, instructions: "Fix the failing test.\n" });

    expect(step.exitCode).toBe(0);
    expect(step.result).toEqual({ outcome: "ok", output: { summary: "fixed" } });
    const [call] = fake.calls();
    expect(flag(call!.args, "--session-id")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(call!.args).not.toContain("--resume");
    expect(call!.stdin).toStartWith("/tdd Fix the failing test.");
    expect(call!.stdin).toContain('"issue": 7');
  });

  test("no session, a later visit: the conversation is lost, and no try can help", () => {
    fake.answers(answered("ok", { summary: "x" }));
    for (const attempt of [1, 2]) {
      const step = runStep(fake, { params: JSON_PARAMS, visit: 2, attempt });
      expect(step.result).toEqual(nonRetryable("session.lost"));
    }
    expect(fake.calls().every((call) => call.args.includes("--resume"))).toBe(true);
  });

  test("session exists, a later visit, attempt 1: resumes, saying the run came back, with the new input", () => {
    fake.answers(answered("ok", { summary: "first" }), answered("ok", { summary: "second" }));
    runStep(fake, { params: JSON_PARAMS, instructions: "Fix it." });
    const step = runStep(fake, { params: { ...JSON_PARAMS, context: { failure: "test 3 is red" } }, visit: 2 });

    expect(step.result).toEqual({ outcome: "ok", output: { summary: "second" } });
    const [first, second] = fake.calls();
    expect(flag(second!.args, "--resume")).toBe(flag(first!.args, "--session-id"));
    expect(second!.stdin).toContain("came back");
    expect(second!.stdin).toContain("visit 2");
    expect(second!.stdin).toContain("test 3 is red");
    expect(second!.stdin).not.toContain("Fix it.");
  });

  test("session exists, attempt above 1: resumes, saying it was cut off, with the current input", () => {
    fake.answers(answered("ok", { summary: "a" }), answered("ok", { summary: "b" }), answered("ok", { summary: "c" }));
    runStep(fake, { params: JSON_PARAMS });
    const retry = runStep(fake, { params: JSON_PARAMS, attempt: 2 });
    const laterRetry = runStep(fake, { params: { ...JSON_PARAMS, context: { now: 3 } }, visit: 3, attempt: 3 });

    expect(retry.result).toEqual({ outcome: "ok", output: { summary: "b" } });
    expect(laterRetry.result).toEqual({ outcome: "ok", output: { summary: "c" } });
    const [, second, third] = fake.calls();
    for (const call of [second!, third!]) {
      expect(call.args).toContain("--resume");
      expect(call.stdin).toContain("cut off");
    }
    expect(third!.stdin).toContain('"now": 3');
  });

  test("session exists, visit 1, attempt 1: the ID belongs to another run, and no try can help", () => {
    fake.answers(answered("ok", { summary: "a" }));
    runStep(fake, { params: JSON_PARAMS });
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual(nonRetryable("session.foreign"));
  });

  test("no session, visit 1, a later attempt: the first try died before the session existed, so it starts", () => {
    fake.answers(answered("ok", { summary: "done" }));
    const step = runStep(fake, { params: JSON_PARAMS, attempt: 2, instructions: "Fix it." });

    expect(step.result).toEqual({ outcome: "ok", output: { summary: "done" } });
    const [resume, start] = fake.calls();
    expect(resume!.args).toContain("--resume");
    expect(flag(start!.args, "--session-id")).toBe(flag(resume!.args, "--resume"));
    expect(start!.stdin).toStartWith("Fix it.");
  });

  test("one session per node per run", () => {
    fake.answers(...Array(4).fill(answered("ok", { summary: "x" })));
    runStep(fake, { params: JSON_PARAMS, run: "run_a", node: "implement" });
    runStep(fake, { params: JSON_PARAMS, run: "run_a", node: "review" });
    runStep(fake, { params: JSON_PARAMS, run: "run_b", node: "implement" });
    runStep(fake, { params: JSON_PARAMS, run: "run_a", node: "implement", visit: 2 });

    const ids = fake.calls().map((call) => flag(call.args, "--session-id") ?? flag(call.args, "--resume"));
    expect(new Set(ids.slice(0, 3)).size).toBe(3);
    expect(ids[3]).toBe(ids[0]);
  });
});

describe("how claude is run", () => {
  test("every parameter becomes its flag; the message goes on stdin", () => {
    const files = scratch();
    const project = realpathSync(scratch());
    fake.answers(answered("ok", { summary: "x" }));
    runStep(fake, {
      params: { ...JSON_PARAMS, model: "opus", tools: ["Read", "Grep"] },
      stepFiles: files,
      cwd: project,
    });

    const [call] = fake.calls();
    const { args } = call!;
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(flag(args, "--permission-mode")).toBe("default");
    expect(flag(args, "--tools")).toBe("Read,Grep");
    expect(flag(args, "--allowedTools")).toBe("Read,Grep");
    expect(flag(args, "--model")).toBe("opus");
    expect(flag(args, "--add-dir")).toBe(files);
    expect(call!.stdin).toContain(`The step's files are in ${files}.`);
    expect(call!.retries).toBe("3");
    expect(call!.cwd).toBe(project);
    expect(JSON.parse(flag(args, "--json-schema")!)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["answer"],
      properties: {
        answer: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["outcome", "output"],
              properties: { outcome: { const: "ok" }, output: SUMMARY },
            },
          ],
        },
      },
    });
    remove(files);
    remove(project);
  });

  test("one anyOf branch per outcome", () => {
    fake.answers(answered("changes", { requests: ["rename x"] }));
    const changes = { type: "object", properties: { requests: { type: "array", items: { type: "string" } } }, required: ["requests"] };
    const step = runStep(fake, { params: { format: "json", schema: { approved: SUMMARY, changes } } });

    expect(step.result).toEqual({ outcome: "changes", output: { requests: ["rename x"] } });
    const schema = JSON.parse(flag(fake.calls()[0]!.args, "--json-schema")!);
    expect(schema.properties.answer.anyOf.map((b: any) => [b.properties.outcome.const, b.properties.output])).toEqual([
      ["approved", SUMMARY],
      ["changes", changes],
    ]);
  });

  test("unset parameters add no flag: no --model, --tools, --allowedTools or --add-dir", () => {
    fake.answers({ envelope: { result: "hello" } });
    runStep(fake, { params: { format: "text", outcome: "ok" } });

    const { args } = fake.calls()[0]!;
    for (const name of ["--model", "--tools", "--allowedTools", "--add-dir", "--json-schema"]) {
      expect(args).not.toContain(name);
    }
    expect(flag(args, "--permission-mode")).toBe("default");
  });
});

describe("the answer", () => {
  test("integral floats become integers", () => {
    fake.answers({
      stdout:
        '{"type":"result","subtype":"success","is_error":false,"num_turns":3.0,"duration_ms":900,"total_cost_usd":0.5,' +
        '"permission_denials":[],"structured_output":{"answer":{"outcome":"ok","output":{"count":2.0,"items":[1.0,-3.00]}}}}',
    });
    const step = runStep(fake, { params: { format: "json", schema: { ok: { type: "object" } } } });

    expect(step.stdout).toBe('{"outcome":"ok","output":{"count":2,"items":[1,-3]}}\n');
  });

  test("a number with a fraction is output.invalid, naming where it is", () => {
    fake.answers(answered("ok", { scores: [1, 2.5] }));
    const step = runStep(fake, { params: { format: "json", schema: { ok: { type: "object" } } } });

    expect(step.result).toEqual(nonRetryable("output.invalid"));
    expect(step.result.error.message).toContain("/scores/1");
  });

  test("repairs used up: output.invalid with Claude Code's errors, and no try can help", () => {
    fake.answers({
      exit: 1,
      envelope: {
        subtype: "error_max_structured_output_retries",
        is_error: true,
        terminal_reason: "structured_output_retry_exhausted",
        errors: ["Failed to provide valid structured output after 3 attempts: summary: expected string"],
      },
    });
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual(nonRetryable("output.invalid"));
    expect(step.result.error.message).toContain("summary: expected string");
    expect(fake.calls()).toHaveLength(1);
  });

  test("no answer: one nudge in the same conversation, then output.missing", () => {
    fake.answers({ envelope: { structured_output: null } }, { envelope: { structured_output: null } });
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual(nonRetryable("output.missing"));
    const [first, nudge] = fake.calls();
    expect(fake.calls()).toHaveLength(2);
    expect(flag(nudge!.args, "--resume")).toBe(flag(first!.args, "--session-id"));
    expect(nudge!.stdin).toContain("without giving your answer");
  });

  test("an answer after the nudge is the step's result", () => {
    fake.answers({ envelope: { structured_output: null } }, answered("ok", { summary: "late" }));
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual({ outcome: "ok", output: { summary: "late" } });
  });

  test("an answer naming an outcome the schema does not have is output.invalid", () => {
    fake.answers(answered("maybe", { summary: "x" }));
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual(nonRetryable("output.invalid"));
  });

  test("text: Claude's last reply under the step's one outcome", () => {
    fake.answers({ envelope: { result: "All four tests pass." } });
    const step = runStep(fake, { params: { format: "text", outcome: "approved" } });

    expect(step.result).toEqual({ outcome: "approved", output: { text: "All four tests pass." } });
    expect(fake.calls()[0]!.args).not.toContain("--json-schema");
  });

  test("text too long for spore keeps its end", () => {
    const reply = `${"a".repeat(100_000)}THE END`;
    fake.answers({ envelope: { result: reply } });
    const step = runStep(fake, { params: { format: "text", outcome: "ok" } });

    expect(Buffer.byteLength(step.stdout)).toBeLessThanOrEqual(63 * 1024 + 1);
    expect(step.result.output.text).toStartWith("[claude-spore: the reply's first ");
    expect(step.result.output.text).toEndWith("THE END");
  });

  test("claude failing for another reason is retryable: the next try resumes", () => {
    fake.answers({ exit: 1, envelope: { subtype: "error_max_turns", is_error: true, errors: ["Reached max turns (1)"] } });
    const step = runStep(fake, { params: JSON_PARAMS });

    expect(step.result).toEqual({ error: { code: "claude.failed", message: expect.stringContaining("max turns") }, retryable: true });
  });
});

describe("run facts", () => {
  test("go to <attempt>.facts.json in the work folder, never into the output", () => {
    fake.answers(
      answered(
        "ok",
        { summary: "done" },
        { num_turns: 8, duration_ms: 9200, total_cost_usd: 0.081234, permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm -rf /" } }] },
      ),
    );
    const step = runStep(fake, { params: JSON_PARAMS, attempt: 1, workDir: work });

    expect(step.result).toEqual({ outcome: "ok", output: { summary: "done" } });
    const session = flag(fake.calls()[0]!.args, "--session-id");
    expect(JSON.parse(readFileSync(join(work, "1.facts.json"), "utf8"))).toEqual({
      session,
      turns: 8,
      durationMs: 9200,
      costMicroUsd: 81234,
      deniedTools: [{ tool: "Bash", input: { command: "rm -rf /" } }],
    });
  });

  test("add up the calls of a try, the nudge included, under the try's own number", () => {
    fake.answers(answered("ok", { summary: "a" }), { envelope: { structured_output: null } }, answered("ok", { summary: "b" }));
    runStep(fake, { params: JSON_PARAMS, workDir: work });
    runStep(fake, { params: JSON_PARAMS, attempt: 2, workDir: work });

    const facts = JSON.parse(readFileSync(join(work, "2.facts.json"), "utf8"));
    expect(facts).toMatchObject({ turns: 6, durationMs: 3000, costMicroUsd: 24692 });
    expect(existsSync(join(work, "1.facts.json"))).toBe(true);
  });

  test("are written for a failed try too", () => {
    fake.answers({ envelope: { structured_output: null } }, { envelope: { structured_output: null } });
    runStep(fake, { params: JSON_PARAMS, workDir: work });

    expect(JSON.parse(readFileSync(join(work, "1.facts.json"), "utf8"))).toMatchObject({ turns: 6 });
  });
});

describe("parameters", () => {
  for (const [name, params] of [
    ["an unknown parameter", { ...JSON_PARAMS, prompt: "hi" }],
    ["json without a schema", { format: "json", context: {} }],
    ["no format and no schema", { context: {} }],
    ["text without its outcome", { format: "text" }],
    ["a tool Claude Code does not have", { ...JSON_PARAMS, tools: ["Read", "Teleport"] }],
    ["a format that is neither", { format: "yaml", schema: { ok: SUMMARY } }],
  ] as const) {
    test(`${name} is params.invalid before claude runs`, () => {
      fake.answers(answered("ok", { summary: "x" }));
      const step = runStep(fake, { params });

      expect(step.exitCode).toBe(0);
      expect(step.result).toEqual(nonRetryable("params.invalid"));
      expect(fake.calls()).toHaveLength(0);
    });
  }

  test("input that is not JSON is params.invalid", () => {
    const step = runStep(fake, { params: "not json" });
    expect(step.result).toEqual(nonRetryable("params.invalid"));
  });

  test("a schema outside the strict form runs, with a warning on stderr", () => {
    fake.answers(answered("ok", { summary: "x" }));
    const loose = { type: "object", properties: { summary: { type: "string", minLength: 1 } } };
    const step = runStep(fake, { params: { format: "json", schema: { ok: loose } } });

    expect(step.result).toEqual({ outcome: "ok", output: { summary: "x" } });
    expect(step.stderr).toContain('keyword "minLength" at /properties/summary');
  });

  test("outside a spore step it exits 2 and runs nothing", () => {
    const step = runStep(fake, { params: JSON_PARAMS, env: { RUNSPORE_RUN_ID: undefined, RUNSPORE_VISIT: undefined } });

    expect(step.exitCode).toBe(2);
    expect(step.stdout).toBe("");
    expect(step.stderr).toContain("RUNSPORE_RUN_ID, RUNSPORE_VISIT not set");
    expect(fake.calls()).toHaveLength(0);
  });
});
