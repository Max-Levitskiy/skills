# Shipping a cleanup as PRs

## Contents
- The split
- Building the branches
- Partition check
- PR bodies
- Review bots
- Merging

## The split

| PR | Content | Review |
|---|---|---|
| Mass removal | file deletions, gitignore entries, and the minimum line removals that would otherwise dangle | auto-merge after CI |
| One per area | refactors and edits: config management, IaC, app code, CI, docs plus task runner | review tools and humans |

The mass removal stays **deletions only**: its diff adds no lines except
gitignore entries. When a target in a task file calls a deleted script, the
removal PR drops that target, because a half-merged state must still work. A
**coupled deletion** goes with the edit it depends on: a file whose removal
breaks callers that are still passing arguments to it.

Stack an area PR on the mass removal only when it depends on it. Examples are
docs that describe the post-removal tree, or a CI rename whose old caller is
deleted there. Otherwise branch from main, so each PR merges on its own.

## Building the branches

Take each file's final state from the cleanup branch:

```bash
git worktree add -b <branch> <dir> origin/main           # or the mass-removal branch, if stacked
cd <dir>
git checkout <cleanup-branch> -- <paths owned by this PR>
git rm -q <files this PR deletes>
git add -A -- <paths>
```

For a file that belongs partly to the mass removal and partly to an area PR,
such as a task file losing dead targets and gaining a refactor, build the
mass-removal version with a script that only deletes blocks. Confirm that its
diff against main contains no added lines.

## Partition check

```bash
bash <this-skill-dir>/scripts/partition-check.sh <base> <cleanup-branch> <pr-branch>...
```

It reports files the cleanup changed that no PR covers, files a PR changes that
the cleanup did not, and files where a PR's content differs from the cleanup's.
A file appearing in two branches is expected only for stacked branches.

Then run each branch's own checks in its worktree. Coupling between PRs shows
up here: a workflow linter, for example, fails on a deleted workflow that still
uses the old secret name.

## PR bodies

Use the repo's PR template or `pr` skill if it has one. For each PR, state:
what changes (a diff-shaped tree is the fastest read), evidence before and after
(test counts, plan summaries, dry-run recaps), and merge danger (whether the
change can be undone, and what a merge sets off). Link the other PRs of the
split and the follow-up tickets.

## Review bots

When their findings arrive:

- **Valid**: fix it on the branch, reply with the commit, and resolve the
  thread.
- **Stale** (it assumes something an earlier PR of the split already removed):
  reply with the PR that did it, and resolve.
- **A commit pushed after the bot's review** gets a fresh review request
  (`@codex review` or the bot's equivalent) before merge.

## Merging

1. CI and concurrency fixes first, so later merges cannot cancel each other's
   deploys.
2. Mass removal next, once CI is green. Then rebase the stacked PRs after the
   squash: `git rebase --onto origin/main <old-base> <branch>`, followed by
   `git push --force-with-lease`.
3. Area PRs one at a time when each merge triggers applies. Watch the
   post-merge runs until they settle before the next merge.
4. A PR with no CI coverage on main yet (its workflow arrives in another PR)
   needs a push after that PR merges, so the new check runs.
5. Remove the worktrees and local branches of merged PRs, and close the
   original combined PR with links to its parts.
