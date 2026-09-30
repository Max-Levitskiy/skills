# Attach, detach, resume or recover

A session is a background server with independent sockets/layout, sharing local global
config. List exact names (including case) with herdr session list --json.

## Interactive workflow

```bash
herdr --session <name>
herdr session attach <name>
herdr --remote <authorized-ssh-target> --session <name>
```

These open a terminal UI and can start sessions; remote setup may offer install/server
replacement. Accept such prompts only within the requested authorization.
Use a real PTY/UI control facility; help does not prove attachment. A status command
reporting not_running does not create the server. Before opening a new session, set
its intended project or disposable scratch cwd: initial startup can create a workspace
there. Record initial inventory and every created session/workspace/pane for cleanup.
Stop only run-owned sessions; deletion of stored state or scratch files is a separate
requested cleanup action.

Choose machine/workspace in the sidebar, then tab/pane. Mouse clicks/menus and border
dragging work without shortcuts. Default ctrl+b is the prefix; ctrl+b q detaches while
processes continue. Prefix+w opens workspace navigation; arrows preview, Enter selects,
Esc cancels. Bindings may be customized. Agent conversations and layout operations map
to their task references. For keyboard/copy mode/mobile/phone access:
https://herdr.dev/docs/keyboard/ and https://herdr.dev/docs/how-to-work/.

For parallel headless control of the same remote UI, use an existing saved profile or
execute the CLI on that authorized remote host (targets.md). TUI selection does not
retarget separate local CLI calls. Record session/profile and IDs, not “the open session”.

Agent attach TARGET or terminal attach TERMINAL_ID opens one terminal, not the whole UI.
One writable owner controls input/resize; takeover replaces it and needs deliberate
authorization. Native Windows direct attach is unsupported; Linux/WSL/macOS support differs.
Read-only observers do not seize input ownership.

## Resume across invocations

Detach preserves real processes. Reattach to the same host/session, inventory panes and
agents, then match the occupant before continuing a conversation.
Keep target/task/IDs/terminal occupant/output references. Names are temporary and
layout IDs can change after moves.

Restart restores layout/cwd, not arbitrary running commands. Missing directories restore
as error panes. Native agent restore needs valid integration session identity or a
reported resume command. Claude/Codex hooks report identity, not successful task completion.
Inspect integration status for current installed support.
Pane history replay restores text, not a process/conversation; it is opt-in because
history may contain sensitive data.

## Stop, update, recover

Stop kills every session pane; delete removes a stopped session's stored data.
Scope precisely, preserve work, and apply the authorization for that cleanup.
Compatible client/server versions need not match; an update may leave a server running.
Experimental live handoff is opt-in/Unix-only, can interrupt requests/events/waits, and
older sending servers may have a 64-pane transfer limit. Re-inventory after interruption.

Snapshots/backups/history are private session data. For requested recovery, follow the
documented backup/stop/restore procedure; do not inspect unrelated agent session storage.
https://herdr.dev/docs/session-state/ details preservation paths and limitations.
