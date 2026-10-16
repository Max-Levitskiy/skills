---
name: orchestrate
description: >-
  Orchestrate subagents over a parent task as small, tracked, parallel work packages,
  with an async question protocol so waiting on human decisions never blocks progress.
  Use whenever the user asks to "orchestrate subagents/agents" on a task or project,
  wants work done "mostly autonomously" while they step away, says "split it into
  subtasks and work in parallel", "collect questions for me", "ask me when you need a
  decision but don't block", or hands over any multi-part deliverable (documents, prep
  materials, analyses, migrations) that benefits from parallel agents plus occasional
  human input. Also use when RESUMING such an orchestration: an agent-completion
  notification arrives, the user answers an open question, or a pending wave needs
  launching. Trigger even if the user never says "orchestrate" — "work through this
  task with agents while I'm out" or "keep going async, I'll answer questions later"
  is this skill.
---

# Orchestrate — parallel work packages with async human decisions

Turn one parent task into small work packages executed by parallel subagents, while
every decision only the human can make becomes a plain-language question document
with a stated default — so the human answers on their own schedule and nothing ever
stalls waiting for them.

Three roles: **the orchestrator** (you — decompose, launch, verify, keep shared state),
**worker agents** (each produces exactly one output file), **the human** (answers
question docs asynchronously, does the steps only they can do).

## The five invariants

Everything else adapts to the project; these do not.

1. **One package = one agent = one output file.** A worker creates or edits exactly one
   file and touches nothing else. This is what makes N agents safe in parallel — no merge
   conflicts, no racing writes on shared files (a real hazard on Drive/Dropbox-synced or
   concurrently-open repos) — and it makes verification trivial: read the file, check the
   done-when.
2. **Packages are small enough to finish without a human.** Size each package so no
   human decision is needed *mid-package*. If a decision might arise, it becomes a
   question doc and the package proceeds on a default. A package that must pause for an
   answer was cut wrong — split it.
3. **Never block.** Workers and orchestrator alike: when a human-only decision or an
   underivable fact appears, write a question doc (see below), state a default, continue
   on the default. The human course-corrects later; momentum is worth more than
   pre-approval on reversible drafts.
4. **Only the orchestrator edits shared state.** Task statuses, index files, the
   question index, cross-links between docs — orchestrator only. Workers create their
   own files (output + question docs) and never touch indexes. Two agents appending to
   the same index is the classic race; this rule removes it.
5. **Verify on disk before closing.** Never mark a package done from an agent's
   self-report alone. Read the output file, check it against the package's done-when
   items. Agents occasionally report success for files that are wrong, partial, or (on
   synced folders) clobbered.

## Configuration

**Optional.** With no config at all the skill discovers the project's tracker in Phase 1 and
runs on defaults; config only caches those decisions so you stop re-making them.

Run this first, before decomposing anything:

```bash
AC=$(command -v agent-config || ls -d "$HOME"/.claude/plugins/cache/*/ml-agent-config/*/bin/agent-config \
     "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/ml-agent-config/*/bin/agent-config 2>/dev/null | tail -1)
"$AC" start orchestrate
```

Prints JSON. `ready: true` → proceed. `ready: false` → read the file at `guide` and follow it to work the `actions` list, then re-run. An empty `$AC` or `command not found` means agent-config isn't installed; tell the user and offer to install it from https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config.

Use the `config` it prints. A set `tracker.kind` replaces the tracker discovery in Phase 1, and
the questions path, model tiers and `defaults` apply as given. An empty `tracker.kind` is the
unconfigured state, not an error: discover the tracker in Phase 1, then offer to save what you
found by following `actions/onboard.md` next to this file. A config still at the old
`.agents/skill-config/orchestrate/` path is copied over by the `agent-config:adopt` action before
anything is asked.

`tracker.kind` is one of `file`, `tasknotes`, `github`, `jira`, `linear`. The first two are
local and need no credential; GitHub uses the `gh` CLI's login unless a token is configured; Jira
and Linear need one. Every key is described in `agent-config.json` and shown with realistic values
in `config.example.json`, both next to this file. The bundled CLI shows and checks what is set:

```bash
O="<this-skill-dir>/scripts/orchestrate-config.ts"
bun "$O" show     # layers, effective settings and the layer each came from
bun "$O" verify   # resolves the credential, makes one real call to the tracker
```

**Configured means `verify` printed OK**, not that a file was written.

## Phase 1 — Setup

**Read the project's own rules first.** CLAUDE.md / AGENTS.md, any glossary or
terminology doc the project marks as canonical, style conventions, past feedback.
Every worker prompt will carry a "read these first" list built from what you find here.
Orchestrating without this produces fluent, wrong output at scale.

