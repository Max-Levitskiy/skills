# Find the intended server

Keep execution environment (Windows/Linux/WSL/remote host), named session, workspace,
tab, pane and current agent distinct. TUI selection changes its input surface, not a
separate CLI process's server.

## Discover the executable

Start with the attached/authorized execution tool and a targeted command lookup, not
an exhaustive tool-metadata dump. If it cannot find Herdr, query command -v herdr in
that same host/distro's login shell with a bounded timeout. Use the returned absolute
path for later noninteractive commands; do not assume another environment's PATH.
In PowerShell use Get-Command herdr. For WSL use
wsl -d <RunningDistro> --exec sh -lc 'command -v herdr' only after inventory.
An optional helper accepts --herdr-bin <discovered-path>. Discovery does not install
software or establish agent login readiness. Execution sandbox review is an environment
requirement, distinct from a Herdr failure.

## Local or named session

```bash
herdr --version
herdr session list --json
herdr --session <name> status server --json
herdr --session <name> workspace list
herdr --session <name> agent list
```

Socket precedence: explicit --session, then HERDR_SOCKET_PATH, HERDR_SESSION, default.
Sessions have separate servers/sockets/layouts but share global config. Default may not
carry the user's work. Inside the matching scope, pane current --current uses injected
identity; outside it, inventory explicit IDs. Preserve deliberate low-level socket
overrides rather than replacing them to hide a failure.

## Windows and WSL

WSL is a separate runtime, not a Herdr session or saved machine:

```powershell
wsl --list --verbose
wsl -d <Distro> --exec herdr --version
wsl -d <Distro> --exec herdr session list --json
wsl -d <Distro> --exec herdr --session <name> agent list
```

Executing in a stopped distro starts it; check inventory and authorization first.
Use its Linux paths, binaries, login context and server list. Windows agent installation
does not establish Linux availability. Optional helpers accept --wsl and --herdr-bin
when noninteractive PATH differs. They never choose another distribution.

## Remote interactive work versus command routing

Attach to an authorized host/session with:
`herdr --remote <ssh-target> --session <name>`.
This opens the full UI and can perform setup/start after confirmation. See sessions.md
for navigation/detach/resume. Use an actual terminal/UI control facility; help does not
prove attachment.

For headless operations, use an existing saved profile:

```bash
herdr machine list --json
herdr --machine <profile-id-or-unique-label> status server --json
herdr --machine <profile-id-or-unique-label> agent list
```

Profiles select one remote session. Machine cannot combine with session/remote.
Labels are unique and case-sensitive; arbitrary SSH aliases are not profiles.
Forwarding requires no TUI, never falls back to Local, and does not install/start/restart
servers. Local pane identity cannot become a remote current pane.

With only authorized SSH access, execute the remote CLI directly:
`ssh <authorized-target> 'herdr --session <name> agent list'`.
For prompts, use supported remote execution and proper destination-shell quoting.
Do not add profiles/change auth to hide a missing route. If interactive attach is the
available route, operate its UI deliberately or report the missing terminal/access
prerequisite. Native Windows direct attach differs from Linux/WSL/macOS capabilities.

## Check and resume

Use installed help plus targeted status/schema; compatible versions need not match.
Missing methods fail the operation rather than retargeting. Machine status performs
fresh SSH checks, so probe authorized profiles only. Machine reconnect authenticates;
machine add may install/start/replace a server. Treat them as separate actions.
Authorization changes stop new operations on that machine.

Save runtime, profile/session, socket/status facts, IDs and task/output references.
On resume, inventory the same server and recheck its occupant. Never infer a target from
the selected desktop/TUI or construct IDs.
https://herdr.dev/docs/connecting-machines/ and https://herdr.dev/docs/cli-reference/
contain version-specific forwarding and platform limits.
