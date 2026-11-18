---
name: read
description: Read the latest assistant reply aloud, rewritten as speech. Invoke explicitly to hear a reply.
disable-model-invocation: true
---

# /ml-voice:read

On Claude Code the ml-voice mod answers this command itself, before this text is rendered: it opens
the read-aloud pane and starts reading, with no turn for the model.

In Claude Code, if this text was expanded, tell the user to run `/reload-plugins` or start a new
session to load the reader pane.

In Codex, use the reply the user picked, or the last completed assistant reply before this turn.
If it is unavailable, ask which text to read. Rewrite it as natural speech. Explain code and tables
in words and keep the decisions, results and actions. Pass the narration on stdin to
`bash <skill-dir>/../../scripts/speak.sh`. If using a quoted heredoc, choose a delimiter that does
not occur on any line of the narration. Use `--laptop` if the user chose laptop playback over SSH.
Keep the turn active until playback returns. The script uses `say` on macOS and `espeak-ng` on Linux.
If playback fails, report the error and use the `remote-audio` skill when the user wants laptop playback.
