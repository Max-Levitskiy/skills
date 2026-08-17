# fellow

Read-only access to [Fellow](https://fellow.ai) meeting data — notes, transcripts, AI summaries, and action items — through Fellow's REST API. No MCP server. The bundled CLI is a zero-dependency `bun` script, so there's nothing to install beyond `bun` itself.

```bash
/plugin install fellow@max-skills
```

## What it does

Ask Claude about your meetings and it will go and look:

- *"What did we decide about the launch date in last week's sync?"*
- *"What are my open action items?"*
- *"Write up a recap of yesterday's client call into `docs/meetings/`."*
- *"Export last month's meeting notes as markdown."*

The interesting one is search. Fellow's API has **no full-text search** — you can filter by date, exact title, channel, or event id, and that's it. The skill pulls a window of notes and transcripts and searches them locally, so questions about what someone actually *said* work even though the API can't answer them directly.

## Project scoping

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

## Requirements

- [`bun`](https://bun.sh)
- A Fellow API key — User Settings → Developer API. Requires a paid workspace, and an admin must enable the API under Workspace Security Settings.
- Whatever CLI holds your secret, if you use one (`op` for 1Password, etc.)

## Setup

Just ask Claude to set up Fellow access. It will ask where your key lives, which workspace to use, and what to store where, then write the config and verify it with a real API call.

Configuration follows the [Agent Config Standard](../../standards/agent-config.md): three layers (global `~/.agents/`, repo, and a gitignored local layer), and **the API key is never written to a config file** — only a reference to where it lives (1Password, an env var, a `.env` file, Keychain, or any shell command).

If that reference is 1Password, Keychain, or a command, add `"cacheVar": "FELLOW_API_KEY"` to it and seed the variable once per shell session:

```bash
export FELLOW_API_KEY="$(op read 'op://Vault/Fellow API key/credential')"
```

Every command in that session then uses the variable and never re-resolves the secret — one Touch ID prompt instead of one per command, and about 5s off each call. The secret is never cached to disk; it dies with the shell.

See [`skills/fellow/config.example.json`](skills/fellow/config.example.json) for the full shape.

## CLI

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

## Scope

Read-only by design — it cannot delete, modify, or upload anything. Fellow's API does support writes (completing action items, webhooks, recording upload, super-admin deletes); those are deliberately not exposed here.

## Notes on the API

A few things that cost real time when working with this API directly, all handled by the CLI and documented in [`skills/fellow/references/api.md`](skills/fellow/references/api.md):

- List endpoints are **POST**, not GET.
- `page_size` must be nested under `pagination` — at the top level you get `200 OK` with an empty list rather than an error.
- Docs are on `fellow.ai`; the API is on `fellow.app`, at a workspace-specific subdomain.
- A Fellow *note* is usually the blank agenda template; the actual summary lives on the linked *recording* as `ai_notes`.

## License

MIT
