#!/usr/bin/env bun
// herdr-agent — start, drive and inspect subagents in herdr panes, in one call each.
//
//   herdr-agent.ts presets                       configured subagents + what's installed
//   herdr-agent.ts running                       agents alive right now, with status
//   herdr-agent.ts start [preset] [--prompt T]   spawn, wait for boot, optionally ask once
//   herdr-agent.ts ask <target> <text>           send + Enter + wait + return the reply
//   herdr-agent.ts read <target>                 pane text (--raw for the unfiltered TUI)
//   herdr-agent.ts stop <target> --force         close the pane, killing the agent
//   herdr-agent.ts config check|show|path|write  ACS v1 config (standards/agent-config.md)
//
// Why this exists: driving an agent by hand is four commands and two traps — `agent send`
// does not press Enter, and a status wait straight after submitting returns instantly
// because the agent has not started working yet, so you read the *previous* reply. Every
// command here handles both.

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import {
  agents,
  defaults,
  expandPath,
  layerPath,
  loadConfig,
  resolvePreset,
  validate,
  writeLayer,
  type AgentPreset,
  type HerdrConfig,
  type Layer,
} from "./lib/config";
import { describeCredential } from "./lib/vendor/agent-config/credentials";

const LAYERS: Layer[] = ["global", "repo", "local"];
/** Lines that are TUI furniture rather than agent output. */
const CHROME =
  /^\s*(?:[─━═│┌┐└┘├┤┬┴┼╭╮╰╯\s]+|❯.*|[✻✳✽✢·*]\s.*|--\s*(?:INSERT|NORMAL)\s*--.*|\?\s*for shortcuts.*|.*esc to interrupt.*)$/;
/** A full-width rule. The last one on screen opens the status bar, which is never output. */
const RULE = /^\s*[─━═]{3,}\s*$/;
/** Gap between typing and Enter. Sending both back to back loses the Enter to the TUI's own redraw. */
const SUBMIT_SETTLE_MS = 400;
const SUBMIT_ATTEMPTS = 3;
/** How long to wait for typed text to show up in the composer before typing it again. */
const TYPED_GRACE_MS = 4_000;
/** How long to give the agent to *start* working before believing a quiet status. */
const WORKING_GRACE_MS = 10_000;
/** Reply text must stop changing for this long before it counts as final. */
const SETTLE_MS = 1_200;
const SETTLE_MAX_MS = 20_000;
const SETTLE_POLL_MS = 300;
const STATUS_POLL_MS = 400;
const BOOT_POLL_MS = 500;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------- herdr CLI

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** herdr's pane/agent record, as much of it as this script uses. */
interface AgentInfo {
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
}

function field(value: Json | undefined, key: string): Json | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value[key];
  return undefined;
}

function asString(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Read the fields this script needs off a herdr agent/pane record. */
function toAgent(value: Json | undefined): AgentInfo {
  return {
    pane_id: asString(field(value, "pane_id")),
    tab_id: asString(field(value, "tab_id")),
    workspace_id: asString(field(value, "workspace_id")),
    agent: asString(field(value, "agent")),
    agent_status: asString(field(value, "agent_status")),
    cwd: asString(field(value, "cwd")),
  };
}

interface Flags {
  session?: string;
  json?: boolean;
  raw?: boolean;
  force?: boolean;
  focus?: boolean;
  lines?: number;
  source?: string;
  timeout?: number;
  prompt?: string;
  name?: string;
  cwd?: string;
  workspace?: string;
  tab?: string;
  split?: string;
  env: string[];
  rest: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { env: [], rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i] ?? die(`${a} needs a value`);
    switch (a) {
      case "--json": f.json = true; break;
      case "--raw": f.raw = true; break;
      case "--force": case "--yes": f.force = true; break;
      case "--focus": f.focus = true; break;
      case "--no-focus": f.focus = false; break;
      case "--session": f.session = value(); break;
      case "--lines": f.lines = Number(value()); break;
      case "--source": f.source = value(); break;
      case "--timeout": f.timeout = Number(value()); break;
      case "--prompt": f.prompt = value(); break;
      case "--name": f.name = value(); break;
      case "--cwd": f.cwd = value(); break;
      case "--workspace": f.workspace = value(); break;
      case "--tab": f.tab = value(); break;
      case "--split": f.split = value(); break;
      case "--env": f.env.push(value()); break;
      default:
        if (a.startsWith("--")) die(`unknown flag ${a}`);
        f.rest.push(a);
    }
  }
  return f;
}

