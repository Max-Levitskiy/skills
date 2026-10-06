// The fact pass for a GitLab merge request, through the `glab` CLI.

import { ciExitCode, conventionDocs, gist, json, section, text, waitForCi, type Ci, type Json } from "./shared";

const ACTIVE = ["created", "waiting_for_resource", "preparing", "pending", "running", "scheduled", "canceling"];
/** Statuses GitLab has not finished computing; the first read after a push routinely returns one. */
const UNSETTLED_MERGE_STATUS = ["unchecked", "checking", "preparing", "approvals_syncing"];
const PER_PAGE = 100;

const MERGE_STATUS_NOTES: Record<string, string> = {
  mergeable: "ready",
  unchecked: "GitLab has not computed it yet — re-poll",
  checking: "GitLab is computing it — re-poll",
  preparing: "the MR is still being created — re-poll",
  approvals_syncing: "approvals are being recomputed — re-poll",
  conflict: "merge conflicts",
  need_rebase: "the merge method needs a rebase onto the target first",
  ci_must_pass: "the pipeline must succeed first",
  ci_still_running: "the pipeline is still running",
  discussions_not_resolved: "open threads block the merge",
  draft_status: "draft",
  not_approved: "a required approval is missing",
  requested_changes: "a reviewer requested changes",
  status_checks_must_pass: "an external status check has not passed",
  merge_request_blocked: "blocked by another MR",
  commits_status: "source branch is missing or has no commits",
  title_regex: "the title does not match the project's required pattern",
  security_policy_violations: "a security policy blocks the merge",
  locked_paths: "it changes a path locked by someone else",
  not_open: "not open",
};

const MERGE_METHOD_NOTES: Record<string, string> = {
  merge: "merge commit",
  rebase_merge: "merge commit, semi-linear (must be rebased first)",
  ff: "fast-forward, no merge commit (must be rebased first)",
};

// The REST API does not say which authors are bots; GraphQL does.
const DISCUSSIONS_QUERY = `
query($path:ID!,$iid:String!){ project(fullPath:$path){ mergeRequest(iid:$iid){
  discussions(first:100){ pageInfo{ hasNextPage } nodes{ id resolvable resolved
    notes(first:50){ nodes{ id system url body author{ username bot }
      userPermissions{ resolveNote }
      position{ filePath newLine oldLine diffRefs{ headSha } } } } } } } } }`;

