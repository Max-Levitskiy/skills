# Verifying changes by class

Blast radius, not diff size, decides how much work a PR deserves. Find the class,
then do the work that class actually calls for.

- [Dependency bumps](#dependency-bumps)
- [Schema and migrations](#schema-and-migrations)
- [CI, infra and config](#ci-infra-and-config)
- [Application code](#application-code)
- [Lockfiles](#lockfiles-any-class)

---

## Dependency bumps

Usually the smallest diff and the widest blast radius, which is exactly why they
get waved through. A bot opened it, the diff is four lines, everything is green —
and the breaking change is in a code path CI never exercises.

**1. Get the real list of what changed.** The changelog is a starting point, not
evidence. Majors especially: maintainers describe removals in terms of their own
architecture, not yours, so an entry like "removed preloading" can name something
you use, something you don't, or both.

**2. Read the published artifact.** This is the step that pays for itself.

```bash
# npm: what does the version actually ship and export?
curl -sL https://registry.npmjs.org/<pkg>/-/<pkg>-<version>.tgz -o /tmp/p.tgz
tar tzf /tmp/p.tgz                            # file list — what's gone?
tar xzf /tmp/p.tgz -C /tmp && python3 -c "
import json; d=json.load(open('/tmp/package/package.json'))
print(json.dumps({k:d.get(k) for k in ('version','main','types','bin','exports','engines')},indent=2))"
```

The `exports` map is the contract. If a subpath you import is still listed, it
still resolves, whatever the release notes implied. Diff the type declarations
between old and new to see the real API delta:

```bash
diff -u /tmp/old/package/lib/main.d.ts /tmp/new/package/dist/index.d.ts
```

For other ecosystems the same instinct applies: `pip download --no-deps`,
`go mod download` + read the module, `gem fetch`. Read the thing that will be
installed.

**3. Grep for the specific changed API at call sites, not the package name.**

```bash
grep -rn "from ['\"]<pkg>\|require(['\"]<pkg>\|import ['\"]<pkg>" . \
  --exclude-dir=node_modules --exclude-dir=.git
grep -rn "<removedFunction>\|<REMOVED_ENV_VAR>\|<removed/subpath>" . \
  --exclude-dir=node_modules --exclude-dir=.git
```

Knowing a package is used tells you nothing. Knowing whether anyone calls the one
function that changed tells you everything. Zero hits for every removed surface
is a genuine all-clear, and it is fast to establish.

**4. Probe the semantics your code actually depends on.** If a call site branches
on an error rather than catching a throw, confirm the new version still returns
that error instead of throwing. Write six lines and run them against the new
version — it beats reasoning about it.

**5. Check for behavioural deltas that are not API changes.** Output moving
stdout→stderr, a default flipping, a log line's format changing, a new binary
appearing in `.bin` that shadows another. Then ask who consumes that: a script
parsing output, a healthcheck, a log matcher. Usually nobody — but say so
because you checked, not because it seemed unlikely.

**6. Note version fragmentation.** Bots often update some manifests and not
others, leaving several majors resolved in one tree. Harmless when the copies are
isolated, worth a line in the report either way, since the next bump inherits it.

---

## Schema and migrations

The class where "it passed CI" is least reassuring, because the damage shows up
against production-shaped data.

- **Read the generated SQL**, never just the ORM diff. Linting it is cheap and
  catches the classic hazards: `squawk` for Postgres.
- **Locking.** Does it rewrite a large table, add a non-concurrent index, or take
  an `ACCESS EXCLUSIVE` lock on something hot?
- **Reversibility.** A dropped column is not recoverable by rerunning migrations.
- **Ordering.** Rebases renumber migrations. If the tool dedupes on timestamp
  rather than content, a renumbered file re-runs and can abort the whole pending
  batch. Confirm ordering against the base branch, not just within the PR.
- **Downstream replication.** Generated/computed columns, replica identity and
  publication membership decide whether a sync layer or read replica ever sees
  the change. A column can be perfectly correct in Postgres and invisible
  downstream.
- **Run it.** A throwaway database is minutes of work and settles the question:

```bash
docker run -d --rm -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16-alpine
# apply migrations against it, then inspect the resulting schema
```

---

## CI, infra and config

The distinguishing question: **what does this do on a branch that is not this
one?** A workflow change is validated by the run it triggers on itself, which is
the one case that proves least — the dangerous behaviour is usually on `main`,
on a tag, on a schedule, or in the deploy job that only fires post-merge.

- Read the whole workflow file, not the diff hunk. Look at `on:` triggers,
  `if:` conditions, permissions and secrets.
- Watch for changes that alter caching or hashing inputs globally — one edit to a
  root config or a global env can invalidate every cached task in a monorepo.
- Pinned versions: check whether the pin has a single source of truth and whether
  this change routes around it (an indirection through an env var can make a
  version invisible to the bot that is supposed to keep it fresh).
- For anything that runs post-merge only, say plainly in your report that it is
  unvalidated until it lands. That is a real limit, not a hedge.

---

## Application code

Here the pipeline carries more weight, so your value is in what it cannot see.

- **Match behaviour against the ticket**, not against the diff. The PR body says
  what the author meant; the linked issue says what was asked for.
- **Look for quiet coupling**: a shared helper gaining a caller with different
  assumptions, a type widening, an exported surface changing shape.
- **Check the tests test the change.** New tests that pass on the base branch
  unchanged are not covering anything new — that check takes one `git stash` and
  is worth the time.
- **Run the repo's own gates** (its CLAUDE.md commands, its pre-push hook).

---

## Lockfiles (any class)

A lockfile is worth a specific look because it is the one file nobody reads.

- Install with the frozen/locked flag and confirm it succeeds — that alone proves
  the lockfile is consistent with the manifests.
- Confirm no drift afterwards: `git status --porcelain` should be empty. A
  lockfile that changes when you install it is a lockfile CI is not enforcing.
- Skim for changes that have nothing to do with the stated purpose — an unrelated
  transitive jump, or version fields moving. Sometimes it is a bot regenerating
  and correcting earlier drift (worth reporting as a bonus); sometimes it is
  scope nobody asked for.
