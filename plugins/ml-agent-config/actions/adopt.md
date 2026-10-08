---
id: agent-config:adopt
type: code
parallel: false
---

This component has a v1 config at the pre-rename path, `.agents/skill-config/<name>/`, and the
matching `.agents/config/` layer has no file yet. v2 reads only `.agents/config/`, so those answers
are not in effect. `context.files` lists each file: its `layer`, where it is (`from`) and where it
goes (`to`).

Run `command`. It copies each file into its layer through `write`: checked for inline secrets,
stamped, journalled, and gitignored for the local layer. The old file stays where it is. Tell the
user, in one line per file, what was copied where, and that the old file can be deleted once they
are happy.

Then re-run `start`. The adopted answers now count, so onboarding asks only for what they did not
cover. If the component's schema has moved past version 1, `start` also emits an
`agent-config:migrate` action for the adopted layer: the answers predate versioned schemas, and
that action checks them against the current one with the user.

On failure the output's `failed` list names the file and the reason, most often an API key written
into the file itself. Do not edit the old file to get past it. Tell the user which file, and offer
to onboard that layer from scratch instead, with the secret moved to where it belongs and the file
holding only a reference to it.
