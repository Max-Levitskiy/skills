---
id: onboard
type: prompt
parallel: false
---

The Atlassian skill is missing the keys in `keys`. Ask the user for them, with `AskUserQuestion`
where they can pick rather than type, then write the answers with
`agent-config write atlassian --layer <layer>`. Describe the keys first with
`agent-config describe atlassian`: it has each key's description and recommended layer, and the
answers already set.

Pass `--from <atlassian-skill-dir>` to every `agent-config` call here: the folder holding
`agent-config.json`, which is the parent of this `actions/` folder. It finds the same declaration
that produced this plan, from an install or from a git checkout that is in no plugin registry,
and never another installed version's.

1. **`jira.baseUrl`** and **`jira.deployment`**: which instance, and is it Cloud or self-hosted.
   A `*.atlassian.net` host is `cloud`; anything else is `server` (Data Center or Server). Infer
   the deployment from the URL and confirm it only when the host doesn't say. On Cloud,
   Confluence is the same host under `/wiki`, so `confluence.baseUrl` stays empty; on Data Center
   it is a separate host, and the user sets it only if they use Confluence.
2. **`credentials.token`**: where the token lives. Cloud: an API token from id.atlassian.com →
   Security → API tokens. Data Center: a personal access token from Profile → Personal Access
   Tokens. Never accept the token itself as text and never write it into a config file: store a
   reference to it (`1password`, `env`, `dotenv`, `keychain` or `command`). For 1Password,
   `agent-config 1password items` lists items by name, never a value. On Data Center Jira and
   Confluence are separate applications with separate tokens: put Jira's in `credentials.token`
   and Confluence's in `credentials.confluenceToken`.
3. **`auth.email`** (Cloud only): the account email. A Cloud API token is sent as `email:token`.
4. **Which layer**: recommend global for all of these. They follow the person, not whichever
   project is open.

A layer adopted from the old `.agents/skill-config/atlassian/` path may hold
`credentials.jiraToken` and no `credentials.token`. Jira reads `jiraToken` ahead of `token`, so
ask whether Confluence uses the same token: if so, write the same reference as `credentials.token`;
if not, write Confluence's token there, or as `credentials.confluenceToken`.

Scopes, defaults, aliases and safety limits all have defaults, so they are not asked for here. Get
the credential working first, then propose scopes from what `jira projects` and
`confluence spaces` list, as the skill's Scopes section says.

`write` replaces the whole layer, so read it first (`describe` lists what each layer sets) and
write the merged whole.

Then run the `verify` action. Configured means an authenticated call succeeded, not that a file
exists. If verify fails on the credential, the config is fine but the secret is not reachable
(`op` not signed in, an env var unset): tell the user which reference failed and what to run, and
leave the config as it is.
