---
name: fellow
description: Retrieve and work with Fellow (fellow.app) meeting notes, transcripts, AI summaries, and action items — answer questions about past meetings, write recaps into a repo, bulk-export to markdown. Trigger even when Fellow is never named — any request to recall, search, summarize, or file what happened in a meeting, like "what did we decide about X", "my action items this week", "pull Friday's transcript". Also for setting up Fellow API access.
---

# Fellow API

Read-only access to Fellow meeting data through a bundled `bun` CLI. No MCP server, no npm install — the script has zero dependencies and uses `fetch` directly.

Throughout this document, `$F` means the bundled CLI:

```bash
F="<this-skill-dir>/scripts/fellow.ts"     # installed as a plugin:
                                           # $CLAUDE_PLUGIN_ROOT/skills/fellow/scripts/fellow.ts
bun "$F" help
```

## Start here every time

Run this before anything else. It tells you in one call whether you can proceed or need to onboard:

```bash
bun "$F" config check
```

- **Succeeds** → you're authenticated; go to [Workflows](#workflows).
- **Reports missing config** → **read `references/onboarding.md`** and follow it. Missing config is the expected first-run state, not a failure — don't report it to the user as an error.
- **Credential fails to resolve** → the config is fine but the secret isn't reachable (`op` not signed in, env var unset). Tell the user exactly which reference failed and what to run; don't rewrite their config.

If the credential resolves through 1Password, Keychain, or a command, `config show` prints both the reference and the variable it is cached in. Seed that variable **once per shell session** and every later command skips the prompt entirely — a `1password` reference otherwise costs ~5s and a Touch ID tap on *every* invocation:

```bash
bun "$F" config show                     # prints the op:// ref and the cache variable
export FELLOW_API_KEY="$(op read 'op://Vault/Fellow API key/credential')"
```

If `cacheVar` isn't in the config yet, add it to `credentials.apiKey` (see `config.example.json`). Never echo the resolved key back to the user or into the transcript — the `export` above is the only place it belongs.

## Project scoping

Most workspaces mix several unrelated streams — a client engagement, an internal product, a daily standup for something else entirely. When the user asks about "the project", returning all of it is noise.

If `projects` is configured, **filtering is already applied** to `notes list`, `recordings list`, `search`, and `export`. Every command prints what it held back:

```
9 note(s).
[project "acme": 12 out of scope]
```

`--project <name>` picks a different scope; `--all-meetings` disables filtering when the user genuinely wants everything ("search all my meetings, not just this project").

If no projects are configured, or `project undecided` has series waiting to be judged, **read `references/project-scoping.md`** before acting. Verdicts land in the *committed* repo config — shared with teammates, shaping every future query, and invisible once recorded because the series stops appearing in the queue. Never record one the user hasn't agreed to; leaving something undecided is strictly safer than guessing.

## Workflows

### Answering a question about a meeting

The API has **no full-text search** — its only server-side filters are date ranges, exact title, channel, and event GUID. `search` therefore pulls a window of content and matches locally, which is why it takes several seconds rather than milliseconds.

```bash
bun "$F" search "pricing model" --since 30                # note bodies only — fast
bun "$F" search "launch date" --since 14 --transcripts    # also spoken content — slower, far higher recall
```

Reach for `--transcripts` whenever the question is about something *said* ("who suggested…", "did anyone mention…"). Most Fellow notes are an empty agenda template, so a notes-only search misses nearly everything that was actually discussed. If a notes-only search returns nothing, retry with `--transcripts` before telling the user there's no match.

Narrow the window when you can — `--since 7` over a busy workspace is many times cheaper than `--since 365`, and most questions are about something recent.

### Treat AI notes as a summary, not as the record

`ai_notes` — the summary, decisions, and topics — is machine-generated from the transcript. It's the fastest way to answer most questions and usually right — but it commits to *one* reading of an ambiguous conversation, and states that reading with more confidence than the conversation supports.

So when the answer depends on precise wording, who said what, or a distinction the participants themselves were fuzzy about, check the transcript before reporting:

```bash
bun "$F" recap <id> --transcript
bun "$F" search "<the phrase in question>" --since 14 --transcripts
```

Quote the speaker rather than the summary when attribution matters. If the transcript and the AI note disagree, the transcript wins — and tell the user they diverge, since that disagreement is often the interesting part. Fellow's transcription mangles names and jargon (people's names get mangled, domain acronyms get mis-expanded), so read around an odd-looking term rather than repeating it.

To find a meeting by name rather than content, list and filter:

```bash
bun "$F" notes list --since 30
bun "$F" recordings list --since 30 --title "Weekly Sync"   # --title is exact-match, server-side
```

Then read the one you want:

```bash
bun "$F" recap <note-id-or-recording-id>              # summary, decisions, action items
bun "$F" recap <id> --transcript                      # everything, including the full transcript
bun "$F" recordings get <id> --transcript-only        # just the words
```

### Other tasks

- **Filing a recap into a repo or vault** → **read `references/writing-recaps.md`**.
- **Bulk export** (`export`) → **read `references/export.md`**. Transcripts are verbatim records of everything said — warn the user before a wide window lands in a git repo.
- **Action items** → **read `references/action-items.md`**. Always pass `--all`: pages cap at 50, and a truncated list looks exactly like a complete one.

## Output modes

Every command takes `--json` for structured output. Default output is formatted for reading.

Prefer the human-readable form when you're going to summarize for the user — it's already condensed, and pulling full JSON transcripts into context wastes a great deal of it for no benefit. Use `--json` when you need specific fields to build something.

## Pagination

**Every list command returns at most 50 rows unless you pass `--all`.** This is the single easiest way to give a confidently wrong answer with this skill — a truncated list looks exactly like a complete one. The CLI flags it when a result fills a page, but for any question phrased as *all*, *every*, *how many*, or *outstanding*, pass `--all` up front.

`--all` costs one extra request per additional page, which is cheap next to being wrong.

## Going deeper

The full endpoint list, filter fields, response shapes, and the API quirks the CLI already works around are in `references/api.md`.

## Scope

This skill is **read-only** by design. It never deletes, modifies, or uploads anything, so it can't damage the workspace. Fellow's API does support writes (completing action items, webhooks, uploading recordings, and super-admin deletes) — if the user wants those, say plainly that this skill doesn't cover them rather than reaching for `curl` to work around it.
