// The fact pass for a GitHub pull request, through the `gh` CLI.

import { ciExitCode, conventionDocs, exec, gist, json, section, text, waitForCi, type Ci, type Json } from "./shared";

const gh = (...args: string[]): Json | null => json("gh", args);

const MERGE_STATE_NOTES: Record<string, string> = {
  CLEAN: "ready",
  BLOCKED: "a required check or review is missing",
  BEHIND: "base moved; branch needs an update",
  UNSTABLE: "a non-required check is failing or still running",
  DIRTY: "merge conflicts",
  UNKNOWN: "GitHub has not computed it yet — re-poll",
};

const THREADS_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100){ totalCount pageInfo{ hasNextPage } nodes{
      id isResolved isOutdated path line originalLine viewerCanResolve
      head: comments(first:1){ totalCount nodes{ author{ login __typename } body url } }
      tail: comments(last:1){ nodes{ author{ login } } } } }
    comments(last:50){ nodes{ id isMinimized author{ login __typename } body url } }
    reviews(last:50){ nodes{ id state isMinimized author{ login __typename } body url } }
  } } }`;

/** Agent reviewers (Copilot, CodeRabbit, Codex, Claude...) post as Bot accounts. */
function who(author: Json): { login: string; bot: boolean } {
  if (!author) return { login: "ghost", bot: false };
  return { login: author.login, bot: author.__typename === "Bot" || author.login.endsWith("[bot]") };
}

function ciState(pr: string): Ci {
  // `gh pr checks` exits non-zero for pending and failed checks alike; the JSON is the answer.
  const p = exec("gh", ["pr", "checks", pr, "--json", "name,bucket"]);
  let checks: Json[] = [];
  try {
    checks = JSON.parse(p.stdout);
  } catch {
    // Only gh's own "no checks reported" means none. An API error or an old gh is
    // an unread state, and the next poll may read it.
    if (!/no checks reported/.test(p.stderr)) {
      return { phase: "running", label: `could not read the checks, retrying (${p.stderr.trim().split("\n")[0]})` };
    }
  }
  if (!checks.length) return { phase: "none", label: "no checks reported" };
  const count = (bucket: string) => checks.filter((c) => c.bucket === bucket).length;
  const pending = count("pending");
  const bad = count("fail") + count("cancel");
  // One failed check settles the answer; the rest finishing cannot turn it green.
  if (bad) {
    const rest = pending ? `, ${pending} still pending` : "";
    return { phase: "red", label: `${bad} of ${checks.length} checks failed or were canceled${rest}` };
  }
  if (pending) return { phase: "running", label: `${pending} of ${checks.length} checks pending` };
  if (!count("pass")) return { phase: "other", label: `all ${checks.length} checks were skipped` };
  return { phase: "green", label: `all ${checks.length} checks settled, none failed` };
}

/** The open PRs as printable lines, or null when they could not be listed. */
function listOpen(repo: string): string[] | null {
  const open: Json[] | null =
    gh("pr", "list", "--repo", repo, "--state", "open", "--limit", "30", "--json",
      "number,title,author,isDraft,updatedAt,headRefName,additions,deletions,changedFiles");
  if (!open) return null;
  return open.flatMap((p) => [
    `  #${p.number}  ${p.author.login}${p.author.is_bot ? " (bot)" : ""}  +${p.additions}/-${p.deletions} ${p.changedFiles}f${p.isDraft ? "  [DRAFT]" : ""}`,
    `      ${p.title}`,
    `      branch: ${p.headRefName}   updated: ${p.updatedAt}`,
  ]);
}

function printChecks(pr: string) {
  const table = (args: string[], widths: number[], limit: number) => {
    const p = exec("gh", ["pr", "checks", pr, ...args]);
    const lines = (p.stdout + p.stderr).split("\n").filter(Boolean).slice(0, limit);
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 2) console.log(`  ${line}`);
      else console.log("  " + widths.map((w, i) => (cols[i] ?? "").padEnd(w)).join(" ").trimEnd());
    }
  };
  section("CHECK STATUS");
  console.log("── required ──");
  table(["--required"], [52, 0], 20);
  console.log("── all ──");
  table([], [52, 9, 0], 40);
}

