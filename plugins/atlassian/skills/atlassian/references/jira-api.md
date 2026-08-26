# Jira REST reference

Read this when the CLI doesn't expose something and you need to add it, or when a response
doesn't look like you expected. Everything here is verified against the endpoints the
bundled client uses.

## Contents

- [Base paths and auth](#base-paths-and-auth)
- [Endpoint map](#endpoint-map)
- [Search and pagination](#search-and-pagination)
- [Field payloads](#field-payloads)
- [JQL cheat sheet](#jql-cheat-sheet)
- [Error shapes](#error-shapes)

## Base paths and auth

| | Cloud | Data Center / Server |
| --- | --- | --- |
| REST root | `/rest/api/3` | `/rest/api/2` |
| Auth header | `Basic base64(email:apiToken)` | `Bearer <pat>` |
| Token issued at | id.atlassian.com → Security → API tokens | Profile → Personal Access Tokens |
| Rich text | ADF (JSON document tree) | wiki markup (plain string) |
| User identifier | `accountId` | `name` (username) |
| Agile API | `/rest/agile/1.0` | `/rest/agile/1.0` |

Cloud also serves `/rest/api/2`, which accepts plain-text bodies. It is not worth using:
v2 on Cloud is a compatibility surface, and mixing versions makes the ADF handling
inconsistent for no gain.

## Endpoint map

| Operation | Method + path | Notes |
| --- | --- | --- |
| Current user | `GET /myself` | cheapest auth check |
| Search | `POST /search/jql` (Cloud) / `POST /search` (DC) | see below |
| Approximate count | `POST /search/approximate-count` | Cloud only |
| Get issue | `GET /issue/{key}` | `?fields=` and `?expand=` both work |
| Create issue | `POST /issue` | body is `{ "fields": {...} }` |
| Update issue | `PUT /issue/{key}` | 204 no content on success |
| Delete issue | `DELETE /issue/{key}?deleteSubtasks=true` | permanent, no trash |
| Comments | `GET|POST /issue/{key}/comment` | |
| Transitions | `GET|POST /issue/{key}/transitions` | POST takes a transition **id** |
| Assignee | `PUT /issue/{key}/assignee` | `{accountId}` vs `{name}` |
| Attachments | `POST /issue/{key}/attachments` | multipart, needs `X-Atlassian-Token: no-check` |
| Projects | `GET /project/search` (Cloud) / `GET /project` (DC) | Cloud paginates under `values` |
| Create metadata | `GET /issue/createmeta/{projectKey}/issuetypes` (Cloud) | DC: `GET /issue/createmeta?projectKeys=&expand=projects.issuetypes.fields` |
| All fields | `GET /field` | how you find `customfield_NNNNN` |
| Link types | `GET /issueLinkType` | |
| Create link | `POST /issueLink` | `{type:{name}, inwardIssue:{key}, outwardIssue:{key}}` |
| Boards | `GET /rest/agile/1.0/board` | Jira Software licence required |
| Sprints | `GET /rest/agile/1.0/board/{id}/sprint?state=active,future` | |

## Search and pagination

**Cloud** — `POST /rest/api/3/search/jql`:

```json
{ "jql": "project = NEO", "maxResults": 50, "fields": ["summary","status"], "nextPageToken": "…" }
```

Response: `{ "issues": [...], "nextPageToken": "…" }`. Three things bite:

1. **No `total`.** The old endpoint returned one; this one doesn't. Use
   `/search/approximate-count` when a number is needed, and label it approximate.
2. **`fields` is not optional in practice.** Omit it and you get `id` only — an empty-looking
   result that is actually a successful response.
3. **Pagination is by token**, and the token is opaque. Stop when it's absent or when a page
   comes back empty; don't compute offsets.

**Data Center** — `POST /rest/api/2/search` with `{jql, startAt, maxResults, fields}`,
returning `{issues, total, startAt, maxResults}`. `total` is exact.

`maxResults` is capped server-side (100 for search on Cloud, configurable on DC). Asking for
more is silently reduced, not an error.

## Field payloads

Jira accepts field values in shapes that vary by field type. The common ones:

```jsonc
{
  "project":   { "key": "NEO" },
  "issuetype": { "name": "Task" },
  "summary":   "plain string",
  "description": { "type": "doc", "version": 1, "content": [] },  // Cloud; plain string on DC
  "assignee":  { "accountId": "…" },      // DC: { "name": "jdoe" }
  "priority":  { "name": "High" },
  "labels":    ["a", "b"],                // replaces the whole set
  "parent":    { "key": "NEO-1" },
  "duedate":   "2026-08-01",              // date only, no time
  "customfield_10016": 5,                 // number (story points)
  "customfield_10001": { "value": "Platform" },  // single-select
  "customfield_10002": [{ "value": "A" }]        // multi-select
}
```

Partial edits that must not clobber concurrent changes go through `update` instead of
`fields`:

```json
{ "update": { "labels": [ {"add": "urgent"}, {"remove": "stale"} ] } }
```

`POST /issue/{key}/transitions` accepts the same `fields` and `update` keys, which is how a
comment can be attached to a transition atomically — useful when the workflow forbids
commenting on the destination status.

## JQL cheat sheet

| Need | Clause |
| --- | --- |
| My open work | `assignee = currentUser() AND resolution = EMPTY` |
| Current sprint | `sprint in openSprints()` |
| Recently touched | `updated >= -7d` |
| Unassigned | `assignee IS EMPTY` |
| Free text | `text ~ "phrase"` (indexed; `~` is not substring matching) |
| In an epic | `parent = NEO-1` (Cloud) / `"Epic Link" = NEO-1` (DC) |
| Multiple states | `status IN ("In Progress", Blocked)` |
| Exclude done | `statusCategory != Done` — survives workflow renames |

Quoting: values with spaces need double quotes; field names with spaces need them too
(`"Story Points" > 3`). `ORDER BY` goes last and is worth setting — the default order is
unspecified.

`statusCategory` (`To Do` / `In Progress` / `Done`) is more portable than `status`, since
every project renames its statuses but the three categories are fixed.

## Error shapes

```json
{ "errorMessages": ["Issue does not exist or you do not have permission to see it."],
  "errors": { "summary": "You must specify a summary of the issue." } }
```

`errorMessages` holds request-level problems; `errors` maps field id → message. A 404 on an
issue that exists usually means a permission scheme, not a typo — Jira deliberately doesn't
distinguish the two.