/** Run a herdr command. `session` becomes the global `--session` flag, which precedes the noun. */
function herdrRaw(session: string | undefined, args: string[]) {
  const argv = session ? ["--session", session, ...args] : args;
  const p = spawnSync("herdr", argv, { encoding: "utf8" });
  if (p.error) die(`could not run herdr: ${p.error.message}`);
  return { status: p.status ?? 1, stdout: (p.stdout ?? "").trim(), stderr: (p.stderr ?? "").trim() };
}

/** Run a herdr command and return the JSON envelope's `result`. Exits on failure. */
function herdr(session: string | undefined, ...args: string[]): Json {
  const { status, stdout, stderr } = herdrRaw(session, args);
  if (status !== 0) die(`herdr ${args.join(" ")} failed: ${stderr || stdout || `exit ${status}`}`);
  if (!stdout) return {};
  // `wait` streams event objects rather than the {id,result} envelope every noun prints,
  // and can emit several lines; the last one is the state that matters either way.
  const line = stdout.split("\n").filter(Boolean).pop() ?? "";
  let parsed: Json;
  try {
    parsed = JSON.parse(line) as Json;
  } catch {
    die(`could not parse herdr output as JSON:\n${stdout}`);
  }
  return field(parsed, "result") ?? parsed;
}

/** Statuses that mean the agent is not producing output right now. */
const TERMINAL_STATUS: Record<string, true> = { idle: true, done: true, blocked: true };

function status(session: string | undefined, pane: string): string {
  return toAgent(field(herdr(session, "agent", "get", pane), "agent")).agent_status ?? "unknown";
}

/**
 * Poll until the agent stops producing, and report which status ended the wait.
 *
 * `herdr wait agent-status` takes exactly one status, and agents disagree on which one
 * they finish in: Claude Code lands on `idle`, Codex on `done`, and either can stop at
 * `blocked` to ask for approval. Waiting on a single name hangs on the other two, so this
 * polls the set instead. `unknown` is not terminal — it is what a booting TUI reports.
 */
function waitQuiet(session: string | undefined, pane: string, timeoutMs: number): string | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = status(session, pane);
    if (TERMINAL_STATUS[s]) return s;
    Bun.sleepSync(STATUS_POLL_MS);
  }
  return null;
}

function readPane(session: string | undefined, pane: string, lines: number, source: string): string {
  const result = herdr(session, "agent", "read", pane, "--source", source, "--lines", String(lines), "--format", "text");
  return asString(field(field(result, "read"), "text")) ?? "";
}

/** Resolve any target herdr accepts (pane id, agent name, label) to its record. */
function lookup(session: string | undefined, target: string): AgentInfo {
  const info = toAgent(field(herdr(session, "agent", "get", target), "agent"));
  return { ...info, pane_id: info.pane_id ?? target };
}

// ---------------------------------------------------------------- reply extraction

/** Everything screen-scraping needs to know about one agent's TUI. */
interface Screen {
  /** The message just submitted, so its echo can be skipped. */
  prompt?: string;
  /** Marker prefixing the agent's own output lines, e.g. Claude Code's "⏺". */
  marker?: string;
  /** Per-agent furniture patterns from the preset, on top of the universal ones. */
  chrome?: string[];
}

/**
 * The prompt as it appears once a TUI has wrapped and re-indented it: same words, elastic
 * whitespace. Matching the literal string fails on every reflowed echo.
 */
function promptPattern(prompt: string): RegExp {
  const words = prompt
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(words.join("\\s+"), "g");
}

/**
 * Pull the agent's answer out of a rendered TUI dump.
 *
 * `agent read` returns the whole screen — banner, composer, status bar — so neither end
 * is usable raw. Three cuts, in order: drop everything from the last full-width rule
 * (the status bar lives below it), skip past the echoed prompt, then past the agent's own
 * output marker when the preset names one. Whatever furniture survives is filtered.
 */
