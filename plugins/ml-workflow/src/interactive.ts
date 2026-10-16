// `claude-spore start|probe|watch|report|stop|close-after`, the interactive Claude step (docs/spec.md, p.17).
// It runs as a spore async command: `start` opens Claude in a herdr pane and prints the holder
// handle, Claude hands its answer to `report` from the pane, and the watch prints that answer.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { cameBackMessage, claudeFlags, cutOffMessage, readInstructions, readParams, startMessage, stepNumbers } from "./claude.ts";
import { misfits, printErrors } from "./fit.ts";
import { closePane, getAgent, openPane, prompt, startClaude, type Agent } from "./herdr.ts";
import type { StepParams } from "./params.ts";
import { bootId, machine, sessionProcess, startTime } from "./proc.ts";
import { fractionAt, isObject } from "./schema.ts";
import { sessionId } from "./session.ts";

type Handle = {
  herdrAgent: string | null;
  session: string;
  pid: number | null;
  started: string | null;
  boot: string | null;
  machine: string;
};

/**
 * `pane.json`: the handle, the pane, the attempt whose report command the pane was given, the
 * message not yet sent to it, without its report command, and how often it was typed without landing.
 */
type PaneRecord = { handle: Handle; pane: string; attempt: number; unsent?: string; lost?: number };

type Failure = { error: { code: string; message: string }; retryable: false };

const BAD_ANSWERS = 3;

// Spore's result limit is 64 KiB; the rest is room for the result's own keys.
const RESULT_LIMIT = 63 * 1024;

const PROCESS_WAIT_MS = 10_000;

// How long `start` tries again to start Claude in a pane whose shell is not at its prompt yet: the
// `--timeout` of `agent start` (`CLAUDE_SPORE_SHELL_WAIT_MS`, for the specs).
const SHELL_WAIT_MS = Number(process.env.CLAUDE_SPORE_SHELL_WAIT_MS) || 60_000;
const SHELL_RETRY_MS = 500;

// A message typed this often without landing stays unsent, and the watch tells the person, like a
// Kubernetes readiness probe's `failureThreshold`.
const SENDS = 3;

/** How long a sent message has to land (`CLAUDE_SPORE_DELIVERY_WAIT_MS`, for the specs). */
const deliveryWait = () => Number(process.env.CLAUDE_SPORE_DELIVERY_WAIT_MS) || 10_000;

/** How long a quiet pane with no answer waits before the watch tells the person (`CLAUDE_SPORE_IDLE_MS`). */
const idleWait = () => Number(process.env.CLAUDE_SPORE_IDLE_MS) || 60_000;

function failure(code: string, message: string): Failure {
  return { error: { code, message }, retryable: false };
}

const resultFile = (work: string, attempt: number) => join(work, `${attempt}.result.json`);

function writeJson(file: string, value: unknown) {
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** herdr's name for the agent of one run and node: `[a-z][a-z0-9_-]{0,31}`, unique per session. */
export function agentName(node: string, session: string): string {
  const slug = node.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 16);
  return `sp-${slug}-${session.replaceAll("-", "").slice(0, 10)}`;
}

/** Claude's transcript of `session`, in any project folder, or null. */
function transcript(session: string): string | null {
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  let folders: string[];
  try {
    folders = readdirSync(projects);
  } catch {
    return null;
  }
  const folder = folders.find((f) => existsSync(join(projects, f, `${session}.jsonl`)));
  return folder === undefined ? null : join(projects, folder, `${session}.jsonl`);
}

/**
 * The user entries of `session`'s transcript, leaving out Claude Code's own (`isMeta`). A resumed
 * Claude adds none until it takes a prompt, so a count that moves after a send means it landed.
 */
function turns(session: string): number {
  const file = transcript(session);
  if (file === null) return 0;
  let count = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (isObject(entry) && entry.type === "user" && entry.isMeta !== true) count++;
    } catch {}
  }
  return count;
}

async function until<T>(get: () => T | null, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const value = get();
    if (value !== null || Date.now() >= end) return value;
    await Bun.sleep(200);
  }
}

/**
 * Starts Claude in a new pane. herdr refuses a pane whose shell has not reached its prompt yet ("is
 * not an available shell"), so a start that never reached Claude, with no process holding the
 * session, is tried again for up to SHELL_WAIT_MS inside this try, as Kubernetes restarts a
 * container that never ran without counting it against `backoffLimit`.
 */
