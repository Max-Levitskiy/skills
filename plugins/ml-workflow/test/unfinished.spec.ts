// Seam 1: `claude-spore unfinished`, the session-start line (docs/spec.md, p.9), against a fake spore
// that answers `list --unfinished` and `status` as each test says.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELPER, remove, scratch } from "./helpers.ts";
import { pathOf, run } from "./release-fixtures.ts";

let dir: string;
let bin: string;

const DB = "/repo/.spore/runspore.db";
// Read the clock per row: a time taken once when the file loads drifts by the time the earlier tests take.
const ago = (ms: number) => String(Date.now() - ms);
const MIN = 60_000;
const ONE = "/ml-workflow:menu to pick it up";
const SEVERAL = "/ml-workflow:menu to pick them up";

beforeEach(() => {
  dir = scratch();
  bin = join(dir, "bin");
  mkdirSync(bin);
  // `list` prints list.json, `status <run>` prints status-<run>.json; a missing file is exit 2.
  writeFileSync(
    join(bin, "spore"),
    `#!/bin/sh
echo "$*" >> "${dir}/calls"
case "$1" in
  list) file="${dir}/list.json" ;;
  status) file="${dir}/status-$2.json" ;;
  *) exit 2 ;;
esac
[ -f "$file" ] || exit 2
cat "$file"
`,
  );
  chmodSync(join(bin, "spore"), 0o755);
});

afterEach(() => remove(dir));

function listed(runs: unknown[]) {
  writeFileSync(join(dir, "list.json"), JSON.stringify({ format: "runspore.cli/0.2", db: DB, runs }));
}

function status(runId: string, fields: Record<string, unknown>) {
  writeFileSync(join(dir, `status-${runId}.json`), JSON.stringify({ format: "runspore.cli/0.2", runId, db: DB, ...fields }));
}

function unfinished(args: string[] = ["--json"], env: Record<string, string> = {}) {
  const ran = run([HELPER, "unfinished", ...args], { env: { PATH: pathOf(bin), RUNSPORE_RUN_ID: "", RUNSPORE_WORK_DIR: "", ...env } });
  let report: any;
  try {
    report = JSON.parse(ran.stdout);
  } catch {}
  return { ...ran, report };
}

