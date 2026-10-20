# ACS v3: contexts, a shared layer, and component identifiers

**Date:** 2026-10-20
**Status:** Approved in conversation, not yet implemented
**Scope:** `standards/agent-config.md` (v2 → v3), the `agent-config` CLI in
`plugins/ml-agent-config`, two new provider components (`identity`, `project`), and the
migration of **every component in this repo** that declares config (`atlassian`, `fellow`,
`herdr`, `orchestrate`, `grill-with-ui`, `size`, agent-config itself) onto ids, `uses` and
contexts, including `atlassian`'s `scopes`. Components outside this repo (the user's
`timesheet` skill) are not in this build; they migrate on their own schedule against the
released standard.

## Problem

Three things the v2 standard cannot express, all hit in the same week:

1. **A setting that belongs to a group of repositories.** A consultant working for a client
   keeps that client's repositories under one directory (`~/git/acme`, a dozen or more
   repos, spread over the client's GitLab and GitHub organisations). Every one of them
   needs the client's Jira site and the email the client issued, while the global layer must
   stay on the user's own organisation. v2 offers only global (one value for every repo) or
   user-repo (one file per repo, typed a dozen times, and again for every new repo). Users
   end up keeping a hand-rolled version of this layer in a directory-level `.envrc`
   (`KUBECONFIG`, `VAULT_ADDR`, …), outside any standard.
2. **A setting owned by no single component.** The email above is read by `atlassian`, a
   time-tracking skill and `fellow`; the Jira site and issue-key prefixes by `atlassian`,
   time tracking and a future agile skill; a project's *hub* (an aggregator repo per product
   where `fellow` files meetings and an agile skill would keep epics) by every skill that
   writes project-level artefacts. Today each component declares its own copy of the key, so
   the user answers the same question per plugin and the copies drift.
3. **No way for one component to depend on another's keys.** There is no identifier a
   declaration can point at, so "atlassian reads the email that identity provides" cannot be
   written down, let alone resolved or installed.

The `atlassian` skill's `scopes` (named streams bound to Jira projects and a Confluence
space) are a component-local answer to 1 and 2. They work for one skill and are invisible to
every other.

## Goals

- A **context**: a named group of places (paths and/or git remotes, with wildcards) carrying
  settings for any component, nestable (`acme` → `acme-web`), defined once and reused by
  every component.
- A **shared layer**: keys provided by one component and read by others, asked once at
  onboarding and delivered with `load`.
- A **global identifier** for a component and a **dependency declaration** between
  components, with a `replace` to swap a provider.
- **Auto-install** of a missing provider, behind a confirmation.
- Files stay the source of truth, laid out so that a future cloud sync can deliver a team's
  shared contexts to a colleague's machine without carrying anything personal.

## Non-goals

- The cloud sync itself. Only the file split that makes it possible.
- Describing a hub's internal layout. The standard carries a hub's URL and local path; what a
  skill does inside it is that skill's business.
- Changing the credential-reference model, `write`'s safety checks, or the subagent rules.
  They apply unchanged inside contexts.
- Replacing Claude Code's `name@marketplace` or the agent-plugins.org manifest. Both stay
  valid; ACS data rides in their extension slots.

## Anti-goals

- A context that silently applies in the wrong place. Every `load` can say which contexts
  matched and why (`agent-config context --explain`), and the `/agent-config` pane shows the
  chain.
- A shared key that two providers define differently. Resolution fails loudly on a schema
  mismatch rather than picking one.
- A secret, or a per-machine path, landing in a team-shared file.

## Prior art, and what was taken from it

Researched 2026-10-19 (see conversation; agent-plugins.org, Agent Skills, Claude Code
plugins, Codex, Gemini, MCP, devcontainer features, git, purl, VS Code). No existing
standard covers conditional layers for arbitrary settings, a shared cross-plugin layer, or
provides/uses between plugins. Adopted:

