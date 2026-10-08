---
id: onboard
type: prompt
parallel: false
---

Fellow is missing the keys in `keys`. Ask the user for them, with `AskUserQuestion` where they can
pick rather than type, then write the answers with `agent-config write fellow --layer <layer>`.
Describe the keys first with `agent-config describe fellow`: it has each key's description and
recommended layer, and the answers already set.

Pass `--from <fellow-skill-dir>` to every `agent-config` call here: the folder holding
`agent-config.json`, which is the parent of this `actions/` folder. It finds the same declaration
that produced this plan, from an install or from a git checkout that is in no plugin registry,
and never another installed version's.

1. **`credentials.apiKey`**: where the Fellow API key lives. They generate one in Fellow under User
   Settings → Developer API (paid workspaces only; an admin must have enabled the API in Workspace
   Security Settings). Never accept the key itself as text and never write it into a config file:
   store a reference to it (`1password`, `env`, `dotenv`, `keychain` or `command`). For 1Password,
   `agent-config 1password items` lists items by name, never a value.
2. **`workspace.subdomain`**: the API is workspace-scoped, `https://{subdomain}.fellow.app/api/v1`.
   The subdomain is in the URL when they use Fellow in a browser.
3. **Which layer**: recommend global for both. They follow the person, not whichever project is
   open.
4. **Storage** has defaults, so it is not asked for unless the user wants recaps or transcripts
   somewhere else. Transcripts are bulky and often sensitive: an absolute path outside the repo is
   the safe choice.

`write` replaces the whole layer, so read it first (`describe` lists what each layer sets) and
write the merged whole.

Then run the `verify` action. Configured means the `/me` call succeeded, not that a file exists.
If verify fails on the credential, the config is fine but the secret is not reachable (`op` not
signed in, an env var unset): tell the user which reference failed and what to run, and leave the
config as it is.
