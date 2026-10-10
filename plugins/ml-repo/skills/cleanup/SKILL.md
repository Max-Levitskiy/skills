---
name: cleanup
description: Repo cleanup — audit a repository for dead, duplicated, generated, stale or over-engineered code and docs, then remove and simplify it without changing behaviour, verified and split into reviewable PRs. Use when the user wants a repo simplified, "less code doing the same", or its code quality improved safely; asks what in a codebase is dead, unused, leftover or "bullshit"; wants old scaffolding, AI-tool installer dirs, stale specs or docs removed; or wants a cleanup shipped as PRs. Any stack, including infrastructure repos with live state (Terraform, Ansible, Helm, Kubernetes). For scoring a single diff for AI slop use ml-slop:code; for landing one existing PR use ml-ship:pr-gate.
---

# Repo cleanup

The goal is the same behaviour with less and simpler code. A cleanup makes two
kinds of change:

- **Remove**: dead files, symbols, dependencies, targets, workflows and stale
  docs.
- **Simplify**: live code made smaller and plainer, with identical behaviour.
  Examples are dedupes, inlined indirection, one mechanism instead of two, and
  stdlib calls instead of hand-rolled code (`references/simplify.md`).

Every change is **safe**: behaviour, public surface and live state stay
identical, and you can show the evidence. Anything that changes behaviour is a
finding, never a quiet edit. That covers bug fixes, API changes and live-state
changes.

Two failures make a cleanup worse than no cleanup:

- **Deleting or changing something live.** Code that looks unreferenced is still reached by a
  string-built path, a plugin registry, another repo, a cron job, or — in
  infrastructure — by live state that a deleted resource block would destroy.
- **One unreviewable mega-diff.** A 150k-line PR gets rubber-stamped or never
  merged. Dead files and real code changes need different reviews.

Every claim of *dead* in this skill rests on **evidence**: a reference search
that came back empty, a caller graph traced from the real entry points, a tool's
output, or a plan that shows no change. "Looks unused" is a hypothesis, not a
finding.

## Pick the mode

Infer it from the request and say which one in a single line:

- **Audit** — a ranked findings report and nothing edited. The default for
  "what's dead here", "what looks like bullshit", "review this repo".
- **Cleanup** — audit, then edits committed on a branch, verified.
- **Ship** — cleanup, then PRs opened, and merged where the user asked for it.

Each mode is a prefix of the next, so stop at the step the mode ends on.

## 1. Ground yourself

Read the repo's own rules first: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
the README, and any memory you hold about the repo. Then take an inventory:

```bash
bash <this-skill-dir>/scripts/inventory.sh [repo-root]
# installed as a plugin: $CLAUDE_PLUGIN_ROOT/skills/cleanup/scripts/inventory.sh
```

It prints, per top-level directory, file and line counts, the last commit and
how many commits ever touched it. It also flags tracked directories that look
generated, groups of byte-identical files copied across directories, CI
workflows with their triggers, task runners, and infrastructure roots. A
directory written by one installer commit and never edited, or the same file
copied into five tool folders, is the cheapest large win in most repos.

Then learn **what a merge does**. Read the CI workflows: which ones run on a
push to the default branch, what they deploy or apply, and which paths trigger
them. This decides later what "code-only" means. Changing a shared CI file can
trigger every deploy at once.

**Done when** you can name the purpose of every top-level directory and every
action a merge to the default branch sets off.

## 2. Audit in slices

Split the repo into 3–6 **slices** that a reviewer would think about
separately: generated scaffolding and docs, each application area, each
infrastructure root, CI. Dispatch one read-only subagent per slice, all in the
same turn. Use the brief in `references/audit-brief.md` and fill in the slice
paths and the repo facts from step 1.

Look for both kinds of change: what can go (dead, duplicated, generated,
stale) and what can get simpler (over-engineered, copy-pasted, hand-rolled,
contradictory). Each finding carries its evidence and one class:

- **SAFE** — a removal nothing reaches at runtime and that holds no state, or
  a simplification with a covering test and an unchanged public surface.
- **NEEDS-CARE** — it holds state or changes behaviour: infrastructure
  resources, database schema, a published API or package, external consumers,
  bootstrap order.
- **BUG** — dead or masking code that hides a defect, such as a swallowed
  error, a health check that cannot fail, or a test that cannot go red. Report
  these first. They are often worth more than the deletions around them.

`references/stacks.md` lists the entry points and dead-code tools per
ecosystem. Read the sections for the stacks the inventory found.

When each agent returns, run `git status`. Some "read-only" tools write, such
as resolvers that rewrite lockfiles or module files. Revert anything the audit
changed.

**Done when** every slice has reported, and you have reopened the files and
rerun the searches yourself for the three highest-impact claims. Agents
overclaim, and a wrong *dead* that ships is the expensive failure.

