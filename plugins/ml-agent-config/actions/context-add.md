---
id: agent-config:context-add
type: prompt
parallel: false
---

The keys in `keys` belong to a project context: a set of answers shared by every repository of one
organisation or client, kept in `~/.agents/contexts/<name>/`. No context matches the place `start`
ran in, so there is nowhere yet to write them. The onboarding action that asks for these keys waits
on this one.

The `context` object carries a context pre-filled from this place:
- `suggestedName` — the remote's owner, or the folder's name when there is no remote
- `remote` — the first remote widened to its owner, for example `github.com/acme/**`, so every
  repository under that owner matches; absent when the place has no remote
- `path` — the checkout root, or the current directory outside git
- `alternative` — `global`, the layer to use instead when the user wants no context

Show the user the suggested name, the remote and the path, and ask for one of two things. Do not
pick on the user's behalf.

**1. Create the context.** Ask for its name, defaulting to `suggestedName`. Then run
`agent-config context add <name> --remote <remote> --path <path>`, leaving out `--remote` when
`context.remote` is absent. The remote filter goes in the context's team file, which can be shared
with the team; the path filter goes in the user's own `context.me.json`. Then continue onboarding
with `agent-config write <component> --layer context:<name>` for the team's answers, and
`--layer context:<name>:me` for credentials and keys the declaration marks `personal`. The team
file refuses those two kinds. `write` replaces the whole layer, so read the file first with
`agent-config path <component> --layer <layer>` and merge into what is there.

**2. Global instead.** Create nothing, and write the answers to `--layer global`, merged into the
current global layer in the same way. They then apply in every repository, not only this
owner's.

Either way, re-run `start` afterwards. A created context now matches here, so the plan names its
layer in the onboarding action's `context.layer`.
