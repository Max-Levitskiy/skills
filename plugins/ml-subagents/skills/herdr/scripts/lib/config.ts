// herdr's config, read through the agent-config CLI (ACS v2) — see
// plugins/ml-agent-config/docs/working-actions.md. The keys are declared in ../../agent-config.json;
// this file spawns the CLI and holds what is herdr's own: the built-in presets, how a preset is
// layered over them, and the checks the declared schemas cannot express.
//
// herdr needs no credential (the CLI talks to a local socket) and every key has a default, so an
// unconfigured herdr is ready. Runs under bun and Node 24.12+, so no Bun-only API here.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "herdr";
/** The skill folder, which holds agent-config.json. Passed as --from, so a git checkout works too. */
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALL_LINK = "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config";

export type Layer = "global" | "repo" | "user-repo" | "local";
export const LAYERS: Layer[] = ["global", "repo", "user-repo", "local"];

/** One launchable subagent: the argv herdr spawns, plus per-preset overrides. */
export interface AgentPreset {
  /** Canonical executable plus its arguments. Required; managed start selects the executable by kind. */
  command?: string[];
  /** Explicit managed agent kind; canonical command names otherwise infer it. */
  kind?: string;
  /** One-line note shown by `presets`, so a user picking a preset knows what it is. */
  description?: string;
  /** Default cwd for this preset. `~` expands; a relative path resolves from the repo root. */
  cwd?: string;
  /** Extra environment, passed as `--env KEY=VALUE`. */
  env?: Record<string, string>;
  /** herdr session (background server) to launch in. Unset = the caller's own session. */
  session?: string;
  /** Split direction when an explicit anchor pane is selected. */
  split?: "right" | "down";
  /** Whether starting it steals the user's focus. */
  focus?: boolean;
  /** Milliseconds to wait for the TUI to finish drawing itself after spawn. */
  bootTimeoutMs?: number;
  /** Milliseconds to wait for one reply. */
  replyTimeoutMs?: number;
  /** Pane lines to read back when extracting a reply. */
  readLines?: number;
  /** Legacy extraction fields: accepted for migration, unused by native reads. */
  replyMarker?: string;
  composerMarker?: string;
  chrome?: string[];
}

/** The defaults object is an AgentPreset minus `command`, plus which preset to use. */
export interface HerdrDefaults extends Omit<AgentPreset, "command" | "description"> {
  /** Preset used when `start` is called without one. */
  agent?: string;
}

export interface HerdrConfig {
  /** SCS/ACS v1 format stamp; accepted on write and dropped, since v2 stamps its own. */
  version?: number;
  agents?: Record<string, AgentPreset>;
  defaults?: HerdrDefaults;
}

export interface Problem {
  code: string;
  message: string;
}

/** What `agent-config start` answers: ready or not, with the merged config either way. */
export interface Plan {
  ready: boolean;
  config: HerdrConfig;
  actions: { id: string; keys: string[] }[];
  problems: Problem[];
  guide: string;
}

export interface LayerFile {
  layer: Layer;
  path: string | null;
  exists: boolean;
}

/** A failed CLI call, with the CLI's own diagnosis and exit code (2 config, 3 credential, 4 schema). */
export class AgentConfigError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `<cache>/*\/ml-agent-config/*\/bin/agent-config`, newest version last. */
function fromCache(cache: string): string | undefined {
  const dirs = (path: string) => {
    try {
      return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
    } catch {
      return [];
    }
  };
  const found: string[] = [];
  for (const marketplace of dirs(cache)) {
    const plugin = join(cache, marketplace, "ml-agent-config");
    for (const version of dirs(plugin)) {
      const bin = join(plugin, version, "bin", "agent-config");
      if (executable(bin)) found.push(join(marketplace, "ml-agent-config", version, "bin", "agent-config"));
    }
  }
  const last = found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  return last && join(cache, last);
}

/**
 * The agent-config binary, found the way working-actions.md says: AGENT_CONFIG_ROOT, then PATH,
 * then the harness plugin caches. Never a reconstructed install path. Undefined when none exists.
 */
function binary(): string | undefined {
  const root = process.env.AGENT_CONFIG_ROOT;
  if (root) return join(root, "bin", "agent-config");
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && executable(join(dir, "agent-config"))) return join(dir, "agent-config");
  }
  const caches = [
    join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins", "cache"),
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "plugins", "cache"),
  ];
  for (const cache of caches) {
    const found = fromCache(cache);
    if (found) return found;
  }
  return undefined;
}

