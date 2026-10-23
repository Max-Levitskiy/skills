// The shapes the CLI prints. JSON only: the client is an agent, and a second output mode is a
// second contract to keep in sync (D4).

import type { ConfigObject, ConfigValue, Layer } from "./layers";
import type { Harness } from "./harness";
import type { WhenMatcher } from "./declaration";
import type { Defs, ValueSchema } from "./key-schema";
import type { MatchedContext, MatchEntry } from "./contexts";
import type { Place } from "./place";

export const ACS_VERSION = 2;

/**
 * Something the agent should tell the human about. A problem is not an action: it has no fix the
 * agent can work, so it is reported alongside whatever plan there is.
 */
export interface Problem {
  code:
    | "legacy-config-path"
    | "credential-malformed"
    | "dependency-ambiguous"
    | "schema-rolled-back"
    | "schema-behind"
    | "dirty-checkout"
    | "invalid-value"
    | "context-unparsable"
    | "untrusted-layer-key"
    | "sibling-contexts"
    | "context-stray-path"
    | "context-stray-dir"
    | "cachevar-shared";
  message: string;
  keys?: string[];
  layer?: Layer;
  path?: string;
}

/** One entry of `start`'s flat action list. The agent topo-sorts by `requires` (D3). */
export interface EmittedAction {
  id: string;
  path: string;
  type: "code" | "prompt" | "manual";
  command: string | null;
  parallel: boolean;
  requires: string[];
  /** The declared keys that triggered this action — the context five missing keys collapse into. */
  keys: string[];
  /** Everything else the action's body needs: the dependency, the layer being migrated, a URL. */
  context: Record<string, ConfigValue>;
}

export interface RepoReport {
  checkout: string | null;
  root: string | null;
  identity: string | null;
  registered: boolean;
  alias: string | null;
}

export interface StartOutput {
  acs: typeof ACS_VERSION;
  name: string;
  harness: Harness;
  repo: RepoReport;
  ready: boolean;
  /** Path to the one document holding the action protocol, so no consumer restates it (D4). */
  guide: string;
  config: ConfigObject;
  provenance: Record<string, Layer | "default">;
  actions: EmittedAction[];
  /** The contexts that apply here, outermost first, each with why. */
  contexts: MatchedContext[];
  problems: Problem[];
}

export interface LoadOutput {
  acs: typeof ACS_VERSION;
  name: string;
  config: ConfigObject;
  provenance: Record<string, Layer | "default">;
  contexts: MatchedContext[];
  problems: Problem[];
}

export interface DescribedKey {
  path: string;
  description: string;
  /** Advisory: where onboarding recommends writing it; `context` is whichever context applies. */
  layer: Layer | "context" | null;
  default: ConfigValue | null;
  /** What the key holds, as JSON Schema; null when the declaration leaves it to the default. */
  schema: ValueSchema | null;
  credential: boolean;
  /** Declared `personal`: the person's own answer, which a context's team file refuses. */
  personal: boolean;
  /** Declared `choices`: `agent-config choices` lists its values, searched here or by the script. */
  choices: { search: "local" | "server" } | null;
  /** The condition this key sits behind, and whether that condition currently holds. */
  group: { when: WhenMatcher; action: string; status: "active" | "inactive" | "unevaluated" } | null;
  /** True when the key is required right now: unconditional, or in a group whose condition holds. */
  required: boolean;
  value: ConfigValue | null;
  source: Layer | "default" | null;
  /**
   * What each layer itself sets for this key, before the merge: a layer that does not set it is
   * absent, and a null is a layer blocking what the layers under it set.
   */
  levels: Partial<Record<Layer, ConfigValue>>;
  problems: string[];
}

export interface DescribeOutput {
  acs: typeof ACS_VERSION;
  name: string;
  harness: Harness;
  schemaVersion: number;
  repo: RepoReport;
  keys: DescribedKey[];
  /** The declaration's `schema.$defs`, which a key's `$ref` names. */
  defs: Defs;
  layers: {
    layer: Layer;
    path: string | null;
    snapshot: string | null;
    exists: boolean;
    schemaVersion: number | null;
    /** Successive earlier contents, newest first. Absent for the repo layer, which git journals. */
    journal: { at: string; config: ConfigObject }[];
  }[];
  contexts: MatchedContext[];
  /** Where this ran: what a context's filters match, and what a new context is suggested from. */
  place: Place;
  problems: Problem[];
}

export interface ListOutput {
  acs: typeof ACS_VERSION;
  /** One entry per installed plugin with a declaration, the newest version of each, by name. */
  components: { name: string; plugin: string; version: string; declaration: string }[];
}

export interface PathOutput {
  acs: typeof ACS_VERSION;
  name: string;
  declaration: string;
  /**
   * Where this CLI itself lives. Neither harness guarantees the plugin's `bin/` is on PATH —
   * Codex never adds it — so an agent that reached the CLI once can hand the absolute path to a
   * consumer script, or set AGENT_CONFIG_ROOT from `root`.
   */
  agentConfig: { root: string; bin: string };
  layers: {
    layer: Layer;
    path: string | null;
    snapshot: string | null;
    exists: boolean;
    schemaVersion: number | null;
  }[];
  contexts: MatchedContext[];
}

export interface ContextListOutput {
  acs: typeof ACS_VERSION;
  /** Every readable context, by name; `matched` when it is in the chain for this place. */
  contexts: {
    name: string;
    id: string | null;
    parent: string | null;
    abstract: boolean;
    team: MatchEntry[];
    me: MatchEntry[];
    matched: boolean;
    /** The components that keep values in it. */
    components: string[];
  }[];
  problems: Problem[];
}

export interface ContextExplainOutput {
  acs: typeof ACS_VERSION;
  place: Place;
  /** The repository the place is in, as describe reports it. */
  repo: RepoReport;
  chain: MatchedContext[];
  /** The merge order the chain makes. */
  layers: Layer[];
}
