// Atlassian's config, read through the agent-config CLI (ACS v2) — see
// plugins/ml-agent-config/docs/working-actions.md. The keys are declared in
// ../../agent-config.json; this file spawns the CLI, types what it answers, and holds the
// inference that turns a few keys into a usable site. There is no credential resolver here: a
// token arrives on fd 3 of `agent-config load`, never on stdout, argv or disk.

import { spawn, spawnSync } from "child_process";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";

const NAME = "atlassian";
/** The skill folder, which holds agent-config.json. Passed as --from, so a git checkout works too. */
const SKILL_DIR = resolve(import.meta.dir, "..", "..");
const INSTALL_LINK = "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config";

export type Layer = "global" | "repo" | "user-repo" | "local";
export type Product = "jira" | "confluence";
export type Deployment = "cloud" | "server";
export type AuthMode = "basic" | "bearer";

/** A reference to where a secret lives. Never the secret. */
export interface CredentialRef {
  source: string;
  ref?: string;
  account?: string;
  var?: string;
  path?: string;
  service?: string;
  command?: string;
  cacheVar?: string;
}

export interface StorageTarget {
  enabled: boolean;
  path: string;
}

export interface ProductSettings {
  baseUrl?: string;
  /** Omit to infer from baseUrl: *.atlassian.net is cloud, anything else is server. */
  deployment?: Deployment;
  /** Jira only. */
  defaultProject?: string;
  /** Confluence only. */
  defaultSpace?: string;
  /** Overrides auth.mode for this product — needed when one host is Cloud and the other on-prem. */
  authMode?: AuthMode;
  /** Overrides auth.email for this product. */
  email?: string;
}

export interface AtlassianConfig {
  credentials?: {
    /** Used by both products unless a product-specific token is set. */
    token?: CredentialRef;
    jiraToken?: CredentialRef;
    confluenceToken?: CredentialRef;
  };
  auth?: {
    /** Inferred per product from deployment when absent: cloud→basic, server→bearer. */
    mode?: AuthMode;
    /** Atlassian account email. Required for Cloud basic auth; not a secret, so it lives in plain config. */
    email?: string;
  };
  jira?: ProductSettings;
  confluence?: ProductSettings;
  /** Named work streams — see lib/scope.ts for how they narrow queries. */
  scopes?: Record<string, import("./scope").Scope>;
  defaultScope?: string;
  /** Friendly name → Jira field id, so callers write `points` not `customfield_10016`. */
  fields?: Record<string, string>;
  /** Shorthand → accountId (Cloud) or username (Data Center). */
  people?: Record<string, string>;
  /** Standing limits, independent of any --yes passed at the call site. */
  safety?: { allowDelete?: boolean; allowPurge?: boolean; readOnly?: boolean };
  defaults?: { issueType?: string };
  storage?: { exports?: StorageTarget };
}

export interface Problem {
  code: string;
  message: string;
}

