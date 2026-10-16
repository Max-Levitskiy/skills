// Seam 1: `claude-spore menu`, the rows of the menu pane (docs/spec.md, p.11), against a fake spore
// that answers `list --unfinished` and `status` as each test says, in a scratch project.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELPER, remove, scratch } from "./helpers.ts";
import { pathOf, run } from "./release-fixtures.ts";

let dir: string;
let bin: string;
let project: string;
let db: string;

const NOW = Date.now();
const ago = (ms: number) => String(NOW - ms);
const MIN = 60_000;

beforeEach(() => {
  dir = scratch();
  bin = join(dir, "bin");
  project = join(dir, "repo");
  db = join(project, ".spore", "runspore.db");
  mkdirSync(bin);
  mkdirSync(join(project, ".spore", "workflows"), { recursive: true });
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
  writeFileSync(join(dir, "list.json"), JSON.stringify({ format: "runspore.cli/0.2", db, runs }));
}

function status(runId: string, fields: Record<string, unknown>) {
  writeFileSync(join(dir, `status-${runId}.json`), JSON.stringify({ format: "runspore.cli/0.2", runId, db, ...fields }));
}

function workflow(folder: string, dot: string) {
  mkdirSync(join(project, ".spore", "workflows", folder), { recursive: true });
  writeFileSync(join(project, ".spore", "workflows", folder, "workflow.dot"), dot);
}

function menu(args: string[] = ["--json"], options: { env?: Record<string, string>; cwd?: string } = {}) {
  const ran = run([HELPER, "menu", ...args], {
    env: { PATH: pathOf(bin), RUNSPORE_RUN_ID: "", RUNSPORE_WORK_DIR: "", ...options.env },
    cwd: options.cwd ?? project,
  });
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

const row = (runId: string, fields: Record<string, unknown>) => ({ runId, workflow: "coding-loop", startKey: null, actor: null, ...fields });

const opt = (label: string, skill: string, args = "") => ({ label, command: `ml-workflow:${skill}`, args });
const act = (runId: string, label: string, action: string) => opt(label, "act", `${runId} ${action}`);
const tail = (runId: string) => [opt("View", "status", runId), opt("Cancel", "cancel", runId)];

const NO_WORKFLOWS = [
  { key: "start", label: "Start a workflow", options: [opt("Start a bundled example", "start")] },
  { key: "author", label: "Write or change a workflow", options: [opt("Write a new workflow", "author")] },
];

test("each run is a row of what it needs, newest first, then starting and writing a workflow", () => {
  listed([
    row("run_a", { startKey: "coding-loop-11111111", nodeId: "approve", needs: "signal", since: ago(2 * 60 * MIN) }),
    row("run_b", { startKey: "coding-loop-22222222", nodeId: "test", needs: "stuck", since: ago(40_000) }),
    row("run_c", { startKey: "coding-loop-33333333", nodeId: "implement", needs: "working", since: ago(14 * MIN) }),
  ]);
  status("run_b", { intervention: { nodeId: "test", reason: "stuck", attempt: "3", maxAttempts: "3" } });
  status("run_c", { running: { attempt: "2", maxAttempts: "3", state: "queued" } });
  const { exitCode, report } = menu();
  expect(exitCode).toBe(0);
  expect(report).toEqual({
    db,
    rows: [
      { key: "run:run_a", label: "coding-loop-11111111 at approve, waiting for your decision for 2 h", options: [act("run_a", "Decide", "decide"), ...tail("run_a")] },
      {
        key: "run:run_b",
        label: "coding-loop-22222222 at test, stuck after attempt 3 of 3 for 40 s",
        options: [act("run_b", "Retry", "retry"), act("run_b", "Mark done", "done"), act("run_b", "Fail", "fail"), ...tail("run_b")],
      },
      { key: "run:run_c", label: "coding-loop-33333333 at implement, attempt 2 of 3, paused 14 min ago", options: [opt("Continue", "continue", "run_c"), ...tail("run_c")] },
      ...NO_WORKFLOWS,
    ],
  });
  // The statuses run side by side, so their order is not fixed.
  expect(calls()[0]).toBe("list --unfinished --json");
  expect(calls().slice(1).sort()).toEqual(["run_a", "run_b", "run_c"].map((id) => `status ${id} --json --no-probe --db ${db}`));
});

test("a step held by the plugin's pane opens the pane; another holder shows its lease", () => {
  listed([
    row("run_d", { startKey: "coding-loop-44444444", nodeId: "implement", needs: "held", since: ago(5 * MIN) }),
    row("run_e", { startKey: "deploy-55555555", nodeId: "deploy", needs: "held", actor: "ci", since: ago(MIN) }),
    row("run_f", { startKey: "deploy-66666666", nodeId: "deploy", needs: "held", actor: "ci", since: ago(30 * MIN) }),
  ]);
  status("run_d", { step: { kind: "command", actor: null, state: "held", holder: { herdrAgent: "sp-implement-0a1b2c3d4e" }, deadlineMs: String(NOW + 60 * MIN) } });
  status("run_e", { step: { kind: "external", actor: "ci", state: "held", holder: { worker: "w1" }, deadlineMs: String(NOW + 3 * MIN + 30_000) } });
  status("run_f", { step: { kind: "external", actor: "ci", state: "held", holder: { worker: "w1" }, deadlineMs: String(NOW - 2 * MIN - 30_000) } });
  const rows = menu().report.rows;
  expect(rows.slice(0, 3)).toEqual([
    {
      key: "run:run_d",
      label: "coding-loop-44444444 at implement, held by its pane (sp-implement-0a1b2c3d4e) for 5 min",
      options: [act("run_d", "Open its pane", "pane"), opt("Continue", "continue", "run_d"), act("run_d", "Abandon", "abandon"), ...tail("run_d")],
    },
    { key: "run:run_e", label: "deploy-55555555 at deploy, held by ci for 1 min, its lease ends in 3 min", options: [opt("Continue", "continue", "run_e"), act("run_e", "Abandon", "abandon"), ...tail("run_e")] },
    { key: "run:run_f", label: "deploy-66666666 at deploy, held by ci for 30 min, its lease ended 2 min ago", options: [opt("Continue", "continue", "run_f"), act("run_f", "Abandon", "abandon"), ...tail("run_f")] },
  ]);
});

test("a step for its actor to claim shows the step; a quarantine names its code and offers the release", () => {
  listed([
    row("run_g", { startKey: "review-77777777", nodeId: "review", needs: "external-ready", actor: "person", since: ago(3 * 24 * 60 * MIN) }),
    row("run_h", { startKey: "coding-loop-88888888", nodeId: "test", needs: "quarantined", since: ago(MIN) }),
    row("run_i", { startKey: "coding-loop-99999999", nodeId: "test", needs: "capability-missing", since: ago(MIN) }),
    row("run_j", { nodeId: null, needs: "working", since: ago(MIN) }),
  ]);
  status("run_h", { quarantine: { code: "lease.lost-twice", details: {} } });
  expect(menu().report.rows.slice(0, 4)).toEqual([
    { key: "run:run_g", label: "review-77777777 at review, waiting for person to claim it for 3 d", options: [act("run_g", "Show the step", "show"), ...tail("run_g")] },
    { key: "run:run_h", label: "coding-loop-88888888 at test, quarantined for 1 min: lease.lost-twice", options: [act("run_h", "Release", "release"), ...tail("run_h")] },
    { key: "run:run_i", label: "coding-loop-99999999 at test, at a step this spore cannot run for 1 min", options: [opt("Continue", "continue", "run_i"), ...tail("run_i")] },
    { key: "run:run_j", label: "run_j, not started yet, created 1 min ago", options: [opt("Continue", "continue", "run_j"), ...tail("run_j")] },
  ]);
});

test("the project's workflows by graph id start; with one, a workflow can be changed", () => {
  listed([]);
  workflow("coding-loop", '// The reference loop.\ndigraph "coding-loop" {\n  start -> done\n}\n');
  workflow("folder-name", "/* digraph wrong { } */\ndigraph review_flow {\n}\n");
  workflow("broken", "not a graph\n");
  mkdirSync(join(project, ".spore", "workflows", "empty"));
  expect(menu().report.rows).toEqual([
    { key: "start", label: "Start a workflow", options: [opt("coding-loop", "start", "coding-loop"), opt("review_flow", "start", "review_flow")] },
    { key: "author", label: "Write or change a workflow", options: [opt("Write a new workflow", "author"), opt("Change a workflow", "author", "--change")] },
  ]);
});

test("the workflows are found from a folder below the project, as spore finds its database", () => {
  workflow("coding-loop", 'digraph "coding-loop" {}\n');
  mkdirSync(join(project, "src", "deep"), { recursive: true });
  // spore cannot list here, so the folder comes from walking up.
  const { report } = menu(["--json"], { cwd: join(project, "src", "deep") });
  expect(report.rows.map((r: { key: string }) => r.key)).toEqual(["spore", "start", "author"]);
  expect(report.rows[1].options).toEqual([opt("coding-loop", "start", "coding-loop")]);
});

test("a spore that cannot list gives a row to check it, and the rest still shows", () => {
  expect(menu().report).toEqual({ db: null, rows: [{ key: "spore", label: "spore could not list the runs", options: [opt("Check spore", "status")] }, ...NO_WORKFLOWS] });
  const missing = menu(["--json"], { env: { PATH: pathOf() } });
  expect(missing.exitCode).toBe(0);
  expect(missing.report.rows[0].key).toBe("spore");
});

test("a Claude that spore started for a step asks spore nothing", () => {
  listed([row("run_k", { nodeId: "implement", needs: "held", since: ago(MIN) })]);
  expect(menu(["--json"], { env: { RUNSPORE_RUN_ID: "run_k" } }).report).toEqual({ db: null, rows: NO_WORKFLOWS });
  expect(calls()).toEqual([]);
});

test("without --json each row and its options are printed with their commands", () => {
  listed([row("run_l", { startKey: "coding-loop-12121212", nodeId: "approve", needs: "signal", since: ago(2 * 60 * MIN) })]);
  expect(menu([])).toMatchObject({
    exitCode: 0,
    stderr: "",
    stdout: [
      "coding-loop-12121212 at approve, waiting for your decision for 2 h",
      "  Decide: /ml-workflow:act run_l decide",
      "  View: /ml-workflow:status run_l",
      "  Cancel: /ml-workflow:cancel run_l",
      "Start a workflow",
      "  Start a bundled example: /ml-workflow:start",
      "Write or change a workflow",
      "  Write a new workflow: /ml-workflow:author",
      "",
    ].join("\n"),
  });
});

test("every command a row hands to is a sub-skill, and every act action one act takes", () => {
  const needs = ["signal", "stuck", "held", "external-ready", "working", "quarantined", "capability-missing"];
  listed(needs.map((need, i) => row(`run_${i}`, { nodeId: "n", needs: need, since: ago(MIN) })));
  status(`run_${needs.indexOf("held")}`, { step: { holder: { herdrAgent: "sp-n-0a1b2c3d4e" } } });
  workflow("coding-loop", 'digraph "coding-loop" {}\n');
  const options = menu().report.rows.flatMap((r: { options: { command: string; args: string }[] }) => r.options);
  const skills = join(import.meta.dir, "..", "skills");
  for (const { command } of options) expect(existsSync(join(skills, command.replace(/^ml-workflow:/, ""), "SKILL.md"))).toBe(true);
  const hint = /argument-hint: "<runId> ([a-z|]+)"/.exec(readFileSync(join(skills, "act", "SKILL.md"), "utf8"))![1]!.split("|");
  const acts = options.filter((o: { command: string }) => o.command === "ml-workflow:act").map((o: { args: string }) => o.args.split(" ")[1]);
  expect([...new Set(acts)].sort()).toEqual([...hint].sort());
});

test("an unknown flag is a usage error", () => {
  expect(menu(["--all"])).toMatchObject({ exitCode: 2, stdout: "", stderr: "usage: claude-spore menu [--json]\n" });
});
