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

## Correctness-boundary regression: 2026-10-12, repaired 2026-10-19

`fixtures/dense_but_wrong.py` is an original synthetic negative control for a
failure mode documented by Rathnasuriya and Yang, *Characterizing Overconfident
Failure in LLM-Based Code Generation* (submitted 2026-10-08,
<https://arxiv.org/abs/2610.11300>): plausible, confident-looking generated code
can still fail execution-based correctness checks.

The original fixture had an invalid "no findings" oracle: its docstring promised
an inclusive endpoint, contradicting its body. The existing `comment-redundancy`
method correctly requires a high-severity `stale-or-wrong` finding for that case.
PR #69's review identified this and a literal scope-statement mismatch; the PR
was merged without those fixture repairs. The repairs below leave all skill
instructions, methods, weights, penalties, and score bands unchanged.

| Analyze one file at a time | Expected slop behavior | Independent functional oracle |
| --- | --- | --- |
| `fixtures/dense_but_wrong.py` | No seeded slop; the inclusive contract is only in the external expectation JSON | Fails: `(1, 3)` returns 3, not 6; `(3, 3)` returns 0, not 3 |
| `fixtures/stale_docstring.py` | `comment-redundancy`: `stale-or-wrong`, high severity | Fails with the same results |
| `fixtures/useful_docstring.py` | No seeded slop; keep the correct public-API docstring | Passes both cases |

The two docstring controls share exactly the same documentation; only the
implementation differs. Do not weaken wrong-comment detection to make the
negative control pass, and do not strip useful documentation. The boundary
fixture intentionally has neither comments nor docstrings, and its neutral
function name does not expose the hidden inclusive contract.

Run the deterministic construction/oracle checks from the repository root:

```bash
python plugins/ml-slop/skills/code/workspace/check_boundary_fixtures.py
```

The checker exits zero when the intentionally wrong implementations fail their
functional contracts and the correct control passes. It does not invoke an LLM
or prove the expected slop findings. Each JSON file's `required_scope_statement`
is a literal substring of the existing report template. No numeric score or
label is an acceptance oracle.

### Compare against the current default-branch baseline

Baseline: `6be7c9e364ab580da4bf8afee21e47a520a31932` (includes merged PR #69).

1. Run `/ml-slop:code` in standalone mode at that baseline and the candidate,
   with identical model/version, effort, harness settings, and input bytes.
2. For each run, provide only one candidate `.py` fixture at a time. Keep the
   JSON expectations, sibling fixtures, and this protocol out of the analysis
   input; they belong to the external evaluator. Otherwise the hidden contract
   leaks and sibling implementations can produce false duplication findings.
3. Save the exact reports and raw method envelopes. Judge findings against the
   paired controls above, and check the literal scope substring in the JSON.
   Both skill revisions should behave the same because their prompts are
   unchanged. Do not interpret a numeric score difference as an improvement.
4. To reproduce fixture-oracle defects at the baseline, run the candidate checker
   against a baseline worktree (replace the path as needed):

```bash
git worktree add --detach ../ml-slop-boundary-base 6be7c9e364ab580da4bf8afee21e47a520a31932
python plugins/ml-slop/skills/code/workspace/check_boundary_fixtures.py \
  --plugin-root ../ml-slop-boundary-base/plugins/ml-slop --existing-only
```

The baseline is expected to fail construction checks for analyzed docstrings,
the literal scope mismatch, and the numeric score oracle. Its functional failure
still reproduces; the new paired controls are skipped because they did not exist.

Recorded deterministic check on 2026-10-19:

| Input fixture revision | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Baseline, candidate checker with `--existing-only` | 1 | 3 | 1 |
| Candidate with `--existing-only` | 4 | 0 | 1 |
| Candidate, all controls | 5 | 0 | 0 |

These counts measure fixture construction and oracle consistency only, not
findings returned by either skill version. The new controls' expected findings
remain unverified by a model harness.

No model-driven comparison has been run for this repair. These are synthetic
inputs and test-integrity checks, not a calibrated benchmark or evidence of
better model accuracy.
