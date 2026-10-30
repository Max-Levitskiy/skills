// The runner module (runner/, skills#152) sealed into a workflow and run by a real spore: the
// grants checked by `spore validate`, a call outside them, and a background Claude killed
// mid-step. The fake `claude` here only stays at work until it is killed; the watched mode
// needs a real herdr and Claude, and is checked by hand (runner/README.md).
//
// The module must be built for a world the spore runs (`spore capabilities`,
// `componentWorlds`): the committed runner/claude-runner.wasm is runspore:runner@0.2.0, which
// needs Web-tree/runspore#290 and #278; CLAUDE_RUNNER_WASM names another build, such as the
// 0.1.0 one CI makes for a released spore 0.7 (`cargo run -p claude-runner-build -- --world 0.1`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SPORE, remove, scratch, sporeVersion } from "./helpers.ts";

const COMMITTED = join(import.meta.dir, "..", "runner", "claude-runner.wasm");
const WORLD_02 = "runspore:runner/runner@0.2.0";

let worlds: string[] = [];

/** The module to seal and why it fits, or null after saying why none does. */
function pickModule(): string | null {
  if (!sporeVersion("runner.spec.ts")) return null;
  try {
    worlds = JSON.parse(Bun.spawnSync([SPORE, "--json", "capabilities"]).stdout.toString()).componentWorlds ?? [];
  } catch {}
  const chosen = process.env.CLAUDE_RUNNER_WASM ?? (worlds.includes(WORLD_02) ? COMMITTED : null);
  if (chosen) return chosen;
  // Not a failure under REQUIRE_SPORE: a released spore before runspore#278 cannot load the
  // committed module, and the job that builds a 0.1.0 one sets CLAUDE_RUNNER_WASM.
  console.warn(`skipping runner.spec.ts: the spore at ${SPORE} runs ${JSON.stringify(worlds)}, not ${WORLD_02}; set CLAUDE_RUNNER_WASM to a module it runs`);
  return null;
}

const module = pickModule();
/** The committed module on a spore that runs it: the runner writes into the work folder, which the action grants, and Claude starts without the token. */
const writes = module === COMMITTED;

const FAKE_CLAUDE = `#!/bin/sh
# Records its arguments and environment, then stays at work until it is killed.
printf '%s\\n' "$@" > "$FAKE_CLAUDE_DIR/args.$$"
env > "$FAKE_CLAUDE_DIR/env.$$"
exec sleep 600
`;

function settings(programs: string[], transcripts: string) {
  return {
    format: "runspore.workflow/0.2",
    actions: {
      claude: {
        kind: "component",
        module: "claude-runner.wasm",
        effect: "idempotent",
        outcomes: ["ok"],
        retry: { maxAttempts: 2 },
        grants: writes
          ? { programs, sockets: ["~/.config/herdr/herdr.sock"], folders: ["$RUNSPORE_WORK_DIR", transcripts], writeFolders: ["$RUNSPORE_WORK_DIR"] }
          : { programs, sockets: ["~/.config/herdr/herdr.sock"], folders: [transcripts] },
        ...(writes ? { passToken: false } : {}),
        async: { timeoutMs: "600000" },
      },
    },
    nodes: {
      work: {
        action: "claude",
        // Claude Code's own is ~/.claude/projects; the spec keeps its own, empty.
        params: { runMode: "background", format: "text", outcome: "ok", transcripts },
        input: { task: { $get: ["input", "task"] } },
      },
      done: { output: { $get: ["nodes", "work", "output"] } },
    },
  };
}

const dot = (name: string) => `digraph "${name}" {
  dialect = "runspore/0.2";
  start = "work";
  work [label="Work"];
  done [kind="complete"];
  work -> done;
}
`;

