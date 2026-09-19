// The shapes the CLI prints. JSON only: the client is an agent, and a second output mode is a
// second contract to keep in sync (D4).

import type { ConfigObject, ConfigValue, Layer } from "./layers";
import type { Harness } from "./harness";
import type { WhenMatcher } from "./declaration";

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
    | "dirty-checkout";
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
  problems: Problem[];
}

export interface LoadOutput {
  acs: typeof ACS_VERSION;
  name: string;
  config: ConfigObject;
  provenance: Record<string, Layer | "default">;
  problems: Problem[];
}

export interface DescribedKey {
  path: string;
  description: string;
  /** Advisory: where onboarding recommends writing it. */
  layer: Layer | null;
  default: ConfigValue | null;
  credential: boolean;
  /** The condition this key sits behind, and whether that condition currently holds. */
  group: { when: WhenMatcher; action: string; status: "active" | "inactive" | "unevaluated" } | null;
  /** True when the key is required right now: unconditional, or in a group whose condition holds. */
  required: boolean;
  value: ConfigValue | null;
  source: Layer | "default" | null;
  problems: string[];
}

export interface DescribeOutput {
  acs: typeof ACS_VERSION;
  name: string;
  harness: Harness;
  schemaVersion: number;
  repo: RepoReport;
  keys: DescribedKey[];
  layers: {
    layer: Layer;
    path: string | null;
    snapshot: string | null;
    exists: boolean;
    schemaVersion: number | null;
    /** Successive earlier contents, newest first. Absent for the repo layer, which git journals. */
    journal: { at: string; config: ConfigObject }[];
  }[];
  problems: Problem[];
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
}
