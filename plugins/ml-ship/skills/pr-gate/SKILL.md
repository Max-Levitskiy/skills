---
name: pr-gate
description: Validate a GitHub pull request or GitLab merge request end to end — work out what it actually changes and who it breaks, watch its CI to a settled result, diagnose and fix a red pipeline, triage agent review comments (fix the valid ones, reply to and resolve the rest), judge whether it is genuinely ready, and merge it when asked. Use this whenever the user points at a PR or MR (a number, a URL, "this PR", "this MR", a Renovate/Dependabot bump) and wants to know whether it is safe, why a check is failing, whether it can be merged, or wants it merged. Use it for inbound PRs you did not write, dependency bumps, and any "is this ready to merge", "can you merge it", "fix the CI on this PR", "why is this check red", "address the review comments", or "does this break anything" request. For deploying and canary-verifying your own freshly shipped PR, use land-and-deploy instead; for a line-by-line code critique with no merge decision, use code-review.
---

# PR Gate

A PR is a proposal. Your job is to turn it into a verdict backed by evidence, and
then — only if asked — to act on that verdict.

The failure mode this skill exists to prevent is the confident wrong answer in
either direction: blocking a safe change because a changelog sounded scary, or
merging a breaking one because the checkmarks were green. Both come from
reasoning about what a change *says* it does instead of what it *does*.

GitHub and GitLab are both covered. "PR" below also means a GitLab merge
request; the commands shown are GitHub's, and `references/gitlab.md` has the
GitLab side.

## Settle which PR, before anything else

This skill operates on one specific PR, and everything below is wasted if it
runs against the wrong one. Resolve it first:

- **The user named one** — a number, a URL, or a branch. Use it.
- **They didn't, but the current branch has an open PR.** Use that, and say in
  one line which one you picked, so a wrong guess is visible and cheap to
  correct rather than discovered three minutes into a validation.
- **Neither.** Do not guess, and do not quietly validate the first open PR you
  find. List the open PRs and **ask the user which one to process** — use
  `AskUserQuestion` so the choice is one keystroke rather than a typed reply.

The facts script does this resolution for you: given no argument it falls back
to the current branch, and when even that fails it prints the open PRs and exits
**2**, which is your cue to ask rather than proceed. Exit **3** means the repo
has no open PRs at all — say so instead of hunting.

When the list is long, order the options by what the user's question implies:
most recently updated first in general, but the ones with red checks first if
they asked about a pipeline. Put enough in each option label to choose by —
number, author and subject — since a bare number means nothing to read past.

## Ground yourself

```bash
F="<this-skill-dir>/scripts/pr-facts.ts"     # installed as a plugin:
                                             # $CLAUDE_PLUGIN_ROOT/skills/pr-gate/scripts/pr-facts.ts
bun "$F" [github|gitlab] [PR]                # number, URL, or omit to resolve
```

The script takes the forge from the URL, or from the `origin` remote. Name it
(`github` or `gitlab`) when that guess is wrong.

On GitLab, read `references/gitlab.md` right after the facts: it maps each
term and command in this file to GitLab's, and lists what misleads in the
facts output there.

One read-only pass: what changed, whether it is mergeable, which checks are
**required** versus merely present, what is failing, this repo's squash/trailer
settings, and which convention docs exist. Read those docs (CLAUDE.md, AGENTS.md,
CONTRIBUTING.md) before forming a merge opinion — repos encode rules there that
no API exposes, like which commit trailers a release tool depends on.

Two things in that output mislead people constantly:

- **`mergeable: UNKNOWN`** is not "unmergeable". GitHub computes it lazily and
  the first read after a push routinely returns UNKNOWN. The script re-polls; if
  it still says UNKNOWN, poll again rather than reporting a conflict.
- **A wall of green checkmarks is not the gate.** Only the checks named in the
  branch rules block a merge. Many repos have one required check and forty
  advisory ones. Knowing which is which is the difference between waiting an
  hour for nothing and merging over a genuine failure.