| From | Taken |
| --- | --- |
| git `includeIf` | filter conditions and glob rules; last match wins; nesting; a matched file may not redefine what matched it |
| Claude Code `dependencies` | the shape of a dependency entry and semver ranges |
| devcontainer features | the split between a hard dependency and an ordering-only one |
| Go modules | `replace` at the consumer, never in the provider's manifest; a module path is a host + path without a scheme |
| agent-plugins.org / Agent Skills | ACS data goes under `extensions` / `metadata`, so manifests stay valid |

Rejected: purl (`pkg:github/...` vs `pkg:generic/...` splits by host; a URI does not).

## Design

### 1. Component identifiers

A component's canonical identifier is a URI without a scheme, in the Go module style:

```
<host>/<path-to-repo>#<component>
github.com/max-levitskiy/skills#identity
gitlab.example.com/acme/tools#timesheet
```

- `<component>` after `#` is the ACS `<name>` of the tool (the same name the config
  directory uses). One repo may publish several.
- The version is **never** part of the identifier. It is a separate field wherever a version
  is needed, because `@` already means "marketplace" in Claude Code.
- A component declares its identifier in `agent-config.json` as `id`. It is declared, not
  derived from the install path, so a plugin cached from any marketplace keeps the same
  identity.
- In a `plugin.json`, the identifier is repeated under
  `extensions["org.agents.config"].id` (namespace is the builder's call, see below); in a
  skill's `SKILL.md`, under `metadata.agent-config-id`. Claude Code keeps using
  `name@marketplace`; the CLI maps a URI to the marketplace entry when it installs.
- A component also declares `version`, a semver of its **provided contract**: bumped when a
  provided key is added, removed or changes shape. It is independent of the plugin's own
  version (two components in one plugin may differ) and of `schema.version` (the shape of the
  answer files). `uses.version` ranges are checked against it. *(Author's call.)*
- **Finding a provider.** The CLI keeps an index at `~/.agents/registry.json`: id →
  install dir, declared `version`, and for a harness-installed plugin its `name@marketplace`.
  It is rebuilt lazily by scanning the harness's plugin directories (the places
  `harness.ts` already knows) and `~/.agents/plugins`, and invalidated by those directories'
  mtimes **and** each manifest file's mtime (an in-place edit of `agent-config.json` changes
  only the latter), so `load` stays a file read. `agent-config registry rebuild` forces it.
  Today's dependency scan in `actions.ts` moves onto the same index. A `--from <dir>`
  also scans that directory's repository root for declarations, and the ids found there
  shadow the registry: a provider in the same uninstalled checkout as its consumer is found,
  which is what dogfooding and every test need. *(Author's call.)*

### 2. Provides and uses

`agent-config.json` gains two fields:

```json
{
  "id": "github.com/max-levitskiy/skills#atlassian",
  "provides": { "jira.site": { "...": "JSON Schema key entry as today" } },
  "uses": [
    { "id": "github.com/max-levitskiy/skills#identity", "version": "^1", "keys": ["email"] },
    { "id": "github.com/max-levitskiy/skills#project", "version": "^1", "keys": ["hub", "jira.prefixes"], "optional": true }
  ]
}
```

- `provides` is the existing `schema.keys` renamed in spirit: every key a component declares
  is readable by a dependant that names it. No separate "public" flag; a key is shared by
  being declared, and a component keeps private state out of its config.
- `uses` is the dependency list. `keys` names what is read. `optional: true` means a missing
  provider is reported, not installed, and `load` runs without those keys; it covers the
  keys too: a present provider with the keys unset leaves them out of `load`, and `start`
  still offers that provider's onboard. Without it the dependency is hard (devcontainer's
  `dependsOn`); an `after` list (ordering only, `installsAfter`) exists for onboarding order
  and nothing else.
