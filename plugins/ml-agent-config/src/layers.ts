// The config layers, their merge, and every write that touches disk.
//
// D1 added `user-repo` between `repo` and `local`: one user's settings for one repository, held
// user-side and keyed on repo identity, so they reach every worktree — which `config.local.json`,
// being per-checkout, never does.
//
// D6 added two artifacts to every write. The schema snapshot travels with the config file and
// shares its fate, because it is the input the next migration diffs against and a committed repo
// layer must carry it to teammates. The edit journal is user-side and never committed, and skips
// the repo layer, where `git log` already does the job with author and date.
//
// Contexts add two layers per matched context between `global` and `repo`: the team file, then the
// user's own `me` file, outermost context first. They live user-side under `~/.agents/contexts/`,
// so they need no repository and nothing to gitignore.
//
// Contexts also bring the first file synced from other people, and the repo layer always was one.
// A credential reference runs a command or reads a variable on `load`, so it is honoured only from
// a layer the user wrote here; an untrusted file's `credentials` subtree is stripped before the merge.

import { homedir } from "os";
import { join, relative } from "path";
import { spawnSync } from "child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync } from "fs";
import { CONFIG_DIR, writeFileAtomic, type RepoContext } from "./repo";
import { merge, type ConfigValue } from "./key-schema";
import type { MatchedContext } from "./contexts";

export { writeFileAtomic };

/** A matched context's team layer, or (with `:me`) the user's own layer for it. */
export type ContextLayer = `context:${string}` | `context:${string}:me`;
export type Layer = "global" | ContextLayer | "repo" | "user-repo" | "local";
/** The fixed layers, for callers that list them. The merge order, contexts included, is `layerOrder`. */
export const LAYERS: Layer[] = ["global", "repo", "user-repo", "local"];

const CONTEXT_PREFIX = "context:";
const ME_SUFFIX = ":me";

/**
 * Why `name` cannot be a context name, or null when it can. A context name is one path segment
 * with no colon, so it stays inside `~/.agents/contexts/` and a `:me` suffix is never ambiguous. It
 * is not `order.json`, which sits beside the contexts, and does not start with a dot, which hides it.
 */
export function invalidContextName(name: string): string | null {
  if (name === "") return "it is empty";
  if (name === "." || name === "..") return `"${name}" is not a directory name`;
  if (/[:/\\]/.test(name)) return "it contains a colon, a slash or a backslash";
  if (name === "order.json") return `"order.json" is reserved for the order of the contexts`;
  if (name.startsWith(".")) return "it starts with a dot, which makes it hidden";
  return null;
}

/**
 * The context a context layer names, and whether it is the `me` layer. Null for a fixed layer; a
 * malformed `context:` layer is a ConfigError, so it can never pass for a fixed layer.
 */
export function contextOf(layer: string): { context: string; me: boolean } | null {
  if (!layer.startsWith(CONTEXT_PREFIX)) return null;
  const rest = layer.slice(CONTEXT_PREFIX.length);
  const me = rest.endsWith(ME_SUFFIX);
  const context = me ? rest.slice(0, -ME_SUFFIX.length) : rest;
  const invalid = invalidContextName(context);
  if (invalid) throw new ConfigError(`Layer "${layer}" does not name a valid context, because ${invalid}`);
  return { context, me };
}

/** Each matched context's team layer then its `me` layer, in chain order (outermost first). */
export function contextLayers(chain: MatchedContext[]): ContextLayer[] {
  return chain.flatMap(({ name }): ContextLayer[] => [`context:${name}`, `context:${name}:me`]);
}

/** The merge order: global, the context layers, then repo, user-repo and local. */
export function layerOrder(chain: MatchedContext[]): Layer[] {
  return ["global", ...contextLayers(chain), "repo", "user-repo", "local"];
}

/** A `--layer` value as a Layer, or a ConfigError naming what is accepted. */
export function parseLayer(value: string): Layer {
  if (LAYERS.includes(value as Layer) || contextOf(value)) return value as Layer;
  // contextOf has already thrown for a malformed `context:` value.
  throw new ConfigError(`Unknown layer "${value}" (${LAYERS.join(", ")}, context:<name>, context:<name>:me)`);
}

/** The key each config file stamps its component's schema version into (D6). */
export const SCHEMA_VERSION_KEY = "schemaVersion";

const LOCAL_GITIGNORE_PATTERNS = [
  `${CONFIG_DIR}/*/config.local.json`,
  `${CONFIG_DIR}/*/config.local.schema-snapshot.json`,
];
const JOURNAL_DEPTH = 3;

// Defined in key-schema.ts, which has no Node, so the hooks module reads the same type.
export type { ConfigValue };
export type ConfigObject = { [key: string]: ConfigValue };

export interface LayerFile {
  layer: Layer;
  /** null when the layer cannot exist here — repo and local outside a repo, user-repo with no identity. Never null for a context layer. */
  path: string | null;
  snapshot: string | null;
  exists: boolean;
  /** The stamp inside the file, or null when the file is absent or carries none. */
  schemaVersion: number | null;
  /** Whether its credential references are honoured: true only for a file the user wrote here. */
  trusted: boolean;
}

