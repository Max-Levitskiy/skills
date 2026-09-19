# Sessions and the server

Read this only when the user genuinely means the background server, not their workspace.
See the trap in SKILL.md first.

A **session** is a named server instance with its own unix socket and its own workspace
tree. Sessions are isolated: workspace `w1` in one is unrelated to `w1` in another, and
no ordinary `herdr` command crosses the boundary.

```bash
herdr session list                # name, status, directory, socket
herdr session attach <name>       # attach this terminal to a session (interactive)
herdr session stop <name>         # stop a session's server ('default' targets the default)
herdr session delete <name>       # remove the session entirely (destructive - confirm)
```

Typical output - note `default` stopped while named sessions carry the work:

```
name        status    directory                          socket
default     stopped   ~/.config/herdr                    ~/.config/herdr/herdr.sock
neochain    running   ~/.config/herdr/sessions/neochain  ~/.config/herdr/sessions/neochain/herdr.sock
personal    running   ~/.config/herdr/sessions/personal  ~/.config/herdr/sessions/personal/herdr.sock
```

## Talking to another session, or another machine

```bash
herdr --session <name> <subcommand> ...     # drive a different session's server
herdr --remote <ssh-target> [--session <name>] ...
```

This is the only way to list or address workspaces outside your own session. Without it,
`herdr workspace list` shows *your* session's workspaces and silently omits the rest -
which reads as "the workspace isn't there" when it is, one session over.

## Server

```bash
herdr status [server|client]   # versions, protocol, socket path, whether a restart is due
herdr server stop              # stop the running server via the API socket
herdr server reload-config     # reload config.toml in place
```

`herdr status` prints the socket path, which tells you which session you are actually
talking to - the fastest way to confirm before running something destructive.

## Other noun groups

Rarely needed, listed so you know they exist rather than concluding a capability is
missing. Use `herdr <noun> --help` for the subcommands.

| Group | Covers |
|-------|--------|
| `herdr api` | socket API metadata and live runtime state; useful for discovering fields |
| `herdr config` | `config.toml`, `config reset-keys` to back up and drop custom keybindings |
| `herdr notification` | notification helpers |
| `herdr integration` | editor / tool integrations |
| `herdr channel` | stable vs preview update channel; `herdr update [--handoff]` |

## Gotchas

- **`session delete` is destructive** and `session stop` kills every agent running in
  that session's panes. Confirm, and check `herdr session list` for `running` first.
- **Don't stop the session you are in.** Your own pane dies with it. Check
  `herdr status` for the socket path and compare against the target.
