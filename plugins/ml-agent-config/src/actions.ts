// Action discovery and synthesis.
//
// D3: every action is a `.md` file. Frontmatter carries the machine-checkable fields —
// `id, type: code|prompt|manual, command?, parallel, requires` — and the body carries the prose
// the agent reads. `requires` is an explicit DAG edge list, not array order. Conditionality is
// not here: by the time an action is emitted, its condition has already fired.
//
// D2: actions are found by convention in `actions/` beside the declaration, never enumerated in
// the declaration — a list would duplicate the directory into a second place that gets forgotten.
// The component owns onboarding its own config; agent-config owns the mechanics (install, the
// human-only reload, registry registration, and D6's migration), under a reserved `agent-config:`
// id prefix so collision with a component's actions is structurally impossible.

import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import { ConfigError, type ConfigObject, type LayerFile } from "./layers";
import {
  isMarketplaceInstall,
  type Declaration,
  type Dependency,
  type FoundDeclaration,
} from "./declaration";
import {
  findDependency,
  installCommand,
  marketplaceCommand,
  marketplaceKnown,
  type Harness,
} from "./harness";
import type { EmittedAction, Problem, RepoReport } from "./types";
import type { Effective } from "./effective";

const BUILTIN_PREFIX = "agent-config:";
const FRONTMATTER_FIELDS = ["id", "type", "command", "parallel", "requires"] as const;
const ACTION_TYPES = ["code", "prompt", "manual"] as const;

export interface ActionFile {
  id: string;
  type: (typeof ACTION_TYPES)[number];
  command: string | null;
  parallel: boolean;
  requires: string[];
  path: string;
}

function parseScalar(raw: string): string | boolean | string[] {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}

/**
 * The trivial `key: value` YAML subset action frontmatter is specified in, plus block lists for
 * `requires`. A full YAML parser would be a dependency, and every field here is a scalar, a
 * boolean, or a list of strings.
 */
