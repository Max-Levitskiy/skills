# ml-workplace

The tools a team works in — issue tracker, wiki, meeting notes — driven from Claude Code.
Each skill ships a zero-dependency `bun` CLI and needs no MCP server.

```bash
/plugin install ml-workplace@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-workplace:atlassian` | Jira and Confluence over REST: JQL, issues, transitions, sprints, pages. Cloud and Data Center |
| `/ml-workplace:fellow` | Read-only Fellow meeting notes, transcripts, AI summaries, and action items |

## `/ml-workplace:atlassian`

Jira and Confluence through their REST APIs, driven by a bundled `bun` CLI. No MCP server, no dependencies beyond `bun` itself. Works against Atlassian Cloud (email + API token) and Data Center/Server (personal access token).

### What it does

Say what you want in plain words and Claude goes and does it:

- *"What's assigned to me and still open?"*
- *"File a bug for this stack trace."*
- *"Move NEO-123 to done and comment what changed."*
- *"What does the spec page say about retries?"*
- *"Write this up on the wiki under the platform runbooks."*

On Jira: JQL search, read and create issues, comment, transition status, log work, link issues, sprints and boards. On Confluence: read, create, and update pages, CQL search, footer and inline comments.

It speaks markdown at the edges and converts to whatever the API wants — ADF on Jira Cloud, wiki markup on Data Center, storage XHTML on Confluence. You never see a format conversion.

### Scopes

Most instances mix unrelated streams: a client engagement, an internal platform, one squad's slice of a shared project. "Which tickets are open?" almost never means all of them.

A **scope** is one stream as you name it, bound to the Jira projects and Confluence space that carry it. It supplies project, issue type, labels, space, parent page, and board, so none of that is repeated per command:

```bash
bun $A config scopes             # what's configured; * marks the default
bun $A config scope NEO-123      # which scope owns a ticket prefix
```

Whatever a scope narrowed is printed back, so a filtered answer is never mistaken for the whole picture:

```
12 issue(s).
[scope "neochain" applied: project IN (NEO, NEOINF) — use --no-scope to search everything]
```

An explicit `--project`, `--space`, or a JQL query that already constrains `project` always wins.

### Setup

Ask Claude to set up Atlassian access and it walks you through it. The config file holds a *reference* to your token — 1Password, environment variable, dotenv, macOS Keychain, or any shell command — never the token itself. See `skills/atlassian/config.example.json` for the shape and [the Agent Config Standard](../../standards/agent-config.md) for the layering rules.

Configuration currently lives under the legacy SCS v1 path `~/.agents/skill-config/atlassian/`, which ACS v1 still reads.

### Requirements

- [`bun`](https://bun.sh)
- A Jira/Confluence account with an API token (Cloud) or personal access token (Data Center)

## `/ml-workplace:fellow`

Read-only access to [Fellow](https://fellow.ai) meeting data — notes, transcripts, AI summaries, and action items — through Fellow's REST API. No MCP server. The bundled CLI is a zero-dependency `bun` script, so there's nothing to install beyond `bun` itself.

### What it does

Ask Claude about your meetings and it will go and look:

- *"What did we decide about the launch date in last week's sync?"*
- *"What are my open action items?"*
- *"Write up a recap of yesterday's client call into `docs/meetings/`."*
- *"Export last month's meeting notes as markdown."*

The interesting one is search. Fellow's API has **no full-text search** — you can filter by date, exact title, channel, or event id, and that's it. The skill pulls a window of notes and transcripts and searches them locally, so questions about what someone actually *said* work even though the API can't answer them directly.

### Project scoping

Most workspaces mix unrelated streams. Define named projects and the CLI filters every listing, search, and export to just that project:

```bash
bun $F notes list --since 21
  9 note(s).
  [project "acme": 12 out of scope]
```

Matching runs cheapest-first, so the expensive check almost never runs:

| Tier | Check | Cost |
| --- | --- | --- |
| 0 | remembered verdict for this calendar series | free, exact |
| 1 | title keywords / regex | free |
| 2 | attendee emails or domains | free |
| 3 | read the summary and judge | one model call, **once per series** |

Tier 3 results are written back into Tier 0, so each judgement is paid for once and is free for every future occurrence — and for teammates, since verdicts live in the committed repo config. A meeting that matches *another* configured project is excluded without reaching Tier 3 at all.

```bash
bun $F project undecided --since 30      # series the free tiers can't settle
bun $F project classify <key> <project> --why "…"   # remember it
```

Keying is on a derived series id, not `event_guid` — the raw value is per-occurrence, so a daily standup would otherwise need re-judging every single day. See [`references/api.md`](skills/fellow/references/api.md#calendar-ids-and-recurring-meetings).

### Requirements

- [`bun`](https://bun.sh)
- A Fellow API key — User Settings → Developer API. Requires a paid workspace, and an admin must enable the API under Workspace Security Settings.
- Whatever CLI holds your secret, if you use one (`op` for 1Password, etc.)

### Setup

Just ask Claude to set up Fellow access. It will ask where your key lives, which workspace to use, and what to store where, then write the config and verify it with a real API call.

Configuration follows the [Agent Config Standard](../../standards/agent-config.md): three layers (global `~/.agents/`, repo, and a gitignored local layer), and **the API key is never written to a config file** — only a reference to where it lives (1Password, an env var, a `.env` file, Keychain, or any shell command).

If that reference is 1Password, Keychain, or a command, add `"cacheVar": "FELLOW_API_KEY"` to it and seed the variable once per shell session:

```bash
export FELLOW_API_KEY="$(op read 'op://Vault/Fellow API key/credential')"
```

Every command in that session then uses the variable and never re-resolves the secret — one Touch ID prompt instead of one per command, and about 5s off each call. The secret is never cached to disk; it dies with the shell.

See [`skills/fellow/config.example.json`](skills/fellow/config.example.json) for the full shape.

### CLI

The skill drives this for you, but it's a normal CLI:

```bash
F=skills/fellow/scripts/fellow.ts

bun $F whoami
bun $F search "launch date" --since 30 --transcripts
bun $F notes list --since 14
bun $F recap <note-id|recording-id> [--transcript]
bun $F recordings get <id> --transcript-only
bun $F action-items --open --scope assigned_to_me
bun $F export --since 30 --out ./meetings
bun $F config show|check|path|gitignore
```

Add `--json` to any command for structured output.

### Scope

Read-only by design — it cannot delete, modify, or upload anything. Fellow's API does support writes (completing action items, webhooks, recording upload, super-admin deletes); those are deliberately not exposed here.

### Notes on the API

A few things that cost real time when working with this API directly, all handled by the CLI and documented in [`skills/fellow/references/api.md`](skills/fellow/references/api.md):

- List endpoints are **POST**, not GET.
- `page_size` must be nested under `pagination` — at the top level you get `200 OK` with an empty list rather than an error.
- Docs are on `fellow.ai`; the API is on `fellow.app`, at a workspace-specific subdomain.
- A Fellow *note* is usually the blank agenda template; the actual summary lives on the linked *recording* as `ai_notes`.

## License

[MIT](LICENSE)