function isPlainObject(value: ConfigValue | undefined): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where one layer's file sits. `user-repo` nests the repo identity as directories rather than
 * escaping it into one segment, so `github.com/Owner/Name` stays readable and cannot collide with
 * a minted `mint/<hex>` id. A context layer sits at `~/.agents/contexts/<context>/<name>/`, as
 * `config.json` (team) or `config.me.json` (me).
 */
export function layerPath(name: string, layer: Layer, repo: RepoContext, home: string = homedir()): string | null {
  const context = contextOf(layer);
  if (context) return join(home, ".agents", "contexts", context.context, name, context.me ? "config.me.json" : "config.json");
  const base = join(home, CONFIG_DIR, name);
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
  const context = contextOf(layer);
  if (context) return join(base, "context", context.context, context.me ? "me-journal.json" : "journal.json");
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

/**
 * One layer's own value for a key, as the merge sees it. A parent that is null or a plain value
 * replaces the inherited object, so it hides the key as surely as a null on the key itself: it reads
 * as null, blocked, not as unset.
 */
export function ownValueAt(config: ConfigObject, dotPath: string): ConfigValue | undefined {
  let cursor: ConfigValue | undefined = config;
  for (const segment of dotPath.split(".")) {
    if (cursor === undefined) return undefined;
    if (!isPlainObject(cursor)) return null;
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
  /** Each untrusted file whose credential references were stripped, and the leaf paths stripped. */
  untrusted: { layer: Layer; path: string; keys: string[] }[];
}

/**
 * Whether the file at `path`, inside `checkout`, is one git does not track, and so the user's own.
 * It fails closed: anything that leaves the answer in doubt is false. A symlink between the checkout
 * and the file is refused outright, because git does not follow one and would call a committed file
 * behind it untracked. Only `ls-files` exit 1 ("did not match") means untracked; exit 0 is tracked,
 * and any other exit (no repo, an unreadable index, `safe.directory`) or a spawn error is doubt.
 * `check-ignore` adds nothing: git never reports a tracked path as ignored.
 */
export function untrackedIn(path: string, checkout: string): boolean {
  let real: string;
  let root: string;
  try {
    real = realpathSync(path);
    root = realpathSync(checkout);
  } catch {
    return false;
  }
  const inside = relative(checkout, path);
  if (inside === "" || inside.startsWith("..") || join(root, inside) !== real) return false;
  const listed = spawnSync("git", ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", inside], { cwd: root });
  return !listed.error && listed.status === 1;
}

/**
 * Whether a layer's credential references are honoured. The repo layer and a context's team file
 * come from other people. `config.local.json` is the user's own only while git does not track it:
 * a tracked one arrived with the checkout, like the repo layer.
 */
function isTrusted(layer: Layer, path: string | null, exists: boolean, checkout: string | null): boolean {
  const context = contextOf(layer);
  if (context) return context.me;
  if (layer === "repo") return false;
  if (layer !== "local" || !path || !exists || !checkout) return true;
  return untrackedIn(path, checkout);
}

/** One entry per layer of `layerOrder(chain)`, in merge order. */
export function layerFiles(name: string, repo: RepoContext, chain: MatchedContext[]): LayerFile[] {
  return layerOrder(chain).map((layer) => {
    const path = layerPath(name, layer, repo);
    if (!path) {
      return { layer, path: null, snapshot: null, exists: false, schemaVersion: null, trusted: isTrusted(layer, null, false, null) };
    }
    const parsed = readConfigFile(path);
    const stamp = parsed?.[SCHEMA_VERSION_KEY];
    return {
      layer,
      path,
      snapshot: snapshotPath(path),
      exists: parsed !== null,
      schemaVersion: typeof stamp === "number" ? stamp : null,
      trusted: isTrusted(layer, path, parsed !== null, repo.checkout),
    };
  });
}

/** A layer's contents as the merge takes them: an untrusted file without its `credentials` subtree. */
export function honoured(config: ConfigObject, file: { trusted: boolean }): ConfigObject {
  if (file.trusted || !isPlainObject(config) || !("credentials" in config)) return config;
  const { credentials, ...rest } = config;
  void credentials;
  return rest;
}

/** The leaf paths of `config`'s `credentials` subtree, `credentials.token.source` style. */
export function credentialLeaves(config: ConfigObject): string[] {
  const keys: string[] = [];
  leafPaths(config.credentials, "credentials", keys);
  return keys;
}

/** Merge the layers in `layerOrder(chain)`, recording which layer each surviving leaf came from. */
export function loadLayers(name: string, repo: RepoContext, chain: MatchedContext[]): LoadedLayers {
  let config: ConfigObject = {};
  const provenance: Record<string, Layer> = {};
  const files = layerFiles(name, repo, chain);
  const untrusted: LoadedLayers["untrusted"] = [];

  for (const file of files) {
    if (!file.path || !file.exists) continue;
    const raw = readConfigFile(file.path);
    if (!raw) continue;
    const parsed = honoured(raw, file);
    if (parsed !== raw) untrusted.push({ layer: file.layer, path: file.path, keys: credentialLeaves(raw) });
    const touched: string[] = [];
    leafPaths(parsed, "", touched);
    for (const path of touched) provenance[path] = file.layer;
    config = (merge(config, parsed) ?? {}) as ConfigObject;
  }

  // A null in a later layer deletes the key, so its provenance entry must go with it.
  for (const path of Object.keys(provenance)) {
    if (valueAt(config, path) === undefined) delete provenance[path];
  }
  return { config, provenance, files, untrusted };
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
  /** Null when the schema the answers were written against is unknown, as for an adopted v1 file. */
  snapshot: string | null;
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
  schema: { version: number; declared?: unknown },
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
  writeFileAtomic(path, `${JSON.stringify(stamped, null, 2)}\n`);

  // No snapshot is better than a wrong one: a migration with none interviews the user (D6), while
  // one with the wrong schema would reinterpret the answers against a shape they never had.
  let snapshot: string | null = snapshotPath(path);
  if (schema.declared === undefined) {
    rmSync(snapshot, { force: true });
    snapshot = null;
  } else {
    writeFileAtomic(snapshot, `${JSON.stringify({ version: schema.version, schema: schema.declared }, null, 2)}\n`);
  }

  const result: WriteResult = { layer, path, snapshot, schemaVersion: schema.version };
  if (layer === "local") result.gitignore = ensureGitignored(repo.checkout);

  const journal = journalPath(name, layer, repo);
  if (journal && previous) {
    const entries = [{ at: new Date().toISOString(), config: previous }, ...readJournal(name, layer, repo)].slice(
      0,
      JOURNAL_DEPTH,
    );
    writeFileAtomic(journal, `${JSON.stringify({ entries }, null, 2)}\n`);
    result.journal = { path: journal, depth: entries.length };
  }
  return result;
}

/** A v1 config still sitting at the pre-rename path, and the v2 file of the same layer. */
export interface LegacyFile {
  layer: Layer;
  /** The `.agents/skill-config/` file. */
  path: string;
  /** The `.agents/config/` file of the same layer. */
  current: string;
  /** True when the current file does not exist, so the old answers can be copied over unchanged. */
  adoptable: boolean;
  /**
   * False for a local file git tracks, or cannot vouch for. Adopting its credential references into
   * the v2 local layer, which is gitignored and so trusted, would launder a teammate's command.
   */
  trusted: boolean;
}

/**
 * SCS v1 configs at `.agents/skill-config/<name>/`. v2 does not read them, so each one is either
 * adopted (no v2 file yet for its layer) or reported (a v2 file already wins, and the two are never
 * merged: which answers the person meant is theirs to say).
 */
export function legacyFiles(name: string, repo: RepoContext): LegacyFile[] {
  const candidates: { layer: Layer; path: string }[] = [
    { layer: "global", path: join(homedir(), ".agents", "skill-config", name, "config.json") },
  ];
  if (repo.checkout) {
    candidates.push(
      { layer: "repo", path: join(repo.checkout, ".agents", "skill-config", name, "config.json") },
      { layer: "local", path: join(repo.checkout, ".agents", "skill-config", name, "config.local.json") },
    );
  }
  return candidates
    .filter(({ path }) => existsSync(path))
    .map(({ layer, path }) => {
      const current = layerPath(name, layer, repo)!;
      const trusted = layer !== "local" || untrackedIn(path, repo.checkout!);
      return { layer, path, current, adoptable: !existsSync(current), trusted };
    });
}

/** The schema version every adopted file is stamped with: v1 configs predate versioned schemas. */
export const LEGACY_SCHEMA_VERSION = 1;

/**
 * Copy one v1 file into its v2 layer, through `writeLayer`, so it is checked for inline secrets,
 * stamped, journalled and (for the local layer) gitignored like any other write. The v1 file is
 * left where it is. Its answers are stamped as schema version 1 with no snapshot: when the
 * component's schema has moved past 1, the next `start` emits a migration for this layer, and with
 * no snapshot that migration asks the user rather than guessing.
 */
export interface AdoptResult extends WriteResult {
  /** The credential leaf paths left behind because the v1 file was untrusted. */
  stripped: string[];
}

export function adoptLegacy(name: string, file: LegacyFile, schema: { version: number; declared: unknown }, repo: RepoContext): AdoptResult {
  const parsed = readConfigFile(file.path);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${file.path} does not hold a JSON object, so there is nothing to adopt`);
  }
  // SCS v1 stamped its own format version here; it means nothing to v2.
  const { version, ...answers } = parsed;
  void version;
  const kept = honoured(answers, file);
  const known = schema.version === LEGACY_SCHEMA_VERSION;
  const result = writeLayer(name, file.layer, kept, known ? schema : { version: LEGACY_SCHEMA_VERSION }, repo);
  return { ...result, stripped: kept === answers ? [] : credentialLeaves(answers) };
}