In **audit** mode, stop here and report (see [Report](#report)).

## 3. Decisions

Batch the decisions that belong to the owner into one `AskUserQuestion` call,
with the recommended option first. These typically include:

- generated scaffolding that people use interactively, such as slash commands
  or editor settings loaded from installer directories;
- retiring a subsystem that no longer works, rather than repairing it;
- how far into live state this pass goes. Recommend **code-only now**: every
  state-changing item becomes a ticket.

Decide routine choices yourself and mention them in the report.

## 4. Implement

Dispatch parallel editing agents, each owning a **disjoint set of paths**. Name
the paths each one owns, and state which paths belong to the others. Agents edit
files and leave committing to you, so commits stay ordered and signed. Also tell
them not to use stash, reset or checkout on shared work, because they share the
working tree.

Removals first, then simplifications, each a commit of its own kind and area,
with the tests green after every commit.

Rules for every edit:

- **Behaviour stays identical.** In any root that holds live state, the plan
  shows no resource changes; disappearing outputs are the only allowed diff.
  `references/live-state.md` has the playbook.
- **Code that is the only handle on live state stays.** A root, module or
  resource whose state may still hold real objects stays in the code, even when
  nothing applies it any more. Its retirement is a ticket: destroy the
  objects, or remove them from state, and then delete the code.
- **Simplify only covered code.** A test must exercise the code before you
  refactor it. If none does, write a characterization test first, or list the
  simplification as a proposal. `references/simplify.md` has the catalogue and
  its traps.
- **BUG findings are reported, not fixed**, unless the owner asked for fixes.
  A fix then goes in its own commit with a test that fails before it. Refactors
  around a bug keep the buggy behaviour as it is.
- **A deletion takes its callers with it** in the same change: task-runner
  targets, CI steps, imports and doc links. A **coupled deletion**, such as a
  variables file that a caller still passes arguments into, stays with the edit
  that removes those arguments.
- **Comments** only explain a non-obvious why. Remove comments that restate the
  code next to your change.

**Done when** a repo-wide search for every deleted path and symbol finds only
intentional mentions, such as history notes or gitignore entries.

## 5. Verify

Evidence per kind of change:

| Change | Evidence |
|---|---|
| Application code | the test suite, type checker and linter, compared before and after; for a simplification, the test that covers it |
| Infrastructure as code | plan of the default branch vs plan of this branch, real backend, read-only |
| Config management | dry run against the live inventory, plus the read-only checks below |
| Task runner, CI | the runner parses and dry-runs; workflow linter |

Dry runs have **blind spots**. Ansible `--check` skips `command` and `shell`
tasks entirely. `terraform plan -refresh=false` misses drift. Many deploy tools
skip hooks. List what the dry run did not exercise. Cover each item with a
targeted read-only real run: the exact commands the new code would execute, or
the repo's own verify or health gate. Report what stays unexercised.

Drift that already exists is not yours. Anything that shows up in both the
default branch's plan and yours predates you. But if CI applies on merge, your
merge applies that drift. Know what it does before you merge.

## 6. Ship

`references/shipping.md` has the mechanics. In short:

1. **Mass removal PR**: deletions only, plus the minimum line removals that
   would otherwise dangle, such as task targets calling deleted scripts.
   Auto-merge it once CI is green.
2. **Review PRs**, one per area, so each has one reviewer mental model. Stack a
   PR on the mass removal only when it depends on it.
3. **Partition check**: the PRs together cover the cleanup exactly once, with
   matching content. Run `scripts/partition-check.sh`.
4. **Triage review bots**: fix the valid findings, then reply to and resolve the
   rest, including findings that are stale against current main.
5. **Merge**, when asked. Merge CI fixes first. When merges trigger applies or
   deploys, merge one at a time and watch the runs after each merge until they
   settle. After a squash merge, rebase the stacked branches onto main.

## 7. Follow-ups

File every NEEDS-CARE item you did not do as a ticket in the repo's tracker
(the one `AGENTS.md` names). Group them under one parent if the tracker has
parents. Each ticket says what to do, how to verify it, and the trap, such as
"a plain delete destroys X; use a `removed` block".

## Report

Lead with the result: lines and files removed, what got simpler, what is
merged, what is open.
Then:

- **BUG** findings, each with the failure it causes;
- what each PR changes, with its link and the evidence it was verified with;
- what stays unexercised, and why;
- the tickets filed, with links;
- surprises found along the way, such as pre-existing CI failures, perpetual
  drift, or permission holes.

In audit mode, the report is the ranked findings list: path, evidence, class,
proposed action (delete, or the simplification and its covering test), lines
saved and risk, with SAFE items grouped so they can be approved in one go.

## Pitfalls

These are the gotchas no config file admits to:

- **Unreferenced is not dead.** Search string-built and dynamic forms too:
  `import()` with variables, reflection, entry-point registries, glob-loaded
  directories, other repos in the org, and scheduled jobs.
- **Duplicates can be load-bearing.** A manifest that duplicates what IaC
  creates may be the only thing that exists in a fresh-bootstrap order. Check
  the bootstrap path before deleting.
- **Removing a module's provider or dependency requirement** can leave the root
  lockfile without an upper bound. Add the constraint to the root.
- **Squash merges break stacks.** The stacked branch still carries the original
  commits. Run `git rebase --onto origin/main <old-base> <branch>`.
- **Shared CI concurrency groups** let a queued PR run replace a pending deploy
  on main, which then shows as cancelled with no jobs. Rerun it, and fix the
  groups.
- **Shell word splitting**: zsh does not split `$VAR` into words. Use arrays
  for pathspecs.