async function startInPane(name: string, pane: string, args: string[], session: string) {
  const end = Date.now() + SHELL_WAIT_MS;
  for (;;) {
    try {
      startClaude(name, pane, args);
      return;
    } catch (error) {
      if (Date.now() >= end || sessionProcess(session) !== null) throw error;
    }
    await Bun.sleep(SHELL_RETRY_MS);
  }
}

/** How Claude hands in its answer for `attempt`, and the shape each outcome takes. */
function reportEnding(params: StepParams, attempt: number): string {
  const command = (outcome: string, answer: string) =>
    `    claude-spore report --attempt ${attempt} --outcome ${outcome} <<'ANSWER'\n    ${answer}\n    ANSWER`;
  if (params.format === "text") {
    return [
      "When you have finished, hand in your reply as plain text with this command:",
      command(params.outcome, "<your reply>"),
      `It prints "accepted" when the step has your reply.`,
    ].join("\n\n");
  }
  const outcomes = Object.entries(params.schema).map(([o, schema]) => `- \`${o}\`: ${JSON.stringify(schema)}`);
  return [
    "When you have finished, hand in your answer with this command, the answer on stdin:",
    command("<outcome>", "<answer>"),
    `The outcomes, each with the JSON its answer must fit:\n\n${outcomes.join("\n")}`,
    `It prints "accepted", or what does not fit, one error per line: fix the answer and run the command again. After ${BAD_ANSWERS} answers that do not fit, the step fails.`,
  ].join("\n\n");
}

/**
 * Sends the record's unsent message, with its attempt's report command, once the agent is ready for
 * it, and waits until it lands. Ready is `idle` or `done`: a prompt typed while Claude works is lost,
 * and Claude can report before its turn ends; one typed while it asks a question would answer that
 * question. A Claude that herdr shows ready can still be drawing a resumed conversation and drop the
 * prompt, so the message leaves `pane.json` only once Claude turns `working` or its transcript gains
 * a turn; otherwise it stays, counted in `lost`. Returns the record as it now is.
 */
async function deliver(work: string, record: PaneRecord, params: StepParams): Promise<PaneRecord> {
  if (record.unsent === undefined || (record.lost ?? 0) >= SENDS) return record;
  const name = record.handle.herdrAgent!;
  const status = getAgent(name)?.status;
  if (status !== "idle" && status !== "done") return record;
  const session = record.handle.session;
  const before = turns(session);
  prompt(name, `${record.unsent}\n\n${reportEnding(params, record.attempt)}`);
  const working = () => {
    try {
      return getAgent(name)?.status === "working";
    } catch {
      return false;
    }
  };
  const landed = await until(() => (turns(session) > before || working() ? true : null), deliveryWait());
  const { unsent: _, lost: __, ...sent } = record;
  const next = landed ? sent : { ...record, lost: (record.lost ?? 0) + 1 };
  writeJson(join(work, "pane.json"), next);
  return next;
}

/** Delivers the record's message, typing it again while it does not land, up to `SENDS` times in all. */
async function send(work: string, record: PaneRecord, params: StepParams): Promise<PaneRecord> {
  for (let next = record; ; ) {
    const after = await deliver(work, next, params);
    // Sent, given up, or Claude not ready: the watch sends it once Claude is.
    if (after === next || after.unsent === undefined) return after;
    next = after;
  }
}

