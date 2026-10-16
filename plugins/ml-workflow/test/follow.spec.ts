// Following a run (docs/spec.md, p.10, p.12): the commands the start, continue and cancel skills run,
// against the real spore, and the fields of each answer the reaction reads. It needs a spore with
// `continue --wait` and `cancel` (Web-tree/runspore#73, #74); without one it is skipped, unless
// REQUIRE_SPORE=1 (CI) makes that a failure.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FakeClaude, FakeHerdr, HELPER, PATH, remove, scratch, SPORE, SPORE_TIMEOUT_MS, sporeVersion } from "./helpers.ts";

const version = sporeVersion("follow.spec.ts");
setDefaultTimeout(SPORE_TIMEOUT_MS);

/** Whether this spore follows and cancels runs; the v0.2.0 release does neither. */
function follows(): boolean {
  if (!version) return false;
  const help = Bun.spawnSync([SPORE, "continue", "--help"]).stdout.toString();
  if (help.includes("--wait") && Bun.spawnSync([SPORE, "cancel", "--help"]).exitCode === 0) return true;
  const reason = `the spore at ${SPORE} has no \`continue --wait\` or no \`cancel\``;
  if (process.env.REQUIRE_SPORE === "1") throw new Error(reason);
  console.warn(`skipping follow.spec.ts: ${reason}`);
  return false;
}

const TASK = {
  type: "object",
  required: ["task"],
  additionalProperties: false,
  properties: { task: { type: "string", minLength: 1, description: "What should this run do?" } },
};

const REASON = { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string" } } };

// A decision, then an end: approved completes, rejected fails.
const DECIDE_DOT = `digraph "decide" {
  dialect = "runspore/0.2";
  start = "approve";
  approve [kind="await-signal"];
  done [kind="complete"];
  stopped [kind="fail"];
  approve -> done [on="approved"];
  approve -> stopped [on="rejected"];
}
`;

const DECIDE = {
  format: "runspore.workflow/0.2",
  inputSchema: TASK,
  actions: {},
  nodes: {
    approve: { signal: "approval", instructions: "steps/approve.md", outputSchemas: { rejected: REASON } },
    done: { output: { task: { $get: ["input", "task"] } } },
    stopped: { error: { code: "approval.rejected", message: "The change was rejected." } },
  },
};

// A command that always fails, with no `failed` arrow: the run gets stuck.
const STUCK_DOT = `digraph "stuck" {
  dialect = "runspore/0.2";
  start = "build";
  build;
  done [kind="complete"];
  build -> done;
}
`;

const STUCK = {
  format: "runspore.workflow/0.2",
  actions: {
    build: { kind: "command", argv: ["sh", "-c", "echo broken >&2; exit 1"], effect: "idempotent", outcomes: ["ok"], timeoutMs: "60000" },
  },
  nodes: { build: { action: "build" } },
};

// A person's manual work.
const MANUAL_DOT = `digraph "manual" {
  dialect = "runspore/0.2";
  start = "review";
  review;
  done [kind="complete"];
  review -> done;
}
`;

const MANUAL = {
  format: "runspore.workflow/0.2",
  actions: { review: { kind: "external", actor: "person", outcomes: ["ok"], effect: "idempotent", timeoutMs: "604800000" } },
  nodes: { review: { action: "review", instructions: "steps/review.md" } },
};

// An interactive Claude step, as the interview writes it.
const WATCHED_DOT = `digraph "watched" {
  dialect = "runspore/0.2";
  start = "implement";
  implement;
  done [kind="complete"];
  implement -> done;
}
`;

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
      outputSchemas: { ok: { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } } },
      input: { format: { $literal: "json" }, schema: { $outputSchemas: {} }, tools: { $literal: ["Read"] } },
    },
  },
};

type Ran = { exitCode: number; stdout: string; stderr: string; json: any };

// Each test runs the real spore five to ten times, and a shared CI runner can take more than Bun's
// default 5 s for that; a follow that really hangs still fails.
const SLOW = 30_000;

