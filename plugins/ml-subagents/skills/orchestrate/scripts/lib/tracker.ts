// The "verify with a real call" half of the onboarding contract.
// One reachability probe per tracker backend. The caller resolves the token through
// `agent-config load` and only when this probe needs it, so `show` never triggers a Touch ID prompt.

import { spawnSync } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { dirname } from "path";
import { expandPath, type OrchestrateConfig, type TrackerKind } from "./config";

export interface VerifyResult {
  ok: boolean;
  /** One line the skill can show the user verbatim. Never contains the secret. */
  detail: string;
}

async function json(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A local tracker is "reachable" when we can actually write where it lives. */
function verifyLocal(kind: TrackerKind, path: string | undefined): VerifyResult {
  if (!path) return { ok: false, detail: `tracker.path is not set for the "${kind}" tracker` };
  const full = expandPath(path);
  let target = full;
  try {
    statSync(full);
  } catch {
    target = dirname(full); // tracker file not created yet — the parent must be writable
  }
  try {
    accessSync(target, constants.W_OK);
  } catch {
    return { ok: false, detail: `${target} is not writable` };
  }
  const exists = target === full;
  return {
    ok: true,
    detail: exists ? `tracker ${full} exists and is writable` : `${full} does not exist yet; ${target} is writable`,
  };
}

async function verifyGithub(repo: string, token: string | null): Promise<VerifyResult> {
  if (!token) {
    const r = spawnSync("gh", ["api", `repos/${repo}`, "--jq", ".full_name"], { encoding: "utf8" });
    if (r.status !== 0) {
      return { ok: false, detail: `gh api repos/${repo} failed: ${(r.stderr || "").trim() || `exit ${r.status}`}` };
    }
    return { ok: true, detail: `gh CLI reached ${r.stdout.trim()}` };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    return { ok: false, detail: `GitHub API ${res.status} for repos/${repo} — check the token's scopes (needs 'issues: write')` };
  }
  const body = await json(res);
  return { ok: true, detail: `authenticated to github.com/${body?.full_name ?? repo}` };
}

async function verifyJira(site: string, email: string, project: string, token: string): Promise<VerifyResult> {
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(`https://${site}/rest/api/3/project/${encodeURIComponent(project)}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (res.status === 401) return { ok: false, detail: `Jira rejected the credentials for ${email} on ${site}` };
  if (res.status === 404) return { ok: false, detail: `Jira project "${project}" not found on ${site}` };
  if (!res.ok) return { ok: false, detail: `Jira API ${res.status} for project ${project} on ${site}` };
  const body = await json(res);
  return { ok: true, detail: `reached Jira project ${body?.key ?? project} ("${body?.name ?? ""}") on ${site}` };
}

async function verifyLinear(team: string, token: string): Promise<VerifyResult> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes { key name } } }`, variables: { k: team } }),
  });
  if (res.status === 401 || res.status === 400) return { ok: false, detail: "Linear rejected the API key" };
  if (!res.ok) return { ok: false, detail: `Linear API ${res.status}` };
  const body = await json(res);
  const node = body?.data?.teams?.nodes?.[0];
  if (!node) return { ok: false, detail: `Linear team "${team}" not found for this API key` };
  return { ok: true, detail: `reached Linear team ${node.key} ("${node.name}")` };
}

/** `token` is the tracker's resolved credential, or null when it has none (a local tracker, or gh). */
export async function verifyTracker(c: OrchestrateConfig, token: string | null): Promise<VerifyResult> {
  const kind = c.tracker?.kind;
  if (!kind) return { ok: false, detail: "tracker.kind is not set: Phase 1 discovers the tracker, so there is nothing to verify" };

  if (kind === "file" || kind === "tasknotes") return verifyLocal(kind, c.tracker?.path);
  if (kind !== "github" && !token) return { ok: false, detail: `the ${kind} tracker needs its credential, and none was resolved` };

  try {
    if (kind === "github") return await verifyGithub(c.tracker!.repo!, token);
    if (kind === "jira") return await verifyJira(c.tracker!.site!, c.tracker!.email!, c.tracker!.project!, token!);
    return await verifyLinear(c.tracker!.team!, token!);
  } catch (e: any) {
    return { ok: false, detail: `network call failed: ${e.message}` };
  }
}
