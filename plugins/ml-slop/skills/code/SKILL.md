---
name: code
description: >
  Analyze code for AI-generation slop: duplication, dead code, redundant
  comments, verbosity inflation, over-abstraction, error masking, convention
  violations, hallucinated dependencies, and performance waste. Score mode
  only: dispatches 10 analysis methods as parallel subagents and aggregates a
  composite 0-100 density score with per-method findings. Works on a git
  diff/branch/PR with repo context, or on standalone files. Use when asked to
  "check code density", "find AI slop in this code", "is this code bloated",
  "review this AI-generated code", "code slop check", or before merging
  agent-authored changes.
---

# Code Density Analyzer (score mode)

Detect AI-code slop — repeated logic, filler constructs, and reviewer-repellent
patterns — and score how dense the code is. This skill only reports; it never
edits code.

## Step 0: Determine target and mode

**Diff mode** (preferred) — use when inside a git repository and any of:
- the user names a branch/PR/commit range → target = that range's diff
- uncommitted changes exist → target = `git diff HEAD` (staged + unstaged)

**Standalone mode** — use when the user names specific files/snippets, or no git
repo is present. If ambiguous, ask: "Analyze the current diff, or specific files?"

## Step 1: Assemble the analysis input

Both modes: number all lines (`cat -n` style) and prefix each file with its path.

Diff mode:
1. Collect the diff and the full post-change content of each changed file
   (subagents need surrounding context, not just hunks).
2. Build repo-context excerpts, bounded to ~300 lines total: for each changed
   file, include the signatures + docstrings of util/helper modules it imports
   or that live in obviously shared locations (`utils/`, `lib/`, `common/`,
   `helpers/`), plus one sibling file as a convention sample. Use
   `grep -rn "def \|function \|class " <shared dirs> | head -80` to build a
   signature index rather than pasting whole files.
3. If the diff exceeds ~3000 changed lines, split by top-level directory and run
   the whole analysis per split, then report per-split scores.

Standalone mode: the named files' contents. No repo context is provided, and
methods that require it must return `applicable: false`.

## Step 2: Dispatch analysis subagents in parallel

Launch ALL methods in a single message so they run concurrently. Each subagent
prompt = the method file below + `agents/_conventions.md` + the assembled input
+ this line: "Return ONLY the JSON output described in your instructions. No
commentary."

| # | Agent file | Method id | Weight |
|---|---|---|---|
| 1 | `agents/code-duplication.md` | `code-duplication` | 0.20 |
| 2 | `agents/verbosity-inflation.md` | `verbosity-inflation` | 0.15 |
| 3 | `agents/dead-code-filler.md` | `dead-code-filler` | 0.10 |
| 4 | `agents/comment-redundancy.md` | `comment-redundancy` | 0.10 |
| 5 | `agents/over-abstraction.md` | `over-abstraction` | 0.10 |
| 6 | `agents/error-masking.md` | `error-masking` | 0.10 |
| 7 | `agents/convention-adherence.md` | `convention-adherence` | 0.10 |
| 8 | `agents/boilerplate-template.md` | `boilerplate-template` | 0.05 |
| 9 | `agents/hallucinated-deps.md` | `hallucinated-deps` | 0.05 |
| 10 | `agents/perf-waste.md` | `perf-waste` | 0.05 |

Weights are provisional pending Round 0 recalibration (see workspace/).

## Step 3: Aggregate (main agent)

1. Parse each envelope. A method whose JSON fails to parse after one retry, or
   which returned `applicable: false`, is EXCLUDED.
2. Renormalize: `density_score = 100 × Σ(weight_i × sub_score_i) / Σ(weight_i)`
   over included methods only. Round to an integer.
3. Labels: 80–100 Dense · 60–79 Acceptable · 40–59 Bloated · 0–39 Sloppy.

## Step 4: Report

```
## Code Density Report

**Target:** <diff range or file list>  |  **Mode:** diff | standalone
**Density score:** <N>/100 (<label>)
**Methods:** <k>/10 included (<excluded list with reason: n/a | failed>)

### Findings by severity
For each high finding, then medium, then low:
- `<file>:<lines>` — **<pattern>** (<method>): <evidence> → <suggestion>

### Per-method breakdown
| Method | Sub-score | Findings |    (one row per included method)

### Top actions
Numbered list of the 3–7 highest-impact removals/merges, referencing findings.
```

Score mode only: present the report and stop. Do not offer to fix the code
within this skill.

## Key principle

**Repeated logic + no new behavior = duplication. Constructs that do no work =
filler. Every line must earn its place** — the goal is never shorter code for
its own sake, but code where nothing is left to delete without losing behavior
or clarity.
