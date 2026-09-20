# Merge mechanics

Read this before merging anything. The failures here are quiet: the merge
succeeds, and something downstream — a release, a changelog, a deploy — silently
does the wrong thing days later.

- [Authorization](#authorization)
- [Required vs advisory checks](#required-vs-advisory-checks)
- [Choosing the merge method](#choosing-the-merge-method)
- [Protecting trailers](#protecting-trailers)
- [Race safety](#race-safety)
- [Auto-merge](#auto-merge)
- [After the merge](#after-the-merge)
- [Bringing a stale branch up to date](#bringing-a-stale-branch-up-to-date)

---

## Authorization

Merging is irreversible, visible to everyone with access, and often triggers a
deploy. It needs the user to have actually asked for it.

- **Asked:** "merge it", "land it", "merge if CI is green", "validate and merge".
- **Not asked:** "validate this PR", "is this safe?", "why is CI red?", "does
  this break anything?" — these want a verdict. Deliver it and stop.

Authorization does not carry between PRs. Being told to merge one PR is not
standing permission for the next one.

A conditional authorization has a condition. "Merge it if nothing breaks" plus a
real regression means the condition failed: report, do not merge.

Never reach for `--admin` to bypass a failing required check on your own
initiative. That flag exists for a human to make a deliberate exception.

---

## Required vs advisory checks

Only the checks named in the branch rules gate a merge:

```bash
BASE=$(gh pr view <PR> --json baseRefName --jq .baseRefName)
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api "repos/$REPO/rules/branches/$BASE" \
  --jq '[.[] | select(.type=="required_status_checks")
        | .parameters.required_status_checks[].context] | .[]'
gh pr checks <PR> --required
```

Repos commonly have one or two required checks and dozens of advisory ones, so
"wait for everything green" can mean waiting an hour for jobs that cannot block
anything. That does not make advisory checks worthless — a failing advisory test
suite is still evidence about the change. It means the decision is yours to make
and to state: say which checks you waited for and why, especially when you merged
while something was still running.

Other rules on the branch matter too. `pull_request` rules can require a review
even with an approval count of zero, which is why a bot cannot push straight to a
protected branch and why `mergeStateStatus` may say `BLOCKED` with every check
green.

---

## Choosing the merge method

Take it from the repo, not from habit:

```bash
gh api "repos/$REPO" --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit,
  rebase: .allow_rebase_merge, auto: .allow_auto_merge, delete: .delete_branch_on_merge,
  squash_title: .squash_merge_commit_title, squash_body: .squash_merge_commit_message}'
```

If only one method is allowed, use it. Where several are allowed, follow what the
repo's recent history actually does (`git log --merges` on the base branch tells
you quickly).

---

## Protecting trailers

This is the quiet one worth knowing by heart.

`squash_merge_commit_title`:
- `COMMIT_OR_PR_TITLE` — a **single-commit** PR keeps that commit's subject; a
  **multi-commit** PR lands under the **PR title**. So on a multi-commit PR the
  PR title is the commit message, and any title-grammar check is load-bearing.
- `PR_TITLE` — always the PR title.

`squash_merge_commit_message`:
- `COMMIT_MESSAGES` — GitHub **replaces the body** with its own bulleted list of
  commit subjects. Any hand-written trailer (`Release:`, `Skip-Release:`,
  `Co-authored-by:`, `Fixes #123`) is flattened into a bullet or dropped
  entirely, and the tool that was supposed to read it never sees it.
- `PR_BODY` — the PR description becomes the body, so trailers there survive.
- `BLANK` — empty body.

When a trailer has to survive, pass it explicitly:

```bash
gh pr merge <PR> --squash \
  --subject "<type>(<scope>): <subject> (#<PR>)" \
  --body "Skip-Release: true"
```

The general rule: if a release tool, a changelog generator or an automation reads
something out of the commit message, confirm it will still be there after the
squash. Read the PR body for trailers before merging — a bot that declares
`Skip-Release: true` in its description is expressing an intent that the default
squash settings may well discard.

---

## Race safety

Validate commit X, someone pushes Y, you merge Y unvalidated. Pin the merge to
what you checked:

```bash
HEAD_SHA=$(gh pr view <PR> --json headRefOid --jq .headRefOid)   # before validating
# ... validate ...
gh pr merge <PR> --squash --match-head-commit "$HEAD_SHA"
```

The merge is refused if the PR moved. Capture the SHA *before* validating, not
after — a SHA read at merge time proves nothing.

Also worth a glance before merging: whether another PR is shipping the same work.
Concurrent sessions and duplicate bot PRs both happen.

```bash
gh pr list --state open --search "<ticket-id>"
```

---

## Auto-merge

When the verdict is clean and only waiting remains, this beats sitting on the PR:

```bash
gh pr merge <PR> --squash --auto --match-head-commit "$HEAD_SHA"
```

GitHub lands it once the required checks pass. It needs `allow_auto_merge` on the
repo and a branch rule that actually gates the merge — with no required checks,
auto-merge has nothing to wait for and merges immediately, so check before
reaching for it.

Tell the user you enabled auto-merge rather than merged, and what it is waiting
on. `gh pr merge --disable-auto` undoes it.

---

## After the merge

```bash
gh pr view <PR> --json state,mergedAt,mergeCommit \
  --jq '"state=\(.state) sha=\(.mergeCommit.oid)"'
```

Confirm it landed rather than assuming — a merge call can succeed at the CLI and
still leave the PR open if auto-merge was enabled instead.

Then clean up after yourself: remove scratch worktrees (`git worktree remove
--force`, then `git worktree prune`), delete temp files, and delete the branch if
that is the repo's habit (`--delete-branch`, or automatic when
`delete_branch_on_merge` is set).

Report the merge commit SHA. It is what the user needs to trace what shipped, and
it is the anchor for a revert if one becomes necessary.

If the repo's convention docs describe post-merge duties — updating a tracker,
pushing local work, filing follow-ups — do them. That is usually where a repo
records the steps its team keeps forgetting.

---

## Bringing a stale branch up to date

This is what to do once the user has authorized fixing a `CONFLICTING` PR (see
the main skill file's [When mergeable is CONFLICTING](../SKILL.md#when-mergeable-is-conflicting))
— it is an authored change to someone else's branch, so get that authorization
first, the same way a merge itself needs it.

1. **Measure the staleness and the overlap before touching anything:**
   ```bash
   MB=$(git merge-base origin/main origin/<head-branch>)
   git log --oneline "$MB"..origin/main | wc -l                     # how far behind
   git log --oneline "$MB"..origin/main -- <PR's changed files>     # what overlapped
   ```
   Read the overlapping commits' diffs, not just their subjects — they are the
   ones that can turn into a silent regression rather than a conflict marker.

2. **Prefer a merge commit over a rebase when the repo squash-merges.** A
   rebase replays every commit on the branch, so a conflict spanning several
   of them gets resolved once per commit; a merge resolves it exactly once.
   A squash-merging repo discards the branch's intermediate commits at merge
   time anyway, so there is no downstream cost to using a merge commit here —
   confirm the repo's own habit (`git log --merges <base>`, or the facts
   output's squash settings) before assuming a rebase is expected just
   because that is the more familiar word for "update my branch."

3. **Do the reconciliation in a scratch worktree**, same as any other
   validation step — see [Validate in a scratch worktree](../SKILL.md#validate-in-a-scratch-worktree)
   — not the user's checkout, and not by pushing straight from a bare clone.

4. **Never resolve a semantic conflict by picking a side.** When two branches
   changed the same function for different reasons — a feature that shipped
   on main, new logic in the PR — the merged result should almost always keep
   *both*, re-threaded together, not whichever side `git merge` happened to
   keep or a mechanical `--ours`/`--theirs`. Read both changes' commit
   messages and code for *why* before writing the merged version; "why" is
   usually right there in a comment or commit body in a codebase that
   documents its decisions.

5. **A mechanical-looking conflict can still need a real regeneration step.**
   A migration/journal number collision, a lockfile diff, or any tool-owned
   sequential-ID file is usually safe to fix — but follow the repo's own
   regeneration command (e.g. re-running the schema tool that owns it) rather
   than hand-editing sequence numbers or IDs, and preserve any hand-written
   content (guards, comments explaining a non-obvious safety property) that
   the regenerated version won't reproduce on its own.

6. **Run the repo's real gates before pushing** — build, lint, the test
   suites its pre-push hook runs — to the same standard a first-time
   validation would. A reconciliation that compiles but silently drops a
   feature (point 4) is worse than the conflict it replaced, and nothing
   about a clean `git merge` exit code would catch that.

7. **Push to the PR's branch, then re-validate from scratch.** The resulting
   commit is new code nobody has reviewed yet. Treat it like any other head
   move — re-run [Judge readiness, then report](../SKILL.md#judge-readiness-then-report)
   against the new SHA rather than assuming the original verdict still holds.