export function extractReply(text: string, screen: Screen = {}): string {
  const { prompt, marker } = screen;
  const chrome = (screen.chrome ?? []).map((p) => new RegExp(p));
  const lines = text.split("\n");
  const lastRule = lines.reduce((found, line, i) => (RULE.test(line) ? i : found), -1);
  let body = (lastRule >= 0 ? lines.slice(0, lastRule) : lines).join("\n");
  if (prompt) {
    // Anchor on the *last* echo — the current turn.
    let end = -1;
    for (const m of text.matchAll(promptPattern(prompt))) end = (m.index ?? 0) + m[0].length;
    if (end >= 0 && end < body.length) body = body.slice(end);
  }
  if (marker) {
    const at = body.indexOf(marker);
    if (at >= 0) body = body.slice(at + marker.length);
  }
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    if (CHROME.test(line) || chrome.some((re) => re.test(line))) continue;
    const trimmed = line.replace(/\s+$/, "");
    if (!trimmed.trim() && !kept.length) continue; // no leading blanks
    kept.push(trimmed);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (!kept.length) return "";
  // The TUI indents continuation lines under its output marker; strip that gutter but keep
  // relative indent, which is load-bearing in code blocks and lists. The first line sits
  // right after the marker itself, so it has no gutter to measure and none to remove.
  const [head, ...tail] = kept;
  const indents = tail.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const gutter = indents.length ? Math.min(...indents) : 0;
  const flush = [head.trimStart(), ...tail.map((l) => l.slice(gutter))];
  return flush.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Does the composer still hold the prompt? Then Enter never landed. */
function stillComposing(text: string, prompt: string, composer: string | undefined): boolean {
  if (!composer) return false; // no marker configured — trust the status instead
  const head = prompt.trim().slice(0, 30);
  const composerLines = text.split("\n").filter((l) => l.trimStart().startsWith(composer));
  const last = composerLines[composerLines.length - 1];
  return Boolean(last && head && last.includes(head));
}

/**
 * Wait until the TUI has finished drawing itself, and report whether it did.
 *
 * Status is not enough on its own: Codex reports `idle` seconds before its model line
 * finishes loading, and text typed into a still-booting TUI is silently truncated — the
 * prompt arrives as "+3." instead of the sentence. A screen that has stopped changing is
 * the observable version of "ready for input".
 */
function waitDrawn(session: string | undefined, pane: string, lines: number, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  while (Date.now() < deadline) {
    const now = readPane(session, pane, lines, "visible");
    if (now.trim() && now === previous && TERMINAL_STATUS[status(session, pane)]) return true;
    previous = now;
    Bun.sleepSync(BOOT_POLL_MS);
  }
  return false;
}

/**
 * Type the message into the composer, and confirm it arrived.
 *
 * A TUI that is booting, redrawing, or busy drops keystrokes silently — the text simply
 * never appears, and the following Enter then submits an empty composer, which reads back
 * as "the agent answered the wrong thing". Verifiable only when the preset names a composer
 * marker; without one, the echo assertion at the end of the turn is the safety net.
 */
function typeInto(session: string | undefined, pane: string, prompt: string, preset: AgentPreset, lines: number) {
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt++) {
    herdr(session, "agent", "send", pane, prompt);
    if (!preset.composerMarker) return;
    const deadline = Date.now() + TYPED_GRACE_MS;
    while (Date.now() < deadline) {
      if (stillComposing(readPane(session, pane, lines, "visible"), prompt, preset.composerMarker)) return;
      Bun.sleepSync(SETTLE_POLL_MS);
    }
  }
}

/**
 * Submit a message and return the reply.
 *
 * Four things bite here, and all four are handled: `agent send` only types, so Enter is a
 * separate call; an Enter sent in the same breath as the text is eaten by the TUI's redraw,
 * so it is delayed and re-tried while the composer still holds the text; the agent is
 * still idle the instant after Enter, so movement off idle is awaited before a quiet
 * status is believed; and quiet also means "stopped to ask you something", so the screen
 * is read until it settles and returned either way.
 */