/** Review bots on GitLab are often plain accounts, so the `bot` flag alone misses them. */
const AGENT_NAME = /\[bot\]$|(^|[-_.])bot([-_.]|$)|^(gitlab-?duo|duo-|coderabbit|codex|copilot|claude|renovate|dependabot)/i;
const EXTRA_AGENTS = (process.env.AGENT_USERS ?? "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);

function isAgent(author: Json): boolean {
  const name: string = author?.username ?? "";
  return Boolean(author?.bot || AGENT_NAME.test(name) || EXTRA_AGENTS.includes(name.toLowerCase()));
}

const flag = (v: unknown) => (v === null || v === undefined ? "unset" : String(v));
const lastSegment = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/** The head pipeline's state, or `none` when nothing ran on the head commit. */
function ciState(mr: Json): Ci {
  const hp = mr.head_pipeline;
  if (!hp) return { phase: "none", label: "no pipeline" };
  // Merged-results and merge-train pipelines run on a merge commit, so their sha
  // never equals the MR head; only a branch pipeline can be stale.
  if (hp.sha !== mr.sha && !/\/(merge|train)$/.test(hp.ref ?? "")) {
    return { phase: "none", label: `pipeline #${hp.id} ran on an older commit` };
  }
  const label = `pipeline #${hp.id} ${hp.status}`;
  if (ACTIVE.includes(hp.status)) return { phase: "running", label };
  if (hp.status === "success") return { phase: "green", label };
  if (hp.status === "failed" || hp.status === "canceled") return { phase: "red", label };
  return { phase: "other", label };
}

/** Print the facts for one merge request. Returns the process exit code. */
export function gitlab(target: string, wait: boolean): number {
  let host = "";
  const api = (endpoint: string, ...args: string[]): Json | null =>
    json("glab", ["api", ...(host ? ["--hostname", host] : []), endpoint, ...args]);
  const pages = (endpoint: string): Json[] | null => {
    const all: Json[] = [];
    for (let page = 1; page <= 50; page++) {
      const batch = api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(batch)) return page === 1 ? null : all;
      all.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    return all;
  };

  // The checkout only resolves an MR that was not named by URL. An MR URL carries
  // its own host and project, so a URL from another project cannot mix that MR's
  // pipeline with this checkout's merge settings.
  const cwdUrl: string = api("projects/:fullpath")?.web_url ?? "";
  let mr = target.replace(/^!/, "");
  let projectRef = ":fullpath";
  const url = /^https?:\/\/([^/]+)\/(.+?)(?:\/-)?\/merge_requests\/(\d+)/.exec(mr);
  if (url) {
    host = url[1];
    projectRef = encodeURIComponent(url[2]);
    mr = url[3];
  }
  const project = api(`projects/${projectRef}`);
  if (!project) {
    console.error("Not in a GitLab project, or glab is not authenticated for it. Pass an MR URL, or run glab auth login.");
    return 1;
  }
  const P = `projects/${project.id}`;

  const listOpen = (limit: number): Json[] =>
    api(`${P}/merge_requests?state=opened&per_page=${limit}&order_by=updated_at`) ?? [];

  // Resolve which MR to work on. Everything downstream is wasted effort if it runs
  // against the wrong one, so an unresolved MR is a question for the user — never
  // a guess, and never "the first open one".
  let iid = mr;
  if (!/^\d+$/.test(mr)) {
    const branch = mr || text("git", ["branch", "--show-current"]);
    const found: Json[] = branch
      ? (api(`${P}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`) ?? [])
      : [];
    if (found.length) {
      iid = String(found[0].iid);
      if (!mr) {
        console.log(`No MR given — using !${iid}, the open MR for the current branch.`);
        console.log("(Say so if you meant a different one.)\n");
      }
    } else {
      const open = listOpen(30);
      const source = branch ? `'${branch}'` : "the current branch";
      console.log("═══ NO MR SPECIFIED ═══");
      if (!open.length) {
        console.log(`No open MR has ${source} as its source, and this project`);
        console.log("has no open MRs at all — there is nothing to gate.");
        return 3;
      }
      console.log(`No open MR has ${source} as its source.`);
      console.log("ASK THE USER which of these to process, then re-run with that number.\n");
      for (const m of open) {
        console.log(`  !${m.iid}  ${m.author.username}  ${m.detailed_merge_status ?? m.merge_status ?? "?"}${m.draft ? "  [DRAFT]" : ""}`);
        console.log(`      ${m.title}`);
        console.log(`      branch: ${m.source_branch}   updated: ${m.updated_at}`);
      }
      console.log("\nDo not pick one yourself.");
      return 2;
    }
  }

  const MR = `${P}/merge_requests/${iid}`;
  const read = (): Json | null => api(`${MR}?include_diverged_commits_count=true`);
  let view = read();
  for (let attempt = 0; attempt < 2 && UNSETTLED_MERGE_STATUS.includes(view?.detailed_merge_status); attempt++) {
    Bun.sleepSync(2_000);
    view = read();
  }
  if (!view) {
    console.log("═══ MR ═══\n  (could not read the MR)");
    return 1;
  }

  let waited: Ci | null = null;
  if (wait && view.state === "opened") {
    waited = waitForCi(() => ciState((view = read() ?? view)));
    console.log();
  }
  const sha: string = view.sha ?? "";

  console.log("═══ MR ═══");
  console.log(`!${view.iid} ${view.title}`);
  console.log(`author:    ${view.author?.username ?? "ghost"}${isAgent(view.author) ? " (bot)" : ""}`);
  console.log(`state:     ${view.state}${view.draft ? " [DRAFT]" : ""}`);
  const fork = view.source_project_id === view.target_project_id ? "" : `   (from a fork, project ${view.source_project_id})`;
  console.log(`branch:    ${view.source_branch} → ${view.target_branch}${fork}`);
  console.log(`head sha:  ${sha}`);
  console.log(`size:      ${view.changes_count ?? "?"} files changed`);
  console.log(`labels:    ${(view.labels ?? []).join(", ") || "none"}`);
  const approvals = api(`${MR}/approvals`);
  if (approvals) {
    const by = (approvals.approved_by ?? []).map((a: Json) => a.user.username).join(", ") || "nobody";
    const need = approvals.approvals_required;
    const rule = need ? `${need} required, ${approvals.approvals_left ?? "?"} left` : "none required";
    console.log(`approvals: ${rule}; approved by ${by}`);
  }
  const reviewers: Json[] = api(`${MR}/reviewers`) ?? [];
  if (reviewers.length) {
    console.log("reviewers: " + reviewers.map((r) => `${r.user.username} (${r.state ?? "?"})`).join(", "));
  }
  console.log(`you:       ${api("user")?.username ?? "?"}`);

  section("MERGEABILITY");
  if (view.state !== "opened") console.log(`MR is ${view.state} — mergeability does not apply.`);
  else {
    const status: string = view.detailed_merge_status ?? view.merge_status ?? "?";
    console.log(`status:     ${status} — ${MERGE_STATUS_NOTES[status] ?? ""}`);
    console.log(`conflicts:  ${view.has_conflicts ? "YES" : "no"}`);
    if (view.diverged_commits_count != null) {
      console.log(`behind:     the target has ${view.diverged_commits_count} commit(s) this branch lacks`);
    }
    if (view.merge_when_pipeline_succeeds) console.log(`auto-merge: already set by ${view.merge_user?.username ?? "?"}`);
    if (view.merge_error) console.log(`last merge error: ${view.merge_error}`);
  }

  section("CHANGED FILES");
  const diffs = pages(`${MR}/diffs`);
  if (!diffs) console.log("  (unavailable)");
  else {
    for (const d of diffs.slice(0, 60)) {
      const mark = d.new_file ? "new      " : d.deleted_file ? "deleted  " : d.renamed_file ? "renamed  " : "";
      console.log(`  ${mark}${d.renamed_file ? `${d.old_path} → ${d.new_path}` : d.new_path}`);
    }
    if (diffs.length > 60) console.log(`  … and ${diffs.length - 60} more`);
  }

  section("MERGE GATES (project settings — what GitLab itself refuses to merge over)");
  const mustPass = project.only_allow_merge_if_pipeline_succeeds;
  const threadsMustResolve = flag(project.only_allow_merge_if_all_discussions_are_resolved);
  console.log(`pipeline must succeed:        ${flag(mustPass)}`);
  console.log(`skipped pipeline is accepted: ${flag(project.allow_merge_on_skipped_pipeline)}`);
  console.log(`all threads must be resolved: ${threadsMustResolve}`);
  for (const c of (api(`${MR}/status_checks`) ?? []) as Json[]) {
    console.log(`external status check:        ${c.name} [${c.status}]`);
  }
  if (!mustPass) {
    console.log("\n  GitLab will merge this over a red or missing pipeline. That is the project's");
    console.log("  setting, not a verdict: the pipeline below still gates readiness.");
  }

  section("PIPELINE");
  const hp = view.head_pipeline;
  if (!hp) console.log("no pipeline on this MR — CI has not run. Not the same as green.");
  else {
    console.log(`head pipeline: #${hp.id}  ${hp.status}  (${hp.source})  ${hp.web_url ?? ""}`);
    const ranOn = (hp.sha ?? "").slice(0, 12);
    if (hp.sha === sha) console.log("ran on:        the MR head");
    else if (ciState(view).phase === "none") {
      console.log(`ran on:        ${ranOn} — NOT the MR head ${sha.slice(0, 12)}. CI has not run on the current head.`);
    } else console.log(`ran on:        merge result ${ranOn} (${hp.ref})`);
    if (hp.project_id && hp.project_id !== project.id) console.log(`runs in:       project ${hp.project_id}, not the MR's — read its jobs under projects/${hp.project_id}`);
    if (hp.yaml_errors) console.log(`yaml errors:   ${hp.yaml_errors}`);
  }
  const basePipelines: Json[] = api(`${P}/pipelines?ref=${encodeURIComponent(view.target_branch)}&per_page=5`) ?? [];
  if (basePipelines.length) {
    console.log(`last pipelines on ${view.target_branch}: ${basePipelines.map((p) => p.status).join(", ")}`);
  }
  // A fork's pipeline lives in the fork's project.
  const pipeline = hp ? `projects/${hp.project_id}/pipelines/${hp.id}` : "";
  const bridges: Json[] = (pipeline && pages(`${pipeline}/bridges`)) || [];
  const jobs: Json[] = [...((pipeline && pages(`${pipeline}/jobs`)) || []), ...bridges];
  for (const advisory of [false, true]) {
    const rows = jobs.filter((j) => Boolean(j.allow_failure) === advisory);
    if (!rows.length) continue;
    console.log(advisory ? "── advisory jobs (allow_failure) ──" : "── blocking jobs (a failure fails the pipeline) ──");
    for (const j of rows.slice(0, 40)) console.log(`  ${`${j.stage ?? "?"}/${j.name}`.padEnd(52)} ${j.status}`);
    if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);
  }
  for (const b of bridges) {
    const down = b.downstream_pipeline;
    if (down) console.log(`  downstream of ${b.name}: #${down.id} ${down.status}  ${down.web_url ?? ""}`);
  }

  section("FAILING / STALLED (with job IDs and log links)");
  const bad = jobs.filter(
    (j) => [...ACTIVE, "failed", "canceled"].includes(j.status) || (j.status === "manual" && !j.allow_failure),
  );
  if (!bad.length) console.log("  (nothing failing or in flight)");
  for (const j of bad) {
    const tags =
      j.status + (j.allow_failure ? ", advisory" : "") + (j.status === "manual" ? ", blocks the pipeline until someone runs it" : "");
    const reason = j.failure_reason ? `  reason: ${j.failure_reason}` : "";
    console.log(`  ${j.stage}/${j.name}  [${tags}]  job ${j.id}${reason}  ${j.web_url ?? ""}`);
  }

  section("REVIEW THREADS AND AGENT COMMENTS");
  console.log(`thread resolution required to merge: ${threadsMustResolve}`);
  const discussions = api("graphql", "-f", `path=${project.path_with_namespace}`, "-f", `iid=${iid}`,
    "-f", `query=${DISCUSSIONS_QUERY}`)?.data?.project?.mergeRequest?.discussions;
  if (!discussions) console.log("  (unavailable)");
  else {
    const userNotes = (d: Json): Json[] => d.notes.nodes.filter((n: Json) => !n.system);
    const threads: Json[] = discussions.nodes.filter((d: Json) => d.resolvable && userNotes(d).length);
    const open = threads.filter((d) => !d.resolved);
    const more = discussions.pageInfo.hasNextPage ? "  (over 100 discussions: page for the rest)" : "";
    console.log(`unresolved threads: ${open.length} of ${threads.length}${more}`);
    for (const kind of ["agent", "human"]) {
      for (const d of open) {
        const notes = userNotes(d);
        const first = notes[0];
        if ((isAgent(first.author) ? "agent" : "human") !== kind) continue;
        const pos = first.position;
        const outdated = pos && (pos.diffRefs?.headSha ?? sha) !== sha;
        const canResolve = first.userPermissions?.resolveNote ?? true;
        const tags = kind + (outdated ? ", outdated" : "") + (canResolve ? "" : ", you cannot resolve");
        const where = pos ? `${pos.filePath}:${pos.newLine ?? pos.oldLine ?? "?"}` : "(not on the diff)";
        const replies = notes.length - 1;
        const last = notes[notes.length - 1].author?.username ?? "ghost";
        console.log(`  [${tags}] ${where}  @${first.author?.username ?? "ghost"}` +
          (replies ? `  ${replies} replies, last @${last}` : ""));
        console.log(`    ${gist(first.body)}`);
        console.log(`    discussion ${lastSegment(d.id)}  ${first.url ?? ""}`);
      }
    }
    const top: Json[] = discussions.nodes
      .filter((d: Json) => !d.resolvable)
      .flatMap(userNotes)
      .filter((n: Json) => isAgent(n.author) && (n.body ?? "").trim());
    console.log(`agent top-level comments: ${top.length}`);
    for (const n of top.slice(-15)) {
      console.log(`  @${n.author.username}  note ${lastSegment(n.id)}  ${n.url ?? ""}`);
      console.log(`    ${gist(n.body)}`);
    }
  }

  section("PROJECT MERGE CONVENTIONS");
  const template = (t: string | null) => (t ? JSON.stringify(t) : "(GitLab default)");
  console.log(`merge method:         ${project.merge_method} — ${MERGE_METHOD_NOTES[project.merge_method] ?? ""}`);
  console.log(`squash:               project ${project.squash_option}; this MR ${Boolean(view.squash)}`);
  console.log(`delete source branch: project default ${flag(project.remove_source_branch_after_merge)}; ` +
    `this MR ${Boolean(view.force_remove_source_branch || view.should_remove_source_branch)}`);
  console.log(`squash commit template: ${template(project.squash_commit_template)}`);
  console.log(`merge commit template:  ${template(project.merge_commit_template)}`);
  if ("merge_pipelines_enabled" in project) console.log(`merged-results pipelines: ${flag(project.merge_pipelines_enabled)}`);
  if ("merge_trains_enabled" in project) console.log(`merge trains:         ${flag(project.merge_trains_enabled)}`);
  console.log(`
  Reading the squash settings: GitLab's default squash template is %{title}, so
  a squashed MR lands as its title and nothing else. Commit bodies and the MR
  description are both dropped, and with them any hand-written trailer (Release:,
  Skip-Release:, Co-authored-by:), unless the template names %{description},
  %{all_commits} or %{co_authored_by}. If a trailer has to survive, pass the
  message yourself with \`glab mr merge --squash-message\`.`);

  conventionDocs(project.web_url, cwdUrl, ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", ".gitlab/merge_request_templates"]);

  section("OTHER OPEN MRs (is someone shipping this same work?)");
  for (const m of listOpen(15)) {
    console.log(`  !${m.iid}  ${m.author.username}  ${m.detailed_merge_status ?? "?"}  ${m.title}`.slice(0, 140));
  }

  return waited ? ciExitCode(waited) : 0;
}
