---
name: agent-config
added: 2026-10-15
files: [server.mjs, SKILL.md, README.md, agent-config.json]
---

## Modification

Whether the agent runs on a remote machine is a per-machine setting in agent-config, not
environment variables: agent-config is flexible enough to cover every way of configuring it,
so `GRILL_HOST` and `GRILL_OPEN` from modification 01 go away. Declare `remote.enabled`
(default false, global layer) and, when it is on, `remote.host` and `remote.open`, with the
meanings 01 gave the variables. `serve` reads the config itself, so the skill text carries no
mode-specific instructions and the agent spends no context on it. A machine with no config,
or without agent-config installed, behaves exactly as upstream and asks nothing.

## Applied

- `agent-config.json` (new): declaration `grill-with-ui`, key `remote.enabled` (boolean,
  default false, global) and a group active when it is true with `remote.host` (default
  `tailscale`) and `remote.open` (default empty). Every key has a default, so `start` is
  always ready and never onboards.
- `server.mjs`: `remoteConfig()` runs `agent-config load grill-with-ui --from <skill dir>` once
  per `serve`, finding the binary by working-actions.md's chain (`AGENT_CONFIG_ROOT`, `PATH`,
  the Claude and Codex plugin caches); a missing binary or `remote.enabled` false gives `{}`, a
  failed load warns on stderr and serves locally. `bindHost()` takes `remote.host` (else
  `127.0.0.1`) and `openUrl()` runs `remote.open`; neither reads the environment.
  `openUrl()` returns whether it started an opener; the ready line and `server.json` carry
  `"opened": true` when it did. The header comment and the error messages name the keys.
- `SKILL.md`: Start step 5 keys "opened" off `"opened": true` in the ready line or
  `server.json` instead of `GRILL_OPEN`.
- `README.md`: "Running the agent on a remote machine" documents the agent-config keys in
  place of the variables, and says to run the tests with `HOME` at an empty folder on a
  machine with `remote.enabled`.

Run upstream's tests with `HOME` at an empty folder (`HOME=$(mktemp -d)`) on a machine whose
global layer enables remote: agent-config reads that layer from the home folder.