function parseFrontmatter(path: string, builtin: boolean): ActionFile {
  const text = readFileSync(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new ConfigError(`${path}: action files need YAML frontmatter delimited by ---`);

  const fields: Record<string, string | boolean | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const held = fields[listKey];
      fields[listKey] = [...(Array.isArray(held) ? held : []), item[1].trim().replace(/^["']|["']$/g, "")];
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!pair) throw new ConfigError(`${path}: cannot read frontmatter line ${JSON.stringify(line)}`);
    const [, key, rest] = pair;
    if (!FRONTMATTER_FIELDS.includes(key as (typeof FRONTMATTER_FIELDS)[number])) {
      throw new ConfigError(`${path}: unknown frontmatter field "${key}" (expected ${FRONTMATTER_FIELDS.join(", ")})`);
    }
    if (rest === "") {
      fields[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    fields[key] = parseScalar(rest);
  }

  const { id, type, command, parallel, requires } = fields;
  if (typeof id !== "string" || !id) throw new ConfigError(`${path}: frontmatter needs an id`);
  if (typeof type !== "string" || !ACTION_TYPES.includes(type as ActionFile["type"])) {
    throw new ConfigError(`${path}: type must be one of ${ACTION_TYPES.join(", ")}`);
  }
  const resolvedType = type as ActionFile["type"];
  // A built-in's command is rendered per harness at emit time, so only components must supply one.
  if (!builtin) {
    if (resolvedType === "code" && typeof command !== "string") {
      throw new ConfigError(`${path}: type: code needs a command`);
    }
    if (resolvedType !== "code" && command !== undefined) {
      throw new ConfigError(`${path}: command is only meaningful for type: code`);
    }
  }
  return {
    id,
    type: resolvedType,
    command: typeof command === "string" ? command : null,
    parallel: parallel === true,
    requires: Array.isArray(requires) ? requires : [],
    path,
  };
}

/** Every action a component ships, keyed by id. */
export function componentActions(dir: string): Map<string, ActionFile> {
  const actionsDir = join(dir, "actions");
  const out = new Map<string, ActionFile>();
  let entries: string[];
  try {
    entries = readdirSync(actionsDir);
  } catch {
    return out;
  }
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const action = parseFrontmatter(join(actionsDir, entry), false);
    if (action.id.startsWith(BUILTIN_PREFIX)) {
      throw new ConfigError(`${action.path}: "${BUILTIN_PREFIX}" is reserved for agent-config's own actions`);
    }
    const clash = out.get(action.id);
    if (clash) throw new ConfigError(`${action.path}: action id "${action.id}" is already used by ${clash.path}`);
    out.set(action.id, action);
  }
  return out;
}

/** agent-config's own actions, beside this source rather than beside the declaration. */
function builtin(name: string): ActionFile {
  const path = join(import.meta.dir, "..", "actions", `${name}.md`);
  if (!existsSync(path)) throw new ConfigError(`agent-config is missing its built-in action ${path}`);
  return parseFrontmatter(path, true);
}

function emit(file: ActionFile, overrides: Partial<EmittedAction>): EmittedAction {
  return {
    id: file.id,
    path: file.path,
    type: file.type,
    command: file.command,
    parallel: file.parallel,
    requires: file.requires,
    keys: [],
    context: {},
    ...overrides,
  };
}

export interface PlanInput {
  found: FoundDeclaration;
  harness: Harness;
  repo: RepoReport;
  effective: Effective;
  layers: LayerFile[];
  /** The user-repo layer's own contents — an opt-out must be authored there, not inherited (D1). */
  userRepoLayer: ConfigObject | null;
}

export interface Plan {
  actions: EmittedAction[];
  problems: Problem[];
}

function dependencyActions(
  declaration: Declaration,
  dir: string,
  harness: Harness,
  checkout: string | null,
  authored: Map<string, ActionFile>,
): Plan {
  const actions: EmittedAction[] = [];
  const problems: Problem[] = [];
  const marketplaces = new Map<string, EmittedAction>();

  for (const [name, dependency] of Object.entries(declaration.dependencies ?? {})) {
    const colon = name.lastIndexOf(":");
    const plugin = colon > 0 ? name.slice(0, colon) : null;
    const bare = colon > 0 ? name.slice(colon + 1) : name;
    const lookup = findDependency(harness, plugin, bare, dependency.kind, checkout);
    if (lookup.foundAt) continue;

    if (lookup.ambiguousWith.length > 0) {
      problems.push({
        code: "dependency-ambiguous",
        message:
          `Dependency "${name}" is a bare name, and nothing of that name is installed outside a plugin, ` +
          `but these installed plugins carry one: ${lookup.ambiguousWith.join(", ")}. ` +
          `Qualify the dependency in ${join(dir, "agent-config.json")} rather than guessing.`,
      });
      continue;
    }

    const install: Dependency["install"] = dependency.install;
    if (!isMarketplaceInstall(install)) {
      const authoredAction = authored.get(install.action);
      if (!authoredAction) {
        throw new ConfigError(
          `Dependency "${name}" names install action "${install.action}", but ${dir}/actions/ has no action with that id`,
        );
      }
      actions.push(emit(authoredAction, { context: { dependency: name, kind: dependency.kind } }));
      continue;
    }

    let marketplaceAction = marketplaces.get(install.marketplace);
    if (!marketplaceAction && !marketplaceKnown(harness, install.marketplace)) {
      marketplaceAction = emit(builtin("marketplace"), {
        id: `${BUILTIN_PREFIX}marketplace:${install.marketplace}`,
        command: marketplaceCommand(harness, install.url),
        context: { marketplace: install.marketplace, url: install.url },
      });
      marketplaces.set(install.marketplace, marketplaceAction);
      actions.push(marketplaceAction);
    }

    actions.push(
      emit(builtin("install"), {
        id: `${BUILTIN_PREFIX}install:${name}`,
        command: installCommand(harness, install.plugin, install.marketplace),
        requires: marketplaceAction ? [marketplaceAction.id] : [],
        context: {
          dependency: name,
          kind: dependency.kind,
          plugin: install.plugin,
          marketplace: install.marketplace,
        },
      }),
    );
  }
  return { actions, problems };
}

/**
 * Per-layer schema comparison (D6). The stamp lives inside each config file and the merged config
 * has no version at all, so each file that is behind gets its own migration action — the agent
 * migrating the repo layer never touches global keys. A rolled-back file warns and proceeds:
 * forward has a repair path, backward has none, and a refusal with no repair path bricks the
 * install.
 */
export function schemaDrift(
  layers: LayerFile[],
  schemaVersion: number,
  keys: string[],
): { behind: LayerFile[]; problems: Problem[] } {
  const behind: LayerFile[] = [];
  const problems: Problem[] = [];
  for (const file of layers) {
    if (!file.exists || file.schemaVersion === null) continue;
    if (file.schemaVersion < schemaVersion) behind.push(file);
    if (file.schemaVersion > schemaVersion) {
      problems.push({
        code: "schema-rolled-back",
        layer: file.layer,
        path: file.path ?? undefined,
        message:
          `${file.path} was written against schema version ${file.schemaVersion}, but the installed component ` +
          `declares ${schemaVersion}. The plugin was probably downgraded. Proceeding — a rollback has no ` +
          `repair path, so refusing would only brick the install.`,
        keys,
      });
    }
  }
  return { behind, problems };
}

/** The flat action list, plus the problems that have no action to fix them. */
export function buildPlan(input: PlanInput): Plan {
  const { found, harness, repo, effective, layers, userRepoLayer } = input;
  const authored = componentActions(found.dir);
  const actions: EmittedAction[] = [];
  const problems: Problem[] = [];

  // 1. The component onboards its own config. Five missing keys pointing at one action produce one
  //    action carrying all five as context, not five identical interviews (D2).
  for (const gap of effective.gaps) {
    const action = authored.get(gap.action);
    if (!action) {
      throw new ConfigError(
        `The declaration points at action "${gap.action}" for ${gap.keys.join(", ")}, ` +
          `but ${found.dir}/actions/ has no action with that id`,
      );
    }
    actions.push(emit(action, { keys: gap.keys }));
  }

  // 2. Missing skill and agent dependencies. The scan runs every time: caching it is stored
  //    derived state, which goes stale silently (D1), and R1 measured the scan as cheap.
  const dependencies = dependencyActions(found.declaration, found.dir, harness, repo.checkout, authored);
  actions.push(...dependencies.actions);
  problems.push(...dependencies.problems);

  // 3. One reload per invocation, after everything it depends on. Three installed plugins produce
  //    one reload request, not three (D4). Reload is human-only, hence `type: manual` (D3).
  const installed = dependencies.actions.map((action) => action.id);
  if (installed.length > 0) {
    actions.push(emit(builtin("reload"), { requires: installed }));
  }

  // 4. Registration, when the component opted into the registry, the repo is not in it, and the
  //    user-repo layer holds no authored opt-out — a decline that stores nothing is re-asked
  //    forever, so the opt-out is authored, never derived (D1).
  const registryOptOut =
    typeof userRepoLayer?.registry === "object" &&
    userRepoLayer.registry !== null &&
    !Array.isArray(userRepoLayer.registry) &&
    userRepoLayer.registry.register === false;
  if (found.declaration.registry && repo.checkout && !repo.registered && !registryOptOut) {
    actions.push(emit(builtin("register-repo"), { context: { root: repo.root, identity: repo.identity } }));
  }

  // 5. One migration per config file whose stamp is behind the declaration (D6).
  const drift = schemaDrift(layers, found.schemaVersion, effective.keys.map((key) => key.path));
  problems.push(...drift.problems);
  for (const file of drift.behind) {
    const snapshot = file.snapshot && existsSync(file.snapshot) ? file.snapshot : null;
    actions.push(
      emit(builtin("migrate"), {
        id: `${BUILTIN_PREFIX}migrate:${file.layer}`,
        keys: effective.keys.map((key) => key.path),
        context: {
          layer: file.layer,
          path: file.path,
          from: file.schemaVersion,
          to: found.schemaVersion,
          snapshot,
        },
      }),
    );
  }

  // An edge to an action that was not emitted means its prerequisite is already satisfied — the
  // DAG is over the plan, and a dangling edge would deadlock the agent's topo-sort.
  const emitted = new Set(actions.map((action) => action.id));
  for (const action of actions) action.requires = action.requires.filter((id) => emitted.has(id));

  return { actions, problems };
}

export function guidePath(): string {
  return join(import.meta.dir, "..", "docs", "working-actions.md");
}

