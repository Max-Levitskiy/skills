---
name: herdr
description: >-
  Run and manage AI subagents in herdr panes, and drive the herdr terminal workspace
  manager from the CLI. Use to start a subagent (claude, codex, omp, gemini, opencode,
  droid, copilot, cursor - or a preset of your own), send it a task, read its answer,
  hold a multi-turn conversation with it, list which agents are running and what state
  they are in, and stop one - one command per step, with the send/Enter and
  status-timing traps handled. Subagent definitions (argv, cwd, env, session, timeouts)
  live in agent config, so "run the reviewer agent" resolves to a preset rather than a
  guessed command line. Also covers the layout itself: list, focus, rename, create, or
  close workspaces, worktrees, tabs, and panes, and answer "which one am I in". Use
  whenever the user mentions herdr, asks to run / spawn / ask / message / check on /
  stop an agent or subagent, or asks to rename / switch / focus / close / list a
  session, workspace, tab, pane, or worktree - e.g. "run a subagent to review this",
  "ask the other claude what it found", "which agents are running", "rename this
  session", "make a worktree for branch X", "close this tab". Prefer this over ad-hoc
  `herdr` commands: it resolves the current pane correctly and handles the
  session-vs-workspace trap.
---

# Driving herdr

`herdr` is a terminal workspace manager for AI coding agents. It runs a background
server and exposes everything over a CLI that talks to that server's socket. This skill
covers reading and changing the layout, and driving other agents.

## The object model (read this first)

```
session (a named background server, own socket, own workspace tree)
└── workspace        ← the per-project / per-worktree unit. HAS THE LABEL in the sidebar.
    └── tab          ← a tab within a workspace
        └── pane     ← a terminal within a tab; where a shell or agent runs
            └── agent ← an AI agent (e.g. claude) attached to a pane
```

**The trap:** "rename **this session**", "what session am I in", "close that session"
usually mean the **workspace** - the labeled sidebar item. Map "session" → workspace by
default.

But sessions are real and plural. A session is a separate server with its own socket and
its own workspaces; users routinely run one per project, and `default` is often
**stopped** while the work lives in named sessions. Every command here talks to *one*
session - the one your pane is in. Workspace `w1` in `neochain` and `w1` in `personal`
are different workspaces. Run `herdr session list` before assuming.

| Object    | id example     | rename command                        |
|-----------|----------------|---------------------------------------|
| workspace | `w1`           | `herdr workspace rename <id> <label>` |
| tab       | `w1:t1X`       | `herdr tab rename <id> <label>`       |
| pane      | `w1:p2M`       | `herdr pane rename <id> <label>`      |
| agent     | pane id / name | `herdr agent rename <target> <name>`  |

Tabs are `<ws>:t<suffix>`, panes are `<ws>:p<suffix>` - same colon, different letter. Ids
are opaque and version-dependent: read them from output, never construct or pattern-match
them.

All `herdr <noun> ...` subcommands print a JSON envelope (`{"id":..,"result":..}`) to
stdout with or without `--json`. Parse `result`.

## Resolving "current" / "the X one"

Native, and enough for most cases - `--current` anchors on `$HERDR_PANE_ID`, exact even
from a subdirectory:

```bash
herdr pane current --current    # current pane + tab + workspace ids, cwd, agent, status
```

The bundled script adds label→id lookup and a rename that defaults to the current object:

```bash
scripts/herdr_here.py whoami            # same, human-readable
scripts/herdr_here.py list              # all workspaces, current marked with *
scripts/herdr_here.py resolve [<label>|<id>]   # → workspace id
scripts/herdr_here.py rename <new-name> [--target <label|id>] [--what tab|pane|agent]
```

So "rename this session to backups" is `scripts/herdr_here.py rename backups`.

Pick a short, kebab-ish label matching the user's existing naming (run `list` to see it),
not a verbose invented one.

## Running a subagent

`scripts/herdr-agent.ts` (bun) does the whole exchange in one command. Use it instead of
hand-rolling `agent start` + `wait` + `send` + `send-keys Enter` + `read`: the manual
sequence has two traps that silently return the *previous* answer, and this handles both
(see `references/agents.md` for what they are).

```bash
scripts/herdr-agent.ts presets                       # which subagents are configured + installed
scripts/herdr-agent.ts running                       # what is alive now, and its status
scripts/herdr-agent.ts start codex --prompt "..."    # spawn, wait for boot, ask once, print the reply
scripts/herdr-agent.ts ask <pane|name> "..."         # next turn in the same conversation
scripts/herdr-agent.ts read <pane|name> [--raw]      # what is on its screen
scripts/herdr-agent.ts stop <pane|name> --force      # close the pane (kills the agent)
```

Add `--json` to `presets`, `running`, `start` and `ask` when you need to consume the
result rather than show it. `start` takes `--name`, `--cwd`, `--workspace`, `--tab`,
`--split right|down`, `--focus`, `--env K=V`, `--session`, `--timeout`.

**Which agent runs is a config question, not a command line.** Presets live under
`agents` in agent config (`scripts/herdr-agent.ts config path global`, ACS v1 - see
`standards/agent-config.md`), keyed by name, holding argv plus cwd, env, session, split,
timeouts and the TUI markers used to scrape replies. Eight agents are built in, so the
skill works with no config file; `config.example.json` shows how to override one or add a
role of your own (`reviewer`, `scratch`). When the user names an agent you do not have a
preset for, run `presets` before guessing a binary.

## Reference - load what the task needs

Each file is the verb list plus the gotchas for that area. Read one when the task touches
it; do not read all four.

| File | Covers |
|------|--------|
| `references/workspaces.md` | workspace + worktree verbs; creating worktree-backed workspaces |
| `references/tabs-and-panes.md` | tab verbs; pane verbs incl. split, move, zoom, resize, read, input |
| `references/agents.md` | subagent presets and config; the one-shot runner; raw `agent` verbs; status semantics |
| `references/sessions.md` | the literal session/server: list, attach, stop, `--session`, `--remote` |

Anything not listed there: `herdr <noun> --help` prints the authoritative subcommand list.

## Gotchas

- **Use `scripts/herdr-agent.ts` for anything conversational.** Raw `herdr agent send`
  does not press Enter, an Enter sent in the same breath as the text is swallowed by the
  TUI redraw, and a status wait straight after submitting returns instantly - each of
  which reads back the *previous* answer. See `references/agents.md`.
- **"session" is usually the workspace** - but check `herdr session list` rather than
  assuming there is only `default`.
- **Destructive verbs** (`workspace close`, `worktree remove`, `tab close`, `pane close`,
  `session delete`) remove things - confirm with the user first, and note `worktree
  remove` deletes the git worktree on disk. Renames and focus are safe and reversible.
- **Don't invent ids.** Resolve from `herdr pane current`, `herdr_here.py`, or a
  `herdr ... list`. Labels can collide; the resolver errors and asks you to disambiguate.
- **Naming.** New worktree-backed workspaces get auto-codenames like
  `worktree-brave-river-06c0`; users rename them to a short task/repo label. Match style.
