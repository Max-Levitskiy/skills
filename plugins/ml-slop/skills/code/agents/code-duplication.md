# Method 1: Code Duplication & Near-Clones

Follow the shared conventions in `_conventions.md`. Method id: `code-duplication`.

Your job: find blocks that express the same logic more than once — exact clones,
near-clones with renamed identifiers, and (diff mode) reimplementations of
functionality that already exists in the repo context.

## Process

1. Extract logical units (functions, methods, repeated statement blocks ≥3 lines).
2. Group units by semantic equivalence: two units match if they compute the same
   result from the same inputs, even with different names, comments, or minor
   reordering. A unit that adds a genuinely new branch, parameter, or behavior is
   related but NOT a duplicate — note it as `unique_detail` in the finding evidence.
3. In diff mode, also compare each new/changed unit against the provided repo-context
   excerpts: a new unit replicating an existing util is pattern `reimplements-existing`.
4. For each clone group, the first/original occurrence is free; every additional
   occurrence is one finding.

## Decision rule

If unit B is semantically equivalent to unit A AND adds no new branch, parameter,
type handling, or behavior → finding (pattern `near-clone`, severity medium; or
`exact-clone`; or `reimplements-existing`, severity high).
If B is similar but adds behavior → no finding; mention as merge candidate in evidence.

Return ONLY the JSON envelope. No commentary.
