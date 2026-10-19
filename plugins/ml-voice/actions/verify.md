---
id: verify
type: prompt
parallel: false
---

Check the voice can be reached, then have the user hear it. Pass `--from <mod dir>` (the parent of
this `actions/` folder) to every `agent-config` call.

1. **The credential** (fish-audio or openrouter): resolve it without showing it, with
   `agent-config load voice-reader --from <mod dir> --secrets credentials.<key> 3>/dev/null`
   (`openrouterKey` or `fishAudioKey`). Exit 0 means it resolved; the secret went to fd 3 and was
   discarded. Exit 3 names the reference that failed and the fix (`op signin`, an unset variable).
2. **The server** (kokoro or self-hosted): `curl -s -m2 -o /dev/null -w '%{http_code}' <url>`
   answers with any HTTP code once the server is listening.
3. Tell the user to run `/ml-voice:read`. Its first line names the voice it picked, and the pane
   shows the error if synthesis fails. Configured means the voice spoke, not that a file was
   written.

On a failure, name the reference or URL that failed and the fix, and leave the config as it is.
