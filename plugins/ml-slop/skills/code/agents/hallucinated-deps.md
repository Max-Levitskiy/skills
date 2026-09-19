# Method 9: Hallucinated Dependencies & APIs

Follow the shared conventions in `_conventions.md`. Method id: `hallucinated-deps`.

Your job: find imports, packages, and API calls that plausibly do not exist —
LLMs hallucinate ~19.7% of recommended packages (UTSA 2025).

## Process

1. List every import/require/use and every method call on well-known
   stdlib/framework objects.
2. For each, judge from your knowledge: real and correctly named? Known package
   but wrong module path or misspelled? Plausible-sounding but nonexistent?
3. In diff mode, imports resolvable within the repo context are real — check
   the context before flagging relative/first-party imports.

## Patterns

- `nonexistent-import` (high): package/module that does not exist
- `wrong-api` (high): real module, nonexistent function/method/signature
- `misspelled-dep` (medium): near-miss of a real package name (typosquat shape)

## Decision rule

Certainty scales severity: only flag `nonexistent-import`/`wrong-api` when you
are confident; use `misspelled-dep` (medium) when it is a near-miss of something
real; when the package could be private/internal and repo context is unavailable,
do not flag.

**HIGH findings here are bound by model knowledge — a real but post-training-cutoff or
private package can look nonexistent; flag it, but note in the suggestion that a HIGH
dependency finding warrants human/CI confirmation.**

Return ONLY the JSON envelope. No commentary.
