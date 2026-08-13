# herdr

Drive [herdr](https://herdr.dev), the terminal workspace manager for AI coding agents, from Claude Code. Rearrange the layout, manage git worktrees, and start other agents and talk to them. No MCP server; it shells out to the `herdr` CLI you already have.

```bash
/plugin install herdr@max-skills
```

Requires the `herdr` binary on `PATH` and a running herdr server. Verified against herdr 0.7.3 (protocol 16).

## What it does

Ask Claude to move your terminal around and it will:

- *"Rename this session to backups."*
- *"What workspace am I in?"*
- *"Make a worktree for branch `feat/auth` and open it."*
- *"Split this pane and run the test suite in it."*
- *"Start a second Claude in the argocd workspace and ask it to summarize the diff."*

## Why a skill and not just `herdr --help`

Three things go wrong when an agent drives herdr from the help text alone. The skill exists to prevent them.

**1. "Session" is overloaded, in both directions.** The labeled thing in the sidebar is a *workspace*; `herdr session` is a separate background server with its own socket and its own workspace tree. When a user says "rename this session" they nearly always mean the workspace. But sessions are real and plural too: `default` is frequently **stopped** while the work lives in named per-project sessions, and workspace `w1` in one session is unrelated to `w1` in another. Guess wrong in either direction and you rename the wrong thing or report a workspace as missing when it is one session over.

**2. `herdr agent send` does not press Enter.** It types text into the agent's composer and stops. A naive send-wait-read returns the agent's *previous* reply and looks like it ignored you. The skill documents the two-line fix and the full conversation recipe:

```bash
herdr agent send        <pane> "your question"
herdr pane send-keys    <pane> Enter
herdr wait agent-status <pane> --status idle --timeout 120000
herdr agent read        <pane> --lines 60 --format text
```

**3. Ids are opaque and easy to invent.** Workspaces are `w1`, tabs `w1:t1X`, panes `w1:p2M` - same colon, different letter, and the format has changed between versions. The skill's rule is to read ids from output, never construct them, and it ships a resolver for the label-to-id step.

## Layout

`SKILL.md` carries only the object model, the session trap, id rules, and the gotchas that cause damage. The verb lists load on demand, so a rename does not pull in the agent-messaging reference:

| File | Covers |
| --- | --- |
| `references/workspaces.md` | workspace and worktree verbs; `create` vs `open`; which delete removes what |
| `references/tabs-and-panes.md` | tab verbs; pane split, move, zoom, resize, swap, read, and the three input verbs |
| `references/agents.md` | starting an agent, messaging it, reading replies, waiting on status |
| `references/sessions.md` | the literal session/server: list, attach, stop, `--session`, `--remote` |

## Resolving "current"

herdr sets `$HERDR_PANE_ID` in every pane, so the native call is exact even from a subdirectory:

```bash
herdr pane current --current
```

The bundled `scripts/herdr_here.py` adds label-to-id lookup and a rename that defaults to the current object, which is the common request:

```bash
scripts/herdr_here.py whoami                  # workspace + tab + pane + agent + cwd
scripts/herdr_here.py resolve <label>         # label to workspace id, errors on ambiguity
scripts/herdr_here.py rename backups          # renames the CURRENT workspace
scripts/herdr_here.py rename api --what pane  # ...or the current tab / pane / agent
```

## Safety

Renames, focus and splits are reversible and the skill treats them as free. These are not, and it asks first:

| Command | Removes |
| --- | --- |
| `herdr worktree remove` | the git worktree **on disk**, uncommitted work included |
| `herdr workspace close` | the sidebar entry (leaves the worktree) |
| `herdr tab close` | every pane in the tab |
| `herdr pane close` | the process running in it, including a working agent |
| `herdr session stop/delete` | every agent in that session; `delete` removes the session |

## License

MIT