describe.skipIf(!follows())(`following a run under a real spore ${version ?? ""}`, () => {
  let project: string;
  let db: string;
  let claude: FakeClaude;
  let herdr: FakeHerdr;
  // No RUNSPORE_ variable from outside: a spec run inside a spore step would make each run its child.
  const env = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("RUNSPORE_"))),
    PATH,
    FAKE_CLAUDE_DIR: claude.dir,
    CLAUDE_CONFIG_DIR: claude.dir,
    FAKE_HERDR_DIR: herdr.dir,
    CLAUDE_SPORE_WATCH_POLL_MS: "50",
  });
  const spore = (...args: string[]): Ran => {
    const child = Bun.spawnSync([SPORE, ...args], { cwd: project, env: env() });
    const stdout = child.stdout.toString();
    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {}
    return { exitCode: child.exitCode, stdout, stderr: child.stderr.toString(), json };
  };
  // What the skills run: `spore start … --json`, then the follow with `--db` after the subcommand.
  const start = (workflow: string, key: string, input: unknown) =>
    spore("start", workflow, "--key", key, "--input", JSON.stringify(input), "--json");
  const follow = (runId: string) => spore("continue", runId, "--wait", "--json", "--db", db);

  const workflow = (name: string, dot: string, settings: unknown, steps: Record<string, string> = {}) => {
    const folder = join(project, ".spore", "workflows", name);
    mkdirSync(join(folder, "steps"), { recursive: true });
    writeFileSync(join(folder, "workflow.dot"), dot);
    writeFileSync(join(folder, "settings.json"), JSON.stringify(settings, null, 2));
    for (const [file, text] of Object.entries(steps)) writeFileSync(join(folder, "steps", file), text);
  };

  beforeAll(() => {
    project = scratch();
    claude = new FakeClaude();
    herdr = new FakeHerdr();
    expect(spore("init").exitCode).toBe(0);
    workflow("decide", DECIDE_DOT, DECIDE, { "approve.md": "Approve when the change looks right; reject it with a reason.\n" });
    workflow("stuck", STUCK_DOT, STUCK);
    workflow("manual", MANUAL_DOT, MANUAL, { "review.md": "Review the change.\n" });
    workflow("watched", WATCHED_DOT, WATCHED, { "implement.md": "Implement the task.\n" });
    for (const name of ["decide", "stuck", "manual", "watched"]) expect(spore("validate", name).exitCode).toBe(0);
    db = spore("list", "--json").json.db;
  }, SLOW);

  afterAll(() => {
    herdr.dispose();
    claude.dispose();
    remove(project);
  });

  test("an input that does not fit creates no run, and the same key then starts one", () => {
    const refused = start("decide", "decide-0000000a", {});
    expect(refused.exitCode).toBe(2);
    expect(refused.json.error.code).toBe("input.invalid");
    expect(refused.json.error.details.errors).toEqual([{ path: "/task", message: expect.any(String) }]);
    expect(spore("list", "--unfinished", "--json").json.runs).toEqual([]);

    const started = start("decide", "decide-0000000a", { task: "add a flag" });
    expect(started.exitCode).toBe(0);
    expect(started.json.runId).toMatch(/^run_/);
    // `start` works nothing: the follow takes the run's first turn.
    expect(spore("status", started.json.runId, "--json").json).toMatchObject({ status: "created", db, parent: null });
    spore("cancel", started.json.runId);
  }, SLOW);

  test("a decision: exit 3, the outcomes, the instructions, then one decision per wait", () => {
    const { runId } = start("decide", "decide-0000000b", { task: "add a flag" }).json;

    const waiting = follow(runId);
    expect(waiting.exitCode).toBe(3);
    expect(waiting.json).toMatchObject({
      runId,
      db,
      needs: "signal",
      position: { nodeId: "approve", activationId: expect.any(String) },
      waiting: { nodeId: "approve", signal: "approval", outcomes: ["approved", "rejected"], outputSchemas: { rejected: REASON } },
    });

    const shown = spore("step", "show", runId, "--json", "--db", db).json;
    expect(shown).toMatchObject({ nodeKind: "await-signal", signal: "approval", outcomes: ["approved", "rejected"] });
    expect(readFileSync(shown.instructions, "utf8")).toStartWith("Approve when the change looks right");

    const id = waiting.json.position.activationId;
    const decide = (outcome: string, ...data: string[]) =>
      spore("signal", runId, "approval", "--outcome", outcome, "--id", id, "--db", db, "--json", ...data);
    expect(decide("approved").exitCode).toBe(0);
    expect(decide("approved").exitCode).toBe(0);
    const other = decide("rejected", "--data", JSON.stringify({ reason: "too big" }));
    expect(other.exitCode).toBe(2);
    expect(other.json.error.code).toBe("signal.id-reused");

    const ended = follow(runId);
    expect(ended.exitCode).toBe(0);
    expect(ended.json).toMatchObject({ status: "completed", needs: null, end: { nodeId: "done" } });
    expect(JSON.stringify(ended.json.result)).toContain('"task":"add a flag"');
  }, SLOW);

  test("a rejected decision with its data: exit 1, the end node and the error", () => {
    const { runId } = start("decide", "decide-0000000c", { task: "add a flag" }).json;
    const id = follow(runId).json.position.activationId;
    const send = (data: unknown) =>
      spore("signal", runId, "approval", "--outcome", "rejected", "--id", id, "--db", db, "--json", "--data", JSON.stringify(data));
    expect(send({}).json.error.code).toBe("output.invalid");
    expect(send({ reason: "too big" }).exitCode).toBe(0);

    const ended = follow(runId);
    expect(ended.exitCode).toBe(1);
    expect(ended.json).toMatchObject({ status: "failed", end: { nodeId: "stopped" }, result: { error: { code: "approval.rejected" } } });
  }, SLOW);

  test("a stuck step: exit 4, its kept error and the three resolutions, then Mark done", () => {
    const { runId } = start("stuck", "stuck-0000000d", {}).json;
    const stuck = follow(runId);
    expect(stuck.exitCode).toBe(4);
    expect(stuck.json).toMatchObject({
      needs: "stuck",
      intervention: { nodeId: "build", reason: "stuck", attempt: 1, maxAttempts: 1, outcomes: ["ok"], error: { code: "command.exit" } },
    });
    expect(stuck.json.intervention.commands).toEqual([
      `spore resolve ${runId} --retry`,
      `spore resolve ${runId} --complete ok`,
      `spore resolve ${runId} --fail <message>`,
    ]);

    expect(spore("resolve", runId, "--complete", "ok", "--db", db).exitCode).toBe(0);
    expect(follow(runId).exitCode).toBe(0);
  }, SLOW);

  test("a person's manual work: exit 6, the actor label and the claim line", () => {
    const { runId } = start("manual", "manual-0000000e", {}).json;
    const ready = follow(runId);
    expect(ready.exitCode).toBe(6);
    expect(ready.json).toMatchObject({ needs: "external-ready", position: { nodeId: "review" }, step: { kind: "external", actor: "person", state: "ready" } });
    expect(ready.json.commands).toContain(`spore step claim ${runId} --actor person`);
    spore("cancel", runId);
  }, SLOW);

  test("several unfinished runs are listed newest first, and continue without an ID names them", () => {
    const first = start("decide", "decide-0000000f", { task: "one" }).json.runId;
    const second = start("decide", "decide-00000010", { task: "two" }).json.runId;
    const rows = spore("list", "--unfinished", "--json").json;
    expect(rows.db).toBe(db);
    expect(rows.runs.map((row: { runId: string }) => row.runId)).toEqual([second, first]);
    expect(rows.runs[0]).toMatchObject({ workflow: "decide", nodeId: null, needs: "working", startKey: "decide-00000010", since: expect.any(String) });

    const several = spore("continue", "--json");
    expect(several.exitCode).toBe(2);
    expect(several.json.error.code).toBe("run.several");
    for (const runId of [first, second]) spore("cancel", runId);
  }, SLOW);

  test("a cancel: the follow returns exit 7 with the reason, and a second cancel changes nothing", () => {
    const { runId } = start("decide", "decide-00000011", { task: "add a flag" }).json;
    expect(follow(runId).exitCode).toBe(3);

    const cancelled = spore("cancel", runId, "--json", "--reason", "not needed");
    expect(cancelled.exitCode).toBe(0);
    expect(cancelled.json).toMatchObject({ runId, disposition: "applied", status: "cancelled", cancel: { reason: "not needed" }, stops: [] });
    expect(spore("cancel", runId, "--json", "--reason", "not needed").json).toMatchObject({ disposition: "duplicate", status: "cancelled" });

    const ended = follow(runId);
    expect(ended.exitCode).toBe(7);
    expect(ended.json).toMatchObject({ status: "cancelled", needs: null, cancel: { reason: "not needed" } });
    expect(spore("list", "--unfinished", "--json").json.runs.map((row: { runId: string }) => row.runId)).not.toContain(runId);
  }, SLOW);

  test("an interactive step that waits for the person: exit 6 with its message, and cancel closes its pane", () => {
    // Claude asks a question in the pane.
    herdr.everyStatus("blocked");
    const { runId } = start("watched", "watched-00000012", {}).json;
    const held = follow(runId);
    expect(held.exitCode).toBe(6);
    expect(held.json).toMatchObject({
      needs: "held",
      position: { nodeId: "implement" },
      step: { kind: "command", state: "held", waiting: "person", message: "implement waits for you in its pane", holder: { herdrAgent: expect.stringMatching(/^sp-implement-/) } },
    });
    const { pid } = held.json.step.holder;
    const [pane] = Object.keys(herdr.state().panes);

    const cancelled = spore("cancel", runId, "--json");
    expect(cancelled.json).toMatchObject({ status: "cancelled", stops: [{ exit: 0 }] });
    expect(herdr.calls()).toContainEqual(["pane", "close", pane!]);
    expect(existsSync(`/proc/${pid}`) || alive(pid)).toBe(false);
    expect(follow(runId).exitCode).toBe(7);
  }, SLOW);

  test("following again after the pane waited for the person keeps watching, and returns when its answer lands", async () => {
    herdr.everyStatus("blocked");
    const { runId } = start("watched", "watched-00000013", {}).json;
    const held = follow(runId);
    expect(held.exitCode).toBe(6);
    const { herdrAgent } = held.json.step.holder;

    // What the skill runs next, in the background.
    const again = Bun.spawn([SPORE, "continue", runId, "--wait", "--json", "--db", db], { cwd: project, env: env(), stdout: "pipe", stderr: "pipe" });
    let returned = false;
    void again.exited.then(() => (returned = true));
    await Bun.sleep(1500);
    expect(returned).toBe(false);

    // The person answers the question, and Claude hands in its answer from the pane.
    herdr.status(herdrAgent, "working");
    const { pane } = herdr.state().agents[herdrAgent]!;
    const reported = Bun.spawnSync([HELPER, "report", "--attempt", "1", "--outcome", "ok"], {
      env: { ...env(), RUNSPORE_WORK_DIR: herdr.state().panes[pane]!.env.RUNSPORE_WORK_DIR! },
      stdin: Buffer.from(JSON.stringify({ summary: "Added." })),
    });
    expect(reported.stdout.toString()).toBe("accepted\n");
    herdr.status(herdrAgent, "idle");

    expect(await again.exited).toBe(0);
    const ended = JSON.parse(await new Response(again.stdout).text());
    expect(ended).toMatchObject({ runId, status: "completed", needs: null });
    herdr.everyStatus("idle");
  }, SLOW);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