function calls(): string[] {
  const file = join(dir, "calls");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

const row = (runId: string, fields: Record<string, unknown>) => ({
  runId,
  workflow: "coding-loop",
  startKey: null,
  actor: null,
  ...fields,
});

const running = (fields: Record<string, unknown>) => ({
  nodeId: "implement",
  actionId: "implement",
  invocationId: "inv_1",
  claimed: false,
  worker: null,
  pid: null,
  sinceMs: ago(0),
  forMs: "0",
  ...fields,
});

test("a run whose follower closed with its session: where it is, the attempt, and what picks it up", () => {
  listed([row("run_a", { startKey: "coding-loop-0238a2a3", nodeId: "implement", needs: "working", since: ago(14 * MIN) })]);
  status("run_a", { running: running({ attempt: "2", maxAttempts: "3", state: "queued" }) });
  const { exitCode, report } = unfinished();
  expect(exitCode).toBe(0);
  expect(report).toEqual({ db: DB, lines: ["coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago", ONE] });
  expect(calls()).toEqual(["list --unfinished --json", `status run_a --json --no-probe --db ${DB}`]);
});

test("one line per run, those that need the person first, each in its own words, then one hint", () => {
  listed([
    row("run_b", { startKey: "coding-loop-11111111", nodeId: "implement", needs: "working", since: ago(3 * MIN) }),
    row("run_c", { startKey: "coding-loop-22222222", nodeId: "approve", needs: "signal", since: ago(2 * 60 * MIN) }),
    row("run_d", { startKey: "coding-loop-33333333", nodeId: "test", needs: "stuck", since: ago(40_000) }),
    row("run_e", { startKey: "coding-loop-44444444", nodeId: "implement", needs: "held", since: ago(5 * MIN) }),
    row("run_f", { startKey: "review-55555555", nodeId: "review", needs: "external-ready", actor: "person", since: ago(3 * 24 * 60 * MIN) }),
    row("run_g", { startKey: "coding-loop-66666666", nodeId: "test", needs: "quarantined", since: ago(MIN) }),
    row("run_h", { nodeId: null, needs: "working", since: ago(MIN) }),
  ]);
  status("run_b", { running: running({ attempt: "1", maxAttempts: "3", state: "started", claimed: true }) });
  status("run_d", { intervention: { nodeId: "test", reason: "stuck", attempt: "3", maxAttempts: "3" } });
  status("run_e", { step: { kind: "command", actor: null, state: "held", holder: { herdrAgent: "sp-implement-0a1b2c3d4e" } } });
  expect(unfinished().report.lines).toEqual([
    "coding-loop-22222222 at approve, waiting for your decision for 2 h",
    "coding-loop-33333333 at test, stuck after attempt 3 of 3 for 40 s",
    "review-55555555 at review, waiting for person to claim it for 3 d",
    "coding-loop-66666666 at test, quarantined for 1 min",
    "coding-loop-11111111 at implement, attempt 1 of 3, running for 3 min",
    "coding-loop-44444444 at implement, held by its pane (sp-implement-0a1b2c3d4e) for 5 min",
    "run_h, not started yet, created 1 min ago",
    SEVERAL,
  ]);
});

test("a stuck step and a quarantine say why, in the kept error's code and its first words", () => {
  listed([
    row("run_s", { startKey: "coding-loop-12121212", nodeId: "test", needs: "stuck", since: ago(40_000) }),
    row("run_t", { startKey: "coding-loop-34343434", nodeId: "fetch", needs: "stuck", since: ago(MIN) }),
    row("run_q", { startKey: "coding-loop-56565656", nodeId: "fix", needs: "quarantined", since: ago(69 * MIN) }),
  ]);
  status("run_s", { intervention: { nodeId: "test", reason: "stuck", attempt: 3, maxAttempts: 3, error: { code: "command.exit", message: "exit code 1" } } });
  status("run_t", {
    intervention: {
      nodeId: "fetch",
      reason: "stuck",
      attempt: 1,
      maxAttempts: 1,
      error: { code: "http.request", message: "connect ECONNREFUSED 127.0.0.1:8080: connection refused while the step fetched its ticket from the tracker\nat fetch()" },
    },
  });
  status("run_q", { quarantine: { code: "host.files-unwritable", details: "No space left on device\nwhile writing step files", commands: ["spore release run_q"] } });
  expect(unfinished().report.lines).toEqual([
    "coding-loop-12121212 at test, stuck after attempt 3 of 3 for 40 s: command.exit: exit code 1",
    "coding-loop-34343434 at fetch, stuck after attempt 1 of 1 for 1 min: http.request: connect ECONNREFUSED 127.0.0.1:8080: connection refused…",
    "coding-loop-56565656 at fix, quarantined for 1 h: host.files-unwritable: No space left on device",
    SEVERAL,
  ]);
});

test("a try spore found cut off says so, that nothing runs it, and what picks it up", () => {
  listed([row("run_x", { startKey: "coding-loop-dffdb9f2", nodeId: "implement", needs: "driver", since: ago(32_000) })]);
  status("run_x", {
    running: running({
      attempt: "1",
      maxAttempts: "3",
      state: "cut-off",
      claimed: true,
      cutOff: { reason: "process-gone", message: "pid 31295 is gone", commands: ["spore continue run_x"] },
    }),
  });
  expect(unfinished().report.lines).toEqual(["coding-loop-dffdb9f2 at implement, attempt 1 of 3 was cut off 32 s ago; nothing is running it", ONE]);
});

test("a run waiting on the runs it started, and a need this plugin does not know, each get their words", () => {
  listed([
    row("run_p", { startKey: "build-0-2", nodeId: "tickets", needs: "child", since: ago(5 * MIN) }),
    row("run_u", { startKey: "coding-loop-13131313", nodeId: "implement", needs: "elsewhere", since: ago(MIN) }),
    row("run_v", { startKey: "coding-loop-24242424", nodeId: "implement", needs: "driver", since: ago(2 * MIN) }),
  ]);
  expect(unfinished().report.lines).toEqual([
    "build-0-2 at tickets, waiting for the runs it started for 5 min",
    "coding-loop-13131313 at implement, elsewhere for 1 min",
    "coding-loop-24242424 at implement, its try was cut off 2 min ago; nothing is running it",
    SEVERAL,
  ]);
});

test("runs that are all running by themselves get no hint", () => {
  listed([row("run_r", { startKey: "coding-loop-78787878", nodeId: "implement", needs: "working", since: ago(3 * MIN) })]);
  status("run_r", { running: running({ attempt: "1", maxAttempts: "3", state: "started", claimed: true }) });
  expect(unfinished().report.lines).toEqual(["coding-loop-78787878 at implement, attempt 1 of 3, running for 3 min"]);
});

test("a status spore does not give still leaves the run its line", () => {
  listed([row("run_i", { startKey: "coding-loop-77777777", nodeId: "implement", needs: "working", since: ago(14 * MIN) })]);
  expect(unfinished().report.lines).toEqual(["coding-loop-77777777 at implement, paused 14 min ago", ONE]);
});

test("without --json each line is printed as it is", () => {
  listed([row("run_j", { startKey: "coding-loop-88888888", nodeId: "approve", needs: "signal", since: ago(2 * 60 * MIN) })]);
  expect(unfinished([])).toEqual({
    exitCode: 0,
    stdout: `coding-loop-88888888 at approve, waiting for your decision for 2 h\n${ONE}\n`,
    stderr: "",
    report: undefined,
  });
});

test("no unfinished run prints no line", () => {
  listed([]);
  expect(unfinished().report).toEqual({ db: DB, lines: [] });
  expect(unfinished([])).toMatchObject({ exitCode: 0, stdout: "" });
});

test("a spore that cannot list prints no line and exits 1", () => {
  expect(unfinished().report).toEqual({ db: null, lines: [] });
  expect(unfinished([])).toMatchObject({ exitCode: 1, stdout: "" });
});

test("no spore on PATH prints no line and exits 1", () => {
  const ran = run([HELPER, "unfinished", "--json"], { env: { PATH: pathOf() } });
  expect(ran.exitCode).toBe(1);
  expect(JSON.parse(ran.stdout)).toEqual({ db: null, lines: [] });
});

test("a Claude that spore started for a step lists nothing, and asks spore nothing", () => {
  listed([row("run_k", { startKey: "coding-loop-99999999", nodeId: "implement", needs: "held", since: ago(MIN) })]);
  expect(unfinished(["--json"], { RUNSPORE_WORK_DIR: "/repo/.spore/runspore.db.files/run_k/work" }).report).toEqual({ db: null, lines: [] });
  expect(calls()).toEqual([]);
});

test("an unknown flag is a usage error", () => {
  expect(unfinished(["--all"])).toMatchObject({ exitCode: 2, stdout: "", stderr: "usage: claude-spore unfinished [--json]\n" });
});
