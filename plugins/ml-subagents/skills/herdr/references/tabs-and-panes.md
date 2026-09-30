# Navigate or control terminals

Within the selected server, inventory returned IDs:

```bash
herdr tab list --workspace <workspace-id>
herdr pane list --workspace <workspace-id>
herdr pane current --current
herdr pane get <pane-id>
herdr pane process-info --pane <pane-id>
herdr pane layout --pane <pane-id>
```

Current requires identity from this scope; outside Herdr or across machines, pass
explicit returned IDs. Get/process-info establishes who receives subsequent input.

## Navigate and arrange

Tab create/get/focus/rename/close manages tabs; create returns result.root_pane.
Use cwd and no-focus for background locations. Focus a tab/workspace explicitly;
pane focus is directional, while agent focus selects a live agent.

Pane neighbor/edges/layout exposes topology. Split right/down with optional ratio;
resize/zoom/swap operate on explicit/current panes. Read specific help for destinations
instead of reconstructing layout from ID patterns.

```bash
herdr pane split <pane-id> --direction right --cwd /path --no-focus
herdr pane zoom <pane-id> --on
herdr pane move <pane-id> --new-workspace --label review
```

Cross-workspace moves change the ID: adopt result.move_result.pane.pane_id and retain
previous_pane_id for reconciliation. Launch-time environment aliases remain usable for
current, but an in-flight wait can end with agent_not_running.
Recheck workspace/tab/occupant after moves. Raw tab/workspace ordering is in advanced-api.md.

## Run, input, read, wait

Pane run types a shell command plus Enter; send-text types literal text without Enter;
send-keys sends keys. For recognized agents use agent prompt/send-keys (agents.md).
Command text is destination-shell code: quote paths and untrusted text appropriately.

```bash
herdr pane read <pane-id> --source visible --lines 80
herdr pane wait-output <pane-id> --match "attempt-specific-marker" --timeout 30000
```

Reads print text. Recent defaults to 80 rows; visible/detection are passive.
Deep recent reads of idle alternate-screen agents can scroll their transcript.
Bound rows/characters; use artifacts for long answers.
Output waits search existing text immediately. Historical markers can match; verify
attempt/current output independently. A text match does not establish command exit code.
Rust regex matching is line-by-line. Always bound waits.

## Interactive equivalents

Choose machine/workspace before pane actions. Mouse menus split/focus, borders resize,
tabs/sidebar navigate. Default prefix is ctrl+b; prefix+w opens workspace navigation.
Arrows preview, Enter activates, Esc cancels. Activate a remote preview before other
shortcuts. Custom bindings differ: consult configuration/keyboard rather than guessing.
See sessions.md for attach/detach/resume and configuration for copy mode or prefix-free use.

Input routing, copy/scroll/search/selection, links, graphics and terminal observers
have advanced APIs. Tab close kills every pane; pane close kills its current occupant.
Inventory and authorization must match the intended cleanup.