/** What `agent-config start` answers: ready or not, with the merged config either way. */
export interface Plan {
  ready: boolean;
  config: AtlassianConfig;
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
  throw new AgentConfigError(`agent-config is not installed, and the Atlassian skill reads its config through it: ${INSTALL_LINK}`, 127);
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

/**
 * The declaration fills unset keys with "" or "auto" so every key has a value to show and edit.
 * Here both mean "not set", so the inference below reads them as absent, exactly as before.
 */
const UNSET_WHEN_EMPTY = [
  "auth.mode",
  "auth.email",
  "jira.authMode",
  "jira.email",
  "jira.defaultProject",
  "confluence.baseUrl",
  "confluence.deployment",
  "confluence.authMode",
  "confluence.email",
  "confluence.defaultSpace",
  "defaultScope",
  "defaults.issueType",
];

function normalise(config: AtlassianConfig): AtlassianConfig {
  for (const path of UNSET_WHEN_EMPTY) {
    const parts = path.split(".");
    const leaf = parts.pop()!;
    let parent: any = config;
    for (const part of parts) parent = parent?.[part];
    if (parent && (parent[leaf] === "" || parent[leaf] === "auto")) delete parent[leaf];
  }
  return config;
}

/** What the skill still needs. Not being configured is an answer here, not an error. */
export function startPlan(): Plan {
  const plan = run<Plan>(["start", NAME]);
  return { ...plan, config: normalise(plan.config) };
}

/** The merged config. Fails (exit 2) when a required key is missing. */
export function loadConfig(): AtlassianConfig {
  return normalise(run<{ config: AtlassianConfig }>(["load", NAME]).config);
}

const secrets = new Map<string, Promise<string>>();

/**
 * One secret, from fd 3 of `agent-config load`. Cached per key for the process, so Jira and
 * Confluence sharing credentials.token cost one resolution, and only when a call needs it.
 */
export function loadSecret(key: string): Promise<string> {
  let pending = secrets.get(key);
  if (!pending) {
    pending = readSecret(key);
    secrets.set(key, pending);
  }
  return pending;
}

async function readSecret(key: string): Promise<string> {
  const args = ["load", NAME, "--secrets", key, "--from", SKILL_DIR];
  const child = spawn(binary(), args, { stdio: ["ignore", "ignore", "pipe", "pipe"] });
  const read = (stream: NodeJS.ReadableStream | null) =>
    new Promise<string>((done) => {
      let text = "";
      if (!stream) return done(text);
      stream.on("data", (chunk) => (text += chunk));
      stream.on("end", () => done(text));
    });
  const [stderr, out, code] = await Promise.all([
    read(child.stderr),
    read(child.stdio[3] as NodeJS.ReadableStream),
    new Promise<number>((done) => child.on("close", (exit) => done(exit ?? 1))),
  ]);
  if (code !== 0) throw failure(args, code, stderr);
  const value = (JSON.parse(out) as Record<string, string>)[key];
  if (!value) throw new AgentConfigError(`agent-config resolved no value for ${key}`, 3);
  return value;
}

/** Where each layer lives; `path` is null for a layer that needs a repository this is not in. */
export function layerPaths(): { layer: Layer; path: string | null; exists: boolean }[] {
  return run<{ layers: { layer: Layer; path: string | null; exists: boolean }[] }>(["path", NAME]).layers;
}

/** How a reference reads to a person: where the secret lives, never the secret. */
export function describeCredential(ref: CredentialRef): string {
  const where =
    ref.source === "1password" ? `1Password: ${ref.ref}${ref.account ? ` (account ${ref.account})` : ""}`
    : ref.source === "env" ? `environment variable ${ref.var}`
    : ref.source === "dotenv" ? `${ref.path} → ${ref.var}`
    : ref.source === "keychain" ? `macOS Keychain: ${ref.service} / ${ref.account}`
    : ref.source === "command" ? `command: ${ref.command}`
    : `unknown source "${ref.source}"`;
  return ref.cacheVar ? `${where} (cached in $${ref.cacheVar} when set)` : where;
}

export function repoRoot(): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

/** Resolve a configured path: `~` expands to home, relative resolves from repo root (or cwd). */
export function expandPath(p: string): string {
  if (p.startsWith("~/")) return join(process.env.HOME || homedir(), p.slice(2));
  if (isAbsolute(p)) return p;
  return resolve(repoRoot() ?? process.cwd(), p);
}

/**
 * Cloud hosts are the only ones we can identify by name. Everything else is
 * assumed on-prem, which is the safe default: guessing "cloud" for a self-hosted
 * host would send v3/ADF payloads that Data Center rejects with a bare 400.
 */
export function inferDeployment(baseUrl: string): Deployment {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "server";
  }
  return host.endsWith(".atlassian.net") || host.endsWith(".jira.com") || host.endsWith(".atlassian.com")
    ? "cloud"
    : "server";
}

