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
} from "./vendor/agent-config/config";

export { expandPath, repoRoot, type Layer };

const NAME = "herdr";

/** One launchable subagent: the argv herdr spawns, plus per-preset overrides. */
export interface AgentPreset {
  /** argv passed to `herdr agent start ... -- <argv>`. Required. */
  command?: string[];
  /** One-line note shown by `presets`, so a user picking a preset knows what it is. */
  description?: string;
  /** Default cwd for this preset. `~` expands; a relative path resolves from the repo root. */
  cwd?: string;
  /** Extra environment, passed as `--env KEY=VALUE`. */
  env?: Record<string, string>;
  /** herdr session (background server) to launch in. Unset = the caller's own session. */
  session?: string;
  /** Where the new pane goes relative to the caller's. */
  split?: "right" | "down";
  /** Whether starting it steals the user's focus. */
  focus?: boolean;
  /** Milliseconds to wait for the TUI to finish drawing itself after spawn. */
  bootTimeoutMs?: number;
  /** Milliseconds to wait for one reply. */
  replyTimeoutMs?: number;
  /** Pane lines to read back when extracting a reply. */
  readLines?: number;
  /**
   * Marker that prefixes an agent's own output lines in its TUI, used to find the reply.
   * Claude Code uses "⏺". Unset means "take everything after the echoed prompt".
   */
  replyMarker?: string;
  /**
   * Marker that prefixes the agent's input composer. Claude Code uses "❯", Codex "›".
   * Used to tell "Enter never landed" from "the reply is just fast", so a missing one only
   * costs a redundant Enter on an already-empty composer.
   */
  composerMarker?: string;
  /**
   * Extra regexes (JS syntax, matched per line) for TUI furniture this agent prints around
   * its answers — activity spinners, hint rows, the status bar. Replaces, not appends to,
   * the entry it overrides, since arrays replace wholesale across config layers.
   */
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
 * authority on what is actually installed, and `presets` cross-checks $PATH.
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
  bootTimeoutMs: 90_000,
  replyTimeoutMs: 300_000,
  readLines: 200,
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

/**
 * What's missing before the skill can launch. Empty array = ready — which is the
 * zero-config case, since the built-in presets are always launchable.
 */
export function validate(c: HerdrConfig): string[] {
  const problems: string[] = [];
  for (const [name, preset] of Object.entries(c.agents ?? {})) {
    const merged = { ...BUILTIN_AGENTS[name], ...preset };
    if (!merged.command?.length) problems.push(`agents.${name}.command is not set (argv array, e.g. ["claude"])`);
    else if (!Array.isArray(merged.command) || merged.command.some((a) => typeof a !== "string"))
      problems.push(`agents.${name}.command must be an array of strings`);
    if (merged.split && merged.split !== "right" && merged.split !== "down")
      problems.push(`agents.${name}.split must be "right" or "down"`);
  }
  const d = c.defaults ?? {};
  if (d.agent && !agents(c)[d.agent]) problems.push(`defaults.agent "${d.agent}" is not a configured preset`);
  if (d.split && d.split !== "right" && d.split !== "down") problems.push('defaults.split must be "right" or "down"');
  return problems;
}
