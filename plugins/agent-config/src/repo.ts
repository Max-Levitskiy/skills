// Repository detection, identity, and the repo registry index.
//
// D1 fixed three things this implements. Identity is the normalised origin URL, with a minted id
// only for repositories that have no origin — a repository with no remote cannot be forked, so an
// inherited identity cannot arise there, which is why a committed id is not the primary scheme.
// The registry holds locations only. And the checkout a component runs in is not the repo root:
// worktrees are never registered, and registering from one registers the root.

import { homedir } from "os";
import { join, dirname, isAbsolute, resolve } from "path";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";

export const CONFIG_DIR = ".agents/config";
/** Pre-v2 location. v2 does not read it; retiring it is a one-off move action D5 owns. */
export const LEGACY_CONFIG_DIR = ".agents/skill-config";
const REGISTRY_PATH = join(homedir(), ".agents", "repos.json");

export interface RepoContext {
  /** `git rev-parse --show-toplevel` — this checkout. The repo and local layers live here. */
  checkout: string | null;
  /** The main checkout a worktree resolves back to. What the registry keys a path on. */
  root: string | null;
  /** Normalised origin, or a minted id; null when neither is available. */
  identity: string | null;
  identitySource: "origin" | "minted" | null;
  registered: boolean;
  alias: string | null;
}

interface RegistryEntry {
  path: string;
  alias?: string;
}

interface Registry {
  version: number;
  repos: Record<string, RegistryEntry>;
}

/**
 * `git@github.com:Owner/Name.git` and `https://github.com/Owner/Name` are the same repository, so
 * both normalise to `github.com/Owner/Name`. Only the host is lowercased — forge path segments are
 * case-sensitive on enough hosts that flattening them would merge two real repositories.
 */
function normaliseOrigin(url: string): string | null {
  let rest = url.trim();
  if (!rest) return null;
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");

  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(rest);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(rest);
  const matched = scheme ?? (rest.includes("://") ? null : scp);
  if (!matched) return isAbsolute(rest) ? rest : null;

  const [, host, path] = matched;
  return `${host.toLowerCase()}/${path.replace(/^\/+/, "")}`;
}

function git(args: string[], cwd: string): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Partial<Registry>;
    return { version: parsed.version ?? 1, repos: parsed.repos ?? {} };
  } catch {
    return { version: 1, repos: {} };
  }
}

/** The minted id a no-origin repository committed for itself, if it has one. */
function mintedIdentity(checkout: string): string | null {
  try {
    const own = JSON.parse(readFileSync(join(checkout, CONFIG_DIR, "agent-config", "config.json"), "utf8")) as {
      repo?: { id?: string };
    };
    return own.repo?.id ?? null;
  } catch {
    return null;
  }
}

export function repoContext(cwd = process.cwd()): RepoContext {
  const absent: RepoContext = {
    checkout: null,
    root: null,
    identity: null,
    identitySource: null,
    registered: false,
    alias: null,
  };

  const paths = git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], cwd);
  if (!paths) return absent;
  const [checkout, commonDir] = paths.split("\n");
  if (!checkout) return absent;
  // The common dir of a worktree points into the main checkout, which is the thing to register.
  const root = commonDir ? dirname(commonDir) : checkout;

  const origin = git(["config", "--get", "remote.origin.url"], checkout);
  const fromOrigin = origin ? normaliseOrigin(origin) : null;
  const minted = fromOrigin ? null : mintedIdentity(checkout);
  const identity = fromOrigin ?? minted;

  const entry = identity ? readRegistry().repos[identity] : undefined;
  return {
    checkout,
    root,
    identity,
    identitySource: fromOrigin ? "origin" : minted ? "minted" : null,
    registered: !!entry,
    alias: entry?.alias ?? null,
  };
}

/** Resolve a configured path: `~` expands to home, relative resolves from the checkout. */
export function expandPath(path: string, checkout: string | null): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(checkout ?? process.cwd(), path);
}

export interface RegisterResult {
  identity: string;
  identitySource: "origin" | "minted";
  path: string;
  alias: string | null;
  outcome: "added" | "unchanged" | "repointed";
  /** Set on `repointed` — replacing a path silently repoints fan-out, so it is announced. */
  previousPath?: string;
  /** Set when an identity had to be minted, since that writes a committed file. */
  mintedInto?: string;
}

/**
 * Add or update one entry. Same identity and path is a no-op; same identity at a new path is a
 * replacement, announced rather than silent. Entries are never removed here — D1 keeps deletion
 * explicit and human-invoked.
 */
export function registerRepo(cwd: string, alias: string | null): RegisterResult {
  const context = repoContext(cwd);
  if (!context.checkout || !context.root) {
    throw new Error("Not inside a git repository, so there is nothing to register.");
  }

  let { identity, identitySource } = context;
  let mintedInto: string | undefined;
  if (!identity) {
    // No origin to derive from, so mint one and commit it with the repository (D1).
    identity = `mint/${randomBytes(6).toString("hex")}`;
    identitySource = "minted";
    mintedInto = join(context.root, CONFIG_DIR, "agent-config", "config.json");
    let own: { repo?: { id?: string } } = {};
    try {
      own = JSON.parse(readFileSync(mintedInto, "utf8")) as { repo?: { id?: string } };
    } catch {
      /* first write */
    }
    own.repo = { ...own.repo, id: identity };
    mkdirSync(dirname(mintedInto), { recursive: true });
    writeFileSync(mintedInto, `${JSON.stringify(own, null, 2)}\n`);
  }

  const registry = readRegistry();
  const previous = registry.repos[identity];
  const resolvedAlias = alias ?? previous?.alias ?? null;
  const outcome: RegisterResult["outcome"] = !previous
    ? "added"
    : previous.path !== context.root
      ? "repointed"
      : previous.alias === resolvedAlias
        ? "unchanged"
        : "added";

  registry.repos[identity] = { path: context.root, ...(resolvedAlias ? { alias: resolvedAlias } : {}) };
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

  return {
    identity,
    identitySource: identitySource ?? "minted",
    path: context.root,
    alias: resolvedAlias,
    outcome,
    ...(outcome === "repointed" ? { previousPath: previous?.path } : {}),
    ...(mintedInto ? { mintedInto } : {}),
  };
}

export function registryPath(): string {
  return REGISTRY_PATH;
}

export function registryEntries(): Record<string, RegistryEntry> {
  return readRegistry().repos;
}