describe.skipIf(!module)("the runner module under a real spore", () => {
  let project: string;
  let bin: string;
  let calls: string;
  const env = () => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_DIR: calls, RUNSPORE_DB: undefined });
  const spore = (...args: string[]) => {
    const child = Bun.spawnSync([SPORE, ...args], { cwd: project, env: env() });
    return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  };
  const workflow = (name: string, programs: string[]) => {
    const folder = join(project, ".spore", "workflows", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "workflow.dot"), dot(name));
    writeFileSync(join(folder, "settings.json"), JSON.stringify(settings(programs, join(project, "transcripts")), null, 2));
    copyFileSync(module!, join(folder, "claude-runner.wasm"));
  };
  const started = () => readdirSync(calls).filter((f) => f.startsWith("args."));

  beforeAll(() => {
    project = scratch();
    bin = join(project, "bin");
    calls = join(project, "calls");
    mkdirSync(bin);
    mkdirSync(calls);
    mkdirSync(join(project, "transcripts"));
    writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
    chmodSync(join(bin, "claude"), 0o755);
    expect(spore("init").exitCode).toBe(0);
    workflow("granted", ["claude"]);
    workflow("ungranted", ["herdr"]);
  });

  afterAll(() => {
    for (const file of readdirSync(calls).filter((f) => f.startsWith("args."))) {
      try {
        process.kill(-Number(file.slice(5)), "SIGKILL");
      } catch {}
    }
    remove(project);
  });

  test("spore validate accepts the sealed module and its grants", () => {
    const validated = spore("validate", "granted");
    expect(validated.stderr).toBe("");
    expect(validated.exitCode).toBe(0);
  });

  test("a start outside the grants fails the step with component.not-granted", () => {
    const run = spore("--json", "run", "ungranted", "--input", JSON.stringify({ task: "t" }));
    const runId = JSON.parse(run.stdout).runId;
    const events = spore("--json", "events", runId).stdout;
    expect(events).toContain("component.not-granted");
    expect(events).toContain('"details":{"grant":"programs","value":"claude"}');
    expect(started()).toEqual([]);
  });

  test("a background Claude killed mid-step: the next probe says dead and the next try starts", () => {
    const run = spore("--json", "run", "granted", "--input", JSON.stringify({ task: "two\nlines" }));
    expect(run.exitCode).toBe(6);
    const parked = JSON.parse(run.stdout);
    expect(parked.step).toMatchObject({ kind: "component", state: "held", holder: { mode: "background" } });
    const runId = parked.runId;
    const [first] = started();
    const pgid = Number(first!.slice(5));
    const args = readFileSync(join(calls, first!), "utf8").trim().split("\n");
    expect(args.slice(0, 2)).toEqual(["-p", "--session-id"]);
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toContain('{"task":"two\\nlines"}');
    // The token reaches the background Claude only through spore's environment on a 0.1.0
    // host; a 0.2.0 one writes it to the step file instead ("passToken": false).
    const claudeEnv = readFileSync(join(calls, `env.${pgid}`), "utf8");
    expect(claudeEnv).toContain("RUNSPORE_WORK_DIR=");
    if (writes) {
      expect(claudeEnv).not.toContain("RUNSPORE_TOKEN=");
      const stepFile = /^RUNSPORE_STEP_FILE=(.*)$/m.exec(claudeEnv)![1]!;
      expect(statSync(stepFile).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(stepFile, "utf8"))).toMatchObject({ attempt: 1, nodeId: "work", token: expect.any(String) });
    }

    expect(JSON.parse(spore("--json", "status", runId).stdout).step).toMatchObject({ state: "held" });
    process.kill(-pgid, "SIGKILL");
    // `status` probes a held async step first: the runner's probe says dead, which frees it.
    spore("--json", "status", runId);
    // Parked again (exit 6): the next try's Claude holds the step.
    expect(spore("--json", "worker", "--run", runId, "--until-parked").exitCode).toBe(6);
    const status = JSON.parse(spore("--json", "status", runId).stdout);
    expect(status.step).toMatchObject({ state: "held", attempt: 2 });
    expect(started().length).toBe(2);
    const [result] = JSON.parse(spore("--json", "events", runId).stdout).events.filter((e: { kind: string }) => e.kind === "activity.result");
    expect(result.payload).toMatchObject({ attempt: 1, status: "expired", retryable: true });
  });
});

// Whether runner/claude-runner.wasm exists is checked here too: a plugin copy without it
// cannot run a component step.
test("the committed module is there", () => {
  expect(existsSync(COMMITTED)).toBe(true);
});
