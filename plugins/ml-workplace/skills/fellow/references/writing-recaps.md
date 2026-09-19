# Writing a meeting recap into a repo or vault

`recap` produces finished markdown — title, date, attendees, AI summary, decisions, action items — so you rarely need to assemble one by hand from raw JSON.

Important: a Fellow *note* is usually just the blank agenda template. The substance lives on the linked *recording* as `ai_notes`. `recap` joins them for you; a note fetched on its own will look empty and misleading.

When filing the recap into a project, follow that project's conventions rather than dumping the raw output — check for a `CLAUDE.md`/`AGENTS.md` describing filenames, front-matter, index files, or cross-linking, and match it. Use `--json` if you need the structured fields to build a custom layout:

```bash
bun "$F" recap <id> --json    # { note, recording, markdown }
```

If the config defines `storage.recaps.path`, that's where the user expects recaps to land. `bun "$F" config show` lists each storage target with its resolved path, or `(not configured)` — check there before inventing a destination.