function converse(session: string | undefined, pane: string, prompt: string, preset: AgentPreset): string {
  const lines = preset.readLines ?? 200;
  const replyTimeoutMs = preset.replyTimeoutMs ?? 300_000;
  const screen: Screen = { prompt, marker: preset.replyMarker, chrome: preset.chrome };
  typeInto(session, pane, prompt, preset, lines);
  let delivered = false;
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS && !delivered; attempt++) {
    Bun.sleepSync(SUBMIT_SETTLE_MS);
    herdr(session, "pane", "send-keys", pane, "Enter");
    // Movement off a quiet status is proof the message landed.
    delivered =
      herdrRaw(session, [
        "wait", "agent-status", pane, "--status", "working", "--timeout", String(WORKING_GRACE_MS),
      ]).status === 0;
    // A reply short enough to finish inside that window leaves no `working` to catch, but
    // `typeInto` already confirmed the text was in the composer, so a composer that has
    // since cleared is proof too. Without a composer marker there is nothing to read, and
    // the echo check below is the only evidence available.
    if (!delivered && preset.composerMarker) {
      delivered = !stillComposing(readPane(session, pane, lines, "visible"), prompt, preset.composerMarker);
    }
  }
  const quiet = waitQuiet(session, pane, replyTimeoutMs);
  if (!quiet) {
    const partial = extractReply(readPane(session, pane, lines, "visible"), screen);
    die(`${pane} was still working after ${replyTimeoutMs}ms. Partial screen:\n${partial}`);
  }
  let last = "";
  let stableSince = 0;
  const deadline = Date.now() + SETTLE_MAX_MS;
  while (Date.now() < deadline) {
    const now = extractReply(readPane(session, pane, lines, "visible"), screen);
    if (now && now === last) {
      if (stableSince && Date.now() - stableSince >= SETTLE_MS) break;
      stableSince ||= Date.now();
    } else {
      last = now;
      stableSince = 0;
    }
    Bun.sleepSync(SETTLE_POLL_MS);
  }
  // With no evidence the message was accepted, an echo of the prompt is the last thing that
  // could prove it. Agents that redraw their transcript away (omp) scroll the echo off the
  // visible screen, so this only decides the case where nothing else did.
  if (!delivered && !promptPattern(prompt).test(readPane(session, pane, lines, "visible"))) {
    die(
      `${pane} never echoed the prompt and never started working, so it was not delivered ` +
        `(the TUI dropped it). Check the pane with: read ${pane} --raw`,
    );
  }
  // `blocked` is a question, not an answer: say so, since the text below is the question.
  return quiet === "blocked" ? `[${pane} is blocked - it is asking you something]\n${last}` : last;
}

// ---------------------------------------------------------------- commands

function cmdPresets(f: Flags) {
  const { config } = loadConfig();
  const table = agents(config);
  const d = defaults(config);
  // `integration status` is plain text: "name: current (v7) (/path)" or "name: not installed (/path)".
  const reporting: Record<string, string> = {};
  for (const line of herdrRaw(f.session, ["integration", "status"]).stdout.split("\n")) {
    const m = line.match(/^(\S+):\s*(.+?)(?:\s*\(\/.*)?$/);
    if (m) reporting[m[1]] = m[2];
  }
  const rows = Object.entries(table)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, preset]) => {
      const binary = preset.command?.[0];
      return {
        name,
        command: (preset.command ?? []).join(" "),
        description: preset.description ?? "",
        onPath: Boolean(binary) && spawnSync("which", [binary!], { encoding: "utf8" }).status === 0,
        statusReporting: reporting[name] ?? "no herdr integration",
        isDefault: name === d.agent,
      };
    });
  if (f.json) {
    console.log(JSON.stringify({ defaults: d, presets: rows }, null, 2));
    return;
  }
  console.log(`default preset: ${d.agent}    split: ${d.split}    focus: ${d.focus}`);
  console.log("\n  preset                argv                       PATH  status reporting");
  for (const r of rows) {
    console.log(
      (r.isDefault ? "* " : "  ") +
        r.name.padEnd(22) +
        r.command.padEnd(27) +
        (r.onPath ? "yes " : "NO  ") +
        r.statusReporting,
    );
  }
  console.log(
    "\nPATH=NO means that binary is not installed. An agent with no herdr integration still runs,\n" +
      "but reports status by heuristic, so waits are less exact. Add or override presets under\n" +
      `"agents" in ${layerPath("global")}`,
  );
}

function cmdRunning(f: Flags) {
  const list = field(herdr(f.session, "agent", "list"), "agents");
  const rows = (Array.isArray(list) ? list : []).map(toAgent);
  if (f.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("no agents running");
    return;
  }
  console.log("pane      agent       status    workspace  cwd");
  for (const a of rows) {
    console.log(
      (a.pane_id ?? "-").padEnd(10) +
        (a.agent ?? "-").padEnd(12) +
        (a.agent_status ?? "?").padEnd(10) +
        (a.workspace_id ?? "-").padEnd(11) +
        (a.cwd ?? ""),
    );
  }
}

