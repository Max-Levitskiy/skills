# herdr

Run AI subagents in [herdr](https://herdr.dev) panes and drive the terminal workspace manager itself, from Claude Code. Start a subagent from a named preset, give it a task, read its answer, keep the conversation going, see which agents are running - plus rearranging the layout and managing git worktrees. No MCP server; it shells out to the `herdr` CLI you already have.

```bash
/plugin install herdr@max-skills
```

Requires the `herdr` binary on `PATH` and a running herdr server; the subagent runner also needs `bun`. Verified against herdr 0.7.3 (protocol 16), Claude Code 2.1, Codex 0.146, omp 4.

## What it does

Ask Claude to run another agent, or to move your terminal around, and it will:

- *"Run a subagent to review the uncommitted diff."*
- *"Ask the other Claude which fix it would do first."*
- *"Which agents are running, and is any of them stuck?"*
- *"Start Codex in a scratch directory and have it explain this stack trace."*
- *"Rename this session to backups."*
- *"Make a worktree for branch `feat/auth` and open it."*

## Running subagents

`scripts/herdr-agent.ts` (bun) collapses the whole exchange into one command per step:

```bash
scripts/herdr-agent.ts presets                     # configured subagents, and what is installed
scripts/herdr-agent.ts start reviewer --prompt "…" # spawn, wait for boot, ask once, print the reply
scripts/herdr-agent.ts ask rev "and then?"         # next turn, same context
scripts/herdr-agent.ts running                     # who is alive, and their status
scripts/herdr-agent.ts stop rev --force            # close the pane
```

Which agents exist is configuration, not a guessed command line. Presets live under `agents` in [agent config](../../standards/agent-config.md) (`~/.agents/config/herdr/config.json`, or the repo/local layers), each holding argv plus cwd, env, herdr session, pane placement, timeouts, and the TUI markers used to scrape replies. Eight are built in - claude, codex, omp, gemini, opencode, droid, copilot, cursor - so it works with no config file; `config.example.json` shows how to override one or add a role such as `reviewer` or `scratch`.

## Why a skill and not just `herdr --help`

Three things go wrong when an agent drives herdr from the help text alone. The skill exists to prevent them.

**1. "Session" is overloaded, in both directions.** The labeled thing in the sidebar is a *workspace*; `herdr session` is a separate background server with its own socket and its own workspace tree. When a user says "rename this session" they nearly always mean the workspace. But sessions are real and plural too: `default` is frequently **stopped** while the work lives in named per-project sessions, and workspace `w1` in one session is unrelated to `w1` in another. Guess wrong in either direction and you rename the wrong thing or report a workspace as missing when it is one session over.

**2. Talking to an agent has four traps, and all four look like being ignored.** `herdr agent send` types text but does not press Enter. An Enter sent in the same breath is swallowed by the TUI's redraw. A status wait straight after submitting returns instantly, because the agent has not started working yet - so you read back the *previous* answer. And agents disagree on which status means finished: Claude Code lands on `idle`, Codex on `done`, either can stop at `blocked` to ask a question. The runner handles all four; the skill documents them for when you drive the raw verbs:

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
| `references/agents.md` | subagent presets and config; the one-shot runner; raw `agent` verbs; status semantics |
| `references/sessions.md` | the literal session/server: list, attach, stop, `--session`, `--remote` |

Scripts: `scripts/herdr-agent.ts` (subagents, needs `bun`), `scripts/herdr_here.py` (label-to-id resolution).

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
