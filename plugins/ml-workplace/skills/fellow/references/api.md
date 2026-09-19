# Fellow Developer API reference

Condensed from <https://developers.fellow.ai> (machine-readable index: `https://developers.fellow.ai/llms.txt`). Read this when the bundled CLI doesn't expose something you need.

## Contents

- [Basics](#basics)
- [Endpoints](#endpoints)
- [Request shapes](#request-shapes)
- [Filters](#filters)
- [Response shapes](#response-shapes)
- [Objects](#objects)
- [Access levels](#access-levels)
- [Gotchas the script already handles](#gotchas-the-script-already-handles)

## Basics

| | |
| --- | --- |
| Base URL | `https://{subdomain}.fellow.app/api/v1` — workspace-scoped |
| Auth | `X-API-KEY: {key}` header (not `Authorization: Bearer`) |
| Key source | Fellow → User Settings → Developer API. Shown once. |
| Requirements | Paid workspace; admin must enable the API in Workspace Security Settings |
| Docs domain | `developers.fellow.ai` — note `.ai` for docs, `.app` for the API. `api.fellow.ai` does not resolve. |

## Endpoints

Read-only (what this skill uses):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Authenticated user + workspace |
| POST | `/notes` | List notes |
| GET | `/note/{note_id}` | One note, content included |
| POST | `/recordings` | List recordings |
| GET | `/recording/{recording_id}` | One recording, transcript + AI notes included |
| POST | `/action_items` | List action items |
| GET | `/action_item/{action_item_id}` | One action item |
| GET | `/recordings/upload` | List API-uploaded recordings and import status |
| GET | `/recordings/upload/{recording_id}` | One upload's status |

Write and destructive (**out of scope for this skill**, listed for completeness):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/recordings/upload` | Upload a recording from a URL |
| POST | `/action_item/{id}/complete` | Mark complete/incomplete |
| POST | `/action_item/{id}/archive` | Archive ("won't do") |
| DELETE | `/note/{id}` | **Super Admin only** |
| DELETE | `/recording/{id}` | **Super Admin only** |
| POST/GET/PATCH/DELETE | `/webhook`, `/webhook/{id}`, `/webhooks` | Webhook management |

Note the inconsistency: list paths are plural (`/notes`, `/recordings`, `/action_items`), fetch-by-id paths are singular (`/note/{id}`, `/recording/{id}`, `/action_item/{id}`).

## Request shapes

List endpoints are **POST with a JSON body**. A GET returns `405 Method not allowed`.

```json
{
  "pagination": { "page_size": 50, "cursor": "opaque-cursor-from-previous-page" },
  "filters":    { "created_at_start": "2026-07-01T00:00:00Z" },
  "include":    { "content_markdown": true },
  "media_url":  { "expire_in": 43200 }
}
```

`page_size` **must** be nested under `pagination`. At the top level the API returns `200 OK` with an empty result list instead of a validation error.

- `page_size`: 1–50, default 20.
- `cursor`: from `page_info.cursor` of the previous page. The cursor keeps being returned past the last page, so stop when a page returns fewer rows than `page_size`.
- `media_url.expire_in`: seconds, 3600–86400, default 12h. Only honoured by `/recordings`; a signed media URL cannot be obtained from `GET /recording/{id}`.

### `include` — expensive fields

Omitted fields come back `null` from list endpoints. `GET`-by-id ignores `include` and returns everything anyway.

| Endpoint | Available flags |
| --- | --- |
| `/notes` | `content_markdown`, `event_attendees` |
| `/recordings` | `transcript`, `ai_notes` |
| `/action_items` | none |

## Filters

There is **no full-text search parameter**. Content search must be done client-side after fetching.

`/notes` and `/recordings`:

| Field | Notes |
| --- | --- |
| `event_guid` | Calendar event id; joins a note to its recording |
| `created_at_start` / `created_at_end` | ISO 8601 |
| `updated_at_start` / `updated_at_end` | ISO 8601 |
| `channel_id` | Fellow channel |
| `title` | Exact match, not substring |

`/action_items`:

| Field | Values |
| --- | --- |
| `completed` | boolean |
| `archived` | boolean |
| `ai_detected` | boolean |
| `ai_suggestion_accepted_by_user` | boolean |
| `scope` | `assigned_to_me`, `assigned_to_others`, `all` |

`/action_items` also accepts `order_by`, e.g. `created_at_desc` (default).

## Response shapes

Every list response wraps a paginated envelope under a named key:

```json
{ "notes": { "page_info": { "cursor": "…", "page_size": 50 }, "data": [ … ] } }
```

Keys: `notes`, `recordings`, `action_items`, `uploads`, `webhooks`.

Fetch-by-id responses wrap a single object: `{ "note": {…} }`, `{ "recording": {…} }`, `{ "action_item": {…} }`.

`/me` returns `{ "user": { id, email, full_name }, "workspace": { id, name, subdomain } }`.

## Objects

**Note** — `id`, `title`, `created_at`, `updated_at`, `event_guid`, `event_start`, `event_end`, `event_is_all_day`, `recording_ids[]`, `event_attendees[]`, `content_markdown`, `content_fellow_markdown`.

`content_markdown` is the human-written note, which in practice is often just the blank agenda template. `content_fellow_markdown` is the same content with Fellow's internal block annotations — harder to read, rarely what you want.

**Recording** — `id`, `title`, `created_at`, `updated_at`, `started_at`, `ended_at`, `event_call_url`, `event_guid`, `note_id`, `user_has_calendar_event`, `transcript`, `ai_notes`, `media_url`.

**Transcript** — `{ language_code, speech_segments: [{ start, end, speaker, text }] }`. `start`/`end` are seconds from the beginning of the recording; `speaker` may be null.

**AI notes** — an array of blocks, each `{ id, is_active, title, template_creator, sections[] }`. Each section is `{ title, type, content }` where `content` is **either** a markdown string (e.g. "Summary") **or** an array of `{ timestamp, text }` (e.g. "Action items", "Decisions"). Handle both; a section with an empty array is a section Fellow found nothing for.

**ActionItem** — `id`, `text`, `status`, `created_at`, `updated_at`, `due_date`, `note_id`, `assignees[]`, `completion_type` (`all`/`any`), `ai_detected`, `recording_offset`.

`status` is one of `Done`, `Archived`, `Incomplete`. Compare exactly — a substring test for `"complete"` matches `"Incomplete"`.

## Access levels

Keys are either privileged or not. A **non-privileged** key sees only the authenticated user's own notes, recordings, and action items; a **privileged** key sees the whole account. Super Admin is a further level required only for the delete endpoints.

This matters when a query returns less than the user expects: it may be the key's scope rather than missing data. `GET /me` does not report the privilege level, so the only way to tell is that account-wide queries return only the user's own rows.

## Calendar ids and recurring meetings

`event_guid` identifies a single **occurrence**, not a series — 15 instances of a daily standup carry 15 distinct values. Anything keyed on the raw value (a cache, a dedup set) will therefore never hit. Two formats appear:

| Source | Shape | Stable series part |
| --- | --- | --- |
| Google Calendar | `<26-char series id>_20240115T090000Z` | everything before `_` |
| Outlook | 112 hex chars, `04000000…07E8010F…<32 hex>` | trailing 32 hex |
| One-off events | 26–43 char id, no date suffix | the id itself |

The Outlook value is a `GlobalObjectId`: a fixed 16-byte prefix, then 4 bytes encoding the occurrence date (`07E8 01 0F` = 2024-01-15), a creation timestamp, reserved bytes, a length, and finally the 16-byte series GUID. Only that last part is constant across the series — the date bytes are why consecutive occurrences look almost identical but never match.

A recreated or rescheduled series legitimately produces a new key — it is a genuinely different calendar series, so re-deciding it once is correct rather than a bug.

Some notes carry no `event_guid` at all; fall back to the note id for those.

## Errors

| Status | Usual cause |
| --- | --- |
| 401 / 403 | Key revoked, or belongs to a different workspace than the subdomain in the URL |
| 404 (HTML body) | Wrong workspace subdomain — Fellow serves its marketing page, not a JSON error |
| 405 | Used GET on a list endpoint; it must be POST |
| 200 with empty `data` | Frequently a malformed request body (`page_size` outside `pagination`) rather than genuinely empty data |

## Gotchas the script already handles

You don't need these to use the CLI — they matter only when debugging odd behaviour or
calling the API directly.

- **List endpoints are POST, not GET.** A GET returns `405 Method not allowed`.
- **`page_size` must be nested under `pagination`.** At the top level the API returns `200 OK` with an *empty list* instead of an error — indistinguishable from an empty workspace.
- **Fetch-by-id paths are singular**: `/note/{id}`, `/recording/{id}`, `/action_item/{id}` (underscore), while list paths are plural.
- **Fetch-by-id returns the expensive fields by default** (transcript, AI notes); *list* endpoints return them as `null` unless you pass `include`.
- **Docs live on `fellow.ai`, the API on `fellow.app`.** `api.fellow.ai` doesn't resolve.
- **Status values are `Done | Archived | Incomplete`** — compare exactly; `"Incomplete".includes("complete")` is true and silently inverts the check.
- **`event_guid` is per-occurrence, not per-series** — see [Calendar ids and recurring meetings](#calendar-ids-and-recurring-meetings) before caching anything on it.