export async function start(): Promise<number> {
  const step = stepNumbers("start", ["RUNSPORE_WORK_DIR"]);
  if (!step) return 2;
  const { visit, attempt } = step;
  const work = process.env.RUNSPORE_WORK_DIR!;
  const node = process.env.RUNSPORE_NODE_ID!;
  const session = sessionId(process.env.RUNSPORE_RUN_ID!, node);
  const name = agentName(node, session);
  const print = (handle: Handle) => {
    console.log(JSON.stringify(handle));
    return 0;
  };
  // A failure found here is the try's result; the watch prints it at once.
  const paneless = (result: Failure) => {
    writeJson(resultFile(work, attempt), result);
    return print({ herdrAgent: null, session, pid: null, started: null, boot: null, machine: machine() });
  };

  const params = await readParams("start");
  if (typeof params === "string") return paneless(failure("params.invalid", params));
  writeJson(join(work, "params.json"), params);

  let live: Agent | null;
  try {
    live = getAgent(name);
    if (live) {
      const record = readJson(join(work, "pane.json")) as PaneRecord | undefined;
      const { handle } = record ?? {};
      if (record && handle?.herdrAgent === name && handle.pid !== null && startTime(handle.pid) === handle.started) {
        // This invocation already has its pane: a repeated start. A message the pane never got
        // still goes, with this attempt's report command; else it is told it was cut off.
        let next = record;
        if (record.attempt !== attempt) {
          next = { handle, pane: record.pane, attempt, unsent: record.unsent ?? cutOffMessage(params, "") };
          writeJson(join(work, "pane.json"), next);
        }
        await send(work, next, params);
        return print(handle);
      }
      // An earlier visit's pane, or one whose start died before it was recorded.
      closePane(live.pane);
      if ((await until(() => (sessionProcess(session) === null ? true : null), PROCESS_WAIT_MS)) === null) {
        console.error(`claude-spore start: the Claude of session ${session} still runs after its pane was closed`);
        return 1;
      }
    }
  } catch (error) {
    console.error(`claude-spore start: herdr: ${(error as Error).message}`);
    return 1;
  }

  // The message without its report command, which `deliver` adds.
  let mode: "start" | "resume";
  let message: string;
  if (transcript(session) === null) {
    if (visit > 1) {
      return paneless(
        failure("session.lost", `the conversation of this step, ${session}, is gone (removed, or on another machine); this is visit ${visit}`),
      );
    }
    // Visit 1: the first try, or one that died before Claude made the session.
    mode = "start";
    message = startMessage(params, await readInstructions(), "");
  } else if (visit === 1 && attempt === 1) {
    return paneless(
      failure(
        "session.foreign",
        `the session for this step, ${session}, already belongs to another conversation; this run is on its first try of its first visit`,
      ),
    );
  } else {
    mode = "resume";
    message = attempt > 1 ? cutOffMessage(params, "") : cameBackMessage(params, visit, "");
  }

  const env: Record<string, string> = { RUNSPORE_WORK_DIR: work };
  if (process.env.RUNSPORE_DB) env.RUNSPORE_DB = process.env.RUNSPORE_DB;
  let pane: string | undefined;
  const give = (why: string) => {
    console.error(`claude-spore start: ${why}`);
    try {
      if (pane) closePane(pane);
    } catch {}
    return 1;
  };
  try {
    pane = openPane(name, process.cwd(), env);
    await startInPane(name, pane, claudeFlags(params, mode, session), session);
  } catch (error) {
    return give(`herdr: ${(error as Error).message}`);
  }
  const pid = await until(() => sessionProcess(session), PROCESS_WAIT_MS);
  const started = pid === null ? null : startTime(pid);
  if (pid === null || started === null) return give(`no Claude process holds session ${session} in pane ${pane}`);

  const handle: Handle = { herdrAgent: name, session, pid, started, boot: bootId(), machine: machine() };
  const record: PaneRecord = { handle, pane, attempt, unsent: message };
  writeJson(join(work, "pane.json"), record);
  try {
    if (!getAgent(name)) return give(`the agent ${name} is gone from pane ${pane}`);
    await send(work, record, params);
  } catch (error) {
    return give(`herdr: ${(error as Error).message}`);
  }
  return print(handle);
}

