#!/usr/bin/env bash
# One-shot fact gathering for a pull request: what it changes, what the repo's
# merge rules are, and which checks are green, red, or still running.
#
# Usage: pr-facts.sh [PR_NUMBER_OR_URL]     (defaults to the current branch's PR)
#
# Everything here is read-only. Run it before forming any opinion — guessing at
# a repo's merge conventions is how trailers get eaten and unvalidated code lands.

set -uo pipefail

PR="${1:-}"
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) || {
  echo "Not in a GitHub repo, or gh is not authenticated." >&2
  exit 1
}

# Resolve which PR to work on. Everything downstream is wasted effort if it runs
# against the wrong one, so an unresolved PR is a question for the user — never
# a guess, and never "the first open one".
if [ -z "$PR" ]; then
  PR=$(gh pr view --json number --jq .number 2>/dev/null) || PR=""
  if [ -n "$PR" ]; then
    echo "No PR given — using #$PR, the open PR for the current branch."
    echo "(Say so if you meant a different one.)"
    echo
  else
    OPEN=$(gh pr list --state open --limit 30 \
      --json number,title,author,isDraft,updatedAt,headRefName,additions,deletions,changedFiles \
      --jq '.[] | "  #\(.number)  \(.author.login)\(if .author.is_bot then " (bot)" else "" end)  +\(.additions)/-\(.deletions) \(.changedFiles)f\(if .isDraft then "  [DRAFT]" else "" end)
      \(.title)
      branch: \(.headRefName)   updated: \(.updatedAt)"' 2>/dev/null)
    echo "═══ NO PR SPECIFIED ═══"
    if [ -z "$OPEN" ]; then
      echo "Nothing was passed, the current branch has no open PR, and this repo"
      echo "has no open PRs at all — there is nothing to gate."
      exit 3
    fi
    echo "Nothing was passed and the current branch has no open PR."
    echo "ASK THE USER which of these to process, then re-run with that number."
    echo
    printf '%s\n' "$OPEN"
    echo
    echo "Do not pick one yourself."
    exit 2
  fi
fi

pr() { gh pr "$@" "$PR"; }

echo "═══ PR ═══"
pr view --json number,title,author,state,isDraft,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,labels,reviewDecision \
  --jq '"#\(.number) \(.title)
author:    \(.author.login)\(if .author.is_bot then " (bot)" else "" end)
state:     \(.state)\(if .isDraft then " [DRAFT]" else "" end)
branch:    \(.headRefName) → \(.baseRefName)
head sha:  \(.headRefOid)
size:      +\(.additions) −\(.deletions) across \(.changedFiles) files
labels:    \([.labels[].name] | join(", ") // "none")
review:    \(.reviewDecision // "none required")"' 2>/dev/null || echo "  (could not read PR)"
echo "you:       $(gh api user --jq .login 2>/dev/null || echo '?')"

# mergeable/mergeStateStatus are computed lazily by GitHub. The first read after
# a push routinely returns UNKNOWN; re-poll rather than reporting "unmergeable".
echo
echo "═══ MERGEABILITY ═══"
PR_STATE=$(pr view --json state --jq .state 2>/dev/null)
if [ "$PR_STATE" != "OPEN" ]; then
  echo "PR is $PR_STATE — mergeability does not apply."
else
for attempt in 1 2 3; do
  MERGE_JSON=$(pr view --json mergeable,mergeStateStatus 2>/dev/null)
  STATE=$(printf '%s' "$MERGE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mergeable",""))' 2>/dev/null)
  [ "$STATE" != "UNKNOWN" ] && [ -n "$STATE" ] && break
  sleep 2
done
printf '%s' "$MERGE_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)
m=d.get("mergeable","?"); s=d.get("mergeStateStatus","?")
notes={"CLEAN":"ready","BLOCKED":"a required check or review is missing","BEHIND":"base moved; branch needs an update",
       "UNSTABLE":"a non-required check is failing or still running","DIRTY":"merge conflicts","UNKNOWN":"GitHub has not computed it yet — re-poll"}
print(f"mergeable: {m}\nstate:     {s} — {notes.get(s,'')}")' 2>/dev/null || echo "  (unavailable)"
fi

echo
echo "═══ CHANGED FILES ═══"
pr diff --name-only 2>/dev/null | head -60
TOTAL=$(pr diff --name-only 2>/dev/null | wc -l | tr -d ' ')
[ "${TOTAL:-0}" -gt 60 ] && echo "  … and $((TOTAL - 60)) more"

echo
echo "═══ REQUIRED CHECKS (from branch rules — the only ones that gate merge) ═══"
BASE=$(pr view --json baseRefName --jq .baseRefName 2>/dev/null)
gh api "repos/$REPO/rules/branches/$BASE" \
  --jq '[.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]
        | if length==0 then ["  (none — no status check gates merge on this branch)"] else map("  " + .) end
        | .[]' 2>/dev/null \
  || echo "  (could not read branch rules; treat every failing check as blocking)"
gh api "repos/$REPO/rules/branches/$BASE" --jq '[.[].type] | join(", ")' 2>/dev/null \
  | sed 's/^/  other rules: /' 2>/dev/null

echo
echo "═══ CHECK STATUS ═══"
echo "── required ──"
pr checks --required 2>&1 | awk -F'\t' 'NF>1{printf "  %-52s %s\n",$1,$2} NF<=1{print "  "$0}' | head -20
echo "── all ──"
pr checks 2>&1 | awk -F'\t' 'NF>1{printf "  %-52s %-9s %s\n",$1,$2,$3} NF<=1{print "  "$0}' | head -40

echo
echo "═══ FAILING / STALLED (with log links) ═══"
pr view --json statusCheckRollup --jq '
  [.statusCheckRollup[]?
   | select(.conclusion=="FAILURE" or .conclusion=="TIMED_OUT" or .conclusion=="CANCELLED" or .conclusion=="STARTUP_FAILURE"
            or (.status=="QUEUED") or (.status=="IN_PROGRESS") or (.state=="FAILURE") or (.state=="ERROR"))
   | "  \(.name // .context)  [\(.conclusion // .status // .state)]  \(.detailsUrl // .targetUrl // "")"]
  | if length==0 then "  (nothing failing or in flight)" else .[] end' 2>/dev/null \
  || echo "  (unavailable)"

# Agent reviewers (Copilot, CodeRabbit, Codex, Claude...) post as Bot accounts.
# Owner/name/number come from the PR's own URL, so a PR URL from another repo
# still reads its own threads.
echo
echo "═══ REVIEW THREADS AND AGENT COMMENTS ═══"
PR_URL=$(pr view --json url --jq .url 2>/dev/null)
IFS=/ read -r _ _ _ OWNER NAME _ NUM <<<"$PR_URL"
RESOLUTION=$(gh api "repos/$REPO/rules/branches/$BASE" \
  --jq '[.[] | select(.type=="pull_request") | .parameters.required_review_thread_resolution] | any' 2>/dev/null)
echo "thread resolution required to merge: ${RESOLUTION:-unknown}"
read -r -d '' THREADS_PY <<'PY'
import json, re, sys
pr = json.load(sys.stdin)["data"]["repository"]["pullRequest"]

def who(a):
    if not a:
        return "ghost", False
    return a["login"], a.get("__typename") == "Bot" or a["login"].endswith("[bot]")

def gist(body, n=160):
    body = re.sub(r"<!--.*?-->", " ", body or "", flags=re.S)
    body = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", body).replace("**", "")
    body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip()
    return body[:n] + ("..." if len(body) > n else "")

threads = pr["reviewThreads"]
open_ = [t for t in threads["nodes"] if not t["isResolved"]]
more = "  (over 100 threads: page for the rest)" if threads["pageInfo"]["hasNextPage"] else ""
print(f"unresolved threads: {len(open_)} of {threads['totalCount']}{more}")
for kind in ("agent", "human"):
    for t in open_:
        c = (t["head"]["nodes"] or [{}])[0]
        login, bot = who(c.get("author"))
        if ("agent" if bot else "human") != kind:
            continue
        tags = kind + (", outdated" if t["isOutdated"] else "") + ("" if t["viewerCanResolve"] else ", you cannot resolve")
        replies = t["head"]["totalCount"] - 1
        last = ((t["tail"]["nodes"] or [{}])[0].get("author") or {}).get("login", "ghost")
        line = t["line"] or t["originalLine"] or "?"
        print(f"  [{tags}] {t['path']}:{line}  @{login}" + (f"  {replies} replies, last @{last}" if replies else ""))
        print(f"    {gist(c.get('body'))}")
        print(f"    thread {t['id']}  {c.get('url', '')}")

top = [("comment", c) for c in pr["comments"]["nodes"]] + [(f"review {r['state']}", r) for r in pr["reviews"]["nodes"]]
top = [(k, c) for k, c in top if who(c.get("author"))[1] and not c["isMinimized"] and (c["body"] or "").strip()]
print(f"agent top-level comments and review bodies: {len(top)}")
for k, c in top[-15:]:
    print(f"  [{k}] @{who(c['author'])[0]}  {c['id']}  {c['url']}")
    print(f"    {gist(c['body'])}")
PY
gh api graphql -f owner="$OWNER" -f name="$NAME" -F number="$NUM" -f query='
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    reviewThreads(first:100){ totalCount pageInfo{ hasNextPage } nodes{
      id isResolved isOutdated path line originalLine viewerCanResolve
      head: comments(first:1){ totalCount nodes{ author{ login __typename } body url } }
      tail: comments(last:1){ nodes{ author{ login } } } } }
    comments(last:50){ nodes{ id isMinimized author{ login __typename } body url } }
    reviews(last:50){ nodes{ id state isMinimized author{ login __typename } body url } }
  } } }' 2>/dev/null | python3 -c "$THREADS_PY" || echo "  (unavailable)"

