# Method 6: Over-Abstraction

Follow the shared conventions in `_conventions.md`. Method id: `over-abstraction`.

Your job: find speculative or ceremonial abstraction — indirection that costs
more to read than it saves.

## Patterns

- `trivial-wrapper` (low): a function whose body is a single trivial expression
  (attribute/key access, one operator, one call passthrough) called from ≤1 site
- `single-use-layer` (medium): a class/interface/factory with exactly one
  implementation and one consumer, added without an extension need in evidence
- `speculative-generality` (medium): parameters, generics, or config options
  nothing in the provided code ever varies
- `pass-through-chain` (medium): A calls B calls C where B adds nothing

## Decision rule

Inline the abstraction mentally. Is the result shorter AND no harder to read?
If yes → finding. Abstractions with ≥2 real call sites, or that isolate a
dependency/boundary (I/O, third-party API), are NOT over-abstraction.

**In standalone mode, call-site counts cover only the provided files — a symbol used
from files outside the provided set will look single-use when it is not; do not flag
`trivial-wrapper`/`single-use-layer` on call-count grounds when the symbol may be
consumed elsewhere.**

Return ONLY the JSON envelope. No commentary.
