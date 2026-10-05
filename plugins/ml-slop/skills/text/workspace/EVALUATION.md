# Text regression protocol

These original, synthetic examples are comparison inputs for the `text` skill.
They are not a calibrated benchmark and do not establish a score threshold.
`rewrite_cases.json` is a JSON array; each case provides `source`, `mode`,
`genre`, and expected properties of the output.

## Compare revisions

1. Run the same model, effort, harness settings, and each case's `source`
   through `/ml-slop:text` in `fix` mode at the base commit and proposed
   commit. Save both exact outputs and raw method reports separately.
2. For each output, check `exact_spans` (literal strings must survive),
   `removable_spans` (empty framing should disappear), and
   `semantic_invariants` (judge meaning, scope, uncertainty, voice, and
   formatting manually). `no_new_claims` means the rewrite may not invent or
   broaden any assertion, attribution, experience, recommendation, certainty,
   or conclusion. A paraphrase can pass even if words differ, except for listed
   exact spans.
3. Record per-case passes and failures, word counts, methods invoked, and
   model/version. Compare base and proposed outputs side by side. Use the
   broader harness before changing numeric score weights or label bands.

The fixtures deliberately include a clean personal note: reducing its repeated
feeling may erase meaning. The guard covers both false positives and losses
caused by an aggressive rewrite. Literal checks alone cannot prove semantic
fidelity or writing quality. The model skill has no executable test runner
here; these are inputs and expected results for an external harness.

## Recorded comparison: 2026-10-05

Two isolated Codex agents received the same four inputs, one with the base skill
at `98585b852e2813f3313917c0fdd4a1db64e25221` and one with the candidate skill.
Both used the runtime's default effort. The runtime identified the model family
as GPT-5 but did not expose an exact model ID or build. The base run produced
final rewrites without raw method reports; the candidate run produced method
reports. Treat this as a forward test, not a calibrated benchmark.

| Case | Source words | Base | Candidate |
| --- | ---: | --- | --- |
| `pilot_scope` | 50 | pass (26 words) | pass (31 words) |
| `qualified_claims` | 40 | fail (27 words) | pass (29 words) |
| `protected_material` | 61 | pass (58 words) | pass (53 words) |
| `voice_negative_control` | 29 | pass (29 words) | pass (29 words) |

The base `qualified_claims` rewrite changed “We have not measured delivery
latency during failover” to “Delivery latency during failover has not been
measured.” That removes the source-local attribution and can be read as a
broader claim. The candidate preserved “We have not measured.” No candidate
output lost a required exact span, retained a removable span, or violated a
semantic invariant. Result: base 3/4, candidate 4/4 on these fixtures.

Exact outputs and the validation commands are recorded in PR #47. Repeat the
comparison in the external harness before using these fixtures to calibrate
numeric score weights or label bands.

## Why these cases

A newer open-source writing skill, Zero Slop, uses local source-detail checks
and explicitly protects caveats, quotes, links, code, and format. Its published
examples motivate these tests; the fixtures above are original and do not
copy its corpus. See https://github.com/manavmishra/ZeroSlop (created
2026-08-03, updated in September 2026). This is a test-design comparison,
not evidence that `ml-slop` scores better after this change.