function requireBinary(): string {
  const bin = binary();
  if (!bin) throw new AgentConfigError(`agent-config is not installed, and herdr stores its presets through it: ${INSTALL_LINK}`, 127);
  return bin;
}

/** One CLI call, JSON on stdout. */
function run<T>(args: string[], stdin?: string, bin = requireBinary()): T {
  const result = spawnSync(bin, [...args, "--from", SKILL_DIR], {
    encoding: "utf8",
    input: stdin,
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw new AgentConfigError(`agent-config ${args[0]}: ${result.error.message}`, 1);
  if (result.status !== 0) {
    throw new AgentConfigError(result.stderr.trim() || `agent-config ${args[0]} exited ${result.status}`, result.status ?? 1);
  }
  return JSON.parse(result.stdout) as T;
}

/** What herdr still needs, plus the merged config. Not being configured is an answer, not an error. */
export function startPlan(): Plan {
  return run<Plan>(["start", NAME]);
}

/**
 * The merged config, defaults applied. Presets are optional, so with agent-config not installed
 * herdr runs on its built-ins and says so on stderr, rather than refusing to talk to a pane.
 */
export function loadConfig(): HerdrConfig {
  const bin = binary();
  if (!bin) {
    process.stderr.write(`herdr: agent-config is not installed, so only built-in presets are available: ${INSTALL_LINK}\n`);
    return {};
  }
  return run<{ config: HerdrConfig }>(["load", NAME], undefined, bin).config;
}

/** Where each layer lives; `path` is null for a layer that needs a repository this is not in. */
export function layerPaths(): LayerFile[] {
  return run<{ layers: LayerFile[] }>(["path", NAME]).layers;
}

export function layerPath(layer: Layer): string | null {
  return run<{ layers: LayerFile[] }>(["path", NAME, "--layer", layer]).layers[0]?.path ?? null;
}

/**
 * Replace one layer. `write` checks the declared schemas, stamps the file, snapshots the schema,
 * journals the previous contents and gitignores the local layer. The v1 `version` stamp is dropped.
 */
export function writeLayer(layer: Layer, config: HerdrConfig): { path: string; layer: Layer } {
  const { version: _v1, ...answers } = config;
  return run<{ path: string; layer: Layer }>(["write", NAME, "--layer", layer], JSON.stringify(answers));
}

export function repoRoot(): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** `~/` is home; a relative path resolves from the repo root, or the working directory outside one. */
export function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(repoRoot() ?? process.cwd(), path);
}

/**
 * Built-in presets, so the skill works with no config file at all. A user's `agents`
 * entry with the same name replaces it (per-key deep merge, arrays wholesale), and any
 * name not listed here is purely theirs.
 *
 * Only agents herdr ships detection for are listed; `herdr integration status` is the
 * authority on what is actually installed, but preset discovery does not prove binary or auth availability.
 */
export const BUILTIN_AGENTS: Record<string, AgentPreset> = {
  claude: {
    command: ["claude"],
    description: "Claude Code",
    replyMarker: "⏺",
    composerMarker: "❯",
  },
  codex: {
    command: ["codex"],
    description: "OpenAI Codex CLI",
    replyMarker: "•",
    composerMarker: "›",
    // Codex surrounds its answer with an update banner, a warning row, a tip row, its own
    // composer and a dot-separated status line. None of those are output.
    chrome: ["^\\s*[⚠✨]\\s", "^\\s*Tip:", "^\\s*›", "(?:\\s·\\s.*){2,}"],
  },
  omp: {
    command: ["omp"],
    description: "Oh My Pi",
    // omp echoes prompt and answer as plain lines, then draws its composer as a titled box.
    chrome: ["^\\s*[╭╰]"],
  },
  gemini: { command: ["gemini"], description: "Gemini CLI" },
  opencode: { command: ["opencode"], description: "opencode" },
  droid: { command: ["droid"], description: "Factory droid" },
  copilot: { command: ["copilot"], description: "GitHub Copilot CLI" },
  cursor: { command: ["cursor-agent"], description: "Cursor agent" },
};

export const BUILTIN_DEFAULTS: Required<
  Pick<HerdrDefaults, "agent" | "split" | "focus" | "bootTimeoutMs" | "replyTimeoutMs" | "readLines">
> = {
  agent: "claude",
  split: "right",
  focus: false,
  bootTimeoutMs: 30_000,
  replyTimeoutMs: 300_000,
  readLines: 80,
};

/** Config presets layered over the built-ins; a user entry wins key by key. */
export function agents(c: HerdrConfig): Record<string, AgentPreset> {
  const out: Record<string, AgentPreset> = {};
  for (const name of new Set([...Object.keys(BUILTIN_AGENTS), ...Object.keys(c.agents ?? {})])) {
    out[name] = { ...BUILTIN_AGENTS[name], ...(c.agents?.[name] ?? {}) };
  }
  return out;
}

export function defaults(c: HerdrConfig): Required<typeof BUILTIN_DEFAULTS> & HerdrDefaults {
  return { ...BUILTIN_DEFAULTS, ...(c.defaults ?? {}) };
}

/**
 * Resolve one preset into the settings a launch needs. `name` unset picks
 * `defaults.agent`. Throws with the available names rather than guessing a neighbour —
 * launching the wrong agent is more expensive than a retry.
 */
export function resolvePreset(c: HerdrConfig, name?: string): AgentPreset & { name: string; command: string[] } {
  const table = agents(c);
  const d = defaults(c);
  const key = name ?? d.agent;
  const preset = table[key];
  if (!preset) {
    const root = repoRoot();
    const v1 = [join(homedir(), ".agents", "skill-config", NAME), ...(root ? [join(root, ".agents", "skill-config", NAME)] : [])]
      .filter((dir) => existsSync(dir));
    throw new Error(
      `no agent preset named "${key}". Configured: ${Object.keys(table).sort().join(", ")}. ` +
        `Add one under "agents": \`herdr-agent.ts config write global\`, or the /agent-config pane.` +
        (v1.length ? ` Presets at ${v1.join(", ")} are a v1 config, no longer read: \`agent-config adopt herdr\` copies them over.` : ""),
    );
  }
  if (!preset.command?.length) {
    throw new Error(`agent preset "${key}" has no "command" argv — set agents.${key}.command to e.g. ["claude"].`);
  }
  const { agent: _ignored, ...inherited } = d;
  return { ...inherited, ...preset, name: key, command: preset.command };
}

/** Validate stored values before writing or launching; availability/auth are separate. */
export function validate(c: HerdrConfig): string[] {
  const problems: string[] = [];
  const object = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!object(c)) return ["config must be an object"];
  if (c.version !== undefined && c.version !== 1) problems.push("version must be 1");
  if (c.agents !== undefined && !object(c.agents)) problems.push("agents must be an object");
  if (c.defaults !== undefined && !object(c.defaults)) problems.push("defaults must be an object");
  const check = (prefix: string, preset: any) => {
    if (!object(preset)) { problems.push(prefix+" must be an object"); return; }
    for (const field of ["kind","description","cwd","session","replyMarker","composerMarker"])
      if (preset[field] !== undefined && (typeof preset[field] !== "string" || !preset[field].trim()))
        problems.push(prefix+"."+field+" must be a nonempty string");
    if (preset.split !== undefined && !["right","down"].includes(preset.split)) problems.push(prefix+".split must be right/down");
    if (preset.focus !== undefined && typeof preset.focus !== "boolean") problems.push(prefix+".focus must be boolean");
    for (const [field, min, max] of [["bootTimeoutMs",3001,300000],["replyTimeoutMs",1,3598000],["readLines",1,1000]] as const) {
      const value = preset[field];
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
        problems.push(prefix+"."+field+" must be "+min+".."+max);
    }
    if (preset.env !== undefined && (!object(preset.env) || Object.entries(preset.env).some(([k,v])=>!/^[_A-Za-z][_A-Za-z0-9]*$/.test(k) || typeof v !== "string")))
      problems.push(prefix+".env must map valid environment names to strings");
    if (preset.chrome !== undefined && (!Array.isArray(preset.chrome) || preset.chrome.some((v:any)=>typeof v !== "string")))
      problems.push(prefix+".chrome must be a string array");
  };
  const table = object(c.agents) ? c.agents! : {};
  for (const [name, preset] of Object.entries(table)) {
    check("agents."+name, preset);
    if (!object(preset)) continue;
    const merged = { ...BUILTIN_AGENTS[name], ...preset };
    if (!Array.isArray(merged.command) || !merged.command.length || merged.command.some(a=>typeof a !== "string") || !merged.command[0]?.trim())
      problems.push("agents."+name+".command must be nonempty argv with a nonempty executable");
  }
  if (object(c.defaults)) {
    check("defaults",c.defaults);
    if (c.defaults!.agent !== undefined && (typeof c.defaults!.agent !== "string" || !(c.defaults!.agent in {...BUILTIN_AGENTS,...table})))
      problems.push("defaults.agent must name a configured preset");
  }
  return problems;
}
