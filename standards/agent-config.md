# Agent Config Standard (ACS v2)

Since 2.1: the [Contexts](#contexts) section and the [trust rule](#trust) for credential references. Component identifiers come in a later revision.

How a skill or subagent stores per-user and per-project settings, and how it gets hold of secrets without ever committing one.

Status: **active**. Applies to any skill, subagent, command, or hook in this marketplace that needs configuration. Canonical implementation: [`plugins/ml-agent-config`](../plugins/ml-agent-config) and its `agent-config` CLI. Every component declares its keys in an `agent-config.json` and reads its config through that CLI, as [`working-actions.md`](../plugins/ml-agent-config/docs/working-actions.md) describes: [`fellow`](../plugins/ml-workplace/skills/fellow) and [`atlassian`](../plugins/ml-workplace/skills/atlassian) (credential-backed), [`orchestrate`](../plugins/ml-subagents/skills/orchestrate) (a credential only for some trackers), [`herdr`](../plugins/ml-subagents/skills/herdr) (no credential at all — presets only), and [`grill-with-ui`](../plugins/ml-grilling/skills/grill-with-ui) (optional remote-mode settings).

## Why this exists

A component that talks to an external service needs to know three kinds of things: *where the credential lives*, *which account/project to act on*, and *where output should go*. These have different lifetimes and different audiences. The credential is personal and secret. The project identity is usually shared by everyone working in the repo. Output paths are often a personal preference that shouldn't be forced on teammates.

Cramming all three into one file means either committing secrets or committing nothing. The layering below separates them so the shareable parts can be checked in and the personal parts stay out of git.

None of that is specific to skills. A subagent calling the same API needs the same three answers, so one format, one set of paths, and one loader serve skills, subagents, commands, and hooks alike. What a subagent must do *differently* is a matter of failure behaviour, covered [below](#what-is-different-for-a-subagent).

## Locations and precedence

Four fixed layers, and two more for each [context](#contexts) that applies here. Later layers override earlier ones.

| Layer | Path | Committed? | Holds |
| --- | --- | --- | --- |
| **global** | `~/.agents/config/<name>/config.json` | n/a (outside repo) | your defaults across every project |
| **context** (`context:<context>`) | `~/.agents/contexts/<context>/<name>/config.json` | n/a (outside repo) | what everyone working for one organisation sets, in every repository of it: a site, issue prefixes |
| **context me** (`context:<context>:me`) | `~/.agents/contexts/<context>/<name>/config.me.json` | n/a (outside repo) | your own answers in that context: your address, your credential references |
| **repo** | `<repo>/.agents/config/<name>/config.json` | **yes** | settings the whole team shares |
| **user-repo** | `~/.agents/config/<name>/user-repo/<repo identity>/config.json` | n/a (outside repo) | your settings for one repository, in every worktree of it |
| **local** | `<repo>/.agents/config/<name>/config.local.json` | **no — gitignored** | per-checkout overrides, personal paths |

`<repo>` is the git top level (`git rev-parse --show-toplevel`). The repo identity is the origin (`github.com/Owner/Name`), or an id minted by `agent-config repos register` for a repository with none. Outside a git repo the repo, user-repo and local layers do not exist: the global layer applies, with any context whose path filter matches. A component must still work with only the global layer, since plenty of useful work happens in a scratch directory.

`<name>` names one tool — the skill name, or the name a skill and its subagent share. One namespace, deliberately: a skill and its subagent are the same tool wearing two hats, and they should read the same file. Forcing two configs would make the user answer the same questions twice and then keep both copies in sync by hand. Pick one name per tool and use it from every component that serves that tool. A plugin holding several tools uses several names (`ml-workplace` reads both `fellow` and `atlassian`), and a name never changes when its plugin is renamed or regrouped. Names are directory names, so different tools never collide.

### Merge semantics

Deep merge, in layer order: `global → context (outermost first, nested inside) → repo → user-repo → local`; within one context the team file merges before `me`. Then:

- Objects merge key by key.
- Scalars and **arrays replace wholesale**. Arrays are configuration values, not accumulators; a user overriding `["a","b"]` with `["c"]` means `["c"]`, and any other rule makes it impossible to remove an inherited entry.
- An explicit `null` **deletes** an inherited key. This is the only way to unset something a lower layer set.

### Why `.agents/` and not `.claude/`

`.agents/` is tool-neutral. The same config should serve whatever agent runtime the user runs next year without a migration. It also keeps component config visibly separate from `.claude/`, which holds Claude Code's own machinery — mixing user data into a tool's config directory makes both harder to reason about.

## Contexts

*Since 2.1.*

A context is a named group of places: every repository of one organisation, wherever it is cloned, and the folders that hold its work. What that organisation shares across its repositories (a tracker site, issue prefixes) is written once into its context, instead of once per repository or into repositories that belong to someone else. A context applies wherever one of its filters matches, and adds its two layers between `global` and `repo`.

### The files

Contexts are defined once, for every component, under `~/.agents/contexts/`:

```
~/.agents/contexts/order.json                         optional: the order of unrelated contexts
~/.agents/contexts/<context>/context.json             the definition: id, parent, remote filters
~/.agents/contexts/<context>/context.me.json          your path filters, for this machine only
~/.agents/contexts/<context>/<name>/config.json       team values for component <name>
~/.agents/contexts/<context>/<name>/config.me.json    your own values for <name>
```

The directory name is the context's name: one path segment, with no colon or backslash. The team file, `~/.agents/contexts/acme-web/context.json`:

```json
{ "schemaVersion": 1, "id": "ctx_9ab7bfbfa3da", "parent": "acme",
  "match": [ { "remote": "github.com/acme/web-*" } ] }
```

and the me file beside it, `context.me.json`:

```json
{ "match": [ { "path": "~/git/acme/web/" } ] }
```

### Team files and me files

A context is split in two because a remote is the same on every machine and a path is not: a colleague may keep the same organisation's work under `~/work/acme`.

- `context.json` is the team file. It carries `schemaVersion`, an `id`, an optional `parent`, and `match` entries with `remote` only. A `path` entry in it is ignored and reported as `context-stray-path`, so a path from one machine never applies on another.
- `context.me.json` is yours. Its `match` entries carry `path` only, and a `remote` entry in it is ignored and reported the same way.
- A component's values split the same way. `<name>/config.json` holds what a colleague would also set. `<name>/config.me.json` holds what is yours: your address, your credential references, any key the declaration marks `personal: true`. `agent-config write` refuses a credential reference or a `personal` key in the team file. The `me` file merges after the team file.

The team files are the ones to share with colleagues. The `me` files never are.

### Matching

A context matches when any entry in either of its files matches the current place: `match` entries are OR-ed.

- A `remote` entry is tested against every configured remote URL of the checkout and of each enclosing git superproject, normalised to `host/path`: scheme, `git@`, user, port and `.git` stripped, host lower-cased, path case kept. Any remote counts, so a fork whose `upstream` points at the organisation is in its context.
- A `path` entry is tested against the checkout root, the main worktree root and the cwd, each with `/` appended, in both symlinked and real form. A linked worktree kept elsewhere still matches through its main root, and a path match needs no git repository at all.

The glob rules are git's:

- `*` does not cross `/`, `**` does; `**/` is prepended unless the pattern starts with `~/`, `./` or `/`; a trailing `/` means `/**`; `~` expands; case-sensitive, `/i` suffix on the field name (`path/i`, `remote/i`) for insensitive.
- The `**/` prefix, the trailing `/` and `~` apply to `path` patterns only. A `remote` pattern gets none of them, and must match the whole normalised remote.
- `?` is one character other than `/`, and `[…]` is a character class, `[!…]` its negation.
- A `./` pattern is kept literal. Every place is tested as an absolute path, so a `./` pattern never matches; start a path with `~/` or `/`, or with neither to match at any depth.

So `gitlab.example.com/acme/*` matches `gitlab.example.com/acme/web` but not `gitlab.example.com/acme/platform/web`: an organisation with subgroups needs `gitlab.example.com/acme/**`. And `~/git/acme/` matches the directory `~/git/acme` itself and everything under it.

### Order

The layer order is `global → context (outermost first, nested inside) → repo → user-repo → local`; within one context the team file merges before `me`. The contexts in it, the chain, are ordered so:

- `parent` names another context. A child applies after its parent, and inherits nothing except through that order. A child need not repeat its parent's filters: when it matches, its whole parent chain applies before it, even where the parents' own filters would not match.
- Contexts with no parent come first in the order `order.json` lists them, a JSON array of context names; those it does not list follow alphabetically. With no `order.json`, all of them are alphabetical. Each is followed by its children in the chain, a parent always before its children, siblings alphabetically. A context applies once.
- The **innermost** context is the last in the chain. Onboarding writes to it.
- When two contexts in the chain, neither an ancestor of the other, both set a declared key, `start`, `load` and `describe` report `sibling-contexts`. The value still follows the order, but the shadowing is never silent. The expected case is a chain, not siblings.

An **abstract** context has no usable filter in either file. It never matches on its own: it exists to be a `parent`, or to be named with `--context`.

### On the command line

Every command that reads config takes three flags:

- `--cwd <dir>` resolves for that directory instead of the current one. A skill that starts a subagent elsewhere passes it, so it sees the chain the subagent's `load` will. A `--cwd` that is not a directory is refused.
- `--context <name>` applies that context and its parent chain, matched or not. A context not yet in the chain is appended after the matched ones, so it becomes the innermost and the write target. One already in the chain keeps its place, and the innermost is unchanged: in an `acme-web` clone, `--context acme` leaves the chain `acme, acme-web`, because a parent always precedes its child.
- `--no-context` applies no matched context. It cannot be combined with `--context`.

The contexts themselves have three commands:

- `agent-config context list` — every context with its id, parent and filters, whether it applies here (`matched`), and the problems found in `~/.agents/contexts/`.
- `agent-config context explain` — the place (the cwd, and the paths and remotes tested), the chain with why each context is in it (`via`: `remote` or `path` with the `entry` that matched, `parent`, or `explicit` for `--context`), and the layer order it makes.
- `agent-config context add <name> [--parent <p>] [--remote <glob>]... [--path <glob>]...` — creates a context: a fresh `id`, the parent and the remote filters in `context.json`, the path filters in `context.me.json`. It is refused when the name is invalid or taken, or the parent is not a readable context.

Values are written with `agent-config write <name> --layer context:<context>` for the team file and `--layer context:<context>:me` for yours. The context must exist.

### When a definition is wrong

- An unknown `parent`, a `parent` cycle, `order.json` naming an unknown context and `--context` naming none are config errors: every command that resolves the chain exits 2, naming it. Dropping it silently would change which file a key is written to.
- An unparsable `context.json` leaves its context out and is reported as `context-unparsable`. It exits 2 only when something names that context: a `parent`, `order.json`, `--context` or `write --layer`. An unparsable `context.me.json` keeps its context without the path filters, and an unparsable `order.json` leaves the order alphabetical; both are reported the same way, as is a directory whose name is not a valid context name.
- A directory under `~/.agents/contexts/` with no `context.json` is not a context, and is reported as `context-stray-dir`.
- Every write goes to a temporary file that is then renamed into place, so a `load` running beside it never reads half a file.

### Worked example

Every repository of the `acme` organisation uses one tracker site. Its web repositories use their own issue prefix.

```bash
agent-config context add acme --remote 'github.com/acme/**' --path '~/git/acme/'
agent-config context add acme-web --parent acme --remote 'github.com/acme/web-*'
```

`acme` now matches every repository under `github.com/acme/`, wherever it is cloned, and every folder under `~/git/acme/`, git or not. `acme-web` matches `web-app` and `web-site`, and brings `acme` with it. In a clone of `github.com/acme/web-app` at `~/git/acme/web-app`:

```
$ agent-config context explain
{ "acs": 2,
  "place": { "cwd": "/home/you/git/acme/web-app",
             "paths": ["/home/you/git/acme/web-app/"],
             "remotes": ["github.com/acme/web-app"] },
  "chain": [ { "name": "acme", "via": "remote", "entry": { "remote": "github.com/acme/**" } },
             { "name": "acme-web", "via": "remote", "entry": { "remote": "github.com/acme/web-*" } } ],
  "layers": ["global", "context:acme", "context:acme:me", "context:acme-web", "context:acme-web:me",
             "repo", "user-repo", "local"] }
```

A `tracker` component has `site` and `prefixes` written to `--layer context:acme`, a different `prefixes` to `--layer context:acme-web`, and the person's `email` to `--layer context:acme:me`. `agent-config load tracker` there takes the inner `prefixes`, and its provenance says where each value came from:

```
"provenance": { "site": "context:acme", "prefixes": "context:acme-web", "email": "context:acme:me" }
```

## File format

Plain JSON, UTF-8. No comments — every parser handles plain JSON, and a config a component can't read is worse than one that's slightly less pleasant to hand-edit.

Two reserved top-level keys; everything else is the component's own namespace.

```json
{
  "schemaVersion": 1,
  "credentials": {
    "apiKey": { "source": "1password", "ref": "op://Vault/Item/field" }
  }
}
```

- `schemaVersion` — the version of the component's declared schema the answers were written against. `agent-config write` stamps it, and saves a snapshot of that schema beside the file, so a later schema change can be migrated instead of misread.
- `credentials` — map of logical name → credential reference (below).

## Credential references

**A config file never contains a secret.** It contains a *reference* describing where to fetch one. The repo layer is committed, so a component that inlines tokens will eventually leak one; making references the only supported form removes the foot-gun rather than warning about it.

Every reference is an object with a `source` discriminator.

### `1password`
```json
{ "source": "1password", "ref": "op://Vault/Item/field", "account": "OPTIONAL_ACCOUNT_ID" }
```
Resolves via `op read <ref>`, adding `--account` when present. Requires the `op` CLI, signed in. `account` matters when the user has both a personal and a work account — without it `op` may resolve against the wrong one.

### `env`
```json
{ "source": "env", "var": "MY_API_KEY" }
```
Reads the environment variable. The right choice in CI.

### `dotenv`
```json
{ "source": "dotenv", "path": ".env.local", "var": "MY_API_KEY" }
```
Reads `var` from a `KEY=value` file. Relative paths resolve from the repo root. The file must be gitignored — the loader should check and refuse if it isn't, since the whole point is defeated otherwise.

### `keychain`
```json
{ "source": "keychain", "service": "my-service", "account": "me@example.com" }
```
macOS Keychain via `security find-generic-password -s <service> -a <account> -w`.

### `command`
```json
{ "source": "command", "command": "vault kv get -field=token secret/my-app" }
```
Runs a shell command; stdout minus trailing newline is the secret. The escape hatch for password managers not covered above (Bitwarden, pass, LastPass, Doppler, AWS Secrets Manager). Powerful, so a component should surface the command to the user during onboarding rather than accepting it silently from a config it just read.

### `cacheVar` — one prompt per session

Any reference, whatever its `source`, may carry an optional `cacheVar`:
```json
{ "source": "1password", "ref": "op://Vault/Item/field", "cacheVar": "MY_API_KEY" }
```
When that environment variable holds a non-empty value, the resolver returns it and never touches `source`. Empty or whitespace-only means unseeded, so a stray `export MY_API_KEY=` falls through to the real source instead of resolving to an empty secret.

This exists because a CLI is a new process every invocation, so a `1password` reference means `op read` — and a Touch ID prompt — on every single call. The operator seeds the variable once per shell session:

```bash
export MY_API_KEY="$(op read 'op://Vault/Item/field')"
```

One prompt for the session, none after it, and nothing downstream changes. It is opt-in per reference and useful beyond 1Password: `keychain` and `command` can prompt or be slow too.

Name it whatever a plain `env` source would use for the same secret. Then moving between the two is a `source` edit, not a rename, and the variable a user already exports for CI works as a cache here.

Two different references can name one `cacheVar`: your own organisation's token in global, another's in a context, both `JIRA_TOKEN`. The variable may then hold either one's secret, so `load` ignores it for both, resolves the reference from its source, and reports `cachevar-shared` naming both.

### Trust

*Since 2.1.* A reference makes `load` run a command or read a variable or a file, so it is honoured only from a layer you wrote on this machine: `global`, `user-repo`, a context's `me` file, and `local` when it is your own. `local` is trusted only when its real path is inside the real checkout and `git ls-files --error-unmatch` exits 1, which is git saying it does not track the file. Any doubt makes it untrusted: a symlink between the checkout and the file, git missing or failing, any other exit. `repo` and a context's team file never carry an honoured credential reference. A tracked `config.local.json` arrived with the checkout, so it is untrusted like the repo layer.

From an untrusted file the whole `credentials` subtree is dropped before the merge, and `start`, `load` and `describe` report `untrusted-layer-key` naming the file and the keys it set. `adopt` strips the credential references from a v1 local file that git tracks or cannot vouch for, and reports them the same way. A cloned repository, or a context file a colleague shared, can therefore never point a credential at a command of its own.

### Resolution rules

- Resolve **lazily** — only when a call actually needs the secret. Listing config shouldn't shell out to a password manager and trigger a Touch ID prompt.
- Honour **`cacheVar`** before consulting `source`, so repeated invocations cost one prompt per shell session rather than one per process. Cache only in the environment: an env var dies with the shell, which is the property that makes it safe to hold a secret in. **Never write a resolved secret to disk** — no cache file, no TTL directory under `~/.cache`, no temp file. And never add a helper that prints the secret so the user can export it; the reference is already visible in `agent-config describe`, which is enough to write the `export` line by hand.
- **Never print, log, or echo a resolved secret**, and never pass it as a command-line argument (argv is world-readable via `ps`). Pass it through the environment or stdin.
- On failure, report *which* reference failed and how to fix it — `op read op://Vault/Item/field failed: not signed in — run 'op signin'` — never dump the raw error and leave the user guessing.

## The onboarding contract

Config will be missing the first time, and that moment decides whether the tool feels finished or broken. A conforming skill or command must:

1. **Detect** missing or incomplete config before doing any work, and treat it as an expected state rather than an error. `agent-config start <name>` does this: `ready: false` with an action list is a plan, not a failure.
2. **Ask**, don't assume. Walk the user through the questions that actually matter — where their credential lives, which account/workspace to use, what output to keep and where.
3. **Offer the layer with a reason.** Most users don't know whether a setting belongs in global or repo. Recommend one and say why: identity and credentials usually global, what one organisation shares across its repositories its context, project identity repo, personal paths local.
4. **Write the layer with `agent-config write`** and tell the user the exact path. Never with a file-writing tool: `write` refuses an inlined secret and a value the declared schema refuses, stamps the schema version, journals the previous contents, and gitignores the local layer. Doing that at write time is the only reliable moment; asking the user to remember is how secrets get committed.
5. **Verify before declaring success** — the component's `verify` action resolves the credential and makes one real call. "Configured" should mean "working", not "file written".

Onboarding should be re-runnable so users can change their minds without hand-editing JSON.

## What is different for a subagent

A subagent reads config exactly as above — same paths, same merge, same references. What changes is what it does when something is missing, and it changes because a subagent starts with no conversation context and often runs unattended: there may be no human watching its transcript to answer anything.

**Never onboard interactively.** A subagent that finds missing or incomplete config reports which keys are missing and the exact path they belong in, then stops. It does not ask, does not guess a value, and does not write a config file. Onboarding belongs to the invoking skill or to the human, who can actually answer the questions. A subagent that opens an interview either hangs until it is killed or invents settings the user never chose — and because the namespace is shared, those invented settings would then be picked up by the skill too.

**Treat credential failure as data.** A credential reference can require a human: Touch ID for the keychain, `op signin` for 1Password, an unlocked vault for a `command` source. A subagent cannot assume any of those prompts get answered, so it must not block on one indefinitely. On failure or timeout it returns the failing logical name, the source, and the fix as part of its result, and exits non-zero. A hang is the worst outcome available — the caller learns nothing and waits forever, whereas a reported failure lets the caller ask the human once and retry.

`agent-config load` makes both structural: it never returns an action list, exits 2 naming the missing keys, and exits 3 naming the unresolvable reference and its fix. A subagent whose whole config surface is `load` has nothing to onboard with. Nor does it create a context: a key that recommends one, where none matches, is a missing key like any other.

A skill that starts a subagent in another directory runs `agent-config start <name> --cwd <that directory>` first. It then works the plan for the contexts the subagent's `load` will resolve, not for its own.

Both rules are testable the same way: run the subagent with no config file, and again with a deliberately broken credential reference. It must terminate promptly in both cases, naming what is missing, and must never emit a question.

## Component-specific keys

Beyond `schemaVersion` and `credentials`, the component owns its namespace. Because `<name>` is shared, so are the keys — name them for the tool, not for whichever component happens to read them first. Two conventions worth following because they recur:

**Storage paths** — when a component writes artifacts, let the user say where and whether at all:

```json
"storage": {
  "recaps": { "enabled": true, "path": "docs/meetings" },
  "transcripts": { "enabled": true, "path": ".agents/fellow/transcripts" },
  "media": { "enabled": false, "path": "~/Media/fellow" }
}
```

Relative paths resolve from the repo root; `~` expands to home. Supporting both matters — a repo-relative path means artifacts get committed alongside the work, and an absolute one means they stay off the project entirely. Users want different things for transcripts (bulky, often private) than for recaps (the actual deliverable).

**Defaults** — a `defaults` object for tunables like page size or lookback window, so the user can change behaviour without passing flags every time.

**Say what a key holds.** A key holding more than text — a number, a fixed set of values, an object, a map of named entries — declares it as JSON Schema in its key entry (`type`, `enum`, `properties`, `additionalProperties`, `items`; shared shapes in `schema.$defs`). `write` then refuses a value no consumer could read, and the `/agent-config` pane draws a field for each part instead of a line of JSON. The keywords are listed in `plugins/ml-agent-config/docs/working-actions.md`, under "What a key holds".

## Declaring and reading config

There is no importable library. The `agent-config` CLI in [`plugins/ml-agent-config`](../plugins/ml-agent-config) is the only interface, which is what stops a credential resolver spreading by copy the way v1's vendored one did. A component:

1. **Declares its keys** in `agent-config.json` — at the plugin root for a one-tool plugin, in `skills/<skill>/` for a plugin holding several. Each key has a description, a recommended layer, a default when it has one (a key with none is required), and JSON Schema for what it holds. A key's layer may be `context`, which recommends whichever context applies, and a key that is the person's own answer (an address) says `personal: true`, so a context's team file refuses it. Keys that only matter in some setups go in a `groups` entry with a `when` condition. The format is [`agent-config.schema.json`](../plugins/ml-agent-config/agent-config.schema.json).
2. **Ships its actions** beside the declaration, in `actions/`: `onboard.md` (the questions, written for the agent) when any key is required, and `verify.md` (one real call).
3. **Starts its skill with the five lines** from [`working-actions.md`](../plugins/ml-agent-config/docs/working-actions.md) — find the binary, `agent-config start <name>`, branch on `ready`.
4. **Reads config in its scripts with `agent-config load <name> --from <skill dir>`**: config on stdout, requested secrets as one JSON object on fd 3, never on stdout, argv or disk. It writes with `agent-config write`, reading the layer first, since `write` replaces it.
5. **Depends on `ml-agent-config`** in its `plugin.json`, so installing the component installs the CLI.

Worked example: fellow — [`agent-config.json`](../plugins/ml-workplace/skills/fellow/agent-config.json), [`actions/`](../plugins/ml-workplace/skills/fellow/actions), and [`scripts/lib/config.ts`](../plugins/ml-workplace/skills/fellow/scripts/lib/config.ts), which spawns the CLI and types what it answers.

## Documenting it

Ship a `config.example.json` next to the component showing every supported key with realistic values — once per `<name>`, not once per component sharing it. It doubles as documentation and as something the user can copy and edit. Never ship a populated `config.json` — a real config appearing on install is indistinguishable from one the user wrote, and they'll act on settings they never chose.

## Migrating from SCS v1

The previous standard, Skill Config Standard v1, used `.agents/skill-config/<skill>/`. v2 does not read those files. When a v1 file's layer has no `.agents/config/` file yet, `agent-config start` emits an `agent-config:adopt` action ahead of onboarding, which copies it over through `write` (`agent-config adopt <name>`) and leaves the old file in place. When both exist, only the new one is read and `start` reports the old one as a `legacy-config-path` problem. Write and document only `.agents/config/`.

## Checklist

- [ ] Declares every key it reads in `agent-config.json`, with a description, layer, default where there is one, and JSON Schema for anything more than text
- [ ] Reads config only through `agent-config load`, and writes only through `agent-config write`
- [ ] Works with only the global layer (outside a git repo, and where no context applies)
- [ ] A credential reference is written only to a trusted layer
- [ ] A `path` filter is never in the team file
- [ ] A plugin's skill and subagent load the same `<name>`
- [ ] No secret is ever written to a config file
- [ ] Secrets arrive on fd 3 of `load`, and never reach argv, logs, stdout, or disk
- [ ] Missing config triggers onboarding in a skill (`start` → `onboard` action) — and in a subagent, `load`'s report naming the missing keys, never a question
- [ ] A subagent with an unresolvable credential exits non-zero naming the reference, rather than blocking on a prompt
- [ ] A `verify` action makes one real call
- [ ] `plugin.json` depends on `ml-agent-config`
- [ ] `config.example.json` documents every key
