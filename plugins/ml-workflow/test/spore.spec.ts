// A real `spore run` of a one-step workflow whose step is `claude-spore run`, with the fake `claude`
// (docs/spec.md, Testing). The `spore` is $SPORE, else the one on PATH; without a 0.2 one the spec
// is skipped, unless REQUIRE_SPORE=1 (CI) makes that a failure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answered, FakeClaude, HELPER, PATH, remove, scratch, SPORE, sporeVersion } from "./helpers.ts";

const version = sporeVersion("spore.spec.ts");

const SETTINGS = {
  format: "runspore.workflow/0.2",
  actions: {
    answer: {
      kind: "command",
      argv: ["claude-spore", "run"],
      output: "result",
      outcomes: ["ok"],
      effect: "idempotent",
      retry: { maxAttempts: 3 },
      timeoutMs: "60000",
    },
  },
  nodes: {
    answer: {
      action: "answer",
      instructions: "steps/answer.md",
      outputSchemas: {
        ok: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
      },
      input: {
        format: { $literal: "json" },
        schema: { $outputSchemas: {} },
        tools: { $literal: ["Read"] },
        context: { question: { $get: ["input", "question"] } },
      },
    },
    done: { output: { $get: ["nodes", "answer", "output"] } },
  },
};

const DOT = `digraph "one" {
  dialect = "runspore/0.2";
  start = "answer";
  answer [label="Answer"];
  done [kind="complete"];
  answer -> done;
}
`;

describe.skipIf(!version)(`a real spore ${version ?? ""} run`, () => {
  let project: string;
  let fake: FakeClaude;
  const env = () => ({ ...process.env, PATH, FAKE_CLAUDE_DIR: fake.dir, RUNSPORE_DB: undefined });
  const spore = (...args: string[]) => {
    const child = Bun.spawnSync([SPORE, ...args], { cwd: project, env: env() });
    return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  };

  beforeAll(() => {
    project = scratch();
    fake = new FakeClaude();
    expect(spore("init").exitCode).toBe(0);
    const folder = join(project, ".spore", "workflows", "one");
    mkdirSync(join(folder, "steps"), { recursive: true });
    writeFileSync(join(folder, "workflow.dot"), DOT);
    writeFileSync(join(folder, "settings.json"), JSON.stringify(SETTINGS, null, 2));
    writeFileSync(join(folder, "steps", "answer.md"), "Answer the question in one sentence.\n");
  });

  afterAll(() => {
    fake.dispose();
    remove(project);
  });

  test("claude-spore check passes the workflow", () => {
    const child = Bun.spawnSync([HELPER, "check", join(project, ".spore", "workflows", "one")]);
    expect(child.stdout.toString()).toContain("1 Claude step checked, no errors");
    expect(child.exitCode).toBe(0);
  });

  test("the run completes with Claude's answer, and the facts stay in the work folder", () => {
    fake.answers(answered("ok", { summary: "Because." }, { total_cost_usd: 0.25 }));
    const run = spore("--json", "run", "one", "--input", JSON.stringify({ question: "why?" }));
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    const runId = JSON.parse(run.stdout).runId;

    const status = JSON.parse(spore("--json", "status", runId).stdout);
    expect(status.status).toBe("completed");
    expect(JSON.stringify(status)).toContain('"summary":"Because."');

    const [call] = fake.calls();
    expect(call!.stdin).toStartWith("Answer the question in one sentence.");
    expect(call!.stdin).toContain('"question": "why?"');
    expect(call!.args).toContain("--add-dir");

    const work = join(project, ".spore", "runspore.db.files", "work", runId);
    const [invocation] = readdirSync(work);
    const facts = JSON.parse(readFileSync(join(work, invocation!, "1.facts.json"), "utf8"));
    expect(facts).toMatchObject({ turns: 3, costMicroUsd: 250000, deniedTools: [] });
  });
});
