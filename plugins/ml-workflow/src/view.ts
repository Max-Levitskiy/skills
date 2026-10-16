// `claude-spore line`, `view` and `draw`: the run line and the live view (docs/spec.md, p.24).
// Everything the mod shows of a followed run is worked out here from `spore status --no-probe` and
// the files the run's artifact pins; the mod polls these and draws what they print.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./doctor.ts";
import { display, dots, layout, picture, plainText, pngSize, tree, writeWhole, type Arrow, type Graph } from "./drawing.ts";
import { duration } from "./unfinished.ts";

// Each spore call is cut off here: the mod polls once a second.
const LIMIT_MS = 4000;

const USAGE = {
  line: "usage: claude-spore line <runId> [--db <db>] [--json]",
  view: "usage: claude-spore view <runId> [--db <db>] [--json]",
  draw: "usage: claude-spore draw --run <runId> [--db <db>] [--at <node>] [--from <node>:<outcome>] (--png <file> | --plain)",
};

type Tries = { attempt?: string | number | null; maxAttempts?: string | number | null } | null;
// What the run waits for, each with how long it has stood so (`forMs`).
type Standing = { forMs?: string | number | null; state?: string | null } | null;
type Status = {
  runId: string;
  db?: string | null;
  startKey?: string | null;
  status?: string;
  artifactDigest?: string | null;
  position?: { nodeId?: string | null; visit?: string | number | null; from?: { nodeId: string; outcome: string } | null } | null;
  end?: { nodeId?: string | null; from?: { nodeId: string; outcome: string } | null } | null;
  invocation?: Tries;
  streaks?: Record<string, { outcome: string; count: string | number; limit?: string | number | null }> | null;
  waiting?: Standing;
  intervention?: Standing;
  running?: Standing;
  quarantine?: { code?: string | null } | null;
  step?: { state?: string | null; actor?: string | null } | null;
};

export type Line = { runId: string; db: string | null; name: string; text: string; shorter: string[]; needsYou: boolean; ended: boolean };
type Failure = { runId: string; db: null; error: { code: string; message: string } };
type Marked = { n: number; text: string; mark: "here" | "taken" | null };

const ENDED = new Set(["completed", "failed", "cancelled"]);

export async function line(argv: string[]): Promise<number> {
  const args = parse(argv, ["--db"], ["--json"]);
  if (!args || args.rest.length !== 1) return usage("line");
  const status = await readStatus(args.rest[0]!, args.values["--db"]);
  if ("error" in status) return failed(status, args.flags.has("--json"));
  const shown = lineOf(status);
  if (args.flags.has("--json")) console.log(JSON.stringify(shown));
  else console.log((shown.needsYou ? "needs you  " : "") + shown.text);
  return 0;
}

export async function view(argv: string[]): Promise<number> {
  const args = parse(argv, ["--db"], ["--json"]);
  if (!args || args.rest.length !== 1) return usage("view");
  const status = await readStatus(args.rest[0]!, args.values["--db"]);
  if ("error" in status) return failed(status, args.flags.has("--json"));
  const json = args.flags.has("--json");
  const files = new Files(status);
  const shown = lineOf(status);
  const { here, taken } = moment(status);
  const source = await files.read("workflow.dot");
  const settings = await files.read("settings.json");
  if (source === null || settings === null) return failed(files.failure("workflow.dot or settings.json"), json);
  let graph: Graph;
  try {
    graph = await display(source, here, taken);
  } catch (error) {
    return failed({ runId: status.runId, db: null, error: { code: "draw.unreadable", message: String(error) } }, json);
  }
  const drawing = dots(await files.layout(source), graph, here, taken);
  const pictured = await files.picture(graph, here, taken);
  const instructionsPath = here ? instructionsOf(settings, here) : null;
  const text = instructionsPath ? await files.read(instructionsPath) : null;
  const result = {
    runId: status.runId,
    db: status.db ?? null,
    line: shown,
    facts: factsOf(status),
    picture: pictured,
    dots: drawing,
    tree: tree(graph, here, taken),
    dot: dotLines(source, here, taken),
    settings: here ? settingsLines(settings, here) : [],
    instructions: instructionsPath && text !== null ? { file: instructionsPath, head: text.split("\n").filter((l) => l.trim()).slice(0, 3), text } : null,
  };
  if (json) {
    console.log(JSON.stringify(result));
    return 0;
  }
  const out = [result.facts + (shown.needsYou ? ", needs you" : ""), "", plainText(drawing), "", "workflow.dot", ...numbered(result.dot)];
  if (result.settings.length) out.push("", "settings.json", ...numbered(result.settings));
  if (result.instructions) out.push("", result.instructions.file, ...result.instructions.head);
  console.log(out.join("\n"));
  return 0;
}

