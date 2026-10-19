---
name: read
description: Read Claude's latest reply aloud in a pane, rewritten as talk; pick earlier replies from the pane. Typed by the person, never invoked by the model.
disable-model-invocation: true
---

# /ml-voice:read

On Claude Code the ml-voice mod answers this command itself, before this text is rendered: it opens
the read-aloud pane and starts reading, with no turn for the model.

You are reading this, so the mod did not answer. Tell the user, in one or two lines, that
`/ml-voice:read` needs the ml-voice plugin's hooks module loaded in Claude Code (its pane, voice
and playback live there), that it does not run under other harnesses, and that `/reload-plugins`
or a new session loads it after an install. Do nothing else.
