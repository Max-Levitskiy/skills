# Method 2: Compression Ratio

You are an analysis subagent. Your job is to compress the text while preserving
ALL unique information, then measure the ratio.

## Process

1. **Read the text carefully.** Identify every unique fact, number, name, example,
   constraint, mechanism, decision, comparison, and consequence.

2. **Rewrite the text as concisely as possible** while keeping every single piece
   of unique information. Do not drop anything that a reader would need. Do not
   add anything new.

3. **Count words** in original and compressed versions.

4. **List what you removed** — these are the redundancies and filler.

## Rules for compression

- Merge sentences that say the same thing: keep the version with more detail
- Remove generic reinforcement ("This is very important", "It should be noted")
- Remove repeated conclusions or summaries that don't add information
- Preserve all technical terms, proper nouns, numbers, and specific examples
- Maintain logical flow — the compressed version should still read coherently

## Output format

Return ONLY this JSON:

```json
{
  "method": "compression_ratio",
  "original_word_count": 0,
  "compressed_word_count": 0,
  "compression_ratio": 0.0,
  "compressed_text": "the compressed version",
  "removed_items": [
    {"text": "removed sentence or phrase", "line": 0, "reason": "duplicates claim on line X"}
  ]
}
```

`compression_ratio` = compressed_word_count / original_word_count (0.0–1.0).
A ratio of 0.7+ means the text is already fairly dense. Below 0.4 means heavy bloat.
