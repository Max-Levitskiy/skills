---
name: text
description: >
  Analyze text for information density, semantic repetition, and filler content.
  Two modes: "score" (read-only audit with per-method breakdown) and "fix" (rewrite
  to remove redundancy while preserving all unique information). Dispatches 7 core
  analysis methods (plus genre-targeted ones) as parallel subagents, then aggregates
  results into a composite score and
  actionable report. Use when asked to "check density", "find repetition", "remove
  AI slop", "deduplicate this text", "is this repetitive", "information density",
  "compress this writing", "tighten this doc", or whenever text feels bloated or
  AI-generated. Also use proactively when reviewing docs or PRs that contain
  suspiciously fluffy prose.
---

# Text Density Analyzer

Detect repeated meaning — not just repeated words — across documents. AI text
often restates the same idea with different phrasing. This skill finds those
patterns and either reports them (score mode) or fixes them (fix mode).

## Step 0: Determine target and mode

If the user specified file(s), use those. Otherwise ask:

```
Which document(s) or file(s) should I analyze for information density?
```

Determine the mode from context:
- **Score mode** (default): User says "check", "score", "audit", "analyze", "how dense is this"
- **Fix mode**: User says "fix", "improve", "tighten", "rewrite", "compress", "remove repetition"

If ambiguous, default to score mode — the user can escalate to fix after seeing results.

## Step 1: Read the target text

Read all target files. If total content exceeds ~50K tokens, split into logical
sections (chapters, headings, or ~2000-word chunks with overlap) and process each
section independently. Track section boundaries for the final report.

## Step 2: Dispatch analysis subagents in parallel

Launch all subagents in a **single message** so they run concurrently. Each
subagent receives the full text (or section) and returns structured JSON.

