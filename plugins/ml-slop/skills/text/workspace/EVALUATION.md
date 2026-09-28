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
   formatting manually). `no_new_claims` means no facts or personal
   experiences may be invented. A paraphrase can pass even if words differ,
   except for listed exact spans.
3. Record per-case passes and failures, word counts, methods invoked, and
   model/version. Compare base and proposed outputs side by side. Use the
   broader harness before changing numeric score weights or label bands.

The fixtures deliberately include a clean personal note: reducing its repeated
feeling may erase meaning. The guard covers both false positives and losses
caused by an aggressive rewrite. Literal checks alone cannot prove semantic
fidelity or writing quality. The model skill has no executable test runner
here; these are inputs and expected results for an external harness.

## Why these cases

A newer open-source writing skill, Zero Slop, uses local source-detail checks
and explicitly protects caveats, quotes, links, code, and format. Its published
examples motivate these tests; the fixtures above are original and do not
copy its corpus. See https://github.com/manavmishra/ZeroSlop (created
2026-08-03, updated in September 2026). This is a test-design comparison,
not evidence that `ml-slop` scores better after this change.