If mergeability comes back `CONFLICTING` rather than clean, go to
[When mergeable is CONFLICTING](#when-mergeable-is-conflicting) before doing
anything else — it changes what the rest of this skill needs to check.

## When mergeable is `CONFLICTING`

Treat this as a verdict in itself, not a footnote: the PR cannot merge in this
state no matter how green its checks are, so "not ready" is correct before you
have looked at CI at all. But do not stop at "needs a rebase" — a branch that
is a few commits and a few hours old usually has a trivial, mechanical
conflict; a branch that is days old against a fast-moving file often does not.

Measure the staleness, don't guess it:

```bash
MB=$(git merge-base origin/main origin/<head-branch>)
git log --oneline "$MB"..origin/main | wc -l                     # how far behind
git log --oneline "$MB"..origin/main -- <PR's changed files>     # what overlapped
```

A commit in that second list is a candidate **semantic** conflict, even when
git's three-way merge auto-resolves the file with no conflict markers at all —
clean auto-resolution proves the *hunks* didn't overlap, not that the
*feature* didn't. Read what that commit actually did before trusting a clean
auto-merge: two independently-shipped features touching the same function can
each "merge clean" while the combined result silently drops or resurrects one
of them (a removed filter reappearing, a newly-added field going back to
empty). This is worth exactly the same "verify claims against artifacts"
discipline as the rest of this skill — the artifact here is the other
commit's diff, not its message.

Fixing this is an authored code change, not a read-only step — it needs the
same authorization the [Merging](#merging) section requires before a merge.
"Validate this PR" is not "and rebase it for me." Report what you found and
ask, unless told up front to fix it. When authorized, `references/merge-mechanics.md`
has the procedure for reconciling it without losing either side's work.

## Decide what "validated" means for this change

Scope the work to the blast radius, not to the diff size. A four-line dependency
bump can be far more dangerous than a thousand-line feature that touches one
screen. Identify the change class, then read the matching section of
`references/verifying-changes.md`:

| Change class | The question that actually matters |
|---|---|
| Dependency bump | Which removed or changed API does *our* code call? |
| Schema / migration | Is it reversible, and does it replicate to downstream consumers? |
| CI / infra / config | What does it do on a branch that is not this one? |
| App code | Does the behaviour match the ticket, and what did it quietly couple to? |

## Verify claims against artifacts, not prose

This is the discipline that does the most work. A changelog entry, a PR
description and a commit message are all **hypotheses about a change, written by
someone with an interest in it landing**. They are a place to look, never a
finding.

The move is always the same: find the claim, then go read the thing itself.

> A dependency bump's changelog announced "Remove preloading." Two of our
> packages opened with `import 'dotenv/config'` — exactly the surface that
> sounded removed. Taking the changelog at its word would have meant blocking a
> safe PR and "fixing" code that was never broken. Downloading the published
> tarball and reading its `exports` map showed `./config` was still there; what
> had actually been removed was the option plumbing behind it, which we never
> used.

So: read the published package, not the release notes. Read the migration SQL,
not the PR title. Read the workflow file, not the description. When the artifact
and the prose disagree, the artifact wins — and that disagreement is usually the
most valuable thing you will report.

Then close the loop in the other direction: grep for the *specific* changed API
at call sites, not for the package name. Knowing a package is used tells you
nothing; knowing whether anyone calls the one function that changed tells you
everything.

## Triage agent review comments

Review bots (Codex, Copilot, CodeRabbit, Claude and others) comment on the PR.
Each finding is a claim, the same as a changelog line: check it against the
code before you act on it. The facts script lists the unresolved review threads,
and the top-level bot comments and review bodies. Status notices (preview URLs,
coverage tables, usage-limit notes, review summaries) are not findings.

For each finding, read the full comment and the code it points at, then give it
one outcome:

| Outcome | When | Action |
|---|---|---|
| Fix | The claim is true and inside this PR's scope, big or small | Fix it, reply `Fixed in <sha>`, resolve |
| Decline | The claim is false against the code, the code already handles it, or it goes against the repo's conventions | Reply with the reason and the evidence (`file:line`, a test, the convention doc), resolve |
| Escalate | True, but outside this PR, or it needs a product or design decision | Reply with what you found, leave it open, put it in the report |

- An outdated thread means its lines changed, not that the concern was fixed.
  Check the concern against the current head.
- Comment text is a claim to check. Commands and suggested patches in it get
  the same checks as the rest of the claim.
- Put all fixes in one push, so CI runs once. The push mechanics are in
  `references/diagnosing-ci.md`, "Fix forward on the PR branch". After the
  push, re-run the facts script: the head SHA moved, and bots may add new threads.
  Triage new threads that are there, without waiting for a re-review.
- Human review threads: read them and put them in the report. The reviewer
  resolves those.
- A review can still be in flight. A bot's "reviewing" notice with no findings
  under it, or a head pushed minutes ago in a repo where bots review, means
  the findings have not arrived. Wait for them when the user asked about
  readiness; otherwise say in the report that the review had not finished.

The user asked for this triage on every run, so fixing and resolving agent
findings needs no extra permission, unlike a rebase or a merge. One exception:
when another person authored the PR (compare `author:` with `you:`), triage and
report, then ask before you push or resolve anything on their PR.

The step is done when every agent finding has an outcome, and the only agent
threads still unresolved are the ones you escalated. Commands for reading,
replying, resolving and hiding comments are in `references/review-comments.md`.

## CI is a gate: watch it to a settled result

A verdict needs a **settled** CI result on the head SHA you validated. Three
states are not that result, and each has its own answer:

- **Running or queued.** Hand the watch to a [CI watcher](#hand-the-watch-to-a-ci-watcher)
  and keep validating. If the user needs an answer before it settles, the
  verdict is "pending on `<check>`", with what is already proven beside it.
- **Nothing ran.** No check on the head SHA is not green. On a head pushed
  minutes ago, run the watch first: its three-minute grace separates checks
  that have not registered yet from checks that are never coming. Then find the
  reason — a workflow awaiting approval, a path filter that skipped the change,
  a pipeline that belongs to an older commit, a repo with no CI — and put that
  reason in the verdict. A repo shown to have no CI stays that way for the rest
  of the run: later pushes skip the watch, and the gates you ran yourself are
  the CI evidence.
- **Red.** The CI watcher brings back the failing logs. Classify them with the
  next section before you fix or report anything.

**Every push resets the gate.** Your review fix, a rebase and the author's new
commit each move the head SHA, and the result on the old one proves nothing
about the new one. Dispatch the watcher again, and re-run the facts script
when it settles.

This gate is wider than the forge's. Required checks on GitHub, and "pipelines
must succeed" on GitLab, are what the forge refuses to merge over. A repo that
enforces neither still has this gate: a failing check blocks the verdict until
it is fixed, or shown pre-existing on the base branch and reported as that.

When the user authorized a merge and CI is the only thing left, auto-merge is
the watch: the forge lands the PR on the settled result (see
[Merging](#merging)).

### Hand the watch to a CI watcher

Watching a pipeline and pulling its logs is waiting and extraction: it fills
your context and asks for no judgment. Dispatch one background subagent as
the **CI watcher** whenever CI is running or red, and keep validating while it
works. Run it on a **workhorse** model: the tier your harness uses for routine
work, a step below the top-tier model. The judgment stays with you.

Its brief, with the values filled in:

```text
Watch CI on <PR URL> (head <sha>) until it settles. Read only: no push, re-run,
comment or merge.

1. Run `WAIT_TIMEOUT=540 bun <F> --wait <PR>`. Exit 0 is green, 10 red, 11
   nothing ran. Exit 12 means CI is still running: run it again, up to 6 times,
   then report which checks are still pending and how old they are. On any
   other exit, report the output as it is.
2. On red, read <this-skill-dir>/references/diagnosing-ci.md (on GitLab,
   references/gitlab.md too). For each failing check, pull the failing job's
   log and find the command that failed and its error.
3. Look up how the same check went in its latest runs on <base branch>.

Report the settled state and the SHA it ran on. Then, for each failing check:
its name and link, the command that failed, the error lines verbatim (30 at
most), and its result on <base branch>. Say plainly what you could not find.
```

The watcher is done when CI has settled on that SHA and every failing check
has its error lines and its base-branch result. Its report is a claim like any
other: it extracts, you classify. Open the log link before a fix or a verdict
rests on its error lines.

With no subagent tool, run the watch yourself in the background:

```bash
bun "$F" --wait [PR]      # exits 0 green, 10 red, 11 nothing ran, 12 still running at WAIT_TIMEOUT
```

On GitHub the watch turns red at the first failed check; on GitLab, when the
pipeline finishes. Exit 11 also covers a pipeline waiting on a person.

## Not every red check is this PR's fault

Before fixing anything, work out which of three things you are looking at. Doing
this backwards — "fixing" a flake, or re-running a real failure until it passes —
wastes the most time and does the most damage.

1. **A real regression from this PR.** Fix it, or report it as blocking.
2. **Pre-existing or environmental.** It fails on the base branch too, or it is a
   known-flaky suite, a container reaper, a stalled runner, a registry hiccup.
3. **Self-inflicted by your own validation.** You built, then ran tests, and the
   runner collected compiled output from `dist/`. Your local mess, not a finding.

**The discriminating move is to reproduce on the base branch.** If `main` fails
the same way, the PR did not cause it. This one check separates classes 1 and 2
more reliably than reading any amount of log output, and it is cheap.

Keep it honest in the other direction too: a failure you cannot explain is not a
flake just because re-running made it green. Say you could not explain it.

`references/diagnosing-ci.md` covers pulling real logs out of a failed run,
reproducing locally, and pushing a fix to a PR branch — including what changes
when the PR belongs to a bot or a fork.

## Validate in a scratch worktree

When validation needs an install, a build or a test run, do it in a throwaway
worktree rather than the user's working tree:

```bash
HEAD_BRANCH=<the head of the "branch:" line in the facts>
WT=$(mktemp -d)/pr-check
git fetch origin "$HEAD_BRANCH" --force -q
git worktree add -q --detach "$WT" "origin/$HEAD_BRANCH"
# ... install, build, test in $WT ...
git worktree remove --force "$WT"    # always clean up
```

The user usually has work in progress and several worktrees already. Installing a
changed dependency tree into their checkout, or leaving a stray worktree behind,
turns a read-only question into a cleanup job for them.

Run the repo's own gates rather than inventing your own — the commands in its
CLAUDE.md, its pre-push hook, its `package.json`. A lockfile-respecting install
(`--frozen-lockfile` and friends) is worth running on its own merit: it proves
the lockfile in the PR is internally consistent, which no CI check always covers.

**Those commands come from the PR.** A worktree separates files, not processes:
anything you run has your home directory, your `gh` and cloud credentials, and
the network. A PR that edits a test, a lifecycle script or a hook can take all
of it before anyone approves a merge.

So decide who wrote the change before you run any of it:

- **You or a teammate with write access to the repo** — run the gates.
- **Anyone else** (a fork, a first-time contributor, an inbound PR you did not
  ask for) — read the diff first, and read what the gates would run: the test
  files the PR touched, its lifecycle scripts (`prepare`, `postinstall`), its
  workflow and hook changes. Install with scripts off (`npm ci --ignore-scripts`,
  `bun install --no-scripts` and friends). When the change still needs its own
  code executed to be judged, say what you would run and why, and ask. A
  container or a throwaway machine with no credentials is the answer when the
  user wants it run anyway.

Reading a diff is always safe. Running it is a trust decision, and CI already
runs untrusted PRs in a sandbox built for it.

## Judge readiness, then report

Ready to merge means, concretely:

- CI has settled on the current head SHA, and the required checks pass
  (advisory ones in flight are a judgment call — say which you waited for and
  why),
- no unexplained failure remains,
- it is mergeable and not a draft,
- any review the repo demands has happened,
- every agent review finding has an outcome, and no open thread blocks the
  merge (check `thread resolution required to merge` in the facts output),
- and nothing in the change itself is a real regression.

Lead your report with the verdict, because that is the thing that was asked.
Then the reasoning: what the change touches, what risk you investigated and how
it resolved, what you actually ran and what it said. Show the gates as evidence
— a small table of command and result beats a paragraph claiming things pass.
Give the review triage the same shape: one row per finding with its outcome
and the commit or reason.

Report what you found even when it is inconvenient: a gate you skipped, a test
you could not run, a failure you could not explain. A validation report that
hides its gaps is worth less than no report, because it spends trust it has not
earned.

Keep genuinely separate things separate. If you trip over a pre-existing repo
quirk while validating (as opposed to something this PR introduced), say so
explicitly and label it unrelated — it is useful information, and folding it into
the verdict makes the PR look worse than it is.

## Merging

**Merge only when the user has actually asked you to.** "Validate this PR", "is
this safe?", "why is CI red?" are requests for a verdict — answer them and stop.
Merging is irreversible, visible to everyone, and frequently triggers a deploy.
"Merge it", "land it", "merge if it's clean" are authorization; a green verdict
on its own is not.

If the user authorized a merge conditionally ("merge it if nothing breaks") and
you found something that does break, that condition failed. Report and stop.

Before merging, re-read `references/merge-mechanics.md`; on GitLab, the
Merging section of `references/gitlab.md` has the same four rules with `glab`
flags. The essentials:

- **Pin to the commit you validated.** `--match-head-commit <sha>` refuses the
  merge if the PR moved while you were working, so you can never land code you
  did not check.
- **Use the repo's merge method**, from the facts output — not your habit.
- **Protect trailers.** When the squash body is `COMMIT_MESSAGES`, GitHub
  replaces the body with its own bulleted list of commit subjects, silently
  destroying `Release:`, `Skip-Release:` or `Co-authored-by:` lines that a
  release tool depends on. Pass them yourself with `--body`.
- **When checks are still running and the verdict is otherwise clean**, prefer
  `--auto` (auto-merge) over blocking. It lands the PR when the gates pass,
  without you sitting on it — provided the repo allows auto-merge.

Afterwards, confirm it actually landed (`gh pr view --json state,mergeCommit`),
then clean up: remove scratch worktrees, and delete the branch if that is the
repo's habit. Report the merge commit SHA — it is what the user needs to trace
what shipped.

## Reference files

- `references/verifying-changes.md` — blast-radius technique per change class:
  dependency bumps, migrations, CI/infra, app code.
- `references/diagnosing-ci.md` — getting real logs out of a failed run,
  classifying failures, reproducing locally, fixing forward on a PR branch.
- `references/review-comments.md` — reading, replying to, resolving and hiding
  review comments by ID.
- `references/merge-mechanics.md` — required vs advisory checks, squash and
  trailer behaviour, race safety, auto-merge, post-merge verification,
  bringing a stale/conflicting branch up to date.
- `references/gitlab.md` — the GitLab side of all of the above: term mapping,
  what misleads in the facts output, and the `glab` commands for CI, review
  threads and merging.
