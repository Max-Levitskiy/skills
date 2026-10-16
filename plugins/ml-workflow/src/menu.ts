// `claude-spore menu`: the rows of the menu pane (docs/spec.md, p.11). The unfinished runs with what
// each needs, the workflows to start, and writing or changing one; each option names the sub-skill
// it hands to, so the mod only draws the rows and runs the picked command.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { describe, duration, unfinishedRuns, type Run } from "./unfinished.ts";

const USAGE = "usage: claude-spore menu [--json]";

export type Option = { label: string; command: string; args: string };
export type MenuRow = { key: string; label: string; options: Option[] };

export async function menu(argv: string[]): Promise<number> {
  const json = argv.length === 1 && argv[0] === "--json";
  if (argv.length > 0 && !json) {
    console.error(USAGE);
    return 2;
  }
  const { db, runs } = await unfinishedRuns();
  const now = Date.now();
  const rows: MenuRow[] = (runs ?? []).map((run) => runRow(run, now));
  if (!runs) rows.push({ key: "spore", label: "spore could not list the runs", options: [option("Check spore", "status")] });
  const workflows = graphIds(workflowsFolder(db));
  rows.push({
    key: "start",
    label: "Start a workflow",
    options: workflows.length ? workflows.map((id) => option(id, "start", id)) : [option("Start a bundled example", "start")],
  });
  rows.push({
    key: "author",
    label: "Write or change a workflow",
    options: [option("Write a new workflow", "author"), ...(workflows.length ? [option("Change a workflow", "author", "--change")] : [])],
  });

  if (json) console.log(JSON.stringify({ db, rows }));
  else {
    for (const row of rows) {
      console.log(row.label);
      for (const { label, command, args } of row.options) console.log(`  ${label}: /${command}${args ? ` ${args}` : ""}`);
    }
  }
  return 0;
}

function option(label: string, skill: string, args = ""): Option {
  return { label, command: `ml-workflow:${skill}`, args };
}

function runRow({ row, status }: Run, now: number): MenuRow {
  const id = row.runId;
  const act = (label: string, action: string) => option(label, "act", `${id} ${action}`);
  const go = option("Continue", "continue", id);
  let label = describe(row, status, now);
  let options: Option[];
  switch (row.nodeId ? row.needs : "working") {
    case "signal":
      options = [act("Decide", "decide")];
      break;
    case "stuck":
      options = [act("Retry", "retry"), act("Mark done", "done"), act("Fail", "fail")];
      break;
    case "held": {
      const deadline = Number(status?.step?.deadlineMs);
      const isPane = Boolean(status?.step?.holder?.herdrAgent);
      if (!isPane && status?.step?.deadlineMs != null && Number.isFinite(deadline)) {
        label += deadline > now ? `, its lease ends in ${duration(deadline - now)}` : `, its lease ended ${duration(now - deadline)} ago`;
      }
      options = isPane ? [act("Open its pane", "pane"), go, act("Abandon", "abandon")] : [go, act("Abandon", "abandon")];
      break;
    }
    case "external-ready":
      options = [act("Show the step", "show")];
      break;
    case "quarantined":
      if (status?.quarantine?.code) label += `: ${status.quarantine.code}`;
      options = [act("Release", "release")];
      break;
    default:
      options = [go];
  }
  // The mod opens the live view (p.24) itself for View; typed, the view sub-skill does.
  return { key: `run:${id}`, label, options: [...options, option("View", "view", id), option("Cancel", "cancel", id)] };
}

/** `.spore/workflows/` beside the database spore names, else in the nearest `.spore/` from here. */
function workflowsFolder(db: string | null): string | null {
  if (db && basename(dirname(db)) === ".spore") return join(dirname(db), "workflows");
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".spore"))) return join(dir, ".spore", "workflows");
    if (dirname(dir) === dir) return null;
  }
}

/** The graph id of each workflow folder, sorted; a folder without one is left out. */
function graphIds(folder: string | null): string[] {
  if (!folder || !existsSync(folder)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const id = graphId(readFileSync(join(folder, entry.name, "workflow.dot"), "utf8"));
      if (id) ids.push(id);
    } catch {}
  }
  return ids.sort();
}

// `digraph "coding-loop" {` or `digraph coding_loop {`, after any comments.
function graphId(dot: string): string | null {
  const code = dot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|#).*$/gm, "");
  const match = /\bdigraph\s+(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*))\s*\{/.exec(code);
  return match ? (match[1] ?? match[2])! : null;
}
