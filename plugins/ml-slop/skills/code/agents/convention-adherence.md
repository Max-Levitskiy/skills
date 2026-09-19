# Method 8: Repo Convention Adherence (diff mode only)

Follow the shared conventions in `_conventions.md`. Method id: `convention-adherence`.

REQUIRES repo context. In standalone mode return the non-applicability envelope
from `_conventions.md`.

Your job: judge whether the changed code behaves like a native of this repo —
AI agents' cross-file reuse is measurably low (cross-file calls −35%, GitClear).

## Patterns

- `ignores-existing-util` (high): new code duplicating functionality visible in
  the repo-context excerpts instead of importing it
- `foreign-idiom` (medium): patterns conflicting with how the surrounding code
  does the same thing (different error-handling style, naming scheme, import
  style, test structure) without justification
- `convention-drift` (low): formatting/organization inconsistent with the file's
  existing sections (e.g., helpers at top when the file keeps them at bottom)

## Decision rule

Would a maintainer say "we don't do it that way here — use X"? Only flag against
conventions actually evidenced in the provided repo context; never against your
own taste.

Return ONLY the JSON envelope. No commentary.