echo
echo "═══ REPO MERGE CONVENTIONS ═══"
gh api "repos/$REPO" --jq '"squash allowed:   \(.allow_squash_merge)
merge allowed:    \(.allow_merge_commit)
rebase allowed:   \(.allow_rebase_merge)
auto-merge:       \(.allow_auto_merge)
delete on merge:  \(.delete_branch_on_merge)
squash subject:   \(.squash_merge_commit_title)
squash body:      \(.squash_merge_commit_message)"' 2>/dev/null || echo "  (unavailable)"
cat <<'NOTE'

  Reading the squash settings: COMMIT_OR_PR_TITLE means a single-commit PR keeps
  its own subject and a multi-commit PR lands under the PR title. COMMIT_MESSAGES
  means the squash body becomes GitHub's bulleted list of commit subjects — which
  silently drops hand-written trailers (Release:, Skip-Release:, Co-authored-by:).
  If a trailer has to survive, pass it yourself with `gh pr merge --body`.
NOTE

echo
echo "═══ REPO CONVENTION DOCS ═══"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$ROOT" ]; then
  for f in CLAUDE.md AGENTS.md CONTRIBUTING.md .github/PULL_REQUEST_TEMPLATE.md; do
    [ -f "$ROOT/$f" ] && echo "  $f ($(wc -l < "$ROOT/$f" | tr -d ' ') lines) — read it before merging"
  done
fi

echo
echo "═══ OTHER OPEN PRs (is someone shipping this same work?) ═══"
gh pr list --state open --limit 15 --json number,title,headRefName \
  --jq '.[] | "  #\(.number)  \(.title)"' 2>/dev/null | head -15
