# Jira workflows

Read this before running any `jira` command. `$A` is the CLI path from SKILL.md.

Deeper detail — the full endpoint map, field payload shapes, a JQL cheat sheet, and error
shapes — is in [`jira-api.md`](jira-api.md). Read that when you need something the CLI
doesn't expose, or when a response doesn't look the way you expected.

## Finding issues

```bash
bun "$A" jira search 'project = NEO AND status != Done ORDER BY updated DESC'
bun "$A" jira search 'assignee = currentUser() AND sprint in openSprints()'
bun "$A" jira search 'text ~ "rate limit" AND created >= -30d' --limit 20
bun "$A" jira search 'project = NEO AND status = Blocked' --count
```

`currentUser()`, `openSprints()`, `-30d`, and `EMPTY` are JQL functions, not literals —
they're how you avoid hardcoding a person or a date. A bare project key (`jira search NEO`)
is expanded to `project = NEO ORDER BY updated DESC` as a convenience.

If a scope is configured (see SKILL.md), its projects and `jqlFilter` are AND-ed in ahead of
any `ORDER BY`, and the added clauses are printed under the results. Write the JQL for the
question, not for the scope — `status != Done` is enough; the project clause is added for
you. Pass `--no-scope` when the user means every project, and `--scope other` to ask about a
different stream. A query that already names `project` is left alone.

`statusCategory` (`To Do` / `In Progress` / `Done`) is more portable than `status`: every
project renames its statuses, but the three categories are fixed.

**Lists are capped and the cap is silent.** Without `--all` you get one page, and a
truncated list looks exactly like a complete one. The CLI warns when more results exist —
but for any question phrased as *all*, *every*, *how many*, or *outstanding*, pass `--all`
or `--count` up front. Being wrong here is worse than being slow.

On Cloud there is **no total** in a search response; the API stopped returning one. If the
user wants a number, use `--count`, and say it's approximate, because Cloud answers from an
index estimate. Never infer a total from the length of a truncated page.

## Reading an issue

```bash
bun "$A" jira get NEO-123
bun "$A" jira get NEO-123 --comments
bun "$A" jira comments NEO-123
```

Default output is condensed markdown: fields, description, subtasks, links, and any
populated custom fields. Prefer it over `--json` when you're going to summarise for the
user — full issue JSON is tens of kilobytes of schema noise. Reach for `--json` when you
need specific fields to build something.

Descriptions and comments come back as text on both deployments; the CLI renders Cloud's
ADF for you. When attribution or exact wording matters, quote the comment author rather
than paraphrasing.

## Creating an issue

Check what the project actually accepts first. Issue type names and required fields are
per-project configuration, and guessing produces a 400 naming a field id you've never seen:

```bash
bun "$A" jira meta NEO --type Task              # issue types, required fields, allowed values
bun "$A" jira fields --search "story points"    # find a customfield_NNNNN id
```

Then:

```bash
bun "$A" jira create --project NEO --type Task \
  --summary "Rate-limit the export endpoint" \
  --description-file /tmp/desc.md \
  --labels backend,api --assignee me --priority High \
  --field customfield_10016=5
```

Descriptions are markdown — headings, lists, code fences, tables, and links all convert.
Write them to a file and pass `--description-file` (or `-` for stdin) rather than fighting
shell quoting with a long `--description`.

`--field` takes `key=value` and parses JSON values, which is how you set the structured
fields Jira insists on: `--field customfield_10001='{"value":"Platform"}'`. Configured field
aliases work here too, so `--field points=5` beats memorising the customfield number.

**A scope supplies the defaults you'd otherwise pass every time**: `--project` comes from
its first project key, `--type` from its `defaultIssueType`, and its `labels` and
`components` are added to whatever you pass. Scope labels are additive, never a
replacement — they mark the work stream without dropping what the caller asked for. The
create output names the scope it used, so the user can see where the ticket landed.

## Updating, commenting, transitioning

```bash
bun "$A" jira update NEO-123 --summary "Clearer title" --add-label needs-review
bun "$A" jira comment NEO-123 --body-file /tmp/comment.md
bun "$A" jira transition NEO-123 --list        # always look first
bun "$A" jira transition NEO-123 Done --comment "Deployed in 2.4.1"
bun "$A" jira assign NEO-123 me
bun "$A" jira link NEO-123 "blocks" NEO-456
```

**Transitions are workflow-specific.** You can't move an issue to an arbitrary status —
only along an edge its workflow defines from where it is right now, and the transition is
often named something other than its destination ("Resolve" → Done). `transition <key>
<name>` matches either the transition name or the destination status, but list them when
you're unsure rather than guessing twice.

`--add-label` / `--remove-label` edit labels in place; `--labels` replaces the whole set and
will silently drop labels other people added.

`--assignee` accepts `me`, a configured people alias, or an email/display name (which costs
a user-search round trip and can be ambiguous — the CLI lists candidates rather than
guessing between them).

Deleting is permanent — no trash, no undo, and comments and worklogs go with the issue. The
CLI requires `--yes`; ask the user first and offer a closing transition instead. If the
config sets `safety.allowDelete: false`, deletion is refused outright and the message says
so — relay that rather than looking for a way around it.

## Boards and sprints

```bash
bun "$A" jira boards --project NEO
bun "$A" jira sprints 42 --state active
bun "$A" jira search 'sprint = 118 AND status != Done'
```

These use Jira's Agile API, present only where Jira Software is licensed. A 404 here means
the board doesn't exist or the account can't see it — not that the CLI is broken.

## Jira-specific gotchas the CLI already handles

- **`/rest/api/3/search` no longer exists on Cloud.** It became
  `POST /rest/api/3/search/jql`, which pages by opaque `nextPageToken` and returns **only
  the `id` field unless fields are requested explicitly**. Data Center still uses
  `/rest/api/2/search` with `startAt`.
- **Cloud descriptions are ADF, Data Center's are wiki markup.** A plain string is rejected
  by Cloud; ADF sent to Data Center stores a page of visible JSON.
- **Cloud identifies users by `accountId`, Data Center by `name`.** GDPR settings can hide
  emails from Cloud user search, so an assignee lookup finding nothing may be a privacy
  setting rather than a missing person.
- **A 404 on an issue that exists is usually a permission scheme.** Jira deliberately
  doesn't distinguish "not found" from "not allowed to see".