export async function draw(argv: string[]): Promise<number> {
  const args = parse(argv, ["--run", "--db", "--at", "--from", "--png"], ["--plain"]);
  const png = args?.values["--png"];
  if (!args || args.rest.length || !args.values["--run"] || (png === undefined) === !args.flags.has("--plain")) return usage("draw");
  const fromFlag = args.values["--from"];
  const arrow = fromFlag === undefined ? undefined : /^([^:]+):([^:]+)$/.exec(fromFlag);
  if (arrow === null) return usage("draw");
  const status = await readStatus(args.values["--run"], args.values["--db"]);
  if ("error" in status) return failed(status, false);
  const files = new Files(status);
  const source = await files.read("workflow.dot");
  if (source === null) return failed(files.failure("workflow.dot"), false);
  const at = args.values["--at"];
  let { here, taken } = moment(status);
  if (at !== undefined || arrow !== undefined) {
    here = at ?? here;
    taken = arrow ? { from: arrow[1]!, outcome: arrow[2]! } : null;
  }
  let graph: Graph;
  try {
    graph = await display(source, here, taken);
  } catch (error) {
    console.error(`draw: Graphviz cannot read the run's workflow.dot: ${String(error)}`);
    return 1;
  }
  if (here && !graph.nodes.includes(here)) {
    console.error(`draw: the run's workflow has no node ${here}`);
    return 1;
  }
  if (png === undefined) {
    console.log(plainText(dots(await files.layout(source), graph, here, taken)));
    return 0;
  }
  const pictured = await files.picture(graph, here, taken);
  if (!pictured) {
    console.error(`draw: no font to draw the labels with; looked for ${fontList()}`);
    return 1;
  }
  copyFileSync(pictured.file, png);
  return 0;
}

/**
 * The run line's words (docs/spec.md, p.24): where the run is and for how long first, as
 * `kubectl get pods` leads with STATUS and AGE. `shorter` is the same line with the arrow cut down,
 * then without it, for a band too narrow for the whole line.
 */
export function lineOf(status: Status): Line {
  const key = status.startKey || status.runId;
  const ended = ENDED.has(status.status ?? "");
  let parts: [string, Arrow | null, string];
  if (status.status === "completed" || status.status === "failed") {
    const node = status.end?.nodeId;
    parts = node ? [`${key} ${status.status} at ${node}`, arrowOf(status.end?.from), ""] : [`${key} ${status.status}`, null, ""];
  } else if (status.status === "cancelled") {
    const node = status.position?.nodeId;
    parts = [node ? `${key} cancelled at ${node}` : `${key} cancelled`, null, ""];
  } else if (status.position?.nodeId) {
    const visit = Number(status.position.visit);
    const again = Number.isInteger(visit) && visit > 1 ? `, visit ${visit}` : "";
    parts = [`${key} at ${status.position.nodeId}${standingText(status)}${again}`, arrowOf(status.position.from), `${triesText(status.invocation)}${streaksText(status)}`];
  } else {
    parts = [`${key}, not started yet`, null, ""];
  }
  const [head, arrow, tail] = parts;
  const text = `${head}${arrow ? `, from ${arrow.from} on ${arrow.outcome}` : ""}${tail}`;
  const shorter = arrow ? [`${head}, from ${arrow.from}:${arrow.outcome}${tail}`, `${head}${tail}`] : [];
  const step = status.step;
  const needsYou = !ended && Boolean(status.waiting || status.intervention || status.quarantine || (step?.state === "ready" && step.actor === "person"));
  return { runId: status.runId, db: status.db ?? null, name: key, text, shorter, needsYou, ended };
}

// ` for 13 min`: how long the run has stood as it is at its node, from what it waits for. A try in
// backoff is not due yet, so it has no time to show.
function standingText(status: Status): string {
  const standing = status.waiting ?? status.intervention ?? status.running;
  const ms = Number(standing?.forMs);
  if (!standing || standing.state === "backoff" || standing.forMs == null || !Number.isFinite(ms)) return "";
  return ` for ${duration(ms)}`;
}

function arrowOf(from: { nodeId: string; outcome: string } | null | undefined): Arrow | null {
  return from?.nodeId ? { from: from.nodeId, outcome: from.outcome } : null;
}

// The live view's facts line: status, node, visit, try and loop count.
function factsOf(status: Status): string {
  const node = status.position?.nodeId ?? status.end?.nodeId;
  const quarantined = status.quarantine ? `, quarantined${status.quarantine.code ? `: ${status.quarantine.code}` : ""}` : "";
  if (!node) return `${status.status ?? "unknown"}${quarantined}`;
  return `${status.status}${quarantined}, at ${node}${visitText(status)}${triesText(status.invocation)}${streaksText(status)}`;
}

