---
id: verify
type: prompt
parallel: false
---

Tell the user to run `/ml-voice:read`. It loads this config, says which voice it picked in its first
line, and the pane shows the error if synthesis fails: an unreachable Kokoro server, an
unresolvable credential reference (`op` not signed in, an env var unset) or the endpoint refusing
the request. Configured means the voice spoke, not that a file was written. On a failure, name the
reference or URL that failed and the fix, and leave the config as it is.