export interface ResolvedProduct {
  product: Product;
  baseUrl: string;
  deployment: Deployment;
  authMode: AuthMode;
  email?: string;
  credential: CredentialRef;
  /** Which config key the credential came from, for error messages. */
  credentialKey: string;
  /** The token, resolved on first use. Listing config or printing help never prompts. */
  secret: () => Promise<string>;
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/**
 * Confluence Cloud lives under /wiki on the site host. Users routinely configure
 * the bare site URL, so normalise rather than fail — a missing /wiki produces a
 * 404 that reads like a broken skill.
 */
function normaliseBaseUrl(product: Product, url: string, deployment: Deployment): string {
  const base = stripSlash(url);
  if (product !== "confluence" || deployment !== "cloud") return base;
  return /\/wiki$/.test(base) ? base : `${base}/wiki`;
}

/** Everything a client needs for one product, with inference applied. Throws if unusable. */
export function resolveProduct(cfg: AtlassianConfig, product: Product): ResolvedProduct {
  const problems = validate(cfg, product);
  if (problems.length) {
    throw new Error(`${product} is not configured:\n  - ${problems.join("\n  - ")}`);
  }
  const settings = cfg[product] ?? {};
  // A Cloud site serves both products from one host, so Jira's base URL is a
  // usable fallback for Confluence (plus /wiki). On-prem they are separate
  // systems and validate() has already insisted on an explicit URL.
  const rawUrl = settings.baseUrl ?? cfg.jira?.baseUrl!;
  const deployment = settings.deployment ?? inferDeployment(rawUrl);
  const authMode = settings.authMode ?? cfg.auth?.mode ?? (deployment === "cloud" ? "basic" : "bearer");
  const perProduct = product === "jira" ? cfg.credentials?.jiraToken : cfg.credentials?.confluenceToken;
  const credential = perProduct ?? cfg.credentials?.token!;
  const credentialKey = perProduct
    ? `credentials.${product}Token`
    : "credentials.token";

  return {
    product,
    baseUrl: normaliseBaseUrl(product, rawUrl, deployment),
    deployment,
    authMode,
    email: settings.email ?? cfg.auth?.email,
    credential,
    credentialKey,
    secret: () => loadSecret(credentialKey),
  };
}

const CREDENTIAL_FIELDS: Record<string, string[]> = {
  "1password": ["ref"],
  env: ["var"],
  dotenv: ["path", "var"],
  keychain: ["service", "account"],
  command: ["command"],
};

function validateCredential(ref: CredentialRef | undefined, key: string): string[] {
  if (!ref) return [`${key} is not set`];
  const required = CREDENTIAL_FIELDS[ref.source];
  if (!required) return [`${key}.source "${ref.source}" is not a known source`];
  return required.filter((f) => !(ref as any)[f]).map((f) => `${key}.${f} is required for source "${ref.source}"`);
}

/**
 * What's missing before this product can make a call. Empty array = ready. `agent-config` checks
 * the declared keys; this adds what a declaration can't say: Confluence's host on Data Center,
 * basic auth's email under a mode override, and the per-product token overrides.
 */
export function validate(cfg: AtlassianConfig, product: Product): string[] {
  const problems: string[] = [];
  const settings = cfg[product] ?? {};

  const inheritedUrl = product === "confluence" ? cfg.jira?.baseUrl : undefined;
  const rawUrl = settings.baseUrl ?? inheritedUrl;
  if (!rawUrl) {
    problems.push(`${product}.baseUrl is not set`);
  } else {
    const deployment = settings.deployment ?? inferDeployment(rawUrl);
    if (settings.baseUrl === undefined && deployment !== "cloud") {
      // Inheriting Jira's host only makes sense on Cloud, where one site serves both.
      problems.push(`${product}.baseUrl is not set (cannot inherit from jira.baseUrl on a server deployment)`);
    }
    const authMode = settings.authMode ?? cfg.auth?.mode ?? (deployment === "cloud" ? "basic" : "bearer");
    if (authMode === "basic" && !(settings.email ?? cfg.auth?.email)) {
      problems.push(`auth.email is required for basic auth (Cloud API tokens authenticate as email:token)`);
    }
  }

  const perProduct = product === "jira" ? cfg.credentials?.jiraToken : cfg.credentials?.confluenceToken;
  problems.push(
    ...(perProduct
      ? validateCredential(perProduct, `credentials.${product}Token`)
      : validateCredential(cfg.credentials?.token, "credentials.token")),
  );
  return problems;
}
