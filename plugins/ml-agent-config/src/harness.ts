// Harness detection and plugin-registry reading.
//
// R1 fixed the detection order and the rule that detection is a filesystem scan, never a CLI
// call: pure `fs` over documented directories is fast, needs no subprocess, and behaves the same
// on both platforms. The CLI is for *building* an install action, not for detecting one.
//
// R3 fixed the other half: never reconstruct an install path. Version path segments vary (semver
// on Claude Code, git SHAs and semver on Codex), the marketplace segment differs per harness for
// the same plugin, and Codex keeps stray backup directories beside real ones.

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export type Harness = "claude" | "codex";
export type DependencyKind = "skill" | "agent";

/** A plugin installed on this machine, at the path the harness itself recorded. */
export interface PluginInstall {
  /** `<plugin>@<marketplace>` on Claude Code; the same form reconstructed on Codex. */
  key: string;
  plugin: string;
  marketplace: string;
  version: string;
  installPath: string;
}

/** `CODEX_HOME` is normally unset and must default (R1). */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/**
 * `CLAUDECODE=1` -> Claude Code; else `CODEX_HOME` or an existing `~/.codex` -> Codex (R1).
 * Neither means we are outside a harness — a bare shell, CI, a cron. Claude Code's layout is the
 * one this marketplace ships for, so it is the terminal default rather than a hard failure.
 */
export function detectHarness(): Harness {
  if (process.env.CLAUDECODE === "1") return "claude";
  if (process.env.CODEX_HOME || existsSync(join(homedir(), ".codex"))) return "codex";
  return "claude";
}

/**
 * The slice of Claude Code's `installed_plugins.json` this reads. Fields stay optional and
 * unknown-ish because the file belongs to the harness and may change shape under us.
 */
interface ClaudeInstalledPlugins {
  plugins?: Record<string, { installPath?: string; version?: string }[]>;
}

/** Parsed JSON from a registry file the harness owns, or null when absent or corrupt. */
function readRegistry<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Subdirectories, ignoring dotfiles. Missing directory reads as empty. */
function subdirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function claudeInstalls(): PluginInstall[] {
  const registry = readRegistry<ClaudeInstalledPlugins>(join(claudeHome(), "plugins", "installed_plugins.json"));
  const plugins = registry?.plugins;
  if (!plugins || typeof plugins !== "object") return [];

  const out: PluginInstall[] = [];
  for (const [key, entries] of Object.entries(plugins)) {
    const at = key.lastIndexOf("@");
    const plugin = at > 0 ? key.slice(0, at) : key;
    const marketplace = at > 0 ? key.slice(at + 1) : "";
    for (const entry of Array.isArray(entries) ? entries : []) {
      const { installPath, version } = entry ?? {};
      if (typeof installPath !== "string" || !existsSync(installPath)) continue;
      out.push({ key, plugin, marketplace, version: typeof version === "string" ? version : "", installPath });
    }
  }
  return out;
}

/**
 * Codex records no installPath anywhere, so the cache layout
 * `plugins/cache/<marketplace>/<plugin>/<version>` is the registry. Backup directories sit beside
 * real ones (`warp` next to `plugin-backup-H32eO8`), so they are skipped by name.
 */
function codexInstalls(): PluginInstall[] {
  const cache = join(codexHome(), "plugins", "cache");
  const out: PluginInstall[] = [];
  for (const marketplace of subdirectories(cache)) {
    for (const plugin of subdirectories(join(cache, marketplace))) {
      if (plugin.startsWith("plugin-backup-")) continue;
      for (const version of subdirectories(join(cache, marketplace, plugin))) {
        if (version.startsWith("plugin-backup-")) continue;
        out.push({
          key: `${plugin}@${marketplace}`,
          plugin,
          marketplace,
          version,
          installPath: join(cache, marketplace, plugin, version),
        });
      }
    }
  }
  return out;
}

let installCache: { harness: Harness; installs: PluginInstall[] } | null = null;

/** Every plugin the detected harness has installed. Read once per process. */
export function pluginInstalls(harness: Harness): PluginInstall[] {
  if (installCache?.harness === harness) return installCache.installs;
  const installs = harness === "claude" ? claudeInstalls() : codexInstalls();
  installCache = { harness, installs };
  return installs;
}

/**
 * Where a skill or agent of this name would sit under one root, most likely first. On Codex an
 * agent is TOML; a plugin authored for Claude Code may still ship Markdown, and Codex reads it.
 */
function candidatePaths(harness: Harness, root: string, kind: DependencyKind, name: string): string[] {
  if (kind === "skill") return [join(root, "skills", name, "SKILL.md")];
  if (harness === "codex") return [join(root, "agents", `${name}.toml`), join(root, "agents", `${name}.md`)];
  return [join(root, "agents", `${name}.md`)];
}

export interface DependencyLookup {
  /** Where it was found, or null when it is not installed. */
  foundAt: string | null;
  /** Plugins carrying something of this bare name — a bare name that collides is never guessed. */
  ambiguousWith: string[];
}

/**
 * Look one declared dependency up on disk. `plugin` is null for a bare name, which D2 allows only
 * for a skill or agent outside any plugin; a bare name that matches installed plugins is reported
 * as ambiguous rather than guessed, because bare names collide (this machine has two
 * `code-review`).
 */
export function findDependency(
  harness: Harness,
  plugin: string | null,
  name: string,
  kind: DependencyKind,
  checkout: string | null,
): DependencyLookup {
  if (plugin) {
    for (const install of pluginInstalls(harness)) {
      if (install.plugin !== plugin) continue;
      const foundAt = candidatePaths(harness, install.installPath, kind, name).find(existsSync);
      if (foundAt) return { foundAt, ambiguousWith: [] };
    }
    return { foundAt: null, ambiguousWith: [] };
  }

  const looseRoots = [harness === "claude" ? claudeHome() : codexHome()];
  if (checkout) looseRoots.push(join(checkout, harness === "claude" ? ".claude" : ".codex"));
  for (const root of looseRoots) {
    const foundAt = candidatePaths(harness, root, kind, name).find(existsSync);
    if (foundAt) return { foundAt, ambiguousWith: [] };
  }

  const collisions = new Set<string>();
  for (const install of pluginInstalls(harness)) {
    if (candidatePaths(harness, install.installPath, kind, name).some(existsSync)) {
      collisions.add(`${install.plugin}:${name}`);
    }
  }
  return { foundAt: null, ambiguousWith: [...collisions] };
}

export function marketplaceKnown(harness: Harness, marketplace: string): boolean {
  if (harness === "codex") return existsSync(join(codexHome(), "plugins", "cache", marketplace));
  const known = readRegistry<Record<string, unknown>>(join(claudeHome(), "plugins", "known_marketplaces.json"));
  return !!known && marketplace in known;
}

/** The command that adds a marketplace the harness does not know yet. */
export function marketplaceCommand(harness: Harness, url: string): string {
  return harness === "codex" ? `codex plugin marketplace add ${url}` : `claude plugin marketplace add ${url}`;
}

/** The command that installs a plugin from a known marketplace. */
export function installCommand(harness: Harness, plugin: string, marketplace: string): string {
  return harness === "codex"
    ? `codex plugin add ${plugin}@${marketplace}`
    : `claude plugin install ${plugin}@${marketplace} -y`;
}

/** What the human must be told to do before a freshly installed plugin is usable (D3). */
export function reloadInstruction(harness: Harness): string {
  return harness === "codex"
    ? "Start a new Codex session — plugins are loaded at session start."
    : "Type /reload-plugins in this session — it is a built-in slash command, so only you can run it.";
}
