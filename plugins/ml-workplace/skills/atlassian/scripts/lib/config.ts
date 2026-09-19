// Skill Config Standard (SCS v1) loader — see standards/skill-config.md
// Layers: ~/.agents (global) -> <repo>/.agents (repo) -> config.local.json (local)

import { homedir } from "os";
import { join, isAbsolute, resolve, dirname } from "path";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";

export const SKILL_NAME = "atlassian";
export const LOCAL_GITIGNORE_PATTERN = ".agents/skill-config/*/config.local.json";

export type Layer = "global" | "repo" | "local";
export type Product = "jira" | "confluence";
export type Deployment = "cloud" | "server";
export type AuthMode = "basic" | "bearer";

export interface CredentialRef {
  source: "1password" | "env" | "dotenv" | "keychain" | "command";
  ref?: string;
  account?: string;
  var?: string;
  path?: string;
  service?: string;
  command?: string;
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
  version?: number;
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
  defaults?: { pageSize?: number; maxResults?: number; issueType?: string };
  storage?: { exports?: StorageTarget };
}

/**
 * $HOME first, matching POSIX semantics. Bun's os.homedir() caches the value at
 * process start, so honouring the environment is both more correct and the only
 * way a test (or a CI job with its own HOME) can redirect the global layer.
 */
export function configHome(): string {
  return process.env.HOME || homedir();
}

export function repoRoot(): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

export function layerPath(layer: Layer, root = repoRoot()): string | null {
  const dir = `.agents/skill-config/${SKILL_NAME}`;
  if (layer === "global") return join(configHome(), dir, "config.json");
  if (!root) return null; // repo/local layers need a git repo
  return join(root, dir, layer === "repo" ? "config.json" : "config.local.json");
}

/** Deep merge per SCS: objects merge, arrays/scalars replace, explicit null deletes. */
function merge(base: any, over: any): any {
  if (over === null) return undefined;
  if (Array.isArray(over) || typeof over !== "object" || over === undefined) return over;
  if (typeof base !== "object" || base === null || Array.isArray(base)) base = {};
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const merged = merge(base[k], v);
    if (merged === undefined) delete out[k];
    else out[k] = merged;
  }
  return out;
}

export interface LoadedConfig {
  config: AtlassianConfig;
  /** Which layers were actually found on disk, in precedence order. */
  found: { layer: Layer; path: string }[];
  missing: { layer: Layer; path: string }[];
}

export function loadConfig(): LoadedConfig {
  const root = repoRoot();
  const found: { layer: Layer; path: string }[] = [];
  const missing: { layer: Layer; path: string }[] = [];
  let config: AtlassianConfig = {};

  for (const layer of ["global", "repo", "local"] as Layer[]) {
    const p = layerPath(layer, root);
    if (!p) continue;
    let raw: string;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      missing.push({ layer, path: p });
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      throw new Error(`Config at ${p} is not valid JSON: ${e.message}`);
    }
    config = merge(config, parsed);
    found.push({ layer, path: p });
  }
  return { config, found, missing };
}

/** Resolve a configured path: `~` expands to home, relative resolves from repo root (or cwd). */
export function expandPath(p: string): string {
  if (p.startsWith("~/")) return join(configHome(), p.slice(2));
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

/** What's missing before this product can make a call. Empty array = ready. */
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

/** Write a config layer, creating parent directories. Returns the path written. */
export function writeLayer(layer: Layer, config: AtlassianConfig): string {
  const path = layerPath(layer);
  if (!path) throw new Error(`The ${layer} layer requires a git repository; run from inside one or use --layer global.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}

/**
 * Ensure the local layer can't be committed. Done at write time because asking
 * the user to remember is how secrets-adjacent files end up in git history.
 */
export function ensureGitignored(): { path: string; added: boolean } {
  const root = repoRoot();
  if (!root) throw new Error("Not inside a git repository — nothing to gitignore.");
  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.split("\n").some((l) => l.trim() === LOCAL_GITIGNORE_PATTERN)) {
    return { path, added: false };
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${prefix}${LOCAL_GITIGNORE_PATTERN}\n`);
  return { path, added: true };
}
