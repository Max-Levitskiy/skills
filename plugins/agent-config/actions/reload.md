---
id: agent-config:reload
type: manual
parallel: false
---

A plugin that was just installed is not live in this session. The harness computes its plugin
PATH and loads skills and agents once, at session start; installing a plugin mid-session changes
files on disk but does not change what this running session can see or invoke.

No agent and no CLI can perform this reload. Do not attempt it, do not look for a command that
does it, and do not retry `agent-config start` to make it happen.

- On Claude Code: relay to the human, verbatim: "Run `/reload-plugins` to pick up the newly
  installed plugin." `/reload-plugins` is a built-in slash command. Only a human typing it into
  the session can dispatch it — the SlashCommand tool reaches only custom commands defined under
  `.claude/commands/`, not this built-in one.
- On Codex: relay to the human, verbatim: "Restart this session to pick up the newly installed
  plugin." The session must be restarted; there is no in-session reload command.

Check the `harness` field of the `agent-config start` output to know which of the two messages
applies, and relay only that one.

This action is terminal for the batch. Once you have relayed the message, stop. Do not attempt
any further actions from the `start` output in this turn, and do not re-run `agent-config start`
in this turn. The human will act on the message, and the next turn starts clean with a session
that has the plugin loaded.
