// orchestrate's slice of the Agent Config Standard (ACS v1) — see standards/agent-config.md.
// Layer paths, merge, writes, and gitignoring come from the vendored library; what lives
// here is the shape orchestrate stores and what it needs before it can drive a tracker.

import { spawnSync } from "child_process";
import {
  ensureGitignored,
  expandPath,
  layerPath as libLayerPath,
  loadConfig as libLoadConfig,
  repoRoot,
  validateCredentialRef,
  writeLayer as libWriteLayer,
  type BaseConfig,
  type CredentialRef,
  type Layer,
} from "./vendor/agent-config/config";

export { ensureGitignored, expandPath, repoRoot, type CredentialRef, type Layer };

const SKILL_NAME = "orchestrate";

/** Trackers the orchestrator can drive. Only the remote ones need a credential. */
export type TrackerKind = "file" | "tasknotes" | "github" | "jira" | "linear";

export interface TrackerConfig {
  kind?: TrackerKind;
  /** file / tasknotes: repo-relative path to the tracker file or task folder. */
  path?: string;
  /** github: "owner/repo". */
  repo?: string;
  /** jira: site host, e.g. "acme.atlassian.net", plus the project key and account email. */
  site?: string;
  project?: string;
  email?: string;
  /** linear: team key, e.g. "ENG". */
  team?: string;
  /** Labels applied to every package entry the orchestrator creates. */
  labels?: string[];
}

export interface OrchestrateConfig extends BaseConfig {
  credentials?: {
    githubToken?: CredentialRef;
    jiraToken?: CredentialRef;
    linearToken?: CredentialRef;
  };
  tracker?: TrackerConfig;
  questions?: { path?: string; human?: string };
  models?: { judgment?: string; mechanical?: string };
  defaults?: { maxParallelAgents?: number; maxPackages?: number; verifyOnDisk?: boolean };
}

/** Which credential each tracker kind needs. `null` = no credential required. */
export const CREDENTIAL_FOR: Record<TrackerKind, keyof NonNullable<OrchestrateConfig["credentials"]> | null> = {
  file: null,
  tasknotes: null,
  github: "githubToken",
  jira: "jiraToken",
  linear: "linearToken",
};

export function layerPath(layer: Layer, root?: string | null): string | null {
  return libLayerPath(SKILL_NAME, layer, root);
}

export function loadConfig() {
  return libLoadConfig<OrchestrateConfig>(SKILL_NAME);
}

export function writeLayer(layer: Layer, config: OrchestrateConfig) {
  return libWriteLayer(SKILL_NAME, layer, config);
}

/**
 * What's missing before the skill can drive the configured tracker.
 * Empty array = ready. A `file` tracker needs no credential, so zero-secret setups pass.
 */
export function validate(c: OrchestrateConfig): string[] {
  const problems: string[] = [];
  const kind = c.tracker?.kind;
  if (!kind) return ["tracker.kind is not set"];
  if (!(kind in CREDENTIAL_FOR)) return [`tracker.kind "${kind}" is not one of: ${Object.keys(CREDENTIAL_FOR).join(", ")}`];

  if (kind === "file" || kind === "tasknotes") {
    if (!c.tracker?.path) problems.push(`tracker.path is required for the "${kind}" tracker`);
  }
  if (kind === "github" && !c.tracker?.repo) problems.push('tracker.repo ("owner/repo") is required for the github tracker');
  if (kind === "jira") {
    if (!c.tracker?.site) problems.push("tracker.site is required for the jira tracker");
    if (!c.tracker?.project) problems.push("tracker.project (project key) is required for the jira tracker");
    if (!c.tracker?.email) problems.push("tracker.email (Atlassian account email) is required for the jira tracker");
  }
  if (kind === "linear" && !c.tracker?.team) problems.push("tracker.team is required for the linear tracker");

  const credName = CREDENTIAL_FOR[kind];
  if (credName) {
    const cred = c.credentials?.[credName];
    // GitHub can authenticate through the `gh` CLI, so its token is optional.
    if (!cred && kind === "github") {
      const gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
      if (gh.status !== 0) {
        problems.push("credentials.githubToken is not set and the gh CLI is not authenticated (run 'gh auth login')");
      }
    } else {
      problems.push(...validateCredentialRef(credName, cred));
    }
  }
  return problems;
}
