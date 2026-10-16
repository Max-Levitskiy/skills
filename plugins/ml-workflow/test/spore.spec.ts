// A real `spore run` of a one-step workflow whose step is `claude-spore run`, with the fake `claude`
// (docs/spec.md, Testing). The `spore` is $SPORE, else the one on PATH; without a 0.2 one the spec
// is skipped, unless REQUIRE_SPORE=1 (CI) makes that a failure.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answered, FakeClaude, FakeHerdr, HELPER, PATH, remove, scratch, SPORE, SPORE_TIMEOUT_MS, sporeVersion } from "./helpers.ts";

const version = sporeVersion("spore.spec.ts");
setDefaultTimeout(SPORE_TIMEOUT_MS);

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
    // A newer spore follows the run on stderr, one JSON event per line; nothing else goes there.
    for (const line of run.stderr.split("\n").filter(Boolean)) expect(JSON.parse(line)).toHaveProperty("change");
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

const WATCHED = {
  format: "runspore.workflow/0.2",
  actions: {
    implement: {
      kind: "command",
      argv: ["claude-spore", "start"],
      outcomes: ["ok"],
      effect: "idempotent",
      retry: { maxAttempts: 3 },
      async: {
        timeoutMs: "14400000",
        probe: { command: { argv: ["claude-spore", "probe"] } },
        watch: { command: { argv: ["claude-spore", "watch"] } },
        stop: { command: { argv: ["claude-spore", "stop"] } },
      },
    },
  },
  nodes: {
    implement: {
      action: "implement",
      instructions: "steps/implement.md",
      outputSchemas: SETTINGS.nodes.answer.outputSchemas,
      input: {
        format: { $literal: "json" },
        schema: { $outputSchemas: {} },
        tools: { $literal: ["Read", "Edit"] },
        context: { task: { $get: ["input", "task"] } },
      },
    },
    done: { output: { $get: ["nodes", "implement", "output"] } },
  },
};

const WATCHED_DOT = `digraph "watched" {
  dialect = "runspore/0.2";
  start = "implement";
  implement [label="Implement"];
  done [kind="complete"];
  implement -> done;
}
`;

/**
 * Whether this spore runs `command` actions async (Web-tree/runspore#71); without it the spec is
 * skipped, unless REQUIRE_SPORE=1 (CI) makes that a failure.
 */
function runsAsync(): boolean {
  let kinds: unknown;
  try {
    kinds = JSON.parse(Bun.spawnSync([SPORE, "capabilities", "--json"]).stdout.toString()).asyncKinds;
  } catch {}
  if (Array.isArray(kinds) && kinds.includes("command")) return true;
  const reason = `the spore at ${SPORE} does not run command actions async`;
  if (version && process.env.REQUIRE_SPORE === "1") throw new Error(reason);
  if (version) console.warn(`skipping the interactive step under a real spore: ${reason}`);
  return false;
}

describe.skipIf(!version || !runsAsync())(`an interactive step under a real spore ${version ?? ""}`, () => {
  let project: string;
  let claude: FakeClaude;
  let herdr: FakeHerdr;
  const env = () => ({
    ...process.env,
    PATH,
    FAKE_CLAUDE_DIR: claude.dir,
    CLAUDE_CONFIG_DIR: claude.dir,
    FAKE_HERDR_DIR: herdr.dir,
    CLAUDE_SPORE_WATCH_POLL_MS: "50",
    RUNSPORE_DB: undefined,
  });
  const spore = (...args: string[]) => {
    const child = Bun.spawnSync([SPORE, ...args], { cwd: project, env: env() });
    return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  };

  beforeAll(() => {
    project = scratch();
    claude = new FakeClaude();
    herdr = new FakeHerdr();
    expect(spore("init").exitCode).toBe(0);
    const folder = join(project, ".spore", "workflows", "watched");
    mkdirSync(join(folder, "steps"), { recursive: true });
    writeFileSync(join(folder, "workflow.dot"), WATCHED_DOT);
    writeFileSync(join(folder, "settings.json"), JSON.stringify(WATCHED, null, 2));
    writeFileSync(join(folder, "steps", "implement.md"), "Implement the task.\n");
  });

  afterAll(() => {
    herdr.dispose();
    claude.dispose();
    remove(project);
  });

  test("claude-spore check passes the workflow", () => {
    const child = Bun.spawnSync([HELPER, "check", join(project, ".spore", "workflows", "watched")], { env: env() });
    expect(child.stdout.toString()).toContain("1 Claude step checked, no errors");
  });

  test("the pane waits for the person, then its report completes the run", () => {
    const run = spore("--json", "run", "watched", "--input", JSON.stringify({ task: "add a flag" }));
    const parked = JSON.parse(run.stdout);
    const runId = parked.runId;
    expect(run.exitCode).toBe(6);
    expect(parked.step).toMatchObject({ kind: "command", state: "held", holder: { herdrAgent: expect.stringMatching(/^sp-implement-/) } });

    const [pane] = Object.values(herdr.state().panes);
    expect(pane!.env.RUNSPORE_WORK_DIR).toContain(runId);
    const [call] = claude.calls();
    expect(call!.args).toContain("--session-id");

    // What Claude runs in the pane.
    const reported = Bun.spawnSync([HELPER, "report", "--attempt", "1", "--outcome", "ok"], {
      env: { ...env(), RUNSPORE_WORK_DIR: pane!.env.RUNSPORE_WORK_DIR },
      stdin: Buffer.from(JSON.stringify({ summary: "Added." })),
    });
    expect(reported.stdout.toString()).toBe("accepted\n");

    const worker = spore("--json", "worker", "--run", runId, "--until-parked");
    expect(worker.exitCode).toBe(0);
    const status = JSON.parse(spore("--json", "status", runId).stdout);
    expect(status.status).toBe("completed");
    expect(JSON.stringify(status)).toContain('"summary":"Added."');
  });
});
