---
name: herdr
description: >-
  Drive the herdr terminal workspace manager from the CLI - list, focus, rename,
  create, or close workspaces, worktrees, tabs, and panes; spawn agents and talk to
  them; and answer "which one am I in". Use whenever the user mentions herdr, or asks
  to rename / switch / focus / close / list a session, workspace, tab, pane, or
  worktree in their terminal workspace manager - e.g. "rename this session", "what
  workspace am I in", "focus the argocd workspace", "make a worktree for branch X",
  "close this tab". Also use to start another agent in a pane, send it a message, read
  its output, or wait for it to finish. Prefer this over ad-hoc `herdr` commands: it
  resolves the current pane correctly and handles the session-vs-workspace trap.
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

## Reference - load what the task needs

Each file is the verb list plus the gotchas for that area. Read one when the task touches
it; do not read all four.

| File | Covers |
|------|--------|
| `references/workspaces.md` | workspace + worktree verbs; creating worktree-backed workspaces |
| `references/tabs-and-panes.md` | tab verbs; pane verbs incl. split, move, zoom, resize, read, input |
| `references/agents.md` | starting an agent, messaging it, reading its replies, waiting on status |
| `references/sessions.md` | the literal session/server: list, attach, stop, `--session`, `--remote` |

Anything not listed there: `herdr <noun> --help` prints the authoritative subcommand list.

## Gotchas

- **`herdr agent send` does not press Enter.** It writes literal text into the composer.
  Follow with `herdr pane send-keys <pane_id> Enter`. See `references/agents.md`.
- **"session" is usually the workspace** - but check `herdr session list` rather than
  assuming there is only `default`.
- **Destructive verbs** (`workspace close`, `worktree remove`, `tab close`, `pane close`,
  `session delete`) remove things - confirm with the user first, and note `worktree
  remove` deletes the git worktree on disk. Renames and focus are safe and reversible.
- **Don't invent ids.** Resolve from `herdr pane current`, `herdr_here.py`, or a
  `herdr ... list`. Labels can collide; the resolver errors and asks you to disambiguate.
- **Naming.** New worktree-backed workspaces get auto-codenames like
  `worktree-brave-river-06c0`; users rename them to a short task/repo label. Match style.
