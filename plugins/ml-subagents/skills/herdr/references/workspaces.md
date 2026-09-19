# Workspaces and worktrees

The workspace is the labeled sidebar item - the per-project or per-worktree unit. When a
user says "session", this is almost always what they mean.

```bash
herdr workspace list
herdr workspace get <workspace_id>
herdr workspace create [--cwd PATH] [--label TEXT] [--env KEY=VALUE] [--focus|--no-focus]
herdr workspace focus <workspace_id>       # switch the UI to this workspace
herdr workspace rename <workspace_id> <label>
herdr workspace close <workspace_id>       # destructive - confirm
```

`workspace list` returns `workspace_id`, `label`, `number`, `active_tab_id`, `tab_count`,
`pane_count`, `agent_status`, `focused`. The key is `workspace_id`, not `id` - a JSON
filter written against `id` fails with `KeyError`.

## Worktrees

A worktree-backed workspace ties a git worktree to a herdr workspace, so a branch gets
its own sidebar entry, tabs and agents.

```bash
herdr worktree list   [--workspace ID | --cwd PATH]
herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] \
                      [--path PATH] [--label TEXT] [--focus|--no-focus]
herdr worktree open   [--workspace ID | --cwd PATH] (--path PATH | --branch NAME) \
                      [--label TEXT] [--focus|--no-focus]
herdr worktree remove --workspace ID [--force]    # destructive - confirm
```

"Make a new worktree for branch `feat/x`" → `herdr worktree create --branch feat/x`, run
from inside the repo. From anywhere else, anchor the repo explicitly with `--cwd` or
`--workspace`; without an anchor herdr has no way to know which repository you meant.

`create` makes a new worktree; `open` adopts one that already exists on disk or on a
branch. Reaching for `create` on an existing branch is the usual mistake.

## Gotchas

- **`worktree remove` deletes the git worktree from disk**, not just the workspace entry.
  Uncommitted work in it is gone. Confirm, and prefer `workspace close` when the user
  only wants the sidebar entry gone.
- **`workspace close` leaves the worktree** on disk - the inverse. Say which one you are
  about to do when the user's phrasing is ambiguous ("get rid of the feat/x one").
- **Labels are free text and can collide.** Resolve to an id before acting;
  `scripts/herdr_here.py resolve <label>` errors on ambiguity instead of guessing.
- **`--focus` moves the user's screen.** Prefer `--no-focus` when creating things
  mid-task so you do not yank them away from what they are reading.
