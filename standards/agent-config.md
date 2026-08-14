# Agent Config Standard (ACS v1)

How a skill or subagent stores per-user and per-project settings, and how it gets hold of secrets without ever committing one.

Status: **active**. Applies to any skill, subagent, command, or hook in this marketplace that needs configuration. Canonical implementation: [`plugins/agent-config`](../plugins/agent-config). Reference implementations: [`fellow`](../plugins/fellow) (credential-backed), [`orchestrate`](../plugins/orchestrate) (optional config), and [`herdr`](../plugins/herdr) (no credential at all — presets only).

## Why this exists

A component that talks to an external service needs to know three kinds of things: *where the credential lives*, *which account/project to act on*, and *where output should go*. These have different lifetimes and different audiences. The credential is personal and secret. The project identity is usually shared by everyone working in the repo. Output paths are often a personal preference that shouldn't be forced on teammates.

Cramming all three into one file means either committing secrets or committing nothing. The layering below separates them so the shareable parts can be checked in and the personal parts stay out of git.

None of that is specific to skills. A subagent calling the same API needs the same three answers, so one format, one set of paths, and one loader serve skills, subagents, commands, and hooks alike. What a subagent must do *differently* is a matter of failure behaviour, covered [below](#what-is-different-for-a-subagent).

## Locations and precedence

Three layers. Later layers override earlier ones.

| Layer | Path | Committed? | Holds |
| --- | --- | --- | --- |
| **global** | `~/.agents/config/<name>/config.json` | n/a (outside repo) | your defaults across every project |
| **repo** | `<repo>/.agents/config/<name>/config.json` | **yes** | settings the whole team shares |
| **local** | `<repo>/.agents/config/<name>/config.local.json` | **no — gitignored** | per-checkout overrides, personal paths |
| *legacy* | the same three files under `.agents/skill-config/<name>/` | as above | read-only compatibility with SCS v1 — see [Migrating](#migrating-from-scs-v1) |

`<repo>` is the git top level (`git rev-parse --show-toplevel`). Outside a git repo, only the global layer applies — a component must still work in that case, since plenty of useful work happens in a scratch directory.

`<name>` is the skill name, the subagent name, or the plugin name — one namespace, deliberately. A plugin's skill and its subagent are the same tool wearing two hats, and they should read the same file: forcing two configs would make the user answer the same questions twice and then keep both copies in sync by hand. Pick one name per plugin and use it from every component in it. Names are directory names, so different plugins never collide.

Within each layer the legacy path is read first, so a value in the current path wins over the same value in the legacy one. That ordering is the safe one — a user who has written the new file has clearly chosen it, while the old file may be months stale, and letting it win would silently undo an edit the user just made.

### Merge semantics

Deep merge, in order global → repo → local:

- Objects merge key by key.
- Scalars and **arrays replace wholesale**. Arrays are configuration values, not accumulators; a user overriding `["a","b"]` with `["c"]` means `["c"]`, and any other rule makes it impossible to remove an inherited entry.
- An explicit `null` **deletes** an inherited key. This is the only way to unset something a lower layer set.

### Why `.agents/` and not `.claude/`

`.agents/` is tool-neutral. The same config should serve whatever agent runtime the user runs next year without a migration. It also keeps component config visibly separate from `.claude/`, which holds Claude Code's own machinery — mixing user data into a tool's config directory makes both harder to reason about.

## File format

Plain JSON, UTF-8. No comments — every parser handles plain JSON, and a config a component can't read is worse than one that's slightly less pleasant to hand-edit.

Two reserved top-level keys; everything else is the component's own namespace.

```json
{
  "version": 1,
  "credentials": {
    "apiKey": { "source": "1password", "ref": "op://Vault/Item/field" }
  }
}
```

- `version` — integer, currently `1`. Lets a loader detect and migrate an older shape instead of crashing on it.
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

### Resolution rules

- Resolve **lazily** — only when a call actually needs the secret. Listing config shouldn't shell out to a password manager and trigger a Touch ID prompt.
- **Never print, log, or echo a resolved secret**, and never pass it as a command-line argument (argv is world-readable via `ps`). Pass it through the environment or stdin.
- On failure, report *which* reference failed and how to fix it — `op read op://Vault/Item/field failed: not signed in — run 'op signin'` — never dump the raw error and leave the user guessing.

## The onboarding contract

Config will be missing the first time, and that moment decides whether the tool feels finished or broken. A conforming skill or command must:

1. **Detect** missing or incomplete config before doing any work, and treat it as an expected state rather than an error.
2. **Ask**, don't assume. Walk the user through the questions that actually matter — where their credential lives, which account/workspace to use, what output to keep and where.
3. **Offer the layer with a reason.** Most users don't know whether a setting belongs in global or repo. Recommend one and say why: identity and credentials usually global, project identity repo, personal paths local.
4. **Write the file** and tell the user the exact path.
5. **Add the local file to `.gitignore`** when writing the local layer — append `.agents/config/*/config.local.json` to the repo's `.gitignore` if it isn't already matched. Doing this at write time is the only reliable moment; asking the user to remember is how secrets get committed.
6. **Verify before declaring success** — resolve the credential and make one real call. "Configured" should mean "working", not "file written".

Onboarding should be re-runnable so users can change their minds without hand-editing JSON.

## What is different for a subagent

A subagent reads config exactly as above — same paths, same merge, same references. What changes is what it does when something is missing, and it changes because a subagent starts with no conversation context and often runs unattended: there may be no human watching its transcript to answer anything.

**Never onboard interactively.** A subagent that finds missing or incomplete config reports which keys are missing and the exact path they belong in, then stops. It does not ask, does not guess a value, and does not write a config file. Onboarding belongs to the invoking skill or to the human, who can actually answer the questions. A subagent that opens an interview either hangs until it is killed or invents settings the user never chose — and because the namespace is shared, those invented settings would then be picked up by the skill too.

**Treat credential failure as data.** A credential reference can require a human: Touch ID for the keychain, `op signin` for 1Password, an unlocked vault for a `command` source. A subagent cannot assume any of those prompts get answered, so it must not block on one indefinitely. On failure or timeout it returns the failing logical name, the source, and the fix as part of its result, and exits non-zero. A hang is the worst outcome available — the caller learns nothing and waits forever, whereas a reported failure lets the caller ask the human once and retry.

Both rules are testable the same way: run the subagent with no config file, and again with a deliberately broken credential reference. It must terminate promptly in both cases, naming what is missing, and must never emit a question.

## Component-specific keys

Beyond `version` and `credentials`, the component owns its namespace. Because `<name>` is shared, so are the keys — name them for the tool, not for whichever component happens to read them first. Two conventions worth following because they recur:

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

## Using the shared library

The canonical implementation is [`plugins/agent-config`](../plugins/agent-config): a skill that teaches this protocol, plus `lib/config.ts` (layer paths, merge, gitignore, validation) and `lib/credentials.ts` (resolution) beside it. Those files define the API — read the signatures there rather than trusting a copy of them in prose.

Consumers **vendor** both files verbatim into `scripts/lib/vendor/agent-config/`, under a provenance header naming the canonical path plus the sync and check commands, then a sentinel line — everything below it is canonical bytes. A runtime dependency between plugins would break whenever a user has one installed and not the other; a copy always works. Drift is caught by diffing below the sentinel rather than against a recorded commit hash: a hash churns the vendored file on every sync even when the content is identical, and it misses the case that actually happens — someone editing the copy. Run `plugins/agent-config/skills/agent-config/scripts/vendor.sh sync` to refresh every copy, and `vendor.sh check` to fail when any has drifted.

A component's own `lib/config.ts` then holds three things and nothing else — its config interface, its `validate()`, and thin re-exports so callers never import the vendor path directly:

```ts
import { loadConfig as load, validateCredentialRef, type BaseConfig } from "./vendor/agent-config/config";

const NAME = "fellow";

export interface FellowConfig extends BaseConfig {
  workspace?: { subdomain?: string };
}

export const loadConfig = () => load<FellowConfig>(NAME);

export function validate(c: FellowConfig): string[] {
  const problems = c.workspace?.subdomain ? [] : ["workspace.subdomain is not set"];
  return [...problems, ...validateCredentialRef("apiKey", c.credentials?.apiKey)];
}

export { repoRoot, expandPath, type Layer } from "./vendor/agent-config/config";
```

## Documenting it

Ship a `config.example.json` next to the component showing every supported key with realistic values — once per `<name>`, not once per component sharing it. It doubles as documentation and as something the user can copy and edit. Never ship a populated `config.json` — a real config appearing on install is indistinguishable from one the user wrote, and they'll act on settings they never chose.

## Migrating from SCS v1

The previous standard, Skill Config Standard v1, used `.agents/skill-config/<skill>/`. Those files are still read, at lower precedence within each layer, so existing setups keep working untouched. This is a compatibility fallback, not a second supported location: write only to `.agents/config/`, and document only `.agents/config/`.

To migrate, move the directory (`mv .agents/skill-config/<name> .agents/config/<name>`, and the same under `~`) and update the ignore pattern in `.gitignore` from `.agents/skill-config/*/config.local.json` to `.agents/config/*/config.local.json`. A component that reads a legacy file should say so once, naming both paths, so the user knows a move is available. No removal date is set; the fallback is read indefinitely until one is.

## Checklist

- [ ] Reads global → repo → local with deep merge, `null` deletes, arrays replace
- [ ] Within a layer, `.agents/config/` wins over legacy `.agents/skill-config/`
- [ ] Works with only the global layer (outside a git repo)
- [ ] A plugin's skill and subagent load the same `<name>`
- [ ] No secret is ever written to a config file
- [ ] Secrets resolve lazily and never reach argv, logs, or stdout
- [ ] Missing config triggers onboarding in a skill — and in a subagent, a report naming the missing keys and their path, never a question
- [ ] A subagent with an unresolvable credential exits non-zero naming the reference, rather than blocking on a prompt
- [ ] Onboarding gitignores `.agents/config/*/config.local.json` and verifies with a real call
- [ ] Vendored library files carry a provenance header and match the canonical copy
- [ ] `config.example.json` documents every key
