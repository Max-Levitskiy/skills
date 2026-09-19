// Fellow's slice of the Agent Config Standard — see standards/agent-config.md.
// Layer paths, merge and credential checks come from the vendored library; what stays
// here is Fellow's config shape, its validate(), and the name every call binds to.

import { readFileSync } from "fs";
import {
  layerPath as libLayerPath,
  loadConfig as libLoadConfig,
  writeLayer,
  ensureGitignored,
  validateCredentialRef,
  repoRoot,
  expandPath,
  LOCAL_GITIGNORE_PATTERN,
  type BaseConfig,
  type CredentialRef,
  type Layer,
} from "./vendor/agent-config/config";
import type { ProjectRules, SeriesVerdict } from "./relevance";

export { repoRoot, expandPath, ensureGitignored, LOCAL_GITIGNORE_PATTERN };
export type { CredentialRef, Layer };

const SKILL_NAME = "fellow";

export interface StorageTarget {
  enabled: boolean;
  path: string;
}

export interface FellowConfig extends BaseConfig {
  credentials?: { apiKey?: CredentialRef };
  workspace?: { subdomain?: string };
  storage?: {
    recaps?: StorageTarget;
    transcripts?: StorageTarget;
    media?: StorageTarget;
  };
  defaults?: { pageSize?: number; lookbackDays?: number };
  /** Named project scopes — see lib/relevance.ts for the matching rules. */
  projects?: Record<string, ProjectRules>;
  defaultProject?: string;
  /** Machine-maintained: calendar series key -> which project it belongs to. */
  series?: Record<string, SeriesVerdict>;
}

export function layerPath(layer: Layer, root?: string | null): string | null {
  return libLayerPath(SKILL_NAME, layer, root);
}

export function loadConfig() {
  return libLoadConfig<FellowConfig>(SKILL_NAME);
}

/**
 * Persist a Tier-0 series verdict. Writes to the repo layer so teammates inherit
 * classifications already paid for; falls back to global outside a git repo.
 * Only the `series` key is touched — hand-written rules are left alone.
 */
export function recordSeriesVerdict(
  key: string,
  project: string | null,
  why: string,
  today: string,
): { path: string; layer: Layer } {
  const root = repoRoot();
  const layer: Layer = root ? "repo" : "global";
  // Read the current path only, never the legacy one: a config still living at the
  // legacy path gets a small current-path file holding just `series`, which loadConfig
  // then merges over it.
  let existing: any = { version: 1 };
  try {
    existing = JSON.parse(readFileSync(layerPath(layer, root)!, "utf8"));
  } catch {
    /* nothing at the current path yet */
  }
  existing.series ??= {};
  existing.series[key] = { project, why, at: today };
  return { path: writeLayer(SKILL_NAME, layer, existing).path, layer };
}

/** What's missing before the skill can actually make a call. Empty array = ready. */
export function validate(c: FellowConfig): string[] {
  return [
    ...(c.workspace?.subdomain ? [] : ["workspace.subdomain is not set"]),
    ...validateCredentialRef("apiKey", c.credentials?.apiKey),
  ];
}
