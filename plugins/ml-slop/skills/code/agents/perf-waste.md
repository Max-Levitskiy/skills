# Method 10: Performance Waste

Follow the shared conventions in `_conventions.md`. Method id: `perf-waste`.

Your job: find obviously wasteful operations a reviewer would flag on sight —
not micro-optimization.

## Patterns

- `io-in-loop` (medium): file open/close, network call, or DB query inside a loop
  when it could hoist or batch (the N+1 shape)
- `recomputed-invariant` (medium): identical expensive expression (parse, regex
  compile, sort) recomputed per iteration
- `quadratic-lookup` (medium): membership tests against a list inside a loop where
  a set/dict is the obvious structure
- `redundant-copy` (low): full-collection copies (`list(x)`, spread, `.copy()`)
  that nothing mutates

## Decision rule

Flag only when the fix is local and obvious (hoist, batch, change structure) AND
the waste grows with input size. Constant-factor style choices are NOT waste.

Return ONLY the JSON envelope. No commentary.