function cmdStart(f: Flags) {
  const { config } = loadConfig();
  const preset = resolvePreset(config, f.rest[0]);
  const session = f.session ?? preset.session;
  const cwd = f.cwd ?? (preset.cwd ? expandPath(preset.cwd) : process.cwd());
  const focus = f.focus ?? preset.focus ?? false;
  const args = ["agent", "start", f.name ?? preset.name, "--cwd", cwd];
  if (f.workspace) args.push("--workspace", f.workspace);
  if (f.tab) args.push("--tab", f.tab);
  const split = f.split ?? preset.split;
  if (split) args.push("--split", split);
  for (const [key, value] of Object.entries(preset.env ?? {})) args.push("--env", `${key}=${value}`);
  for (const pair of f.env) args.push("--env", pair);
  args.push(focus ? "--focus" : "--no-focus", "--", ...preset.command);

  const started = toAgent(field(herdr(session, ...args), "agent"));
  const pane = started.pane_id ?? die("herdr agent start returned no pane id");
  // A booting TUI reports `unknown`, then a quiet status while it is still drawing; text
  // typed before it settles is silently truncated. Wait for the screen to stop moving.
  const booted = waitDrawn(session, pane, preset.readLines ?? 200, f.timeout ?? preset.bootTimeoutMs ?? 90_000);
  if (f.prompt && !booted) {
    die(`${pane} never finished starting, so the prompt was not sent. Inspect it with: read ${pane} --raw`);
  }
  const reply = f.prompt ? converse(session, pane, f.prompt, preset) : undefined;

  if (f.json) {
    const out = {
      pane_id: pane,
      tab_id: started.tab_id,
      workspace_id: started.workspace_id,
      preset: preset.name,
      command: preset.command,
      cwd,
      session: session ?? null,
      booted,
      prompt: f.prompt,
      reply,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(
    `pane ${pane}  (${preset.name}: ${preset.command.join(" ")})  ` +
      `tab ${started.tab_id}  workspace ${started.workspace_id}`,
  );
  console.log(`cwd  ${cwd}`);
  if (!booted) console.log("WARNING: still drawing - starting up, or waiting on a trust prompt.");
  if (reply) console.log(`\n${reply}`);
  else if (booted) console.log(`\nask it: herdr-agent.ts ask ${pane} "your question"`);
}

/**
 * The preset to read replies with is the one matching what is *running* in that pane, not
 * `defaults.agent` — the reply marker differs per agent, and guessing it mangles output.
 */
function presetForRunning(config: HerdrConfig, info: AgentInfo, f: Flags): AgentPreset {
  const { agent: _default, ...inherited } = defaults(config);
  return {
    ...inherited,
    ...(info.agent ? agents(config)[info.agent] : undefined),
    ...(f.timeout ? { replyTimeoutMs: f.timeout } : {}),
    ...(f.lines ? { readLines: f.lines } : {}),
  };
}

function cmdAsk(f: Flags) {
  const [target, ...words] = f.rest;
  if (!target || !words.length) die('usage: ask <pane|agent-name> "text"');
  const { config } = loadConfig();
  const info = lookup(f.session, target);
  const prompt = words.join(" ");
  const reply = converse(f.session, info.pane_id!, prompt, presetForRunning(config, info, f));
  if (f.json) {
    console.log(JSON.stringify({ pane_id: info.pane_id, agent: info.agent, prompt, reply }, null, 2));
    return;
  }
  console.log(reply || `(no reply text found - read the raw screen: read ${info.pane_id} --raw)`);
}

function cmdRead(f: Flags) {
  const target = f.rest[0] ?? die("usage: read <pane|agent-name> [--raw] [--lines N] [--source visible|recent]");
  const { config } = loadConfig();
  const info = lookup(f.session, target);
  const preset = presetForRunning(config, info, f);
  const text = readPane(f.session, info.pane_id!, preset.readLines ?? 200, f.source ?? "visible");
  console.log(f.raw ? text : extractReply(text, { chrome: preset.chrome }) || text);
}

function cmdStop(f: Flags) {
  const target = f.rest[0] ?? die("usage: stop <pane|agent-name> --force");
  const info = lookup(f.session, target);
  if (!f.force) {
    die(
      `closing ${info.pane_id} kills ${info.agent ?? "the process"} running in it, ` +
        "work in progress included. Re-run with --force.",
    );
  }
  herdr(f.session, "pane", "close", info.pane_id!);
  console.log(`closed ${info.pane_id}`);
}

// ---------------------------------------------------------------- config (ACS v1)

function cmdConfig(f: Flags) {
  const sub = f.rest[0] ?? "check";
  const { config, found, legacy } = loadConfig();

  if (sub === "path") {
    const layer = (f.rest[1] ?? "global") as Layer;
    if (!LAYERS.includes(layer)) die(`unknown layer ${layer}; one of ${LAYERS.join(", ")}`);
    console.log(layerPath(layer) ?? `the ${layer} layer needs a git repository`);
    return;
  }
  if (sub === "show") {
    // Credentials are described, never revealed. herdr needs none, but the namespace is
    // shared with anything else configured under the same name.
    const credentials = config.credentials
      ? Object.fromEntries(Object.entries(config.credentials).map(([k, ref]) => [k, describeCredential(ref)]))
      : undefined;
    console.log(JSON.stringify({ ...config, credentials }, null, 2));
    return;
  }
  if (sub === "write") {
    const layer = f.rest[1] as Layer;
    if (!LAYERS.includes(layer)) die(`usage: config write <${LAYERS.join("|")}>  (JSON on stdin)`);
    let parsed: HerdrConfig;
    try {
      parsed = JSON.parse(readFileSync(0, "utf8")) as HerdrConfig;
    } catch (e) {
      die(`stdin is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const problems = validate(parsed);
    if (problems.length) die(`refusing to write an invalid config:\n- ${problems.join("\n- ")}`);
    const { path, gitignore } = writeLayer(layer, { version: 1, ...parsed });
    console.log(`wrote ${path}`);
    if (gitignore?.action === "added") console.log(`gitignored the local layer in ${gitignore.path}`);
    return;
  }
  if (sub !== "check") die(`unknown config subcommand ${sub}; one of check, show, path, write`);

  console.log("layers:");
  for (const layer of LAYERS) {
    const hit = found.find((x) => x.layer === layer);
    console.log(`  ${layer.padEnd(6)} ${hit ? "found    " : "-        "} ${hit?.path ?? layerPath(layer) ?? "(needs a git repository)"}`);
  }
  if (legacy.length) {
    console.log(`\nreading legacy paths: ${legacy.map((l) => l.path).join(", ")}`);
    console.log("move each into .agents/config/herdr/ - see standards/agent-config.md");
  }
  const d = defaults(config);
  console.log(`\ndefault preset: ${d.agent}    presets: ${Object.keys(agents(config)).sort().join(", ")}`);
  const problems = validate(config);
  if (problems.length) {
    console.log(`\nnot ready:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    found.length
      ? "\nready (config found)."
      : `\nready on built-in presets - no config file needed. Add ${layerPath("global")} to define your own.`,
  );
}

// ---------------------------------------------------------------- entry

const COMMANDS: Record<string, (f: Flags) => void> = {
  presets: cmdPresets,
  running: cmdRunning,
  start: cmdStart,
  ask: cmdAsk,
  read: cmdRead,
  stop: cmdStop,
  config: cmdConfig,
};
const USAGE = [
  "herdr-agent.ts presets [--json]",
  "herdr-agent.ts running [--json]",
  'herdr-agent.ts start [preset] [--prompt "text"] [--name N] [--cwd P] [--workspace ID] [--tab ID]',
  "                     [--split right|down] [--focus] [--env K=V] [--session S] [--timeout MS] [--json]",
  'herdr-agent.ts ask <target> "text" [--timeout MS] [--lines N] [--json]',
  "herdr-agent.ts read <target> [--raw] [--lines N] [--source visible|recent]",
  "herdr-agent.ts stop <target> --force",
  "herdr-agent.ts config check|show|path [layer]|write <layer>",
].join("\n");

const [sub, ...rest] = process.argv.slice(2);
if (!sub || sub === "--help" || sub === "-h") {
  console.log(USAGE);
  process.exit(sub ? 0 : 1);
}
const run = COMMANDS[sub] ?? die(`unknown command ${sub}; one of ${Object.keys(COMMANDS).join(", ")}`);
run(parseFlags(rest));