**Settle the tracker; never import your own.** If `start` printed a non-empty `tracker.kind`, that
is the answer — use it. Otherwise look for what the project already uses: a tasks folder
with frontmatter task files (e.g. Obsidian TaskNotes — needs `tags: [task]` and the
project's field conventions), a `task-index.md` / `TODO.md`, GitHub issues (`gh`).
Mirror its exact conventions — naming, frontmatter fields, status vocabulary, link
style. If nothing exists, create a minimal `tasks.md` (table: package / status / due /
output file) next to the work and say so.

**Create the questions folder** at `questions.path` if config set one, otherwise near the
work (e.g. `<workspace>/questions/`), with a README holding the template and two index
tables (open / answered). Full template, writing rules, and index skeleton:
**read `references/question-protocol.md`** before creating it.

**Decompose the parent task.** Each package gets:
- a one-line mission and exactly one output file (new file, or one existing file edited in place);
- an explicit inputs list (files the worker must read);
- 2–4 *checkable* done-when items;
- a due date if the parent has hard dates;
- its dependency edges (which packages must land first).

Create a tracker entry per package, link them from the parent task, and note in the
parent that the split happened and where questions collect. Good package boundaries
follow the outputs the human will actually use (a briefing doc, a worksheet, a drafted
deck), not internal process steps. Stay within `defaults.maxPackages` when config sets
it — if the work genuinely needs more, say so rather than silently exceeding it.

## Phase 2 — Launch

**Waves by dependency.** Everything with no unmet dependency launches in wave 1 — all
in a single message so they run concurrently, up to `defaults.maxParallelAgents`. Later
waves launch as their inputs land. Don't hold a ready package hostage to an unrelated one.

**Tier models by judgment required.** Judgment-heavy drafting (client-facing prose,
analysis, anything where taste matters) → `models.judgment`. Mechanical work
(decomposing an existing table, reformatting, inventory-building) → `models.mechanical`.
With no config, pick per package on the same criterion. Say which you chose and why when
reporting.

**Build each worker prompt from the scaffold** in `references/agent-prompt.md` — read
it when writing the first prompt. The non-negotiable blocks: the context paragraph
(a worker knows nothing about the engagement), the single-output-file assignment, the
ordered read-first list, content requirements, the question protocol (verbatim block
from the reference), the shared-state prohibition (never edit indexes, including the
questions README), on-disk verification after the final write, and a structured final
report (output path / key decisions / question files created / assumptions).

## Phase 3 — Process completions

On each completion notification (they can arrive as bare "idle" signals with no
report, and **duplicates are normal — processing must be idempotent**; if the task is
already closed, say so and stop):

**A completion signal means a turn ended, not that the work is done.** An orchestrating
agent idles while its own sub-workers still run, then resumes when they finish — so a
package (or a whole orchestration) can signal several times before it is actually
complete. Before closing anything, check *quiescence* on disk: the declared output
exists in final form and the tracker state is terminal, not "in progress". Judging a
mid-flight snapshot produces confidently wrong conclusions.

1. **Verify**: read the output file on disk; check every done-when item.
2. **Collect questions**: list the questions folder; read any new files; register each
   in the README index (orchestrator-only edit) with its one-line question and default.
3. **Close**: mark the tracker entry done (check the boxes, add a dated completion note
   naming the output and any questions raised), update the index/mirror.
4. **Launch** any wave whose dependencies just cleared.
5. **Report to the human**, leading with the outcome: what landed and what it contains,
   new questions (one line + default each), scoreboard (X of N done, what's running),
   and which questions are worth answering soon versus safely deferrable.

If verification fails, message the same agent with the specific gap (it retains
context) rather than respawning cold.

## Phase 4 — Answers and wrap-up

**When the human answers a question** (in the file or in chat): if the answer matches
the default, flip the file's status to `answered`, move its index row to the answered
table, done. If it overrides the default, apply the delta — question docs are written
to name what the default touched, so the edit is targeted — then update status and
index, and note the change where the affected doc's conventions require.

**Wrap up** when all packages are closed: final report (deliverables, open questions
with defaults, what remains human-only — meetings, approvals, rehearsals), and leave a
resume trail: the parent task and any persistent memory should record the split, the
questions-folder location and its open count, and what event unblocks each remaining
step, so a fresh session can pick up mid-flight.

## Anti-patterns

- **Question inflation.** Raising questions to look diligent. If you can infer the
  answer confidently and annotate the reasoning, infer — the annotation *is* the
  question. Reserve question docs for genuine forks where the human's choice changes
  the work. (Expect roughly one question per package, often zero.)
- **Jargon in question docs.** The human may batch-answer days later, on a phone,
  without context. A question doc a stranger can't follow has failed. Plain words,
  short sentences, every project term explained at first use.
- **Two workers, one file.** If two packages "need" the same file, either merge them
  into one package or re-cut the boundary. No exceptions — this includes indexes.
- **Closing on self-report.** See invariant 5.
- **Restructuring paths under running workers.** Never move, rename, or reorganize
  directories that live workers hold absolute paths into — their later writes land in
  recreated old paths or vanish. Reorganize only at quiescence.
- **Blocking.** Ending a turn with "waiting for your answer before continuing" while
  runnable packages exist. The only things that wait are the things that genuinely
  depend on the answer.
- **Invented facts.** Workers must trace every figure and claim to a source or mark it
  TBD; instruct this explicitly and spot-check during verification.
- **Onboarding as a gate.** Missing config is not a reason to stall an orchestration.
  Ask the four questions, write the layer, move on — or, if the user is already away,
  proceed on a discovered `file` tracker and raise the choice as a question doc.
