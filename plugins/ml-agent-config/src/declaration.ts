// Reading and validating a component's declaration.
//
// D2: `agent-config.json` at the plugin root, one per ACS `<name>`, required for `start`. It holds
// the author's questions; config holds the user's answers, and the difference between them is the
// list of what is not yet set up. Absence meaning "nothing is required" was rejected, because it
// makes a typo'd name indistinguishable from a legitimately empty declaration.
//
// D4: the declaration is found by scanning the plugin registry for a matching `name`. Two matches
// is an ambiguity error, never a guess.

import { join, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { ConfigError, type ConfigValue, type Layer } from "./layers";
import { pluginInstalls, type DependencyKind, type Harness } from "./harness";

export const DECLARATION_FILE = "agent-config.json";
export const DECLARATION_VERSION = 2;
export const DEFAULT_ONBOARD_ACTION = "onboard";

export type Scalar = string | number | boolean;
/** A bare string is a dot-path meaning "truthy". An object is AND across its entries. */
export type WhenMatcher = string | Record<string, Scalar | Scalar[]>;

export interface KeyEntry {
  description: string;
  /** Advisory only: onboarding recommends it with a reason, writing elsewhere is permitted. */
  layer?: Layer;
  default?: ConfigValue;
}

export interface KeyGroup {
  when: WhenMatcher;
  action?: string;
  keys: Record<string, KeyEntry>;
}

export interface MarketplaceInstall {
  marketplace: string;
  url: string;
  plugin: string;
}

export interface ActionInstall {
  action: string;
}

export interface Dependency {
  kind: DependencyKind;
  install: MarketplaceInstall | ActionInstall;
}

export interface Declaration {
  version: number;
  name: string;
  schema?: {
    version?: number;
    keys?: Record<string, KeyEntry>;
    groups?: KeyGroup[];
  };
  dependencies?: Record<string, Dependency>;
  registry?: { dirtyCheckout?: "refuse" | "allow" };
}

export interface FoundDeclaration {
  declaration: Declaration;
  /** The plugin root — `actions/` sits beside the declaration (D2). */
  dir: string;
  path: string;
  /** The component's config-shape version, defaulted for a declaration that omits it. */
  schemaVersion: number;
}

export function isMarketplaceInstall(install: Dependency["install"]): install is MarketplaceInstall {
  return "marketplace" in install;
}

export interface DeclaredKey {
  path: string;
  entry: KeyEntry;
  /** The conditional group it belongs to, or null when it is unconditional. */
  group: KeyGroup | null;
}

/** Every key the declaration mentions, unconditional ones first. */
export function declaredKeys(declaration: Declaration): DeclaredKey[] {
  const out: DeclaredKey[] = Object.entries(declaration.schema?.keys ?? {}).map(([path, entry]) => ({
    path,
    entry,
    group: null,
  }));
  for (const group of declaration.schema?.groups ?? []) {
    for (const [path, entry] of Object.entries(group.keys ?? {})) out.push({ path, entry, group });
  }
  return out;
}

function validate(declaration: Declaration, expectedName: string, path: string): void {
  const fail = (message: string): never => {
    throw new ConfigError(`${path}: ${message}`);
  };

  if (declaration.version !== DECLARATION_VERSION) {
    fail(`declaration version is ${JSON.stringify(declaration.version)}; this CLI reads version ${DECLARATION_VERSION}`);
  }
  if (declaration.name !== expectedName) {
    fail(`declares name "${declaration.name}", but "${expectedName}" was asked for`);
  }

  const topLevel = declaration.schema?.keys ?? {};
  for (const { path: keyPath, entry } of declaredKeys(declaration)) {
    if (!entry || typeof entry.description !== "string" || !entry.description) {
      fail(`key "${keyPath}" needs a description — onboarding has nothing to ask without one`);
    }
  }

  for (const group of declaration.schema?.groups ?? []) {
    if (!group.when) fail("every group needs a `when`");
    const read = typeof group.when === "string" ? [group.when] : Object.keys(group.when);
    for (const dependencyPath of read) {
      // D2's one checkable rule against cycles: a `when` may only read an unconditional key.
      if (!(dependencyPath in topLevel)) {
        fail(`group condition reads "${dependencyPath}", which is not declared in schema.keys`);
      }
    }
  }

  for (const [name, dependency] of Object.entries(declaration.dependencies ?? {})) {
    if (dependency?.kind !== "skill" && dependency?.kind !== "agent") {
      fail(`dependency "${name}" needs kind "skill" or "agent"`);
    }
    const install = dependency.install;
    if (!install) fail(`dependency "${name}" needs an install source — it cannot be inferred (R1)`);
    if (isMarketplaceInstall(install)) {
      if (!install.marketplace || !install.url || !install.plugin) {
        fail(`dependency "${name}" needs marketplace, url and plugin in its install source`);
      }
    } else if (!install.action) {
      fail(`dependency "${name}" needs either a marketplace install source or an authored action`);
    }
    if ("version" in dependency) {
      fail(`dependency "${name}" carries a version. Skill dependencies are name-only, by design (R1)`);
    }
  }
}

function read(path: string, expectedName: string): FoundDeclaration {
  let declaration: Declaration;
  try {
    declaration = JSON.parse(readFileSync(path, "utf8")) as Declaration;
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  validate(declaration, expectedName, path);
  return {
    declaration,
    dir: dirname(path),
    path,
    schemaVersion: declaration.schema?.version ?? 1,
  };
}

/** Walk up from a directory the way `package.json` is found, for a checkout in no registry. */
function findUpwards(from: string): string | null {
  let cursor = from;
  for (;;) {
    const candidate = join(cursor, DECLARATION_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/**
 * Find the declaration for `name`. `--from` is the development override for a git checkout, which
 * appears in no registry; otherwise every installed plugin of the detected harness is scanned.
 * Several versions of one plugin resolve to the newest, which is not a guess between authors;
 * two different plugins declaring one name is, and fails.
 */
export function findDeclaration(name: string, harness: Harness, from?: string): FoundDeclaration {
  if (from) {
    const path = findUpwards(from);
    if (!path) throw new ConfigError(`No ${DECLARATION_FILE} at or above ${from}`);
    return read(path, name);
  }

  const byPlugin = new Map<string, { version: string; path: string }>();
  for (const install of pluginInstalls(harness)) {
    const candidate = join(install.installPath, DECLARATION_FILE);
    if (!existsSync(candidate)) continue;
    let declared: { name?: unknown };
    try {
      declared = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown };
    } catch {
      continue; // A broken declaration belonging to another component is not this call's problem.
    }
    if (declared.name !== name) continue;
    const held = byPlugin.get(install.key);
    if (!held || held.version.localeCompare(install.version, undefined, { numeric: true }) < 0) {
      byPlugin.set(install.key, { version: install.version, path: candidate });
    }
  }

  const matches = [...byPlugin.entries()];
  if (matches.length === 0) {
    throw new ConfigError(
      `No installed plugin declares the agent-config name "${name}". ` +
        `Every component needs an ${DECLARATION_FILE} at its plugin root. ` +
        `For a git checkout that is in no plugin registry, pass --from <dir>.`,
    );
  }
  if (matches.length > 1) {
    const where = matches.map(([key, match]) => `${key} (${match.path})`).join(", ");
    throw new ConfigError(`The name "${name}" is declared by more than one installed plugin: ${where}`);
  }
  return read(matches[0][1].path, name);
}
