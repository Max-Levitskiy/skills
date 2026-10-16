// orchestrate's config, read through the agent-config CLI (ACS v2) — see
// plugins/ml-agent-config/docs/working-actions.md. The keys are declared in
// ../../agent-config.json; this file only spawns the CLI and types what it answers. There is no
// credential resolver here: a tracker token arrives on fd 3 of `agent-config load`, never on
// stdout, argv or disk.

import { spawn, spawnSync } from "child_process";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";

const NAME = "orchestrate";
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

/** Trackers the orchestrator can drive. Only the remote ones need a credential. */
export type TrackerKind = "file" | "tasknotes" | "github" | "jira" | "linear";

export interface TrackerConfig {
  /** Empty: Phase 1 discovers the tracker. */
  kind?: TrackerKind | "";
  /** github: "gh" uses the gh CLI's login unless a token is configured; "token" requires one. */
  githubAuth?: "gh" | "token";
  /** file / tasknotes: repo-relative path to the tracker file or task folder. */
  path?: string;
  /** github: "owner/repo". */
  repo?: string;
  /** jira: site host, e.g. "acme.atlassian.net", plus the project key and account email. */
  site?: string;
  project?: string;
  email?: string;
  /** linear: team key, e.g. "ENG". */
  team?: string;
  /** Labels applied to every package entry the orchestrator creates. */
  labels?: string[];
}

export interface OrchestrateConfig {
  credentials?: {
    githubToken?: CredentialRef;
    jiraToken?: CredentialRef;
    linearToken?: CredentialRef;
  };
  tracker?: TrackerConfig;
  questions?: { path?: string; human?: string };
  models?: { judgment?: string; mechanical?: string };
  defaults?: { maxParallelAgents?: number; maxPackages?: number; verifyOnDisk?: boolean };
}

/** Which credential each tracker kind needs. `null` = no credential required. */
export const CREDENTIAL_FOR: Record<TrackerKind, keyof NonNullable<OrchestrateConfig["credentials"]> | null> = {
  file: null,
  tasknotes: null,
  github: "githubToken",
  jira: "jiraToken",
  linear: "linearToken",
};

export interface Problem {
  code: string;
  message: string;
}

/** What `agent-config start` answers: ready or not, with the merged config either way. */
export interface Plan {
  ready: boolean;
  config: OrchestrateConfig;
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
  throw new AgentConfigError(`agent-config is not installed, and orchestrate reads its config through it: ${INSTALL_LINK}`, 127);
}

function failure(args: string[], code: number, stderr: string): AgentConfigError {
  const said = stderr.trim() || `agent-config ${args[0]} exited ${code}`;
  return new AgentConfigError(said, code);
}

/** One CLI call, JSON on stdout. */
function run<T>(args: string[]): T {
  const result = spawnSync(binary(), [...args, "--from", SKILL_DIR], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new AgentConfigError(result.error.message, 1);
  if (result.status !== 0) throw failure(args, result.status ?? 1, result.stderr);
  return JSON.parse(result.stdout) as T;
}

/** What orchestrate still needs. Not being configured is an answer here, not an error. */
export function startPlan(): Plan {
  return run<Plan>(["start", NAME]);
}

/** The merged config, defaults applied. Fails (exit 2) when a required key is missing. */
export function loadConfig(): OrchestrateConfig {
  return run<{ config: OrchestrateConfig }>(["load", NAME]).config;
}

/**
 * The config and, when `secret` names a configured credential, its value, in one call so a
 * 1Password reference costs one approval. The value comes back on fd 3 and lives only in this
 * process's memory.
 */
export async function loadWithSecret(
  secret?: keyof NonNullable<OrchestrateConfig["credentials"]>,
): Promise<{ config: OrchestrateConfig; token: string | null }> {
  if (!secret) return { config: loadConfig(), token: null };
  const key = `credentials.${secret}`;
  const args = ["load", NAME, "--secrets", key, "--from", SKILL_DIR];
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
  const token = (JSON.parse(secrets) as Record<string, string>)[key];
  if (!token) throw new AgentConfigError(`agent-config resolved no value for ${key}`, 3);
  return { config: (JSON.parse(stdout) as { config: OrchestrateConfig }).config, token };
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
