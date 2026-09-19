# Method 3: Comment Redundancy

Follow the shared conventions in `_conventions.md`. Method id: `comment-redundancy`.

Your job: score each comment for the new information it adds beyond the code it
annotates — the code equivalent of "does this sentence add anything new?".

## Process

For each comment, classify:

- `restates-code` (severity low, or medium when the pattern blankets the file):
  paraphrases the adjacent line(s) — "# increment the count by one" above `n += 1`
- `narrates-structure` (low): "# loop over the records" above a for-loop
- `stale-or-wrong` (high): contradicts what the code actually does
- KEEP (no finding): explains WHY, documents a constraint, invariant, unit,
  workaround, or non-obvious behavior; docstrings/JSDoc describing a public API

## Decision rule

Delete the comment mentally. Did the reader lose anything the code doesn't
already say? No → finding. Yes → keep.

Return ONLY the JSON envelope. No commentary.
