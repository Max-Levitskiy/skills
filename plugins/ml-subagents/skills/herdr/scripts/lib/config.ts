// herdr's slice of the Agent Config Standard (ACS v1) — see standards/agent-config.md.
// Layer paths, merge, writes and gitignoring come from the vendored library; what lives
// here is the shape herdr stores: named subagent presets and the launch defaults applied
// when a preset (or a flag) leaves something out.
//
// herdr needs no credential — the CLI talks to a local socket — so `credentials` stays
// empty and `validate()` only checks that presets are launchable.

import {
  expandPath,
  layerPath as libLayerPath,
  loadConfig as libLoadConfig,
  repoRoot,
  writeLayer as libWriteLayer,
  type BaseConfig,
  type Layer,
} from "./vendor/agent-config/config.ts";

export { expandPath, repoRoot, type Layer };

const NAME = "herdr";

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

export interface HerdrConfig extends BaseConfig {
  agents?: Record<string, AgentPreset>;
  defaults?: HerdrDefaults;
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

export function layerPath(layer: Layer, root?: string | null): string | null {
  return libLayerPath(NAME, layer, root);
}

export function loadConfig() {
  return libLoadConfig<HerdrConfig>(NAME);
}

export function writeLayer(layer: Layer, config: HerdrConfig) {
  return libWriteLayer(NAME, layer, config);
}

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
    throw new Error(
      `no agent preset named "${key}". Configured: ${Object.keys(table).sort().join(", ")}. ` +
        `Add one under "agents" in ${layerPath("global") ?? "the global config"}.`,
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
