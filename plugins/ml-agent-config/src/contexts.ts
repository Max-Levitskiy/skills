// Contexts: named groups of places, matched by git remote (the team file, `context.json`) or by
// local path (the user's own file, `context.me.json`), and nestable through `parent`.
//
// This module reads the definitions under `~/.agents/contexts/` and creates new ones, matches them
// against a Place and orders what matched into a chain, outermost first. Turning the chain into config layers is not
// done here.

import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { randomBytes } from "crypto";
import { compileGlob } from "./glob";
import { ConfigError, invalidContextName, writeFileAtomic } from "./layers";
import type { Place } from "./place";
import type { Problem } from "./types";

export const CONTEXTS_DIR = ".agents/contexts";
const TEAM_FILE = "context.json";
const ME_FILE = "context.me.json";
const ORDER_FILE = "order.json";

/** One filter. The `/i` key variants (`remote/i`, `path/i`) set `ignoreCase`. */
export interface MatchEntry {
  remote?: string;
  path?: string;
  ignoreCase?: boolean;
}

export interface ContextDef {
  name: string;
  id: string | null;
  parent: string | null;
  dir: string;
  /** Remote filters from `context.json`. */
  team: MatchEntry[];
  /** Path filters from `context.me.json`. */
  me: MatchEntry[];
  /** True when neither file contributes a usable filter: the context then matches only when named. */
  abstract: boolean;
}

export interface ContextStore {
  defs: Map<string, ContextDef>;
  /** The names `order.json` lists, which rank root contexts; empty when the file is missing. */
  order: string[];
  problems: Problem[];
  /** The home directory the store was read from; `~` in a path filter stands for it. */
  home: string;
}

export interface MatchedContext {
  name: string;
  via: "remote" | "path" | "parent" | "explicit";
  /** The filter that matched; absent for `parent` and `explicit`. */
  entry?: MatchEntry;
}