**Core methods (always run — 7):**
- `agents/claim-similarity.md` — Method 1: semantic duplicate claims
- `agents/compression-ratio.md` — Method 2: compressible bloat
- `agents/new-information.md` — Method 3: new-info per sentence
- `agents/unique-claims-ratio.md` — Method 4: unique claims / sentences
- `agents/role-repetition.md` — Method 5: rhetorical role overloading
- `agents/specificity-filler.md` — Method 6: specificity + filler patterns
- `agents/thematic-redundancy.md` — Method 7: claims serving the same narrative
  purpose (distinct from Method 1's semantic similarity)

**Targeted methods (run based on text type — they earn their cost where the
matching slop concentrates):**
- `agents/structure-template.md` — generic opening/closing bookends. High value on
  AI-generated and expository text; cheap everywhere.
- `agents/specificity-quota.md` — flags whole zero-anchor windows. High value on
  informational/machine text with long fact-free passages.
- `agents/purple-prose.md` — overwrought/decorative ornamentation. High value on
  creative/literary/narrative prose.
- `agents/cliche-detection.md` — formulaic stock phrases and AI-tells. Useful on
  any text; overlaps `structure-template` on bookends.

For short or clearly-typed documents, run all of them — the marginal cost is one
parallel subagent each. For large documents, you may skip the targeted methods
that don't match the genre (e.g., skip `purple-prose` on API docs).

### Subagent prompt template

For each subagent, include:
1. The agent instructions (from the corresponding file in `agents/`)
2. The full text to analyze
3. This instruction: "Return ONLY the JSON output described in your instructions. No commentary."

> Note: two other techniques — stance-agency and tense-consistency — were tested
> during development and intentionally left out. Stance-agency improves rewrite
> voice but biases against compression; tense-consistency is polish-only and has
> no effect on what gets cut.

## Step 3: Aggregate scores (main agent)

Once subagents return, compute the composite density score. The redundancy term
combines Method 1 (semantic) and Method 7 (thematic) — take the higher of the two
redundancy ratios, since either form of repetition lowers density:

```
redundancy = max(semantic_redundancy_ratio, thematic_redundancy_ratio)

density_score =
    0.35 × unique_claim_ratio        (Method 4)
  + 0.25 × compression_ratio         (Method 2)
  + 0.20 × average_specificity       (Method 6)
  + 0.10 × (1 - redundancy)          (Methods 1 & 7)
  + 0.10 × (1 - filler_ratio)        (Method 6)
```

Using `max()` of the two redundancy signals fixes a calibration miss found in
testing: text that restates one idea through many different metaphors (low
semantic redundancy, high thematic redundancy) was previously over-scored.

Scale to 0–100. Interpret:

| Range  | Label         | Meaning                                         |
|--------|---------------|-------------------------------------------------|
| 80–100 | Dense         | Minimal repetition, high information per sentence |
| 60–79  | Acceptable    | Some redundancy, could be tightened              |
| 40–59  | Bloated       | Significant repetition, many filler sentences    |
| 0–39   | Very redundant | Most content restates the same few ideas         |

### Build the report

Combine findings from all methods into a single report:

```
## Information Density Report

**File(s):** <paths>
**Density score:** <N>/100 (<label>)
**Sentences:** <total>  |  **Unique claims:** <count>  |  **Compression ratio:** <pct>%

### Repeated Claim Groups
For each group of semantically similar claims:
- Main claim (strongest version)
- Duplicate sentences (with line numbers)
- Unique details worth preserving from duplicates

### Filler Sentences
Sentences that add no new fact, number, example, constraint, or decision.

### Role Overloading
Sequences where the same sentence function repeats (e.g., claim-claim-claim
with no evidence between them).

### Recommended Actions
Numbered list: remove, merge, or keep — with specific sentence references.
```

## Step 4: Score mode — stop here

In score mode, present the report and stop. Offer: "Run again in fix mode to
apply these improvements?"

## Step 5: Fix mode — dispatch improvement subagents

In fix mode, after presenting the report, dispatch fix subagents. Group fixes
by document section to avoid conflicts. Each fix subagent receives the original
section, the findings from all methods, and applies edits in **two ordered
passes**. Order matters: cutting before rewriting prevents the rewriter from
preserving content it should have removed. Testing showed single-pass fixing is
systematically too conservative — it keeps factually-distinct-but-purposeless
prose because the rewriter tries to preserve and edit simultaneously.

```
PASS 1 — Remove (delete, do not rewrite):
- Delete sentences flagged repetitive by Methods 1, 3, 4
- Delete filler sentences from Method 6
- Delete thematically-redundant sentences from Method 7 — keep only each
  function group's survivor (the most concrete instance)
- Delete template openings and template-closing paragraphs from structure-template
- Delete purple-prose decoration (purple-prose) and cliché framing (cliche-detection)
- Delete the weakest sentences in zero-anchor windows from specificity-quota
- Drop any claim the source cannot support (do not carry forward hallucinations)

PASS 2 — Rewrite what remains:
- Merge merge-candidates: keep the version with most concrete detail
- Tighten remaining sentences for clarity
- Preserve ALL unique facts, numbers, examples, constraints, decisions, mechanisms
- Do not add information that wasn't in the original
- Keep technical terms, domain language, and the heading structure
- Verify against the original that no unique information was lost
```

When the genre is creative/literary, lean on Method 7 + purple-prose in Pass 1
(thematic restatement and ornamentation are the dominant slop). When the genre is
informational/machine-generated, lean on structure-template + specificity-quota +
the remove-first ordering (bookends and fact-free windows dominate).

After fix subagents return, run a verification pass: compare original claims
against rewritten text to ensure no unique information was lost. Report:

```
## Fix Summary

**Before:** <word_count> words, density <score>/100
**After:** <word_count> words, density <score>/100
**Removed:** <N> redundant sentences
**Merged:** <N> claim groups
**Lost information:** <none | list of lost items>
```

Apply the fixes using the Edit tool. Show a before/after diff for each changed section.

## Key principle

**Repeated meaning + no new detail = redundancy.**
**Similar meaning + new detail = merge, don't delete.**
**Different meaning = keep.**

The goal is never to make text shorter — it's to make every sentence earn its place
by contributing information that no other sentence already covers.
