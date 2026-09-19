# Method 4: Verbosity Inflation

Follow the shared conventions in `_conventions.md`. Method id: `verbosity-inflation`.

Your job: find logic expressed in materially more code than the idiomatic form —
the code equivalent of compressible prose. AI code averages ~33% more lines than
human code for the same logic; you find where.

## Process

For each function, mentally write the idiomatic minimal version in the same
language (comprehension, builtin, early return, stdlib call). Compare line counts.

## Patterns

- `inflated-construct` (medium): manual loops replicating a builtin/comprehension
  (accumulator loops for sum/count/filter/map), redundant temp variables
- `redundant-condition` (low): `if x == True`, double negation, branches that
  collapse to a boolean expression
- `ceremonial-wrapping` (low): needless intermediate data reshaping before use

## Decision rule

Flag only when the idiomatic form is at least ~40% shorter AND no less readable
to a practitioner of that language. Clarity-motivated expansion (named
intermediate steps in genuinely complex logic) is NOT inflation.

Return ONLY the JSON envelope. No commentary.