function visitText(status: Status): string {
  const visit = Number(status.position?.visit);
  return status.position?.nodeId && Number.isInteger(visit) && visit > 0 ? `, visit ${visit}` : "";
}

// `try 2/3`, or past the action's limit after a person's retry, `try 4 (past the limit of 3)`.
function triesText(tries: Tries | undefined): string {
  const n = Number(tries?.attempt);
  const of = Number(tries?.maxAttempts);
  if (!Number.isInteger(n) || n < 1) return "";
  if (!Number.isInteger(of) || of < 1) return `, try ${n}`;
  return n <= of ? `, try ${n}/${of}` : `, try ${n} (past the limit of ${of})`;
}

function streaksText(status: Status): string {
  return Object.keys(status.streaks ?? {})
    .sort()
    .map((node) => {
      const { outcome, count, limit } = status.streaks![node]!;
      return `, ${outcome} ${count}${limit != null ? `/${limit}` : ""} in a row`;
    })
    .join("");
}

/** The node to light and the arrow into it: where the run is, else where it ended. */
function moment(status: Status): { here: string | null; taken: Arrow | null } {
  const at = status.position?.nodeId ? status.position : status.end;
  const from = at?.from;
  return { here: at?.nodeId ?? null, taken: from?.nodeId ? { from: from.nodeId, outcome: from.outcome } : null };
}

// ---------- the files beside the drawing ----------

const ID = String.raw`(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.]+))`;

/** `workflow.dot` line by line, the current node's statements and the arrow just taken marked. */
export function dotLines(source: string, here: string | null, taken: Arrow | null): Marked[] {
  const nodeStatement = new RegExp(String.raw`^\s*${ID}\s*(\[|;|$)`);
  const chain = new RegExp(String.raw`^\s*${ID}((?:\s*->\s*${ID})+)\s*(\[.*)?`);
  const idIn = new RegExp(ID, "g");
  return source.replace(/\n$/, "").split("\n").map((text, i) => {
    const line = text.replace(/^\s*(\/\/|#).*$/, "");
    let mark: Marked["mark"] = null;
    const node = nodeStatement.exec(line);
    const edge = chain.exec(line);
    if (edge && taken && here) {
      const ids = [...line.slice(0, line.indexOf("[") >= 0 ? line.indexOf("[") : undefined).matchAll(idIn)].map((m) => m[1] ?? m[2]);
      const on = /\bon\s*=\s*"?([A-Za-z0-9-]+)"?/.exec(edge[edge.length - 1] ?? "")?.[1] ?? "ok";
      for (let k = 0; k + 1 < ids.length; k++) if (ids[k] === taken.from && ids[k + 1] === here && on === taken.outcome) mark = "taken";
    } else if (node && here && (node[1] ?? node[2]) === here && !/^(graph|node|edge|digraph)$/i.test(node[2] ?? "")) {
      mark = "here";
    }
    return { n: i + 1, text, mark };
  });
}

/** The lines of `settings.json` holding the node's action under `actions`, then the node itself. */
export function settingsLines(settings: string, here: string): Marked[] {
  let action: unknown;
  try {
    action = JSON.parse(settings)?.nodes?.[here]?.action;
  } catch {
    return [];
  }
  const all = settings.split("\n");
  const lineAt = (offset: number) => settings.slice(0, offset).split("\n").length - 1;
  const out: Marked[] = [];
  const add = (span: [number, number] | null, markFirst: boolean) => {
    if (!span) return;
    const [first, last] = [lineAt(span[0]), lineAt(span[1])];
    for (let k = first; k <= last; k++) out.push({ n: k + 1, text: all[k]!, mark: markFirst && k === first ? "here" : null });
  };
  if (typeof action === "string") add(memberSpan(settings, ["actions", action]), false);
  add(memberSpan(settings, ["nodes", here]), true);
  return out;
}

function instructionsOf(settings: string, here: string): string | null {
  try {
    const path = JSON.parse(settings)?.nodes?.[here]?.instructions;
    return typeof path === "string" ? path : null;
  } catch {
    return null;
  }
}

/** Where a member of a JSON text starts (its key) and ends (its value), by its path of keys. */
function memberSpan(text: string, path: string[]): [number, number] | null {
  let i = 0;
  let found: [number, number] | null = null;
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const string = (): string => {
    const start = i;
    for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = (at: string[]) => {
    space();
    const c = text[i];
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      space();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        space();
        if (c === "{") {
          const keyAt = i;
          const key = string();
          space();
          i++; // the colon
          const inner = [...at, key];
          value(inner);
          if (!found && inner.length === path.length && inner.every((k, n) => k === path[n])) found = [keyAt, i - 1];
        } else {
          value(at);
        }
        space();
        if (text[i++] !== ",") return;
      }
    }
    if (c === '"') {
      string();
      return;
    }
    while (i < text.length && !/[,\]}\s]/.test(text[i]!)) i++;
  };
  try {
    value([]);
  } catch {
    return null;
  }
  return found;
}

