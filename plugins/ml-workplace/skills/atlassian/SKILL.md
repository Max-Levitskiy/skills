---
name: atlassian
description: Work with Jira and Confluence through their REST APIs using a bundled TypeScript CLI — search issues with JQL, read and create tickets, comment, transition status, manage sprints and boards, and read, write, and update Confluence pages. Works against both Atlassian Cloud (email + API token) and Data Center/Server (personal access token). Use this whenever the user mentions Jira, Confluence, tickets, issues, the backlog, the board, a sprint, an epic, "the wiki", a runbook or spec page, or pastes an issue key like NEO-123 or an atlassian.net URL — and also when they describe the work without naming the tool: "what's assigned to me", "move that to done", "file a bug for this", "write this up on the wiki", "what does the spec page say", "which tickets are still open". Also use for setting up or fixing Atlassian API credentials.
---

# Jira & Confluence

One `bun` CLI over both products, with no dependencies and no MCP server. It speaks
markdown at the edges and converts to whatever the API needs — ADF on Jira Cloud, wiki
markup on Data Center, storage XHTML on Confluence.

Throughout this skill, `$A` means the bundled CLI:

```bash
A="<this-skill-dir>/scripts/atlassian.ts"     # installed as a plugin:
                                              # $CLAUDE_PLUGIN_ROOT/skills/atlassian/scripts/atlassian.ts
bun "$A" help
```