function printFailing(pr: string) {
  section("FAILING / STALLED (with log links)");
  const rollup: Json[] | undefined = gh("pr", "view", pr, "--json", "statusCheckRollup")?.statusCheckRollup;
  if (!rollup) return console.log("  (unavailable)");
  const bad = rollup.filter(
    (c) =>
      ["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(c.conclusion) ||
      ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"].includes(c.status) ||
      ["FAILURE", "ERROR", "PENDING", "EXPECTED"].includes(c.state),
  );
  if (!bad.length) console.log("  (nothing failing or in flight)");
  for (const c of bad) {
    console.log(`  ${c.name ?? c.context}  [${c.conclusion || c.status || c.state}]  ${c.detailsUrl ?? c.targetUrl ?? ""}`);
  }
}

/**
 * Whether an open thread blocks the merge. Rulesets and classic branch protection each
 * hold this setting in their own place, and reading classic protection needs admin. Say
 * "unknown" rather than "false" when neither answered, so an open thread is not called
 * harmless.
 */
function threadResolutionRequired(repo: string, base: string, rules: Json[] | null): string {
  let known = rules ? String(rules.some((r) => r.type === "pull_request" && r.parameters?.required_review_thread_resolution)) : "";
  if (known === "true") return known;
  const p = exec("gh", ["api", `repos/${repo}/branches/${base}/protection`]);
  if (p.status === 0) {
    try {
      if (JSON.parse(p.stdout).required_conversation_resolution?.enabled) return "true";
    } catch {}
    return known || "false";
  }
  // A plain "Not Found" is also what a token without admin rights gets on a protected branch.
  if (/Branch not protected/.test(p.stdout + p.stderr)) return known || "false";
  return `${known || "unknown"}, and classic branch protection is unreadable here`;
}

function printThreads(owner: string, name: string, num: string, resolution: string) {
  section("REVIEW THREADS AND AGENT COMMENTS");
  console.log(`thread resolution required to merge: ${resolution}`);
  const pr = gh("api", "graphql", "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${num}`,
    "-f", `query=${THREADS_QUERY}`)?.data?.repository?.pullRequest;
  if (!pr) return console.log("  (unavailable)");

  const threads = pr.reviewThreads;
  const open: Json[] = threads.nodes.filter((t: Json) => !t.isResolved);
  const more = threads.pageInfo.hasNextPage ? "  (over 100 threads: page for the rest)" : "";
  console.log(`unresolved threads: ${open.length} of ${threads.totalCount}${more}`);
  for (const kind of ["agent", "human"]) {
    for (const t of open) {
      const first = t.head.nodes[0] ?? {};
      const { login, bot } = who(first.author);
      if ((bot ? "agent" : "human") !== kind) continue;
      const tags = kind + (t.isOutdated ? ", outdated" : "") + (t.viewerCanResolve ? "" : ", you cannot resolve");
      const replies = t.head.totalCount - 1;
      const last = t.tail.nodes[0]?.author?.login ?? "ghost";
      console.log(`  [${tags}] ${t.path}:${t.line ?? t.originalLine ?? "?"}  @${login}` +
        (replies ? `  ${replies} replies, last @${last}` : ""));
      console.log(`    ${gist(first.body)}`);
      console.log(`    thread ${t.id}  ${first.url ?? ""}`);
    }
  }

  const top: [string, Json][] = [
    ...pr.comments.nodes.map((c: Json) => ["comment", c]),
    ...pr.reviews.nodes.map((r: Json) => [`review ${r.state}`, r]),
  ].filter(([, c]) => who(c.author).bot && !c.isMinimized && (c.body ?? "").trim());
  console.log(`agent top-level comments and review bodies: ${top.length}`);
  for (const [kind, c] of top.slice(-15)) {
    console.log(`  [${kind}] @${who(c.author).login}  ${c.id}  ${c.url}`);
    console.log(`    ${gist(c.body)}`);
  }
}

function printMergeConventions(repo: string) {
  section("REPO MERGE CONVENTIONS");
  const r = gh("api", `repos/${repo}`);
  if (!r) console.log("  (unavailable)");
  else {
    console.log(`squash allowed:   ${r.allow_squash_merge}`);
    console.log(`merge allowed:    ${r.allow_merge_commit}`);
    console.log(`rebase allowed:   ${r.allow_rebase_merge}`);
    console.log(`auto-merge:       ${r.allow_auto_merge}`);
    console.log(`delete on merge:  ${r.delete_branch_on_merge}`);
    console.log(`squash subject:   ${r.squash_merge_commit_title}`);
    console.log(`squash body:      ${r.squash_merge_commit_message}`);
  }
  console.log(`
  Reading the squash settings: COMMIT_OR_PR_TITLE means a single-commit PR keeps
  its own subject and a multi-commit PR lands under the PR title. COMMIT_MESSAGES
  means the squash body becomes GitHub's bulleted list of commit subjects — which
  silently drops hand-written trailers (Release:, Skip-Release:, Co-authored-by:).
  If a trailer has to survive, pass it yourself with \`gh pr merge --body\`.`);
}

/** Print the facts for one pull request. Returns the process exit code. */
export function github(target: string, wait: boolean): number {
  // The checkout only resolves a PR that was not named. Every later call uses the
  // repo the PR itself belongs to, so a URL from another repo cannot mix that
  // PR's checks with this checkout's merge policy.
  const cwdRepo = text("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!cwdRepo && !target) {
    console.error("Not in a GitHub repo, or gh is not authenticated. Pass a PR number or URL.");
    return 1;
  }

  // Resolve which PR to work on. Everything downstream is wasted effort if it runs
  // against the wrong one, so an unresolved PR is a question for the user — never
  // a guess, and never "the first open one".
  let pr = target;
  if (!pr) {
    // `gh pr view` also answers with the branch's merged or closed PR.
    const current = gh("pr", "view", "--json", "number,state");
    if (current?.state === "OPEN") {
      pr = String(current.number);
      console.log(`No PR given — using #${pr}, the open PR for the current branch.`);
      console.log("(Say so if you meant a different one.)\n");
    } else {
      const open = listOpen(cwdRepo);
      if (!open) {
        console.error(`Could not list the open PRs of ${cwdRepo}. Pass a PR number or URL.`);
        return 1;
      }
      console.log("═══ NO PR SPECIFIED ═══");
      if (!open.length) {
        console.log("Nothing was passed, the current branch has no open PR, and this repo");
        console.log("has no open PRs at all — there is nothing to gate.");
        return 3;
      }
      console.log("Nothing was passed and the current branch has no open PR.");
      console.log("ASK THE USER which of these to process, then re-run with that number.\n");
      console.log(open.join("\n"));
      console.log("\nDo not pick one yourself.");
      return 2;
    }
  }

  const fields =
    "number,title,author,state,isDraft,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,labels,reviewDecision,url";
  const read = () => gh("pr", "view", pr, "--json", fields);
  let view = read();
  if (!view) {
    console.error(`Could not read PR ${pr}: it does not exist here, or gh is not authenticated.`);
    return 1;
  }
  let waited: Ci | null = null;
  if (wait) {
    waited = view.state === "OPEN"
      ? waitForCi(() => ciState(pr))
      : { phase: "none", label: `the PR is ${view.state}` };
    console.log();
    view = read() ?? view;
  }
  printFacts(pr, view, cwdRepo);
  return waited ? ciExitCode(waited) : 0;
}

function printFacts(pr: string, view: Json, cwdRepo: string) {
  const [, , , owner, name, , num] = view.url.split("/");
  const repo = `${owner}/${name}`;
  const base: string = view.baseRefName;

  console.log("═══ PR ═══");
  console.log(`#${view.number} ${view.title}`);
  console.log(`author:    ${view.author.login}${view.author.is_bot ? " (bot)" : ""}`);
  console.log(`state:     ${view.state}${view.isDraft ? " [DRAFT]" : ""}`);
  console.log(`branch:    ${view.headRefName} → ${view.baseRefName}`);
  console.log(`head sha:  ${view.headRefOid}`);
  console.log(`size:      +${view.additions} −${view.deletions} across ${view.changedFiles} files`);
  console.log(`labels:    ${view.labels.map((l: Json) => l.name).join(", ") || "none"}`);
  console.log(`review:    ${view.reviewDecision || "none required"}`);
  console.log(`you:       ${text("gh", ["api", "user", "--jq", ".login"]) || "?"}`);

  section("MERGEABILITY");
  if (view.state !== "OPEN") console.log(`PR is ${view.state} — mergeability does not apply.`);
  else {
    // mergeable/mergeStateStatus are computed lazily by GitHub. The first read after
    // a push routinely returns UNKNOWN; re-poll rather than reporting "unmergeable".
    let merge: Json | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      merge = gh("pr", "view", pr, "--json", "mergeable,mergeStateStatus");
      if (merge?.mergeable && merge.mergeable !== "UNKNOWN") break;
      Bun.sleepSync(2_000);
    }
    if (!merge) console.log("  (unavailable)");
    else {
      console.log(`mergeable: ${merge.mergeable}`);
      console.log(`state:     ${merge.mergeStateStatus} — ${MERGE_STATE_NOTES[merge.mergeStateStatus] ?? ""}`);
    }
  }

  section("CHANGED FILES");
  const files = text("gh", ["pr", "diff", pr, "--name-only"]).split("\n").filter(Boolean);
  for (const f of files.slice(0, 60)) console.log(f);
  if (files.length > 60) console.log(`  … and ${files.length - 60} more`);

  section("REQUIRED CHECKS (from branch rules — the only ones that gate merge)");
  const rules: Json[] | null = gh("api", `repos/${repo}/rules/branches/${base}`);
  if (!rules) console.log("  (could not read branch rules; treat every failing check as blocking)");
  else {
    const required = rules
      .filter((r) => r.type === "required_status_checks")
      .flatMap((r) => r.parameters.required_status_checks.map((c: Json) => c.context));
    if (!required.length) console.log("  (none — no status check gates merge on this branch)");
    for (const context of required) console.log(`  ${context}`);
    console.log(`  other rules: ${rules.map((r) => r.type).join(", ") || "none"}`);
  }

  printChecks(pr);
  printFailing(pr);
  printThreads(owner, name, num, threadResolutionRequired(repo, base, rules));
  printMergeConventions(repo);
  conventionDocs(repo, cwdRepo, ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"]);

  section("OTHER OPEN PRs (is someone shipping this same work?)");
  const others: Json[] =
    gh("pr", "list", "--repo", repo, "--state", "open", "--limit", "15", "--json", "number,title") ?? [];
  for (const p of others) console.log(`  #${p.number}  ${p.title}`);
}
