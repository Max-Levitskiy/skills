# Confluence workflows

Read this before running any `confluence` command. `$A` is the CLI path from SKILL.md.

Deeper detail — the full endpoint map, the storage-format spec, a CQL cheat sheet, and
error shapes — is in [`confluence-api.md`](confluence-api.md). Read that when you need
something the CLI doesn't expose, or when a page write doesn't land the way you expected.

## Finding and reading pages

```bash
bun "$A" confluence search "incident runbook" --space NEO
bun "$A" confluence search --cql 'type = page AND label = "adr" ORDER BY lastmodified DESC'
bun "$A" confluence spaces
bun "$A" confluence pages --space NEO
bun "$A" confluence get 98765            # id, or any URL containing one
bun "$A" confluence get 98765 --comments
bun "$A" confluence children 98765
```

Page bodies come back as markdown — headings, tables, code macros, task lists, and panels
are all converted. Pass `--storage` for the raw XHTML; that's rare, and mainly useful when
you intend to edit around a macro you must preserve.

Text search is indexed, so a page created seconds ago may not appear yet, and `~` matches
indexed terms rather than substrings (`text ~ "config"` will not find `reconfigure`). If a
search comes back empty and the page should exist, list the space with `confluence pages
--space NEO` before concluding it's missing.

If a scope is configured (see SKILL.md), its space and `cqlFilter` are applied to searches
and printed under the results. `--space` is a narrower statement than the scope, so passing
it wins outright; `--no-scope` searches every space the account can see. When a ticket key
is the starting point, `config scope NEO-123` names the space its documentation lives in —
better than guessing that the space key matches the project key, which is often but not
always true.

## Writing pages

```bash
bun "$A" confluence create --space NEO --title "Export API runbook" \
  --parent 98765 --body-file /tmp/page.md

bun "$A" confluence append 98765 --body-file /tmp/section.md

bun "$A" confluence update 98765 --body-file /tmp/page.md --expect-version 7 \
  --message "Add rollback steps"
```

Markdown in — the CLI converts to storage format. Preview a conversion with `confluence
to-storage --body-file f` when a page has fiddly formatting.

**Confluence has no partial update.** `update` replaces the entire body, so writing a page
from your memory of it silently deletes everything you didn't reproduce. Two safe patterns:

- **Adding to the end** → use `append`. It reads, concatenates, and writes with the version
  it read, so a concurrent edit fails loudly instead of vanishing.
- **Changing part of a page** → `confluence get <id>` first, edit that text, then `update`
  with `--expect-version` set to the version you read. Without it, an edit someone else
  made in between is overwritten with no error at all.

A scope supplies `--space` and, through `parentPage`, the place new pages hang from — so a
page lands beside its siblings instead of at the space root. Both are overridden by an
explicit flag, and `create` reports which scope it used.

Titles must be unique within a space; `create` checks first and points you at the existing
page rather than letting the API return a bare 400.

Deleting sends a page to the space trash, where an admin can restore it — `--purge` skips
the trash and is unrecoverable. Either way the CLI requires `--yes`; ask the user first. The
config can disable both outright (`safety.allowDelete` / `safety.allowPurge`), in which case
the refusal says so — relay it rather than working around it.

## Comments and attachments

```bash
bun "$A" confluence comments 98765
bun "$A" confluence comment 98765 --body "Reviewed — matches the runbook we ran on Tuesday."
bun "$A" confluence attachments 98765
bun "$A" confluence attach 98765 ./diagram.png
```

## Filing generated documents

When writing a document into Confluence that also lives in a repo, follow the project's
conventions rather than dumping raw output — check for a `CLAUDE.md`/`AGENTS.md` describing
page titles, parent pages, or labelling, and match it. `confluence pages --space NEO` shows
how existing pages in the space are named, which is usually the fastest way to infer the
convention.

If the config sets `storage.exports`, that's where the user expects local copies to land;
`config show` prints the resolved path or `(not configured)`.

## Confluence-specific gotchas the CLI already handles

- **Cloud is a split API.** Pages are v2 (`/api/v2/pages`), but CQL search and attachment
  upload were never ported and still use v1 (`/rest/api/...`). There is no v2 search, and
  Atlassian has said there won't be one.
- **v2 create needs a numeric `spaceId`, not the space key** everyone actually uses. The
  CLI resolves keys to ids and caches them.
- **Cloud lives under `/wiki`**; omitting it produces a 404 with an HTML body. The config
  loader appends it when the deployment is Cloud.
- **Storage format is XHTML, not HTML or markdown.** Unescaped `&`, unclosed tags, or a
  `]]>` inside a code macro corrupt the page — sometimes without an error. The converter
  handles all three.
- **A 404 on a page that exists is usually a space permission**, not a wrong id.
