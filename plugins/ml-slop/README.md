# ml-slop

Find and score AI-generation slop — in prose and in code — and keep it out of the
comments you write. The two analyzers run their methods as parallel subagents and
aggregate a weighted 0–100 density score.

```bash
/plugin install ml-slop@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-slop:text` | Score or fix repeated meaning, filler, and low density in any text |
| `/ml-slop:code` | Score a diff or files for duplication, dead code, over-abstraction, and other code slop |
| `/ml-slop:comments` | The rule for writing comments: only a non-obvious why, constraint, invariant, or workaround |

## `/ml-slop:text`

Detect **repeated meaning — not just repeated words** — in any text, then either
report it or fix it. AI-generated prose often restates the same idea in different
phrasing; this skill finds those patterns and measures information density.

### Use

The `text` skill triggers on phrases like *"check density"*, *"remove AI
slop"*, *"deduplicate this text"*, *"tighten this doc"*, or *"is this repetitive?"* —
or invoke it directly:

```
/ml-slop:text
```

**Two modes:**

- **Score** (default) — read-only audit. Dispatches 7 core analysis methods (plus
  genre-targeted ones) as parallel subagents, then aggregates a composite density
  score (0–100) with a per-method breakdown and a repeated-claim report.
- **Fix** — rewrites in two ordered passes (remove, then tighten) to strip
  redundancy while preserving every unique fact, number, and example.

Say *"check density of X"* for score mode, or *"tighten X"* / *"remove repetition
in X"* for fix mode.

### How it scores

```
density_score =
    0.35 × unique_claim_ratio
  + 0.25 × compression_ratio
  + 0.20 × average_specificity
  + 0.10 × (1 - redundancy)      # max(semantic, thematic)
  + 0.10 × (1 - filler_ratio)
```

Scaled to 0–100: **80+** dense · **60–79** acceptable · **40–59** bloated ·
**<40** very redundant.

## `/ml-slop:code`

Detect **AI-generation slop in code** — repeated logic, dead code, filler
comments, over-abstraction, and other patterns human reviewers routinely fix —
then measure how dense the code is. The code counterpart of
`/ml-slop:text`: parallel analysis methods
feeding a weighted composite score.

### Use

The `code` skill triggers on phrases like *"check code density"*,
*"find AI slop in this code"*, *"is this code bloated?"*, *"review this
AI-generated code"*, or *"code slop check"* — or invoke it directly:

```
/ml-slop:code
```

**Two input modes, auto-detected:**

- **Diff mode** (in a git repo) — analyzes your working diff / branch / PR with
  repo context, the way a reviewer would. Catches repo-aware slop like
  reimplementing an existing utility or ignoring local conventions.
- **Standalone mode** — analyzes the specific files you name. Repo-context-only
  methods report *not applicable* rather than guessing.

Score mode only in v1: it reports findings and a composite score; it never edits
your code.

### The ten methods

Five adapt the prompt patterns of their `text` counterparts,
five are code-specific:

| Method | Detects |
|---|---|
| `code-duplication` | Clone / near-clone blocks; reimplementations of existing repo utils |
| `verbosity-inflation` | Logic expressed in materially more code than the idiomatic form |
| `dead-code-filler` | Unused vars/helpers, leftover debug prints, TODO stubs |
| `comment-redundancy` | Comments restating the code instead of explaining why |
| `over-abstraction` | Single-use wrappers, speculative generality |
| `error-masking` | Broad/silent catches, redundant defensive checks |
| `convention-adherence` | Ignoring repo idioms or existing utilities *(diff mode only)* |
| `boilerplate-template` | Generic tutorial-style scaffolding |
| `hallucinated-deps` | Imports / APIs that plausibly don't exist |
| `perf-waste` | Obvious inefficiencies (I/O in loops, N+1, quadratic lookups) |

Each method runs as a parallel subagent returning a strict JSON envelope; the
orchestrator aggregates a weighted composite **0–100** density score: **80+**
dense · **60–79** acceptable · **40–59** bloated · **<40** sloppy. Methods that
fail or don't apply drop out and the remaining weights renormalize.

### Status

v1, smoke-validated in both input modes across Python and TypeScript (see
[`skills/code/workspace/SMOKE.md`](skills/code/workspace/SMOKE.md)). The composite **weights, the
per-method scoring function, and the label bands are provisional** — absolute
scores are pre-calibration; only relative separation (sloppy vs clean) is
validated so far. The bundled `skills/code/workspace/` holds the smoke fixtures and the
first calibration finding; a full evaluation harness against real
AI-authored-then-human-fixed code is planned.

## `/ml-slop:comments`

The writing-side counterpart to the analyzers: a comment must justify its existence,
and the default is no comment at all. It fires only when you ask for it, in Claude Code
and in Codex.

```text
/ml-slop:comments          # Claude Code
$comments                  # Codex
```

Implicit invocation is off in both harnesses: `disable-model-invocation: true` in
[`skills/comments/SKILL.md`](skills/comments/SKILL.md), and
`policy.allow_implicit_invocation: false` in
[`skills/comments/agents/openai.yaml`](skills/comments/agents/openai.yaml).

## License & attribution

MIT. The `text` skill was originally authored by [Web-Tree](https://github.com/Web-tree)
and keeps its own [`LICENSE`](skills/text/LICENSE) and [`NOTICE`](skills/text/NOTICE).
The `code` skill is by [Max Levitskiy](https://github.com/Max-Levitskiy), adapting the
text skill's methodology — see [`LICENSE`](LICENSE) and [`NOTICE`](skills/code/NOTICE).
