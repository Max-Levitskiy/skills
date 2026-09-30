# Isolate or organize work

A workspace is a labeled project/task location; a named session is another server.
Resolve server scope first. Inventory distinguishes what the user called a session
before a rename or close.

## Create, find, rename

```bash
herdr workspace list
herdr workspace get <workspace-id>
herdr workspace create --cwd /path/to/repo --label review --no-focus
herdr workspace rename <workspace-id> <label>
herdr workspace focus <workspace-id>
```

Creation returns result.workspace, result.tab and result.root_pane.
List records use workspace_id, not id. Keep IDs with their server scope.
Exact labels can collide; resolve by returned ID rather than first match.
Focus changes presentation and may mark completion seen. Prefer no-focus creation
for background delegation.

Optional scripts/herdr_here.py resolves labels with list/resolve/whoami/rename.
Session/machine/wsl/herdr-bin options select its target. Current uses injected pane
identity only in its matching scope. Explicit pane/tab targets are required for those
renames outside that context; a workspace cwd match cannot identify its current pane.

## Give a branch its own checkout

```bash
herdr worktree list --cwd /path/to/repo
herdr worktree create --cwd /path/to/repo --branch review --base main --no-focus
herdr worktree open --cwd /path/to/repo --path /path/to/existing --no-focus
```

Create makes a checkout; open adopts an existing checkout/branch. Anchor by cwd or
workspace, not an unrelated current directory. Read help for supported branch/path forms.
Remote cwd must be absolute, ~, or start with ~/; let the remote server expand it.

Inspect Git status and repository instructions; preserve modifications.
Understand checkout/hooks when a repository trust decision is requested before using
--trust-repository. It is not a routine workaround. Editing workers need file ownership
or separate worktrees plus an integration plan. Worktrees share Git history and do not
resolve task conflicts by themselves.

## Remove exactly what was requested

Workspace close closes running panes; its checkout remains.
Worktree remove --workspace ID also deletes the checkout.
Workspace close --group affects a group; inventory its members first.
A sidebar entry, running processes and disk checkout are distinct removal outcomes.

Check current target, running work, Git modifications and authorization. Preserve outputs
and choose the removal matching the request. A failed creation can leave partial state:
reconcile before retrying. Re-list after move/cleanup rather than reusing old layout facts.
Workspace order/group moves and metadata have raw APIs; use advanced-api.md as needed.
https://herdr.dev/docs/agent-automation/ supplies current response contracts.
