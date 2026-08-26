# Confluence REST reference

Read this when the CLI doesn't expose something, or when a page write doesn't land the way
you expected. The split between v1 and v2 on Cloud is the thing to internalise.

## Contents

- [Base paths and auth](#base-paths-and-auth)
- [Endpoint map](#endpoint-map)
- [The update contract](#the-update-contract)
- [Storage format](#storage-format)
- [CQL cheat sheet](#cql-cheat-sheet)
- [Error shapes](#error-shapes)

## Base paths and auth

| | Cloud | Data Center / Server |
| --- | --- | --- |
| Site root | `https://site.atlassian.net/wiki` | `https://confluence.example.com` |
| Content API | `/api/v2` | `/rest/api` |
| Search API | `/rest/api/search` (v1 — no v2 equivalent exists) | `/rest/api/search` |
| Auth header | `Basic base64(email:apiToken)` | `Bearer <pat>` |
| Space identifier | numeric `spaceId` in v2 | space `key` |

The `/wiki` prefix is easy to lose and produces a 404 with an HTML body. On Data Center
there is no `/wiki` unless the admin configured a context path.

**Cloud v2 has no search.** Atlassian has said it isn't planned; CQL search stays on v1.
Attachment *upload* is likewise v1-only — v2 can list attachments but not create them.

## Endpoint map

| Operation | Cloud | Data Center |
| --- | --- | --- |
| Current user | `GET /rest/api/user/current` | `GET /rest/api/user/current` |
| List spaces | `GET /api/v2/spaces` | `GET /rest/api/space` |
| Space by key → id | `GET /api/v2/spaces?keys=NEO` | n/a (keys used directly) |
| Get page | `GET /api/v2/pages/{id}?body-format=storage` | `GET /rest/api/content/{id}?expand=body.storage,version,space,ancestors` |
| Pages in space | `GET /api/v2/spaces/{spaceId}/pages` | `GET /rest/api/content?spaceKey=NEO&type=page` |
| Page by title | `GET /api/v2/spaces/{spaceId}/pages?title=X` | `GET /rest/api/content?spaceKey=NEO&title=X` |
| Children | `GET /api/v2/pages/{id}/children` | `GET /rest/api/content/{id}/child/page` |
| Create | `POST /api/v2/pages` | `POST /rest/api/content` |
| Update | `PUT /api/v2/pages/{id}` | `PUT /rest/api/content/{id}` |
| Delete | `DELETE /api/v2/pages/{id}[?purge=true]` | `DELETE /rest/api/content/{id}` |
| Comments | `GET /api/v2/pages/{id}/footer-comments`, `POST /api/v2/footer-comments` | `GET /rest/api/content/{id}/child/comment`, `POST /rest/api/content` with `type: comment` |
| Attachments | list `GET /api/v2/pages/{id}/attachments`; upload `PUT /rest/api/content/{id}/child/attachment` | same v1 path for both |
| Search | `GET /rest/api/search?cql=…` | `GET /rest/api/search?cql=…` |

Create bodies:

```jsonc
// Cloud v2
{ "spaceId": "555", "status": "current", "title": "T",
  "parentId": "98765",
  "body": { "representation": "storage", "value": "<p>hi</p>" } }

// Data Center v1
{ "type": "page", "title": "T", "space": { "key": "NEO" },
  "ancestors": [{ "id": "98765" }],
  "body": { "storage": { "value": "<p>hi</p>", "representation": "storage" } } }
```

## The update contract

An update **replaces the page** and must carry the next version number:

```jsonc
{ "id": "98765", "status": "current", "title": "T",
  "body": { "representation": "storage", "value": "<full body>" },
  "version": { "number": 8, "message": "why" } }
```

Consequences worth stating plainly:

- **Omitting the title renames the page to nothing** on v1, and 400s on v2. Always resend it.
- **The body is not merged.** Anything you don't include is deleted, including macros,
  attachments-in-body, and sections you never read.
- **The version number is the only concurrency control**, and it's weak. Read version 7,
  write version 8, and if someone else also wrote 8 in between, the second write wins
  silently. `updatePage(..., expectVersion)` in the client re-reads and refuses when the
  number moved — use it for anything you didn't author in the same breath.
- Version numbers are per page and start at 1. `message` shows in the page history and is
  worth setting.

## Storage format

Storage format is XHTML plus Confluence's namespaced elements. It is neither HTML nor
markdown, and posting either produces a page that renders as escaped source.

```html
<h2>Heading</h2>
<p>Text with <strong>bold</strong>, <em>italic</em>, <code>code</code>,
   and <a href="https://x">a link</a>.</p>
<ul><li>item<ul><li>nested</li></ul></li></ul>
<table><tbody><tr><th>h</th></tr><tr><td>v</td></tr></tbody></table>

<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">bash</ac:parameter>
  <ac:plain-text-body><![CDATA[echo hi]]></ac:plain-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="info">
  <ac:rich-text-body><p>Callout</p></ac:rich-text-body>
</ac:structured-macro>

<ac:link><ri:page ri:content-title="Other page" /></ac:link>
<ac:image><ri:attachment ri:filename="diagram.png" /></ac:image>
```

Rules that cause silent corruption when broken:

- **Escape `&`, `<`, `>` in prose.** A bare `&` makes the body invalid XHTML; some versions
  reject it, others store a broken page.
- **Code goes in CDATA**, unescaped. A `]]>` inside a snippet closes the section early — the
  converter splits it as `]]]]><![CDATA[>`.
- **Tags must be closed and properly nested.** `<br>` must be `<br />`.
- **`ri:` elements are empty** and self-closing; their content is in attributes.

The bundled converter (`scripts/lib/storage.ts`) handles all of the above in both
directions. Prefer `confluence to-storage --body-file f` for a preview over hand-writing
XHTML.

## CQL cheat sheet

| Need | Clause |
| --- | --- |
| Full text | `text ~ "phrase"` |
| Title match | `title ~ "runbook"` |
| In a space | `space = "NEO"` |
| By label | `label = "adr"` |
| Pages only | `type = page` (also `blogpost`, `comment`, `attachment`) |
| Under a parent | `ancestor = 98765` |
| Recently changed | `lastmodified >= now("-7d")` |
| Ordering | `ORDER BY lastmodified DESC` |

`~` is indexed matching, not substring: `text ~ "config"` will not find `reconfigure`.
Quote values containing spaces. User-specific fields (`user`, `user.accountid`) were removed
from `/rest/api/search` on Cloud — user lookup has its own endpoint,
`/rest/api/search/user`.

Search is index-backed, so a page created seconds ago may not be findable yet. When a page
should exist but doesn't appear, list the space directly before concluding it's missing.

## Error shapes

```jsonc
// v2
{ "errors": [{ "status": 400, "code": "INVALID_REQUEST_PARAMETER",
               "title": "Bad Request", "detail": "…" }] }
// v1
{ "statusCode": 404, "message": "No content found with id: 123" }
```

A 404 on a page that exists is usually a space permission, not a wrong id. A 400 on create
with no useful detail is most often a duplicate title in the space — titles must be unique
per space.
