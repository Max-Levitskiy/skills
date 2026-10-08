// Fellow's config, read through the agent-config CLI (ACS v2) — see
// plugins/ml-agent-config/docs/working-actions.md. The keys Fellow asks for are declared in
// ../../agent-config.json; this file only spawns the CLI and types what it answers. There is no
// credential resolver here: the API key arrives on fd 3 of `agent-config load`, never on stdout,
// argv or disk.

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import type { ProjectRules, SeriesVerdict } from "./relevance";

const NAME = "fellow";
/** The skill folder, which holds agent-config.json. Passed as --from, so a git checkout works too. */
const SKILL_DIR = resolve(import.meta.dir, "..", "..");
const INSTALL_LINK = "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config";

export type Layer = "global" | "repo" | "user-repo" | "local";

/** A reference to where a secret lives. Never the secret. */
export interface CredentialRef {
  source: string;
  ref?: string;
  var?: string;
  path?: string;
  service?: string;
  account?: string;
  command?: string;
  cacheVar?: string;
}

export interface FellowConfig {
  credentials?: { apiKey?: CredentialRef };
  workspace?: { subdomain?: string };
  storage?: {
    recaps?: { enabled?: boolean; path?: string };
    transcripts?: { enabled?: boolean; path?: string };
    media?: { enabled?: boolean; path?: string };
  };
  /** Named project scopes — see lib/relevance.ts for the matching rules. */
  projects?: Record<string, ProjectRules>;
  defaultProject?: string;
  /** Machine-maintained: calendar series key -> which project it belongs to. */
  series?: Record<string, SeriesVerdict>;
}

export interface Problem {
  code: string;
  message: string;
}

/** What `agent-config start` answers: ready or not, with the merged config either way. */
export interface Plan {
  ready: boolean;
  config: FellowConfig;
  provenance: Record<string, string>;
  actions: { id: string; keys: string[] }[];
  problems: Problem[];
  guide: string;
}

/** A failed CLI call, with the CLI's own diagnosis and exit code (2 config, 3 credential, 4 schema). */
export class AgentConfigError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

/**
 * The agent-config binary, found the way working-actions.md says: AGENT_CONFIG_ROOT, then PATH,
 * then the harness plugin caches. Never a reconstructed install path.
 */
function binary(): string {
  const root = process.env.AGENT_CONFIG_ROOT;
  if (root) return join(root, "bin", "agent-config");
  const onPath = Bun.which("agent-config");
  if (onPath) return onPath;
  const caches = [
    join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins", "cache"),
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "plugins", "cache"),
  ];
  for (const cache of caches) {
    const found = [...new Bun.Glob("*/ml-agent-config/*/bin/agent-config").scanSync({ cwd: cache, onlyFiles: false })]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .pop();
    if (found) return join(cache, found);
  }
  throw new AgentConfigError(`agent-config is not installed, and Fellow reads its config through it: ${INSTALL_LINK}`, 127);
}

function failure(args: string[], code: number, stderr: string): AgentConfigError {
  const said = stderr.trim() || `agent-config ${args[0]} exited ${code}`;
  return new AgentConfigError(said, code);
}

/** One CLI call, JSON on stdout. */
function run<T>(args: string[], stdin?: string): T {
  const result = spawnSync(binary(), [...args, "--from", SKILL_DIR], {
    encoding: "utf8",
    input: stdin,
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw new AgentConfigError(result.error.message, 1);
  if (result.status !== 0) throw failure(args, result.status ?? 1, result.stderr);
  return JSON.parse(result.stdout) as T;
}

/** What Fellow still needs. Not being configured is an answer here, not an error. */
export function startPlan(): Plan {
  return run<Plan>(["start", NAME]);
}

/** The merged config. Fails (exit 2) when a required key is missing. */
export function loadConfig(): FellowConfig {
  return run<{ config: FellowConfig }>(["load", NAME]).config;
}

/**
 * The config and the API key, in one call so a 1Password reference costs one approval. The key
 * comes back on fd 3 and lives only in this process's memory.
 */
export async function loadWithKey(): Promise<{ config: FellowConfig; apiKey: string }> {
  const args = ["load", NAME, "--secrets", "credentials.apiKey", "--from", SKILL_DIR];
  const child = spawn(binary(), args, { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  const read = (stream: NodeJS.ReadableStream | null) =>
    new Promise<string>((done) => {
      let text = "";
      if (!stream) return done(text);
      stream.on("data", (chunk) => (text += chunk));
      stream.on("end", () => done(text));
    });
  const [stdout, stderr, secrets, code] = await Promise.all([
    read(child.stdout),
    read(child.stderr),
    read(child.stdio[3] as NodeJS.ReadableStream),
    new Promise<number>((done) => child.on("close", (exit) => done(exit ?? 1))),
  ]);
  if (code !== 0) throw failure(args, code, stderr);
  const apiKey = (JSON.parse(secrets) as Record<string, string>)["credentials.apiKey"];
  if (!apiKey) throw new AgentConfigError("agent-config resolved no value for credentials.apiKey", 3);
  return { config: (JSON.parse(stdout) as { config: FellowConfig }).config, apiKey };
}

/** Where each layer lives; `path` is null for a layer that needs a repository this is not in. */
export function layerPaths(): { layer: Layer; path: string | null; exists: boolean }[] {
  return run<{ layers: { layer: Layer; path: string | null; exists: boolean }[] }>(["path", NAME]).layers;
}

/** How a reference reads to a person: where the secret lives, never the secret. */
export function describeCredential(ref: CredentialRef): string {
  const where =
    ref.source === "1password" ? `1password ${ref.ref}${ref.account ? ` (account ${ref.account})` : ""}`
    : ref.source === "env" ? `env $${ref.var}`
    : ref.source === "dotenv" ? `dotenv ${ref.path} → ${ref.var}`
    : ref.source === "keychain" ? `keychain service=${ref.service}${ref.account ? ` account=${ref.account}` : ""}`
    : ref.source === "command" ? `command \`${ref.command}\``
    : ref.source;
  return ref.cacheVar ? `${where}  (cached in $${ref.cacheVar} when set)` : where;
}

export function repoRoot(): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** `~/` is home; a relative path resolves from the repo root, or the working directory outside one. */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(repoRoot() ?? process.cwd(), path);
}

/**
 * Persist a series verdict. Writes to the repo layer so teammates inherit classifications already
 * paid for; falls back to global outside a git repo. `write` replaces the whole layer, so the
 * layer's own file is read first and only its `series` key changes.
 */
export function recordSeriesVerdict(
  key: string,
  project: string | null,
  why: string,
  today: string,
): { path: string; layer: Layer } {
  const layers = layerPaths();
  const target = layers.find((one) => one.layer === "repo" && one.path) ?? layers.find((one) => one.layer === "global")!;
  let existing: Record<string, any> = {};
  if (target.exists && target.path && existsSync(target.path)) {
    existing = JSON.parse(readFileSync(target.path, "utf8"));
  }
  existing.series ??= {};
  existing.series[key] = { project, why, at: today };
  const wrote = run<{ path: string }>(["write", NAME, "--layer", target.layer], JSON.stringify(existing));
  return { path: wrote.path, layer: target.layer };
}
