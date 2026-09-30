# Diagnose state, readiness or integrations

Use bounded, read-only probes on the exact target: version/status, agent get/list,
passive visible/detection reads, explain. Keep target and method/error code.
Client help/schema may differ from the running server. Update/restart/auth changes
are separate from diagnosis.

```bash
herdr status --json
herdr agent explain <pane-or-live-name> --json
herdr server agent-manifests --json
herdr integration status
herdr config check
```

Machine status performs fresh SSH checks; probe authorized profiles only.
Logs/config/pane output can contain sensitive data: return relevant redacted facts.

## Interpret detection

Get includes status, readiness/launch flags, revision, terminal identity and, on current
servers, state_change_seq/completion_seq. Completion identifies a work-related idle
transition, not proof of this task's outcome.
Explain reports active manifest/version/source, matching evidence/fallback and whether
full lifecycle authority superseded screen detection.
Known non-Codex agents can fall back to idle without a rule match; Codex falls back to
unknown. A composer/title/missing spinner is insufficient completion evidence.
Blocked requires recognized approval/question UI. Inspect artifacts/dialogs rather than
reporting invented state to make another pane look correct.

Detection reads the live bottom, unlike a manually scrolled viewport.
Tmux inside a Herdr pane can hide agents. Command-scoped HERDR_AGENT hints can identify
host-visible wrappers; hints only inside containers/VMs do not reach the host.
Restricted foreground detection has opt-in child-groups inference.
These are launch/config changes; investigate before applying them.
Local overrides win over remote/bundled manifests; update/reload changes server state.

## Integration roles

Status is inspection; install/uninstall modifies agent config.
Claude/Codex hooks report session identity for restore; their state remains screen-based.
Pi/OMP/Kimi/OpenCode/Kilo/MastraCode integrations also report lifecycle.
Others can support Herdr themselves by reporting state and resume argv.
Discover actual supported kinds from start help rather than freezing eight agents.

Custom support uses pane report-agent/report-agent-session/release-agent and metadata.
Semantic reported states are idle/working/blocked/unknown; done is derived.
Source ownership, sequence ordering, release on exit and resume argv validation matter.
Metadata labels/tokens are display only and do not change waits.
Use CLI for portable Unix/Windows behavior rather than assuming Unix socket transport.

## Readiness and failure

Managed start requires a shell prompt and detects the canonical executable.
Startup failure may leave an approval dialog or named pane; preserve identity and inspect
before another launch. PATH availability does not establish auth/model/integration readiness.

After stalled/timeout/transport failures, inspect status/passive output/current artifact.
Input may have been delivered. Report uncertainty and a bounded next action before retrying.
Connection/auth errors end that target's operation, not its permission boundaries.
Hook/integration stderr can be nonblocking; compare actual reply/artifact and native
readiness before calling the task failed. Report unrelated hook errors separately;
do not repair the user's agent config as an implicit part of a conversation.
For input duplication, cwd/IME/SSH/keybinding/update problems, use matching sections at
https://herdr.dev/docs/troubleshooting/. Authoring and install-specific detail:
https://herdr.dev/docs/integrations/ and https://herdr.dev/docs/add-herdr-support/.
