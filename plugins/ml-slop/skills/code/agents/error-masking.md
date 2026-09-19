# Method 7: Error Masking & Over-Defensive Code

Follow the shared conventions in `_conventions.md`. Method id: `error-masking`.

Your job: find error handling that hides failures or defends against impossible
states — a signature AI-code pattern (+47% error-masking constructs, GitClear 2026).

## Patterns

- `silent-catch` (high): broad catch (bare `except:`, `except Exception`,
  `catch {}`) that swallows, `pass`es, or returns a default without logging or
  re-raising
- `catch-log-continue` (medium): catches broadly, logs, and continues as if
  nothing happened where the caller cannot detect the failure
- `impossible-guard` (low): null/type checks on values the same function just
  created or that the type system already guarantees
- `redundant-fallback` (low): `or default` / `?? default` chains on values that
  cannot be falsy/nullish in the provided code
- `pointless-try` (medium): try/catch wrapping code that cannot raise

## Decision rule

If this code fails here, does anyone find out? If no → finding. Narrow catches
of specific expected exceptions with meaningful handling are NOT masking.

Return ONLY the JSON envelope. No commentary.
