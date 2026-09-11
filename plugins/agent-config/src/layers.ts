// The four config layers, their merge, and every write that touches disk.
//
// D1 added `user-repo` between `repo` and `local`: one user's settings for one repository, held
// user-side and keyed on repo identity, so they reach every worktree — which `config.local.json`,
// being per-checkout, never does.
//
// D6 added two artifacts to every write. The schema snapshot travels with the config file and
// shares its fate, because it is the input the next migration diffs against and a committed repo
// layer must carry it to teammates. The edit journal is user-side and never committed, and skips
// the repo layer, where `git log` already does the job with author and date.

import { homedir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { CONFIG_DIR, type RepoContext } from "./repo";

export type Layer = "global" | "repo" | "user-repo" | "local";
export const LAYERS: Layer[] = ["global", "repo", "user-repo", "local"];

/** The key each config file stamps its component's schema version into (D6). */
export const SCHEMA_VERSION_KEY = "schemaVersion";

const LOCAL_GITIGNORE_PATTERNS = [
  `${CONFIG_DIR}/*/config.local.json`,
  `${CONFIG_DIR}/*/config.local.schema-snapshot.json`,
];
const JOURNAL_DEPTH = 3;

export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigObject = { [key: string]: ConfigValue };

export interface LayerFile {
  layer: Layer;
  /** null when the layer cannot exist here — repo and local outside a repo, user-repo with no identity. */
  path: string | null;
  snapshot: string | null;
  exists: boolean;
  /** The stamp inside the file, or null when the file is absent or carries none. */
  schemaVersion: number | null;
}

function isPlainObject(value: ConfigValue | undefined): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where one layer's file sits. `user-repo` nests the repo identity as directories rather than
 * escaping it into one segment, so `github.com/Owner/Name` stays readable and cannot collide with
 * a minted `mint/<hex>` id.
 */
export function layerPath(name: string, layer: Layer, repo: RepoContext): string | null {
  const base = join(homedir(), CONFIG_DIR, name);
  if (layer === "global") return join(base, "config.json");
  if (layer === "user-repo") return repo.identity ? join(base, "user-repo", repo.identity, "config.json") : null;
  if (!repo.checkout) return null;
  const inRepo = join(repo.checkout, CONFIG_DIR, name);
  return layer === "repo" ? join(inRepo, "config.json") : join(inRepo, "config.local.json");
}

/** The schema snapshot is a sibling file, so it shares the config's fate in git (D6). */
export function snapshotPath(configPath: string): string {
  return configPath.replace(/\.json$/, ".schema-snapshot.json");
}

function journalPath(name: string, layer: Layer, repo: RepoContext): string | null {
  const base = join(homedir(), ".agents", "journal", name);
  if (layer === "global") return join(base, "global.json");
  if (layer === "user-repo") return repo.identity ? join(base, "user-repo", repo.identity, "journal.json") : null;
  // The repo layer is tracked by git, which journals it better than we can.
  if (layer === "repo" || !repo.checkout) return null;
  return join(base, "local", repo.checkout.replace(/^\/+/, ""), "journal.json");
}

function readConfigFile(path: string): ConfigObject | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as ConfigObject;
  } catch (error) {
    throw new ConfigError(`Config at ${path} is not valid JSON: ${(error as Error).message}`);
  }
}

/** A problem with a declaration or a config file — exit 2, never a crash. */
export class ConfigError extends Error {}

/** Deep merge per ACS: objects merge, arrays and scalars replace, an explicit null deletes. */
function merge(base: ConfigValue | undefined, over: ConfigValue | undefined): ConfigValue | undefined {
  if (over === null) return undefined;
  if (over === undefined || !isPlainObject(over)) return over;
  const target: ConfigObject = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(over)) {
    const merged = merge(target[key], value);
    if (merged === undefined) delete target[key];
    else target[key] = merged;
  }
  return target;
}

function leafPaths(value: ConfigValue, prefix: string, out: string[]): void {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) leafPaths(child, prefix ? `${prefix}.${key}` : key, out);
    return;
  }
  if (prefix) out.push(prefix);
}

export function valueAt(config: ConfigObject, dotPath: string): ConfigValue | undefined {
  let cursor: ConfigValue | undefined = config;
  for (const segment of dotPath.split(".")) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function setValueAt(config: ConfigObject, dotPath: string, value: ConfigValue): void {
  const segments = dotPath.split(".");
  let cursor = config;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!isPlainObject(next)) cursor[segment] = {};
    cursor = cursor[segment] as ConfigObject;
  }
  cursor[segments[segments.length - 1]] = value;
}

export interface LoadedLayers {
  config: ConfigObject;
  /** Leaf dot-path -> the layer that last set it. Defaults are added later, as `default`. */
  provenance: Record<string, Layer>;
  files: LayerFile[];
}

export function layerFiles(name: string, repo: RepoContext): LayerFile[] {
  return LAYERS.map((layer) => {
    const path = layerPath(name, layer, repo);
    if (!path) return { layer, path: null, snapshot: null, exists: false, schemaVersion: null };
    const parsed = readConfigFile(path);
    const stamp = parsed?.[SCHEMA_VERSION_KEY];
    return {
      layer,
      path,
      snapshot: snapshotPath(path),
      exists: parsed !== null,
      schemaVersion: typeof stamp === "number" ? stamp : null,
    };
  });
}

