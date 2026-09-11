---
id: agent-config:migrate
type: prompt
parallel: false
---

One config file's answers were written against an older version of the component's schema. The
shape of the schema has moved on; the answers in the file have not. This is not about missing or
extra keys — it is about a key whose name stayed the same but whose meaning changed underneath it.

The `context` object carries:
- `layer` — which layer this file belongs to
- `path` — the config file to migrate
- `from` — the schema version stamped in the file, or `null` if the file carries no stamp
- `to` — the schema version the current declaration declares
- `snapshot` — the path to the schema snapshot saved when those answers were written, or `null` if
  none exists
- `keys` — the current declared keys

Do this, in order:

1. Read the config file at `path`, the snapshot at `snapshot` if one exists, and the current
   schema by running `agent-config describe <name>`.
2. Diff the snapshot against the current schema. Look specifically for a key whose path is
   unchanged but whose meaning moved — for example a path that became repo-relative instead of
   absolute, or a timeout that became milliseconds instead of seconds. A key that was added needs
   no migration: it will simply surface as a missing key on the next `start`. A key that was
   removed needs no migration either: excess keys in the file are ignored.
3. Rewrite only this one layer's answers, reinterpreting each changed key's stored value under its
   new meaning, and write it back with `agent-config write <name> --layer <layer>`. This restamps
   the file to the current schema version and saves a fresh snapshot. Do not touch any other
   layer's file — if more than one layer is affected, each gets its own separate migrate action.
4. If there is no snapshot (`snapshot` is `null`), do not guess at what changed. Instead, check the
   current answers against the current schema key by key. Where a stored value would be a
   reasonable answer under both the old and the new meaning of a key, ask the user to confirm or
   correct it before writing. Running an interview is the correct fallback here; silently carrying
   the value forward, and refusing to migrate at all, are both wrong.

On failure, or when you are genuinely uncertain whether a reinterpretation is correct, leave the
file untouched and tell the user which file is affected and which two schema versions (`from` and
`to`) are involved, so they can resolve it by hand.