- `load <name>` answers the component's own keys plus, under `uses.<component name>`
  (`uses.identity.email`, not the full id: ids hold `.` and `#`, which the dot-path
  provenance cannot carry; the id appears in provenance beside each used key), the keys it
  asked for, resolved through the same layer chain. A used key is read from the provider's
  namespace, so `identity.email` is stored once, in `identity`'s files, and never copied.
  *(Author's call.)*
- `uses` **subsumes** today's `dependencies` map. An entry without `keys` is what
  `dependencies` expresses now: a skill or agent that must be installed, nothing read from
  it. Such an entry keeps today's `kind` and optional `install` (marketplace or `action`),
  and `id` is optional on it, because a skill with no `agent-config.json` has no id. One
  install mechanism. The old map is still read for one release and `start` reports it as a
  `legacy-dependencies` problem naming the `uses` entry to write. *(Author's call.)*
- `keys` may not name `credentials.*`: a secret never crosses components. A consumer that
  needs a provider's service asks the provider's CLI, not its token.
- `uses` is a reserved top-level key of `load`'s output, beside `schemaVersion` and
  `credentials`; a component may not declare a key of that name.
- Onboarding (`start`) walks `uses` first: a missing provider becomes an `install` action, a
  provider with missing keys becomes that provider's `onboard` action, then the component's
  own. The user answers `email` once, for every plugin that uses it.
- A dependency cycle is an error at `start`.

### 3. `replace`

A `replace` map lives in agent-config's **own** config (`~/.agents/config/agent-config/`,
in a trusted layer only, see §9), never in a component's manifest:

```json
{ "replace": { "github.com/max-levitskiy/skills#identity": "github.com/colleague/skills#identity" } }
```

- Resolution: every `uses.id` is looked up in `replace` before anything else, including
  install.
- The replacement must provide every key the dependant names, with a schema the original's
  value would satisfy (`type`, `enum`, `pattern` checked). A mismatch fails `load` with exit 2
  and names the key and both schemas.
- `replace` is a map merged key by key across the trusted layers (global and a context's
  `config.me.json`, §9); a replacement skips the consumer's `uses.version` range check,
  since it numbers its own versions: schema compatibility is the whole contract.

### 4. Auto-install

When a hard `uses` has no installed provider (after `replace`):

- `start` emits an `install` action naming the id, version range and the command it will
  run; a skill shows a confirmation; `agent-config install <id>` runs it.
- Mechanism: the harness's own installer when there is one. In Claude Code the id's host
  and path are treated as the marketplace URL: `claude plugin marketplace add <url>` if it is
  not added yet, then install the plugin whose manifest declares the id; when none does, or
  the harness has no installer (Codex and others), a git clone into
  `~/.agents/plugins/<host>/<path>` at the newest tag (`<plugin>--v<ver>`, Claude Code's
  convention; `HEAD` when there is none), registered as installed. Tags carry the plugin's
  version, not the component's contract `version`, so the clone is followed by the same
  post-install range check as a harness install, never by a tag search against the range.
- A harness install knows nothing of ranges. After any install the registry's declared
  `version` is checked against every consumer's range; outside it, `start` reports
  `version-unsatisfied`, a hard `load` exits 2, an optional one omits the keys. Nothing is
  reinstalled automatically.
- Two keys in agent-config's own config: `install.auto` and `update.auto`, each
  `ask | always | never`, default `ask`. `update` means moving within the declared range;
  anything beyond it is a manifest change, not an update.
- A subagent never installs; `load` exits 2 naming the missing provider, as it does for a
  missing key today.

### 5. Contexts

A context is a named layer that applies when a filter matches. It sits between `global` and
`repo`:

```
global → context (outermost first, nested inside) → repo → user-repo → local
```

**Definition.** Contexts are defined once, for all components, in
`~/.agents/contexts/<name>/context.json`:

```json
// ~/.agents/contexts/acme-web/context.json      (team, synced)
{
  "schemaVersion": 1,
  "id": "ctx_8f3a…",
  "parent": "acme",
  "match": [
    { "remote": "github.com/acme/web-*" }
  ]
}
// ~/.agents/contexts/acme-web/context.me.json   (this machine, never synced)
{
  "match": [
    { "path": "~/git/acme/web/" }
  ]
}
```

- `match` entries are OR-ed. Each entry's fields are AND-ed (`remote` and `path` together
  means both).
- `context.json` is the team file and carries **`remote` entries only**: a path is
  per-machine (a colleague keeps the client under `~/work/acme`). `path` entries live in a
  sibling `context.me.json`, OR-ed in, never synced. An entry combining both is split
  across the two files by `context add`.
