---
id: agent-config:register-repo
type: prompt
parallel: false
---

This component uses the repo registry, the current repository is not in it, and the user has not
opted out of being asked. Ask the user now, and offer exactly these three options. Do not pick one
on the user's behalf.

**1. Register now.** Run `agent-config repos register`, optionally with `--alias <short-name>`.
Suggest an alias derived from the directory name if the user does not supply one. If the current
working directory is a worktree, `repos register` registers the repo root, not the worktree — this
is expected, do not try to register the worktree path instead.

**2. Don't ask again.** Write an explicit opt-out into this repository's user-repo layer, so the
question is never re-derived on a future `start`. Before writing, read the current user-repo layer
with `agent-config path <name> --layer user-repo` — `agent-config write` replaces the whole layer,
so you must merge the opt-out into whatever is already there, not overwrite it. Then run
`agent-config write <name> --layer user-repo` with the merged config on stdin, setting the key
`registry.register` to `false`.

**3. Ask later.** Write nothing. The question returns on the next `start`.

If the repository has no git origin, the registry has no natural identity to key it by, so
`repos register` mints one and writes it into `.agents/config/agent-config/config.json` at the
repo root. It does not commit for you — tell the user that the file needs committing for the
identity to hold for their teammates, and say so before they choose option 1. A user who does not
want that file in the repository should choose option 2 or option 3 instead.

Remember: the registry holds locations only, never settings — it exists purely so a component can
be run once and act on every repository set up for it (fan-out), and so a repository can be
targeted by name instead of by path. Do not conflate it with per-repo configuration.