async function readHandle(): Promise<Handle | null> {
  let value: unknown;
  try {
    value = JSON.parse(await Bun.stdin.text());
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  const nullable = (v: unknown, type: string) => v === null || typeof v === type;
  const ok =
    nullable(value.herdrAgent, "string") &&
    typeof value.session === "string" &&
    (value.pid === null || Number.isInteger(value.pid)) &&
    nullable(value.started, "string") &&
    nullable(value.boot, "string") &&
    typeof value.machine === "string";
  return ok ? (value as Handle) : null;
}

export async function probe(): Promise<number> {
  const answer = (holder: "alive" | "dead" | "unknown") => {
    console.log(JSON.stringify({ holder }));
    return 0;
  };
  const handle = await readHandle();
  // A pane-less handle: `start` wrote the try's result itself, and the watch delivers it.
  if (!handle || handle.herdrAgent === null || handle.pid === null || handle.started === null) return answer("unknown");
  if (handle.machine !== machine()) return answer("unknown");
  const boot = bootId();
  if (boot === null || handle.boot === null) return answer("unknown");
  if (boot !== handle.boot) return answer("dead");
  return answer(startTime(handle.pid) === handle.started ? "alive" : "dead");
}

/** Copies the latest success of an earlier try in this work folder to `attempt`'s name. */
function carryOver(work: string, attempt: number) {
  if (existsSync(resultFile(work, attempt))) return;
  for (let earlier = attempt - 1; earlier >= 1; earlier--) {
    const result = readJson(resultFile(work, earlier));
    if (isObject(result) && typeof result.outcome === "string") {
      copyFileSync(resultFile(work, earlier), resultFile(work, attempt));
      return;
    }
  }
}

export async function watch(): Promise<number> {
  const step = stepNumbers("watch", ["RUNSPORE_WORK_DIR"]);
  if (!step) return 2;
  const handle = await readHandle();
  if (!handle) {
    console.error("claude-spore watch: the holder handle on stdin is not one `claude-spore start` printed");
    return 2;
  }
  const work = process.env.RUNSPORE_WORK_DIR!;
  const node = process.env.RUNSPORE_NODE_ID!;
  const file = resultFile(work, step.attempt);
  const poll = Number(process.env.CLAUDE_SPORE_WATCH_POLL_MS) || 1000;
  const result = () => (existsSync(file) ? readFileSync(file, "utf8").trim() : null);
  // What the watches of this attempt saw last: the pane `busy`, or the person `told`. It outlives a
  // watch, so the one the next `continue --wait` starts does not tell the person again.
  const seenFile = join(work, `${step.attempt}.watch`);
  let seen = existsSync(seenFile) ? readFileSync(seenFile, "utf8").trim() : "";
  const see = (state: "" | "busy" | "told") => {
    if (seen === state) return;
    if (state) writeFileSync(seenFile, `${state}\n`);
    else rmSync(seenFile, { force: true });
    seen = state;
  };
  // Since when this watch has seen the pane quiet with no answer, counted again after a message is sent.
  let quietSince: number | null = null;

  for (;;) {
    carryOver(work, step.attempt);
    if (handle.herdrAgent === null) {
      const found = result();
      if (found !== null) {
        console.log(found);
        return 0;
      }
      console.error("claude-spore watch: no pane to watch, and no result");
      return 1;
    }
    let agent: Agent | null | undefined;
    try {
      agent = getAgent(handle.herdrAgent);
    } catch {
      // herdr does not answer: keep waiting; the host stops the watch at the deadline.
    }
    if (agent !== undefined) {
      const quiet = agent === null || agent.status === "idle" || agent.status === "done";
      const found = result();
      if (found !== null && quiet) {
        // The answer moves the run past the node, so the pane is done with.
        if (agent) release(handle.herdrAgent, agent.pane, work);
        console.log(found);
        return 0;
      }
      if (agent === null) {
        console.error(`claude-spore watch: the pane of ${node} is gone, and it reported nothing`);
        return 1;
      }
      // A message `start` could not send, or that did not land, goes once Claude can take it.
      const record = readJson(join(work, "pane.json")) as PaneRecord | undefined;
      const params = readJson(join(work, "params.json")) as StepParams | undefined;
      let undelivered = false;
      if (record?.unsent !== undefined && record.attempt === step.attempt && record.handle.herdrAgent === handle.herdrAgent && params) {
        let next = record;
        try {
          next = await deliver(work, record, params);
        } catch {
          // herdr refused the prompt: try again at the next poll.
        }
        if (next.unsent === undefined) {
          // The pane has not started on the message yet: what the watches saw before no longer holds.
          see("");
          quietSince = null;
          await Bun.sleep(poll);
          continue;
        }
        undelivered = (next.lost ?? 0) >= SENDS;
      }
      quietSince = quiet ? (quietSince ?? Date.now()) : null;
      // Quiet counts once the pane was busy, or once it stayed quiet past the idle wait: a pane that
      // has not started on its message yet shows idle too, but not for long.
      const stalled = quiet && (seen === "busy" || undelivered || Date.now() - quietSince! >= idleWait());
      if (seen !== "told" && (agent.status === "blocked" || stalled)) {
        console.log(JSON.stringify({ needs: "person", message: `${node} waits for you in its pane` }));
        see("told");
      } else if (agent.status === "working") {
        see("busy");
      }
    }
    await Bun.sleep(poll);
  }
}

/**
 * Closes the pane of a step that has its answer: at once, or after the step's `keepSeconds` by a
 * detached `claude-spore close-after`, so the run need not wait. A failed close is not the step's.
 */
function release(name: string, pane: string, work: string) {
  const params = readJson(join(work, "params.json"));
  const keep = isObject(params) && typeof params.keepSeconds === "number" ? params.keepSeconds : 0;
  if (keep > 0) {
    spawn(process.execPath, [process.argv[1]!, "close-after", String(keep), name, pane], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  try {
    closePane(pane);
  } catch {}
}

/** `claude-spore close-after <seconds> <agent> <pane>`: closes the pane later, if the agent still has it. */
export async function closeAfter(args: string[]): Promise<number> {
  const [seconds, name, pane] = args;
  if (!(Number(seconds) >= 0) || !name || !pane || args.length !== 3) {
    console.error("usage: claude-spore close-after <seconds> <agent> <pane>");
    return 2;
  }
  await Bun.sleep(Number(seconds) * 1000);
  try {
    // A later visit closes this pane itself and opens its own under the same agent name.
    if (getAgent(name)?.pane === pane) closePane(pane);
    return 0;
  } catch (error) {
    console.error(`claude-spore close-after: herdr: ${(error as Error).message}`);
    return 1;
  }
}

export async function stop(): Promise<number> {
  const handle = await readHandle();
  if (!handle) {
    console.error("claude-spore stop: the holder handle on stdin is not one `claude-spore start` printed");
    return 2;
  }
  if (handle.herdrAgent === null) return 0;
  try {
    const agent = getAgent(handle.herdrAgent);
    if (agent) closePane(agent.pane);
    return 0;
  } catch (error) {
    console.error(`claude-spore stop: herdr: ${(error as Error).message}`);
    return 1;
  }
}

const REPORT_USAGE = "usage: claude-spore report --attempt <n> --outcome <outcome>, the answer on stdin";

export async function report(args: string[]): Promise<number> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = [args[i]!, args[i + 1]];
    if ((key !== "--attempt" && key !== "--outcome") || value === undefined) {
      console.error(REPORT_USAGE);
      return 2;
    }
    flags[key.slice(2)] = value;
  }
  const attempt = Number(flags.attempt ?? process.env.RUNSPORE_ATTEMPT);
  const outcome = flags.outcome;
  const work = process.env.RUNSPORE_WORK_DIR;
  if (!outcome || !(attempt >= 1 && Number.isInteger(attempt))) {
    console.error(REPORT_USAGE);
    return 2;
  }
  const params = work ? (readJson(join(work, "params.json")) as StepParams | undefined) : undefined;
  if (!work || !isObject(params)) {
    console.error(
      `claude-spore report: no params.json in ${work ?? "$RUNSPORE_WORK_DIR (not set)"}; report runs in the pane of an interactive step`,
    );
    return 2;
  }
  const file = resultFile(work, attempt);
  if (existsSync(file)) {
    console.log(`attempt ${attempt} of this step already has its answer; nothing was written`);
    return 1;
  }

  const text = await Bun.stdin.text();
  const errors: string[] = [];
  let output: unknown = null;
  if (params.format === "text") {
    if (outcome !== params.outcome) errors.push(`this step ends only with the outcome "${params.outcome}"`);
    output = { text: text.replace(/\n$/, "") };
  } else if (!(outcome in params.schema)) {
    errors.push(`"${outcome}" is not an outcome of this step; they are ${Object.keys(params.schema).map((o) => `"${o}"`).join(", ")}`);
  } else {
    try {
      output = JSON.parse(text);
    } catch (error) {
      errors.push(`the answer is not JSON: ${(error as Error).message}`);
    }
    if (errors.length === 0) {
      const fraction = fractionAt(output);
      if (fraction !== null) {
        errors.push(`${fraction === "" ? "(root)" : fraction}: a number with a fraction; a step's output holds integers only`);
      } else {
        const misfit = misfits(output, params.schema[outcome]);
        if (misfit.length > 0) errors.push(printErrors(misfit));
      }
    }
  }
  const result = { outcome, output };
  const size = Buffer.byteLength(JSON.stringify(result));
  if (errors.length === 0 && size > RESULT_LIMIT) {
    errors.push(`the answer takes ${size} bytes; at most ${RESULT_LIMIT} fit in a step's result`);
  }

  if (errors.length === 0) {
    writeJson(file, result);
    console.log("accepted");
    return 0;
  }
  const counter = join(work, `${attempt}.answers`);
  const bad = (Number(existsSync(counter) ? readFileSync(counter, "utf8") : 0) || 0) + 1;
  writeFileSync(counter, `${bad}\n`);
  console.log(errors.join("\n"));
  if (bad >= BAD_ANSWERS) {
    writeJson(file, failure("output.invalid", `the answer did not fit after ${bad} tries:\n${errors.join("\n")}`));
    console.log(`That was answer ${bad} that did not fit: the step failed (output.invalid).`);
  } else {
    console.log(`Fix the answer and run the command again; after ${BAD_ANSWERS - bad} more that do not fit, the step fails.`);
  }
  return 1;
}