- A `*` in a glob does not cross `/`, as in git; `**` does. An organisation with subgroups
  (`gitlab.example.com/acme/platform/web`) is matched with `gitlab.example.com/acme/**`,
  and that is what `context:add` pre-fills.
- `remote` matches any configured remote URL of the current checkout **or of any enclosing
  git superproject** (`git rev-parse --show-superproject-working-tree`, followed up the
  chain: a vendored submodule inside a client's repo is still the client's; a plain checkout
  that merely sits inside another repo's tree is not, and matches by path),
  normalised to `host/path` (scheme, `git@`, `.git`, user and port stripped, host
  lower-cased), with git's `hasconfig:remote.*.url` glob rules. Any remote counts, as in
  git: a fork whose `upstream` points at the client's organisation is in the client's
  context. `path` is tested against the **checkout root**, the **main worktree's root**
  (parent of the common git dir, so a linked worktree under `~/.worktrees/` still belongs
  to its repo's context) and the current working directory, each with a trailing `/`
  appended before matching so that `~/git/acme/` matches the directory `~/git/acme` itself;
  symlinked and real paths both. Rules as `gitdir:`: `**/` is prepended unless the pattern
  starts with `~/`, `./` or `/`; a trailing `/` means `/**`; `~` expands; case-sensitive,
  `path/i` for insensitive. A path match needs no git repository: a client's documents in a
  synced cloud folder are a context too.
  `load`, `start` and `context` take `--cwd` so a skill driving a subagent elsewhere
  resolves the same chain the subagent will.
- An absent or empty `match` makes an **abstract** context: it never matches on its own,
  and exists to be a `parent` or to be named with `--scope`.
- `parent` names another context. A child applies after its parent and inherits nothing by
  itself; inheritance is simply merge order. A child need not repeat its parent's `match`:
  it matches on its own terms, and when it does, its parent chain is applied before it even
  if the parent's own filter would not have matched. A cycle in `parent` is an error.
- Order: first the chain roots, by `~/.agents/contexts/order.json` when present, else
  alphabetical; a parent always precedes its child; a context reachable twice applies once,
  at its first position. The **innermost** context is the last one in that order, and it is
  the default write target. `--explain` prints the order. The expected case is a chain, not
  siblings. A `parent` naming no context is a config error (`load` exits 2), never silently
  dropped: dropping it would change which site a key gets written to. The same holds for
  `order.json` naming an unknown context (`unknown-context`, exit 2). A directory under
  `~/.agents/contexts/` with no `context.json` is not a context; `context list` flags it.
- Two matched contexts with no ancestor relation that both set a key for the component
  being loaded (a repo in two projects, each with its own `jira.prefixes`) are reported by
  `load` as `sibling-contexts` naming both; the value still follows the order, but the
  shadowing is never silent (anti-goal 1).
- `context add` mints an `id` (random, stored in `context.json`) and the directory name is
  the label. Sync, renames and conflicts between machines key on the id, not the name.
- Rule taken from git: a component's config files may not define `match` or `parent` for
  any context. Only `context.json` (and `context.me.json` for `path`) do, and they are read
  before any component config.

**Values.** A component's values for a context live beside the definition, split into the
team file and the personal file:

```
~/.agents/contexts/acme/context.json             the definition (team)
~/.agents/contexts/acme/<name>/config.json       team values for component <name>
~/.agents/contexts/acme/<name>/config.me.json    personal values for <name>
```

`config.json` holds what a colleague would also set (Jira site, issue prefixes, hub URL).
`config.me.json` holds what is this machine's or this person's (email, credential
references, hub local path, `replace`). Both are plain ACS files; `me` merges after the team file.
The future sync delivers `context.json` and every `config.json`, and never `config.me.json`.
`write` refuses a credential reference and any key declared `personal: true` in the team
file, and the pane offers the two as **Project, shared** / **Project, just me** the way it
offers layers today.

**Onboarding into a context.** When `start` finds a missing key whose recommended layer
is `context`:

- One or more contexts match: the write goes to the **innermost** matching context, and
  the action names it. The pane offers the outer ones under *Save to…*.
- None matches: `start` emits a `context:add` action ahead of the `onboard`, pre-filled from
  the current place: a `remote` glob widened to the organisation (`github.com/acme/**`
  from `github.com/acme/web-app`) for `context.json` and the current path for
  `context.me.json`. The user names the context
  or picks **global instead**, which writes the key to the global layer as today. Nothing
  is created without that answer, and a subagent never reaches this branch (`load` exits 2).

**CLI.**

- `agent-config context list` — defined contexts and which match here.
- `agent-config context --explain` — the resolved chain for the cwd, each context with the
  entry that matched it.
- `agent-config context add <name> [--parent p] [--remote glob] [--path glob]` and
  `context edit`; `write --layer context:<name>[:me]` for values.
- `path`, `start`, `load`, `describe` all learn the new layer; `layer` values in a key entry
  may say `context` to recommend it.
- `load --context <name>` appends the named context and its parent chain after every
  matched one, so it is the innermost and the write target; an abstract context is used
  this way. `load --no-context` drops every matched context. A skill's own flags
  (atlassian's `--scope` / `--no-scope`) map onto these two.

### 6. First providers

Two components ship with `ml-agent-config`, so the shared layer is usable on day one:

**`github.com/max-levitskiy/skills#identity`** — who the user is in the current place.
Keys: `email`, `name`, `onepassword.account`, `onepassword.vault`. Layer: context, personal.
Replaces `auth.email` in atlassian and `authorEmails` in timesheet.

**`github.com/max-levitskiy/skills#project`** — what the current place belongs to.
Keys: `hub.url` (team), `hub.path` (personal), `jira.site` (team), `jira.prefixes` (team,
list), `label` (team). Layer: context. A context without a `project` config is just a
settings group; one with it is a project.

Which keys exactly, and their schemas, are the builder's to settle from the current atlassian,
timesheet and fellow declarations. The names above are the intent.

Neither provider fronts a service, so "verify makes one real call" cannot hold. A
declaration may say `verify: none`; `start` then treats the keys as verified once written,
and the checklist item reads "a `verify` action makes one real call, or the declaration
says `verify: none`".

### 7. Migration

- `atlassian`'s `scopes` become contexts with `project` values: `scopes.<scope>.jira.projects`
  → `project.jira.prefixes` in context `<scope>`; `defaultScope` disappears, the matching
  context is the default; `--scope <name>` stays as an explicit override and `--no-scope`
  as "ignore contexts". `config scopes` prints the matching chain. `jira.baseUrl` is read
  through `uses project.jira.site` with the component's own key kept as a fallback for one
  release, then removed. During that release the used key wins whenever it is set; the own
  key applies only when the used one is absent, and `start` reports `deprecated-key` while
  the own key is still set, so the window closes visibly.
- **How the move happens.** Today's `migrate` action works on one component's file in
  place; a key moving to a provider needs more. The consumer's declaration lists each
  moved key as `movedTo: "<id>#<key>"`. `start` then plans a `migrate` that, per layer,
  copies the value into the provider's key in the equivalent layer (global → global, a
  repo layer → that repo layer, a `scopes` entry → the context named after it) and sets
  the old key to `null`, through `write`, journaled. Nothing is re-asked that the user
  already answered. `scopes` become **abstract** contexts (they carry no remote or path);
  the old `defaultScope` is offered as the `--context` to pass.
- The standard's worked example: a consultant with their own organisation in global, a
  client context `acme` (remotes `gitlab.example.com/acme/**` and `github.com/acme/**` in
  `context.json`, path `~/git/acme/` in `context.me.json`), a documents-only context for
  that client's synced folder (path only, so its `context.json` is abstract), and a
  product context `acme-web` with parent `acme`. The example lives in the standard's text,
  not as shipped files.
- Every other component in this repo gets an `id`, a `version`, and `uses` for the keys it
  can take from `identity` or `project` (fellow: the email it files meetings under and the
  hub it writes recaps into; herdr, orchestrate, grill-with-ui, size: whatever of their
  declared keys is really identity or project data — the builder decides per key from the
  declaration, keeping the component's own key as a one-release fallback as for atlassian).
- Directory-level `.envrc` files are out of scope; the standard notes that an
  `env`-sourced credential can still read what direnv exports.
- v2 files are read unchanged. A v2 declaration without `id` gets an id of
  `<unknown>#<name>` and cannot be depended on; `start` reports it.

### 8. Standard text

`standards/agent-config.md` becomes v3 with new sections: *Identifiers*, *Depending on
another component*, *Contexts*, *The shared files and the personal files*, and an updated
layer table and checklist. ADR 0003 records the identifier decision (URI over purl, version
outside the id) and the `replace` placement.

## 9. Rules for the edge cases

Settled from a corner-case review (2026-10-20). Each is a rule the implementation and its
tests follow; none is left open.

**Trust.** Three kinds of value can make the CLI fetch code or hand out a secret: `replace`,
`install.*` / `update.*`, and a credential reference. They are honoured **only from layers
the user wrote on this machine**: global, user-repo, a context's `config.me.json`, and the
local layer **only when git confirms the file is untracked or ignored** (`git check-ignore`
/ `git ls-files`): a repository can commit a `config.local.json` and arrange `.gitignore`
so it is tracked, and such a file is treated as the repo layer. `replace` is narrower
still: global and `config.me.json` only (§3). In the repo layer (committed by whoever owns
the repo), a tracked local file, and a context's team `config.json` (delivered by sync)
`load` ignores these keys and `start` reports `untrusted-layer-key` naming the file. A
cloned repository can therefore never redirect a provider, trigger an install, or point a
credential at its own source.

**`cacheVar` collisions.** Two references in one resolved chain may name the same variable
(the own-org token in global, the client's in a context, both `JIRA_TOKEN`). A `cacheVar`
is honoured only when no other reference in the chain names the same variable; otherwise it
is skipped with a warning naming both files, and the reference is resolved from its source.
The session cache in the hooks module is keyed by the full reference and is unaffected.
Changing directory into another context mid-session therefore resolves the other reference,
never the cached neighbour.

**`replace` keeps the name.** Consumers read `uses.<name>` under the *original* id's
component name. A replacement with a different name (`#whoami` for `#identity`) is read
from its own config directory and surfaced under `uses.identity`.

**One id, several installs.** When the registry finds two installs declaring one id, it
prefers the one whose install source matches the id's host and path; if neither or both
do, `start` reports `id-conflict` and `load` exits 2. The index is keyed on each manifest
file's mtime, not its directory's, so an in-place update of `agent-config.json` is seen.

**Version ranges.** Install and update pick a version satisfying every installed
consumer's `uses.version`; when the ranges have no common version, `start` reports
`version-conflict` with both consumers and nothing is installed or moved.

**Unattended installs.** The git fallback clones with `GIT_TERMINAL_PROMPT=0`; a private
repo without a working credential helper is a `problem` with the fix, never a prompt.

**Sync payload.** The schema-snapshot file beside a context's team `config.json` syncs with
it (it holds the schema only), so a colleague's first `start` does not re-interview them.

**Exit codes.** Every config error introduced here — parent cycle, missing parent,
replace schema mismatch, id or version conflict — is `load` exit 2 with a distinct `code`
in the report, matching how a missing key is reported today.

**A broken context must not break every component.** An unparsable `context.json` or
`context.me.json` is skipped and reported as `context-unparsable` by `start` and in
`load`'s report; `load` exits 2 for it only when something in the resolved chain needs
that context — another context's `parent`, `order.json`, or `--context` names it.

**Concurrent readers.** The registry, `order.json`, every `context*.json` and every config
file are written to a temporary file and renamed into place, so a `load` racing a sync or
a second CLI process never reads a truncated file.

## Left to the builder

- The exact `extensions` namespace string and the `SKILL.md` metadata key.
- Remote-URL normalisation details (ssh aliases, trailing slashes, case of host).
- Whether `context.json` also allows a `when` on an environment variable. Not asked for;
  include only if it falls out of the matcher for free.
- Order and wording of the `install` confirmation, and how the pane draws the context chain.
- Test plan: the matcher against git's own documented cases; `load` with a replaced provider
  whose schema differs; a subagent with a missing provider exits 2 without a prompt.
