---
id: agent-config:install
type: code
parallel: true
---

This action installs a plugin that carries a skill or agent the component depends on.

Run the `command` verbatim. The CLI has already rendered it for the detected harness:
- Claude Code: `claude plugin install <plugin>@<marketplace> -y`
- Codex: `codex plugin add <plugin>@<marketplace>`

The `context` object carries:
- `dependency` — the `<plugin>:<skill>` name the component declared
- `kind` — `skill` or `agent`
- `plugin` — the plugin being installed
- `marketplace` — the marketplace it is installed from

A successful install is not enough for the dependency to be usable in this session. An
`agent-config:reload` action follows and requires this one; do not treat the dependency as
available, and do not try to invoke it, until that reload action has run.

On failure, report which dependency could not be installed and what the component will be unable
to do without it. Do not attempt to hand-install the skill or agent's files yourself — install
failures are reported, not worked around.
