# Diagnosing and fixing a red pipeline

The check name is a label, not a diagnosis. Everything here starts from getting
the actual failure out of the run.

- [Get the real failure](#get-the-real-failure)
- [Classify before fixing](#classify-before-fixing)
- [Reproduce locally](#reproduce-locally)
- [Fix forward on the PR branch](#fix-forward-on-the-pr-branch)
- [Bot and fork PRs](#bot-and-fork-prs)
- [Waiting without blocking](#waiting-without-blocking)

---

## Get the real failure

```bash
gh pr checks <PR>                                   # which checks, and their URLs
gh run view <run-id> --log-failed                   # only the failed steps
gh run view <run-id> --job <job-id> --log           # one job in full
gh run view <run-id> --json jobs \
  --jq '.jobs[] | select(.conclusion=="failure") | {name, steps: [.steps[] | select(.conclusion=="failure") | .name]}'
```

`--log-failed` is the one to reach for first: it skips the setup noise and prints
the steps that actually broke.

Read past the last line. A suite that prints `3 failed` at the bottom may have
died from a single import error at the top, and the thing that broke is often
several screens above the summary.

**A job can fail with zero test failures.** A worker shutdown race, a runner
losing its container, a step that cleans up after itself badly — the suite passes
and the job still goes red. If the log shows no actual failing assertion, treat
the job result as suspect and look at what happened after the tests finished.

---

## Classify before fixing

Three classes, and getting this wrong is the main way time gets wasted:

**1. A real regression from this PR.** Fix it or report it as blocking.

**2. Pre-existing or environmental.** The decisive test is cheap:

```bash
gh run list --branch <base> --workflow "<same workflow>" --limit 5 \
  --json conclusion,createdAt,headSha
```

If the same job is failing on the base branch, this PR did not cause it. Say so,
and keep it out of the verdict on the PR itself.

Common environmental shapes worth recognising: container-reaper timeouts
misreported as database startup failures, self-hosted runners that sit queued
forever, registry and cache fetch timeouts at builder boot, and jobs gated on
approval that publish no check runs at all while they wait.

**3. Self-inflicted by your own validation.** Building and then testing in the
same tree can make a runner collect compiled output alongside sources, producing
failures with paths that look wrong because they *are* wrong. Before reporting
anything, ask whether you caused it. Clean the build output and re-run.

**Re-running is a legitimate response to a known-flaky job, not a diagnosis.**

```bash
gh run rerun <run-id> --failed
```

If you cannot explain why it failed, say that, even if the re-run went green. A
failure explained as a flake without evidence is how a real intermittent bug gets
buried.

---

## Reproduce locally

Much faster than pushing commits at CI and watching. Run the exact command the
workflow runs — read it out of the workflow file rather than guessing:

```bash
gh run view <run-id> --log-failed | grep -A3 "##\[group\]Run "
```

Match the environment where it matters: the same Node/Bun/Python version (repos
usually pin this in one place — respect that single source), the same env vars,
the same working directory. A reproduction that needs a different command than CI
used is not yet a reproduction.

---

## Fix forward on the PR branch

Prefer fixing the cause on current versions over reverting a bump: a revert hides
the break, strands neighbouring packages, and grows code against an old API.

The branch lives in the PR's head repository, which is the contributor's fork on
a cross-repo PR. Push there, not to `origin`, or the commit lands in the base
repo and the PR never moves:

```bash
HEAD_REPO=$(gh pr view <PR> --json headRepositoryOwner,headRepository \
  --jq '"\(.headRepositoryOwner.login)/\(.headRepository.name)"')
HEAD_URL=$(gh repo view "$HEAD_REPO" --json sshUrl --jq .sshUrl)

git fetch "$HEAD_URL" <head-branch> -q
git worktree add -q /tmp/prfix FETCH_HEAD        # or checkout, if you own the branch
# ... make the fix, run the repo's gates ...
git -C /tmp/prfix commit -m "<repo's commit convention>"
git -C /tmp/prfix push "$HEAD_URL" HEAD:<head-branch>
```

For a PR from a branch in the same repo, `$HEAD_REPO` is that repo and the same
commands work unchanged.

Before pushing to someone else's PR branch, make sure that is wanted. Pushing to
a colleague's branch mid-review is surprising; ask unless the user has told you
to fix it.

Respect the repo's commit conventions — many enforce a grammar via a `commit-msg`
hook and a matching PR-title check, and a commit that does not parse can silently
exclude the work from a release.

After pushing, the PR head moves. Any validation you did against the old SHA is
now stale: re-check, and never carry a `--match-head-commit` value across a push.
When the user's own checkout is on the PR branch, tell them it is now behind
the remote.

---

## Bot and fork PRs

**Renovate / Dependabot branches are managed.** The bot may rebase or force-push
over your commits. If the fix belongs in the dependency update itself, prefer
changing the config that governs the bot, or land your fix as a separate PR to
the base branch and let the bot rebase onto it. A commit pushed straight onto a
bot branch can simply vanish.

**Fork PRs** live in the author's repository. Push to that fork's URL, as above,
and only when the author enabled maintainer edits:

```bash
gh pr view <PR> --json maintainerCanModify,headRepositoryOwner
```

Fork PRs also run with restricted secrets, so a job failing on a missing secret
may be working exactly as designed. Do not "fix" that by loosening the workflow's
permissions — that is a supply-chain hazard, not a CI bug.

---

## Waiting without blocking

To wait for checks, use the facts script's watch rather than hand-rolling a
poll loop:

```bash
bun "<this-skill-dir>/scripts/pr-facts.ts" --wait <PR>    # every check; exits 0 green, 10 red, 11 nothing ran, 12 still running
gh pr checks <PR> --watch --required                      # only what actually gates merge
```

Run it in the background so you can keep working while it settles, or hand it
to the CI watcher subagent described in the main skill file. Exit 12 means
`WAIT_TIMEOUT` seconds passed (3600 by default) with CI still running: run it
again.

Exit 11 after a few minutes means no check was ever reported on the head
commit. That is the "nothing ran" state, not a pass: look for a run awaiting
approval (`gh run list --branch <head-branch>`) or a path filter that skipped
the change. `gh pr checks --required` exits at once with `no required checks
reported` on a repo that has none; watch them all there. When the
verdict is otherwise clean and only the waiting remains, auto-merge is usually
the better answer than watching at all — see `merge-mechanics.md`.

Distinguish **queued** from **stalled**: a job's age tells you which. Minutes old
is in flight; hours old with no runner assigned is a stuck runner pool, and
waiting will not fix it.
