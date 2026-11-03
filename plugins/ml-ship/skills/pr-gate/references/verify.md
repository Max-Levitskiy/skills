# verify

Scope the work by blast radius, not diff size. On a head you already verified, check only what moved.

| Change | The question | Do |
|---|---|---|
| Dependency bump | Which changed API does *our* code call? | Read the published package, not the release notes: its `exports` map is the contract, and the type declarations diff is the API delta. Grep call sites for the specific changed API, not the package name. Prove what you conclude: copy the call pattern into a scratch project with the old and new versions (scripts off), then type-check and run it. This is the published package and your own few lines, not the PR's code, so it needs no trust decision. Look for behaviour changes that are not API: a flipped default, stdout moved to stderr |
| Schema / migration | Reversible? Does it reach downstream? | Read the generated SQL (`squawk` lints Postgres). Check locks on hot tables and irreversible drops. Rebases renumber migrations: check order against the base. Replica identity and publications decide whether a sync layer sees the change. Applying it to a throwaway database settles most of this |
| CI / infra / config | What does it do on a branch that is not this one? | Read the whole workflow: `on:`, `if:`, permissions, secrets. Look for edits that invalidate caches globally, and pins that route around their source of truth. Post-merge jobs stay unvalidated until landed: say so |
| App code | Does it match the ticket, and what did it couple to? | Compare against the linked issue, if there is one, not the diff. Look at shared helpers gaining callers and exported shapes changing. New tests that pass on the base branch cover nothing new |
| Lockfile (with any of these) | Consistent, and in scope? | A frozen install must succeed and leave `git status` empty. Unrelated transitive jumps are out-of-scope changes: report them |

## Running the PR's code

Gates run in a throwaway worktree, never the person's checkout. The repo's gates are the commands in its convention docs, its pre-push hook, its package scripts and what its CI runs for these files:

```bash
WT=$(mktemp -d)/pr-check
git fetch origin pull/<N>/head -q          # GitLab: merge-requests/<N>/head. Works for forks and deleted branches
git worktree add -q --detach "$WT" <head sha>
# install, build, test in $WT
git worktree remove --force "$WT"
```

A worktree separates files, not processes: what you run has your credentials and network.

- **You or a teammate with write access wrote it**, or a bot bumped a dependency: run the gates. With a bump, install with scripts off.
- **Anyone else** (a fork, a first-time contributor): read the diff, the tests it touches, its lifecycle scripts and hooks first. Install with scripts off. If it must execute to be judged, say what you would run and ask.

A local failure after build-then-test may be your own mess, such as a runner collecting `dist/`. Clean and re-run before reporting it.

## Done when

- **Each changed package has its trace:** the command CI really ran on it, followed from the workflow through the root script and its filters to the package's own script. Name what no check ran, such as a type-check or tests. A PR comment saying what CI covers is a claim, whoever posted it, and an automated triage can post under a person's account.
- **A dependency bump has a run behind it:** the call sites' pattern went through the type-checker against the new version, in your repo gates or the scratch project. Reading `.d.ts` files gives you a hypothesis. If you cannot run it, the verdict says the types are unproven.
