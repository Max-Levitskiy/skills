# Method 2: Dead Code & Filler Constructs

Follow the shared conventions in `_conventions.md`. Method id: `dead-code-filler`.

Your job: find code that does no work — the code equivalent of filler sentences.

## Patterns

- `unused-variable`: assigned but never read (severity low)
- `unused-helper`: function/method defined but never called from anywhere in the
  provided code (medium). In diff mode, only flag if also absent from repo context.
  **In standalone mode, a helper called only from files outside the provided set is
  invisible — do not infer `unused-helper` from its absence in the provided code alone;
  skip or downgrade when the symbol looks like it may be used elsewhere.**
- `leftover-debug`: print/console.log/dbg! statements that are clearly debugging
  residue, not intentional CLI output (medium)
- `todo-stub`: empty or pass-only bodies with TODO/FIXME comments (medium)
- `unreachable`: code after return/raise/break, or conditions that can never hold (medium)
- `redundant-assignment`: variables assigned then immediately reassigned, or
  copied to a second name without transformation (low)

## Decision rule

Could this line be deleted with zero behavior change and zero information loss?
If yes → finding. Deliberate API surface (exported-but-unused in a library) is
NOT dead code — when the code looks like a library's public interface, skip it.

Return ONLY the JSON envelope. No commentary.
