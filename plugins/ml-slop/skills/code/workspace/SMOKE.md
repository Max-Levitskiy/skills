# Smoke run log

End-to-end validation of the `code` skill (named `analyze-code-density` at the time) (Plan 1, Task 6).

**Method note:** each fixture was run by one orchestrator agent (model `sonnet`) that
executed the applicable analysis methods *inline* and aggregated per SKILL.md's formula,
rather than by fanning out one subagent per method. The parallel per-method dispatch path
was validated separately by the Task 3/Task 4 behavioral spot-checks (dead-code-filler,
error-masking, convention-adherence non-applicability). For a smoke gate — "does the
pipeline produce valid envelopes and sensible composites end-to-end" — the inline runner is
faithful and much cheaper.

## Results

| Date | Fixture | Mode | Methods incl. | Score | Anchors | High | Result |
|------|---------|------|---------------|-------|---------|------|--------|
| 2026-07-28 | clean_sample.py | standalone | 9/9 (conv-adh n/a) | 100/100 Dense | — | 0 | PASS |
| 2026-07-28 | sloppy_sample.py | standalone | 9/9 (conv-adh n/a) | 78/100 Acceptable | 11/11 | 3 | PASS w/ calibration note |
| 2026-07-28 | sloppy_sample.ts | standalone | 2 checked | — | 2/2 checks | — | PASS |
| 2026-07-28 | diff-repo | diff | 2 checked (10 applicable) | — | make_slug flagged | 2 | PASS |

## Detail

**clean_sample.py (negative control) — PASS.** All 9 methods returned well-formed
envelopes, `sub_score` 1.0 each, zero findings, composite 100. No false positives; the one
borderline case (`is_valid` as a possible trivial-wrapper) was correctly *not* flagged
because it is a real 3-condition predicate, not a passthrough (precision over recall).

**sloppy_sample.py (primary) — PASS with calibration note.** All 9 methods returned valid
envelopes (no malformed output). Anchor coverage **11/11** — every seeded slop instance was
detected by the intended method. Composite **78/100 (Acceptable)**.
Per-method sub_scores: code-duplication 0.71, verbosity-inflation 0.50, dead-code-filler
0.60, comment-redundancy 0.84, over-abstraction 0.99, error-masking 0.96,
boilerplate-template 0.96, hallucinated-deps 0.98, perf-waste 0.97.
Aggregation checks out: Σ(weight×sub_score)=0.7015; 100×0.7015/0.90 = 78.

> **Calibration signal (input to Plan 2 / Round 0), NOT a defect.** The plan's Task 6
> Step 1 guessed composite ≤60 for this fixture; observed 78. Cause: the composite is a
> weighted average of per-method sub_scores, and 5 of 9 methods each found only 1 small
> (1–2 line) finding in a 67-line file, so their sub_scores sit at 0.95–0.99 and pull the
> average up. The pipeline is correct — it found all the slop and aggregated exactly as
> specified. The ≤60 target reflected an assumption about per-method slop density that this
> diverse-but-sparse fixture doesn't meet. Deliberately NOT re-tuned here: the plan defers
> weight/label calibration to Round 0 mining on real AIDev data, and tuning against one
> synthetic fixture would be overfitting (the exact trap documented in the text skill's
> VERIFICATION.md). Two distinct deferred items, which must not be conflated: (a)
> **weight/label fitting** — redistributing the provisional per-method weights and
> re-fitting the score bands; and (b) **aggregation-function redesign** — the deeper issue.
> Because the per-method weights sum to 1.0, re-fitting them only redistributes emphasis
> and cannot lift a composite that compresses toward 1.0 when slop is diverse-but-sparse;
> that compression is a property of the penalty function's *shape* (linear,
> whole-file-normalized, severity-insensitive), not the weights. Round 0 must therefore
> treat the aggregation-function redesign — e.g. a saturating (non-linear) line-ratio
> penalty, an additive severity term so one high-severity finding moves the needle, and/or
> per-method-domain normalization instead of whole-file line ratio — as a first-class
> agenda item, and fit weights against a chosen good function rather than fitting weights
> or bands to compensate for a poor one.

**sloppy_sample.ts (language independence) — PASS.** code-duplication flagged
`formatInvoiceId` as a near-clone of `formatOrderId` (sub_score 0.84); dead-code-filler
flagged the `console.log` leftover (sub_score 0.64). Both envelopes valid. The method
prompts were confirmed free of Python-specific wording (generic "function/method",
"print/console.log/dbg!", "TODO/FIXME").

**diff-repo (diff-mode repo context) — PASS.** With `utils/strings.py` supplied as repo
context, convention-adherence correctly became `applicable: true` (vs `false` in the
standalone runs) and flagged `make_slug` as `ignores-existing-util` (high); code-duplication
independently flagged it as `reimplements-existing` (high). Both envelopes valid. Note: both
sub_scores floored at 0.0 because the flagged function is 11 of 13 non-blank lines — a
small-file artifact of the linear line-ratio penalty, folded into the calibration signal
above; irrelevant on realistically-sized diffs.

## Bottom line

Pipeline validated end-to-end across two languages and both input modes: valid envelopes
everywhere, full slop detection (11/11), clean-code specificity (100, zero false positives),
working repo-context detection, and correct non-applicability handling. Relative separation
holds (clean 100 vs sloppy 78, a 22-pt gap ≥ the 20-pt target). The single unmet expectation
is the absolute sloppy-score threshold, recorded above as the primary calibration input for
Plan 2 Round 0.

## Correctness-boundary regression: 2026-10-12

`fixtures/dense_but_wrong.py` is an original synthetic negative control for a
failure mode documented by Rathnasuriya and Yang, *Characterizing Overconfident
Failure in LLM-Based Code Generation* (submitted 2026-10-08,
<https://arxiv.org/abs/2610.11300>): plausible, confident-looking generated code
can still fail execution-based correctness checks.

The fixture is intentionally compact and free of seeded slop, but its documented
inclusive endpoint is wrong. The deterministic oracle in
`dense_but_wrong.expected.json` must fail:

```bash
python -c "import sys; sys.path.insert(0, 'plugins/ml-slop/skills/code/workspace/fixtures'); from dense_but_wrong import inclusive_sum; assert inclusive_sum(1, 3) == 6"
```

Use the same file to compare the code skill at base
`7f9d2b119cfc0910b6b5894442387d15930b290b` and the candidate branch:

1. Run `/ml-slop:code` in standalone mode with the same model, effort, and
   harness settings.
2. Save the exact reports and raw method envelopes.
3. Expect no supported slop findings and no score reduction merely because the
   functional oracle fails. Do not use the exact numeric score as an oracle.
4. Confirm that the candidate report states that density is not functional
   correctness, security, or authorship; the base report has no such required
   scope line.

The model-driven comparison has not been run in this repository. The fixture and
expectation file are ready for the external harness; no improvement in score or
detection accuracy is claimed.