type MatchKind = "remote" | "path";
type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Parses a JSON file, or returns the reason it could not be read. */
function readJson(path: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * The filters of one file that use `kind`. A key of the other kind does not belong in this file:
 * it is ignored, and reported once for the file. An entry with neither kind is ignored silently.
 */
function readEntries(raw: unknown[], kind: MatchKind, file: string, problems: Problem[]): MatchEntry[] {
  const stray: MatchKind = kind === "remote" ? "path" : "remote";
  const entries: MatchEntry[] = [];
  let strayFound = false;
  for (const item of raw) {
    if (!isObject(item)) continue;
    if (stray in item || `${stray}/i` in item) strayFound = true;
    if (typeof item[kind] === "string") entries.push({ [kind]: item[kind] });
    else if (typeof item[`${kind}/i`] === "string") entries.push({ [kind]: item[`${kind}/i`], ignoreCase: true });
  }
  if (strayFound) {
    problems.push({
      code: "context-stray-path",
      message: `${file} has a "${stray}" filter, which belongs in ${kind === "remote" ? ME_FILE : TEAM_FILE}; it is ignored`,
      path: file,
    });
  }
  return entries;
}

/** Reads one context file's object, or reports it unparsable and returns null. */
function readContextFile(file: string, kind: "team" | "me", problems: Problem[]): JsonObject | null {
  const read = readJson(file);
  let reason: string | null = null;
  if ("error" in read) reason = read.error;
  else if (!isObject(read.value)) reason = "it does not hold a JSON object";
  else if (read.value.match !== undefined && !Array.isArray(read.value.match)) reason = '"match" is not an array';
  else if (kind === "team" && read.value.parent != null && typeof read.value.parent !== "string")
    reason = '"parent" is not a string';
  if (reason === null) return read.value as JsonObject;
  problems.push({ code: "context-unparsable", message: `${file} could not be read: ${reason}`, path: file });
  return null;
}

function readContext(name: string, dir: string, problems: Problem[]): ContextDef | null {
  const teamFile = join(dir, TEAM_FILE);
  const team = readContextFile(teamFile, "team", problems);
  if (!team) return null;

  const meFile = join(dir, ME_FILE);
  const me = existsSync(meFile) ? readContextFile(meFile, "me", problems) : null;

  const teamEntries = readEntries((team.match as unknown[] | undefined) ?? [], "remote", teamFile, problems);
  const meEntries = readEntries((me?.match as unknown[] | undefined) ?? [], "path", meFile, problems);
  return {
    name,
    id: typeof team.id === "string" ? team.id : null,
    parent: typeof team.parent === "string" ? team.parent : null,
    dir,
    team: teamEntries,
    me: meEntries,
    abstract: teamEntries.length === 0 && meEntries.length === 0,
  };
}

function readOrder(file: string, problems: Problem[]): string[] {
  if (!existsSync(file)) return [];
  const read = readJson(file);
  if ("value" in read && Array.isArray(read.value) && read.value.every((n) => typeof n === "string")) {
    return read.value as string[];
  }
  const reason = "error" in read ? read.error : "it is not an array of context names";
  problems.push({ code: "context-unparsable", message: `${file} could not be read: ${reason}`, path: file });
  return [];
}

/**
 * Every context under `<home>/.agents/contexts/`. A context whose `context.json` cannot be read is
 * left out and reported as `context-unparsable`, as is a directory whose name is not a valid
 * context name; a directory with no `context.json` is reported as `context-stray-dir`. A hidden
 * entry is skipped silently.
 */
export function readContexts(home: string = homedir()): ContextStore {
  const root = join(home, CONTEXTS_DIR);
  const store: ContextStore = { defs: new Map(), order: [], problems: [], home };
  if (!isDirectory(root)) return store;

  for (const name of readdirSync(root).sort()) {
    // A hidden entry, such as `.git` when the store is a clone, is never a context and never a problem.
    if (name.startsWith(".")) continue;
    const dir = join(root, name);
    if (!isDirectory(dir)) continue;
    const invalid = invalidContextName(name);
    if (invalid) {
      store.problems.push({
        code: "context-unparsable",
        message: `${dir} is not a valid context name, because ${invalid}; it is ignored`,
        path: dir,
      });
      continue;
    }
    if (!existsSync(join(dir, TEAM_FILE))) {
      store.problems.push({
        code: "context-stray-dir",
        message: `${dir} has no ${TEAM_FILE}, so it is not a context`,
        path: dir,
      });
      continue;
    }
    const def = readContext(name, dir, store.problems);
    if (def) store.defs.set(name, def);
  }
  store.order = readOrder(join(root, ORDER_FILE), store.problems);
  return store;
}

/** The context `name`, or a ConfigError saying what named it and why it is not usable. */
function lookup(store: ContextStore, name: string, namedBy: string): ContextDef {
  const def = store.defs.get(name);
  if (def) return def;
  const file = join(store.home, CONTEXTS_DIR, name, TEAM_FILE);
  const broken = store.problems.find((p) => p.code === "context-unparsable" && p.path === file);
  throw new ConfigError(`${namedBy}, which ${broken ? `is unusable: ${broken.message}` : "does not exist"}`);
}

export interface AddedContext {
  dir: string;
  id: string;
  /** The `context.json` written. */
  team: string;
  /** The `context.me.json` written, or null when no path filter was given. */
  me: string | null;
}

/**
 * Create the context `name`: remote filters in the team file, with a fresh id and the parent, and
 * path filters in the user's own file, written only when there are some. Refused when the name is
 * not valid, the directory already exists, or `parent` is not a readable context.
 */
export function addContext(opts: {
  name: string;
  parent?: string;
  remote?: string[];
  path?: string[];
  home?: string;
}): AddedContext {
  const home = opts.home ?? homedir();
  const invalid = invalidContextName(opts.name);
  if (invalid) throw new ConfigError(`"${opts.name}" is not a valid context name, because ${invalid}`);
  const dir = join(home, CONTEXTS_DIR, opts.name);
  if (existsSync(dir)) throw new ConfigError(`context "${opts.name}" already exists at ${dir}`);
  if (opts.parent !== undefined) {
    lookup(readContexts(home), opts.parent, `context "${opts.name}" names parent "${opts.parent}"`);
  }

  const id = `ctx_${randomBytes(6).toString("hex")}`;
  const team = join(dir, TEAM_FILE);
  const teamFile = {
    schemaVersion: 1,
    id,
    ...(opts.parent !== undefined ? { parent: opts.parent } : {}),
    match: (opts.remote ?? []).map((remote) => ({ remote })),
  };
  writeFileAtomic(team, `${JSON.stringify(teamFile, null, 2)}\n`);

  const paths = opts.path ?? [];
  const me = paths.length > 0 ? join(dir, ME_FILE) : null;
  if (me) writeFileAtomic(me, `${JSON.stringify({ match: paths.map((path) => ({ path })) }, null, 2)}\n`);
  return { dir, id, team, me };
}

/** Whether `ancestor` is on `name`'s parent line. Throws, as `resolveChain` does, on a broken line. */
export function isAncestor(store: ContextStore, ancestor: string, name: string): boolean {
  return lineage(store, name).slice(0, -1).some((def) => def.name === ancestor);
}

/** `name` and its ancestors, outermost first. Throws on an unknown parent or a cycle. */
function lineage(store: ContextStore, name: string): ContextDef[] {
  const seen: string[] = [];
  let def: ContextDef = store.defs.get(name)!;
  for (;;) {
    seen.push(def.name);
    if (def.parent === null) return seen.map((n) => store.defs.get(n)!).reverse();
    if (seen.includes(def.parent)) {
      const cycle = [...seen.slice(seen.indexOf(def.parent)), def.parent];
      throw new ConfigError(`context parent cycle: ${cycle.join(" -> ")}`);
    }
    def = lookup(store, def.parent, `context "${def.name}" names parent "${def.parent}"`);
  }
}

/** How `def` matches `place`: the first remote filter that does, else the first path filter. */
function matchOf(def: ContextDef, place: Place, home: string): MatchedContext | null {
  for (const entry of def.team) {
    const test = compileGlob(entry.remote ?? "", { anchored: "remote", ignoreCase: entry.ignoreCase });
    if (place.remotes.some(test)) return { name: def.name, via: "remote", entry };
  }
  for (const entry of def.me) {
    const test = compileGlob(entry.path ?? "", { anchored: "path", ignoreCase: entry.ignoreCase, home });
    if (place.paths.some(test)) return { name: def.name, via: "path", entry };
  }
  return null;
}

/**
 * The contexts that apply to `place`, outermost first: each matched context's tree, from its root
 * down through the ancestors of whatever matched, roots in `order` then alphabetical, each context
 * once at its first position. `explicit` makes that context the innermost: it is appended with its
 * ancestors, or moved to the end when it already matched, unless it is an ancestor of another
 * matched context, which keeps it in its place. `none` drops everything that matched.
 */
export function resolveChain(
  store: ContextStore,
  place: Place,
  opts: { explicit?: string; none?: boolean },
): MatchedContext[] {
  if (opts.none && opts.explicit === undefined) return [];

  const lineages = new Map<string, ContextDef[]>();
  for (const name of store.defs.keys()) lineages.set(name, lineage(store, name));
  for (const name of store.order) lookup(store, name, `${ORDER_FILE} names "${name}"`);

  const matched = new Map<string, MatchedContext>();
  if (!opts.none) {
    for (const def of store.defs.values()) {
      const match = matchOf(def, place, store.home);
      if (match) matched.set(def.name, match);
    }
  }

  // Every context on the way from a root down to something that matched, as the tree's members.
  const members = new Set<string>();
  for (const name of matched.keys()) for (const def of lineages.get(name)!) members.add(def.name);

  const rank = (name: string) => {
    const at = store.order.indexOf(name);
    return at === -1 ? store.order.length : at;
  };
  // Alphabetical first, then a stable sort by rank, so roots `order` does not name stay alphabetical.
  const roots = [...members]
    .filter((name) => store.defs.get(name)!.parent === null)
    .sort()
    .sort((a, b) => rank(a) - rank(b));

  const chain: MatchedContext[] = [];
  const emitted = new Set<string>();
  const emit = (name: string) => {
    if (emitted.has(name)) return;
    emitted.add(name);
    chain.push(matched.get(name) ?? { name, via: "parent" });
  };
  const visit = (name: string) => {
    emit(name);
    const children = [...members].filter((n) => store.defs.get(n)!.parent === name).sort();
    for (const child of children) visit(child);
  };
  for (const root of roots) visit(root);

  if (opts.explicit !== undefined) {
    lookup(store, opts.explicit, `the requested context "${opts.explicit}"`);
    const line = lineages.get(opts.explicit)!;
    for (const def of line.slice(0, -1)) emit(def.name);
    if (!emitted.has(opts.explicit)) {
      emitted.add(opts.explicit);
      chain.push({ name: opts.explicit, via: "explicit" });
    } else {
      // Already matched: it still becomes the innermost, moved to the end, unless a context after it
      // descends from it. Its descendants always come after it, so it never has any to carry along.
      const at = chain.findIndex((c) => c.name === opts.explicit);
      const ancestor = chain.slice(at + 1).some((c) => lineages.get(c.name)!.some((def) => def.name === opts.explicit));
      if (!ancestor) chain.push(...chain.splice(at, 1));
    }
  }
  return chain;
}