function numbered(lines: Marked[]): string[] {
  return lines.map(({ n, text, mark }) => `${mark === "here" ? ">" : mark === "taken" ? "*" : " "} ${String(n).padStart(3)}  ${text}`);
}

// ---------- spore, and what is kept of each artifact ----------

/** The files a run's artifact pins, read through spore once and kept in the plugin's data folder. */
class Files {
  private readonly folder: string | null;
  private missing: string | null = null;

  constructor(private readonly status: Status) {
    const digest = /^sha256:([0-9a-f]{64})$/.exec(status.artifactDigest ?? "")?.[1];
    this.folder = digest ? join(dataDir(), "artifacts", digest) : null;
  }

  async read(path: string): Promise<string | null> {
    const kept = this.folder && !path.split("/").includes("..") ? join(this.folder, "files", path) : null;
    if (kept && existsSync(kept)) return readFileSync(kept, "utf8");
    const args = ["inspect", "--run", this.status.runId, "--file", path, ...(this.status.db ? ["--db", this.status.db] : [])];
    const ran = await spore(args);
    if (ran.code !== 0) {
      this.missing = ran.stderr.trim().split("\n")[0] || `spore inspect exited ${ran.code}`;
      return null;
    }
    if (kept) writeWhole(kept, ran.stdout);
    return ran.stdout;
  }

  failure(what: string): Failure {
    return { runId: this.status.runId, db: null, error: { code: "artifact.unreadable", message: this.missing ?? `the run's ${what} could not be read` } };
  }

  /** Graphviz's layout of the display DOT, the same for every moment of the artifact. */
  async layout(source: string): Promise<string> {
    const kept = this.folder && join(this.folder, "layout.plain");
    if (kept && existsSync(kept)) return readFileSync(kept, "utf8");
    const plain = await layout((await display(source, null, null, true)).dot);
    if (kept) writeWhole(kept, plain);
    return plain;
  }

  /** The moment's picture, drawn once and kept; null with no font. */
  async picture(graph: Graph, here: string | null, taken: Arrow | null): Promise<{ file: string; width: number; height: number } | null> {
    const name = `${here ?? "_"}${taken ? `@${taken.from}.${taken.outcome}` : ""}`.replace(/[^A-Za-z0-9_.@-]/g, "_");
    const file = join(this.folder ?? join(dataDir(), "artifacts", "unpinned", this.status.runId), `${name}.png`);
    if (!existsSync(file)) {
      const png = await picture(graph.dot);
      if (!png) return null;
      writeWhole(file, png);
    }
    return { file, ...pngSize(readFileSync(file)) };
  }
}

async function readStatus(runId: string, db: string | undefined): Promise<Status | Failure> {
  const ran = await spore(["status", runId, "--json", "--no-probe", ...(db ? ["--db", db] : [])]);
  let answer: any;
  try {
    answer = JSON.parse(ran.stdout);
  } catch {}
  if (ran.code === 0 && answer?.runId) return answer as Status;
  const error = answer?.error;
  if (error?.code) return { runId, db: null, error: { code: String(error.code), message: String(error.message ?? "") } };
  const message = ran.stderr.trim().split("\n")[0] || (ran.code === null ? "spore is not on PATH" : `spore status exited ${ran.code}`);
  return { runId, db: null, error: { code: "spore.unavailable", message } };
}

function failed(failure: Failure, json: boolean): number {
  if (json) console.log(JSON.stringify(failure));
  else console.error(`${failure.error.code}: ${failure.error.message}`);
  return 1;
}

async function spore(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const path = Bun.which("spore");
  if (!path) return { code: null, stdout: "", stderr: "" };
  try {
    const child = Bun.spawn([path, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: LIMIT_MS });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: null, stdout: "", stderr: String(error) };
  }
}

function fontList(): string {
  const env = process.env.CLAUDE_SPORE_FONTS;
  return env === undefined ? "Helvetica or Arial (macOS), DejaVu Sans, Liberation Sans or Noto Sans (under /usr/share/fonts)" : env || "no font files (CLAUDE_SPORE_FONTS is empty)";
}

type Parsed = { values: Record<string, string>; flags: Set<string>; rest: string[] };

function parse(argv: string[], valued: string[], flags: string[]): Parsed | null {
  const out: Parsed = { values: {}, flags: new Set(), rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (valued.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || arg in out.values) return null;
      out.values[arg] = value;
    } else if (flags.includes(arg)) out.flags.add(arg);
    else if (arg.startsWith("-")) return null;
    else out.rest.push(arg);
  }
  return out;
}

function usage(command: keyof typeof USAGE): number {
  console.error(USAGE[command]);
  return 2;
}