/** Merge the four layers in order, recording which layer each surviving leaf came from. */
export function loadLayers(name: string, repo: RepoContext): LoadedLayers {
  let config: ConfigObject = {};
  const provenance: Record<string, Layer> = {};
  const files = layerFiles(name, repo);

  for (const file of files) {
    if (!file.path || !file.exists) continue;
    const parsed = readConfigFile(file.path);
    if (!parsed) continue;
    const touched: string[] = [];
    leafPaths(parsed, "", touched);
    for (const path of touched) provenance[path] = file.layer;
    config = (merge(config, parsed) ?? {}) as ConfigObject;
  }

  // A null in a later layer deletes the key, so its provenance entry must go with it.
  for (const path of Object.keys(provenance)) {
    if (valueAt(config, path) === undefined) delete provenance[path];
  }
  return { config, provenance, files };
}

/** One layer's own contents, unmerged — what an authored opt-out must be read from (D1). */
export function readLayer(name: string, layer: Layer, repo: RepoContext): ConfigObject | null {
  const path = layerPath(name, layer, repo);
  return path ? readConfigFile(path) : null;
}

const SECRET_LOOKING_KEYS = ["value", "token", "secret", "password", "apikey", "api_key", "key"];

/**
 * Refuse to persist anything that looks like an inlined secret. The repo layer is committed, so
 * this is the one place a leak can still be stopped cheaply.
 */
export function assertNoInlineSecrets(value: ConfigValue, trail: string[] = []): void {
  if (!isPlainObject(value)) return;
  const inCredentials = trail[0] === "credentials";
  for (const [key, child] of Object.entries(value)) {
    const here = [...trail, key];
    if (inCredentials && typeof child === "string" && SECRET_LOOKING_KEYS.includes(key.toLowerCase())) {
      throw new ConfigError(
        `Refusing to write ${here.join(".")}: config files hold credential *references*, never secrets. ` +
          `Use {"source":"env","var":"..."} or another source from standards/agent-config.md.`,
      );
    }
    assertNoInlineSecrets(child, here);
  }
}

export interface GitignoreResult {
  path: string;
  action: "added" | "already-ignored" | "no-repo";
}

/**
 * Append the local-layer patterns to the repo .gitignore if nothing already matches them. Done at
 * write time — asking the user to remember is how secrets get committed. The snapshot sibling goes
 * in too: it shares the config's fate, and the local layer's fate is "never committed".
 */
export function ensureGitignored(checkout: string | null): GitignoreResult {
  if (!checkout) return { path: "", action: "no-repo" };
  const unignored = LOCAL_GITIGNORE_PATTERNS.filter(
    (pattern) =>
      spawnSync("git", ["check-ignore", "-q", join(checkout, pattern.replace("*", "probe"))], { cwd: checkout })
        .status !== 0,
  );
  const gitignore = join(checkout, ".gitignore");
  if (unignored.length === 0) return { path: gitignore, action: "already-ignored" };

  let existing = "";
  try {
    existing = readFileSync(gitignore, "utf8");
  } catch {
    /* no .gitignore yet */
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(
    gitignore,
    `${prefix}\n# Local agent config (may reference secrets) — see standards/agent-config.md\n${unignored.join("\n")}\n`,
  );
  return { path: gitignore, action: "added" };
}

export interface JournalEntry {
  at: string;
  config: ConfigObject;
}

export function readJournal(name: string, layer: Layer, repo: RepoContext): JournalEntry[] {
  const path = journalPath(name, layer, repo);
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: JournalEntry[] };
    return parsed.entries ?? [];
  } catch {
    return [];
  }
}

export interface WriteResult {
  layer: Layer;
  path: string;
  snapshot: string;
  schemaVersion: number;
  gitignore?: GitignoreResult;
  journal?: { path: string; depth: number };
}

/**
 * Write one layer wholesale — the caller merges first, because a partial write cannot express
 * deleting a key. Stamping the schema version and saving the snapshot happen here rather than
 * being left to the caller: a write that forgets them is exactly the write a later migration
 * cannot read.
 */
export function writeLayer(
  name: string,
  layer: Layer,
  config: ConfigObject,
  schema: { version: number; declared: unknown },
  repo: RepoContext,
): WriteResult {
  assertNoInlineSecrets(config);
  const path = layerPath(name, layer, repo);
  if (!path) {
    throw new ConfigError(
      layer === "user-repo"
        ? "The user-repo layer needs a repo identity. Run this inside a repository with an origin, or register it first."
        : `The ${layer} layer needs a git repository; run this inside one, or use the global layer.`,
    );
  }

  const previous = readConfigFile(path);
  const stamped: ConfigObject = { ...config, [SCHEMA_VERSION_KEY]: schema.version };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`);

  const snapshot = snapshotPath(path);
  writeFileSync(snapshot, `${JSON.stringify({ version: schema.version, schema: schema.declared }, null, 2)}\n`);

  const result: WriteResult = { layer, path, snapshot, schemaVersion: schema.version };
  if (layer === "local") result.gitignore = ensureGitignored(repo.checkout);

  const journal = journalPath(name, layer, repo);
  if (journal && previous) {
    const entries = [{ at: new Date().toISOString(), config: previous }, ...readJournal(name, layer, repo)].slice(
      0,
      JOURNAL_DEPTH,
    );
    mkdirSync(dirname(journal), { recursive: true });
    writeFileSync(journal, `${JSON.stringify({ entries }, null, 2)}\n`);
    result.journal = { path: journal, depth: entries.length };
  }
  return result;
}

/** A v1 config still sitting at the pre-rename path. v2 does not read it; the user must be told. */
export function legacyConfigPaths(name: string, repo: RepoContext): string[] {
  const candidates = [join(homedir(), ".agents", "skill-config", name, "config.json")];
  if (repo.checkout) {
    candidates.push(
      join(repo.checkout, ".agents", "skill-config", name, "config.json"),
      join(repo.checkout, ".agents", "skill-config", name, "config.local.json"),
    );
  }
  return candidates.filter(existsSync);
}