Installed as a plugin, the same CLI is also on the Bash tool's PATH as `atlassian`, so `atlassian
jira get NEO-123` needs no path. For a workflow hook or a terminal outside Claude Code,
`atlassian launcher install` puts a launcher of that name in `~/.local/bin`; it runs the installed
plugin's CLI, whatever its version, so nothing pins a `~/.claude/plugins/cache/…/<version>/` path.

## Start here every time

Run this first, before anything else:

```bash
AC=$(command -v agent-config || ls -d "$HOME"/.claude/plugins/cache/*/ml-agent-config/*/bin/agent-config \
     "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/ml-agent-config/*/bin/agent-config 2>/dev/null | tail -1)
"$AC" start atlassian
```

Prints JSON. `ready: true` → proceed. `ready: false` → read the file at `guide` and follow it to work the `actions` list, then re-run. An empty `$AC` or `command not found` means agent-config isn't installed; tell the user and offer to install it from https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config.

Missing config is the expected first run, not a failure — don't report it to the user as an
error: the `onboard` action asks for the site, its deployment and the token, and writes the
answers. A config still at the old `~/.agents/skill-config/atlassian/` path is picked up by the
`agent-config:adopt` action, which copies it into `.agents/config/atlassian/` before onboarding
asks anything.

On Claude Code, a 1Password token is asked for once per session and kept in memory. Elsewhere, a
reference with `"cacheVar": "ATLASSIAN_TOKEN"` reads the token from that variable when it holds a
value, so the user can seed it once per shell: `export ATLASSIAN_TOKEN="$(op read '<their ref>')"`.
Print that line for them; never run it yourself and never echo the token.

Ready means the keys are there. Whether the token works is `config check`:

```bash
bun "$A" config check
```

- **`jira: OK …` / `confluence: OK …`** → authenticated. Load the product file below.
- **`not configured`** for one product → that product lacks something a declaration can't
  require, most often `confluence.baseUrl` on Data Center. Fine when they don't use it.
- **`FAILED`** → the config is fine but the call isn't working. The message says which
  credential reference and which host; relay that rather than rewriting their config.

Only one product may be configured, and that's fine — a Jira-only setup works.

## Then load the product file

The two products share credentials and little else: different API versions, different body
formats, different pagination, different failure modes. Keeping them apart means you read
about the one you're using and nothing else.

| Working with | Read first | Add when |
| --- | --- | --- |
| Jira — issues, JQL, sprints, boards | [`references/jira.md`](references/jira.md) | [`references/jira-api.md`](references/jira-api.md) — endpoint map, field payload shapes, JQL cheat sheet |
| Confluence — pages, spaces, CQL | [`references/confluence.md`](references/confluence.md) | [`references/confluence-api.md`](references/confluence-api.md) — endpoint map, storage format, CQL cheat sheet |

**Read the workflow file before running anything past `config check`.** It carries the
command surface and the traps specific to that product — which flag prevents a silently
truncated list, which one prevents overwriting someone's page edit. Guessing costs a failed
call and, for writes, sometimes costs data. The `-api.md` files are the next layer down:
reach for one when you need an endpoint the CLI doesn't expose, or when a response doesn't
match what the workflow file led you to expect.

If the task spans both products — "file a ticket and link it from the runbook" — read both.

## Onboarding

The `onboard` action that `start` plans carries the questions: the instance and whether it is
Cloud or Data Center, where the token lives, and on Cloud the account email. Config lives in
`.agents/config/atlassian/` — global (`~/.agents/config/atlassian/config.json`) for the site and
credentials, which follow the person; the repo layer for a `defaultProject`, `defaultSpace` or
scopes the whole team shares; local for anything personal that shouldn't be committed.

Two things the declaration can't ask for on its own:

- **Data Center usually means two tokens.** Jira and Confluence are separate applications, so
  Confluence's personal access token goes in `credentials.confluenceToken` beside
  `credentials.token`, and `confluence.baseUrl` is its own host.
- **A Jira and a Confluence on different deployments** (Jira on-prem, Confluence on Cloud) set
  `jira.authMode` / `confluence.authMode` and `jira.email` / `confluence.email` per product.

Change an answer with `agent-config describe atlassian` and `agent-config write atlassian --layer
<layer>`, never with the file-writing tool: `write` checks each value against the declaration,
stamps the file and gitignores the local layer. `bun "$A" config show` prints every layer's path
and what the merged config resolves to; `config.example.json` next to this file shows every key.

Full layering and credential rules: [the Agent Config Standard](https://github.com/Max-Levitskiy/skills/blob/main/standards/agent-config.md).

## Scopes

Most instances mix unrelated streams — a client engagement, an internal platform, a squad's
slice of a shared project. "Which tickets are open?" almost never means *all* of them, and
a page written into the wrong space is worse than no page.

A **scope** is one stream as the user names it, bound to the Jira projects and Confluence
space that carry it. It's called a scope because "project" already means something specific
in Jira. Configured scopes supply the project, issue type, labels, space, parent page, and
board so none of that is repeated per command:

```bash
bun "$A" config scopes             # what's configured; * marks the default
bun "$A" config scope NEO-123      # which scope owns a ticket prefix, and its space
```

Every command that searches or creates takes `--scope <name>`, or `--no-scope` to ignore
the configured default when the user genuinely means everything ("search all of Jira, not
just NeoChain"). **Whatever a scope narrowed is printed back**, so a filtered answer is
never mistaken for the whole picture:

```
12 issue(s).
[scope "neochain" applied: project IN (NEO, NEOINF) — use --no-scope to search everything]
```

An explicit `--project`, `--space`, or a JQL query that already constrains `project` always
wins: the user was specific, and silently overriding them would be both surprising and
impossible to work around.

### Proposing scopes when none are configured

Don't invent them from nothing, and don't silently return everything when the user clearly
meant one stream. Look at what actually exists first:

```bash
bun "$A" jira projects
bun "$A" confluence spaces
```

Then propose a starting config from what's there — usually one scope per project key the
user recognises, paired with the space whose key or name matches. Where a stream is a
*slice* of a shared project rather than a whole one, that's what `jqlFilter` /
`cqlFilter` are for (`labels = adi`). Show the user the proposal and let them correct the
pairing; they know which space belongs to which project in a way no listing reveals.

Scopes live wherever the mapping belongs: the repo layer when the whole team shares it, the
global layer for personal streams. The full key list is in `config.example.json`.

### Aliases and standing limits

Three more things the config carries, all optional:

- **`fields`** — friendly name → field id, so `--field points=5` works instead of
  `--field customfield_10016=5`. Find ids with `jira fields --search "story points"`. They
  differ per instance, so this belongs in the repo layer.
- **`people`** — shorthand → accountId/username for `--assignee dana`. Skips user search,
  which matters on Cloud where privacy settings can hide the email a search matches on.
- **`safety`** — `allowDelete: false` / `allowPurge: false` disable destruction outright,
  regardless of any `--yes` at the call site. Worth setting on a shared or production
  instance: `--yes` guards against a mistake in the moment, this is a standing decision.
  `readOnly: true` goes further and refuses *every* mutating subcommand — create, update,
  comment, transition, assign, link, attach, delete — before a client is even built. Use it
  when an instance is a reference source rather than somewhere you file work; it fails
  closed, so a subcommand added later is refused until it's listed as a read in
  `scope.ts`. `config check` prints when either is in force.

## Before you write anything

Reads are free. Writes are not: a created issue notifies watchers, a page edit emails a
space, and neither is quietly undoable. So:

- **Create, update, transition, comment, delete, and attach only when the user asked for
  that specific change.** "What's blocking NEO-42?" is a read. Don't fix it too.
- **Show what you're about to write** — summary, target project or space, parent — and get
  a yes when the content is substantial, when it lands somewhere shared, or when you
  inferred any part of it. For a one-line comment the user dictated, just do it.
- **`delete` requires `--yes` and asks the user first.** A deleted Jira issue is gone
  permanently: no trash, no undo, and its comments and worklogs go with it. A deleted
  Confluence page goes to the space trash unless `--purge`. Prefer closing an issue over
  deleting it, and say so.

## Output modes

Every command takes `--json`. The default output is formatted for reading and already
condensed; prefer it when summarising for the user, and use `--json` only when you need
specific fields to build something. Pulling full issue or page JSON into context costs a
great deal for no benefit.

**Lists are capped unless you ask otherwise**, and a truncated list looks exactly like a
complete one. The product files spell out the flag for each — reach for it whenever the
question is phrased as *all*, *every*, or *how many*.

## Cross-cutting gotchas

Product-specific traps live in the product files. These apply to both:

- **A 200 carrying HTML means an SSO login page**, not success — the classic Data Center
  failure when the API path sits behind a proxy. The CLI says so rather than reporting a
  parse error.
- **A 401 is not always a bad token.** On Cloud it's often `auth.email` not matching the
  account that issued the token; on Data Center, an expired PAT. The error message names
  the credential reference it used.
- **Rate limits**: 429s are retried honouring `Retry-After`, 5xx up to three times. A 400
  is never retried, because a rejected payload stays rejected.
- **Secrets never reach argv, logs, or stdout.** If you extend the CLI, keep it that way —
  process arguments are world-readable.

## Extending the CLI

The client is small and typed: `scripts/lib/jira.ts` and `scripts/lib/confluence.ts` hold
the endpoints, `scripts/atlassian.ts` the commands. If the user needs an endpoint that
isn't wired up, add a method and a subcommand rather than shelling out to `curl` — the
existing code already handles auth, retries, pagination, and body conversion for both
deployments, and a one-off curl handles none of them.

Tests live beside the code: `bun test` from the skill directory. The converters and the
request shapes are covered against a stub server, so a change that breaks Data Center while
fixing Cloud fails immediately.
