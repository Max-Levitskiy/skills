---
id: onboard
type: prompt
parallel: false
---

orchestrate is missing the keys in `keys`: a tracker kind was chosen and what it needs is not set
yet. The same steps serve when nothing is missing and the user wants Phase 1's discoveries saved,
so the next orchestration skips them. Ask with `AskUserQuestion` where they can pick rather than
type, then write the answers with `agent-config write orchestrate --layer <layer>`. Describe the
keys first with `agent-config describe orchestrate`: it has each key's description and recommended
layer, and the answers already set.

Pass `--from <orchestrate-skill-dir>` to every `agent-config` call here: the folder holding
`agent-config.json`, which is the parent of this `actions/` folder.

1. **Where should work packages be tracked?** (`tracker.kind`) Look before asking and put the
   discovered option first: an existing `tasks.md` or `TODO.md` (`file`), a task folder with
   frontmatter task files such as Obsidian TaskNotes (`tasknotes`), or GitHub / Jira / Linear.
   If nothing exists, recommend `file` with a new `tasks.md` next to the work: no credential, no
   setup. Then the kind's own keys: `tracker.path`; `tracker.repo`; `tracker.site`,
   `tracker.project`, `tracker.email`; or `tracker.team`.
2. **Where does the credential live**, only for `github`, `jira`, `linear`. GitHub needs none
   when `gh auth status` already succeeds: offer that first (`tracker.githubAuth: "gh"`), and set
   `"token"` only when they want a token instead. Never accept a token as text and never write
   one into a config file: store a reference (`1password`, `env`, `dotenv`, `keychain` or
   `command`). For 1Password, `agent-config 1password items` lists items by name, never a value.
   If the source can prompt (1Password, Keychain), add `cacheVar` to the reference and give the
   user the one-line `export` that seeds it: orchestrate runs many short-lived processes, and
   without it each one resolves the secret again.
3. **Where do question docs collect, and who answers them**: `questions.path`,
   `questions.human`.
4. **Model tiering**: `models.judgment` and `models.mechanical`. Offer to skip; empty means every
   worker inherits the session model.

**Which layer**: the tracker and questions keys describe the project, so recommend repo, where
teammates share them. Credentials, `tracker.email` and model tiering follow the person: global.

`write` replaces the whole layer, so read it first (`describe` lists what each layer sets) and
write the merged whole.

Then run the `verify` action. Configured means the tracker answered, not that a file exists. If
verify fails on the credential, the config is fine but the secret is not reachable (`op` not signed
in, an env var unset): tell the user which reference failed and what to run, and leave the config
as it is. Missing config never stalls an orchestration: if the user is away, proceed on a
discovered `file` tracker and raise the choice as a question doc.
