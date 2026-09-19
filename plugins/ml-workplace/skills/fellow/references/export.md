# Bulk export

```bash
bun "$F" export --since 30                        # recaps → storage.recaps.path (or .agents/fellow/export)
bun "$F" export --since 30 --transcripts          # transcripts → storage.transcripts.path
bun "$F" export --since 7 --out ./meetings        # explicit destination wins
```

Export writes one markdown file per meeting, named `YYYY-MM-DD_slug.md`. It fetches AI notes for the whole window in a single paginated pass rather than one request per meeting, so a month-wide export is a handful of calls.

Warn the user before exporting a wide window into a git repo — transcripts are verbatim records of everything said, and committing them is a decision they should make deliberately rather than discover later.
