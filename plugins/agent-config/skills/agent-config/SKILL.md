---
name: agent-config
description: >-
  Set up, repair, or relocate the settings and credentials a skill, subagent, command, or
  hook depends on — layered `.agents/config` files plus credential *references* (1Password,
  environment variable, dotenv, macOS Keychain, any shell command) that keep secrets out of
  git. Use when a component reports missing or incomplete configuration, when its credential
  won't resolve, when the user asks where an API key or setting is stored or wants to move
  one between the global, repo, and local layers, and when a skill author is adding
  configuration to a new skill or subagent. Other skills invoke this instead of restating
  any of it.
---

# Agent Config (ACS v1)

The rules live in [`standards/agent-config.md`](../../../../standards/agent-config.md) — precedence, merge semantics, every credential shape, the full checklist. This skill makes them actionable and deliberately does not repeat them; read the standard when something here doesn't answer the question.

Two jobs arrive here: a user needs configuring → [Onboarding](#onboarding); a skill needs config wired into it → [Wiring config into a component](#wiring-config-into-a-component).

## The shape

Three layers, later overrides earlier:

| layer | path | committed |
| --- | --- | --- |
| global | `~/.agents/config/<name>/config.json` | outside the repo |
| repo | `<repo>/.agents/config/<name>/config.json` | **yes** |
| local | `<repo>/.agents/config/<name>/config.local.json` | **no — gitignored** |

`<name>` is the plugin name: one namespace, so a plugin's skill and its subagent read the same file instead of asking the user the same questions twice. `version` and `credentials` are reserved; every other key belongs to the component. Outside a git repo only the global layer exists, and a component must still work there.

## Onboarding

Missing config is the expected first-run state, not a failure — never report it to the user as an error. It is re-runnable: changing an answer means writing the layer again, not hand-editing JSON.

1. **Detect before doing any work.** Run the calling skill's config check — `fellow.ts config check`, `orchestrate-config.ts check`. It either says proceed or names exactly which keys are missing. A skill with no CLI does the same with `loadConfig()` and its own `validate()`.

2. **Ask only the questions that matter**, with `AskUserQuestion` so the user picks rather than types. Skip any that don't apply — a component with no credential (a file-backed tracker) asks none of the first one:
   - **Where does the credential live?** 1Password (`op`), an environment variable, a gitignored `.env` file, macOS Keychain, or any shell command that prints the secret (Bitwarden, pass, Doppler, `vault`). **Never accept the secret itself as text.** The exact JSON for each source is in the standard. Read a `command` source back to the user before saving — it runs on every call. When the source prompts or is slow — 1Password raises a Touch ID prompt on every process — add `cacheVar` to the reference and show the user the one-line `export` that seeds it for the shell session.
   - **Which account, workspace, or project?** Whatever identifies the target of the call.
   - **What gets written, and where?** Say plainly that anything not configured simply isn't written, and that bulky or sensitive output can stay out of the repo entirely via an absolute path.

3. **Recommend a layer and say why** — most users don't know which is right:
   - **global** — credentials and personal identity; they follow the person across every project.
   - **repo** — project identity the whole team shares; it gets committed.
   - **local** — personal paths and per-checkout overrides on a shared repo; gitignored.

4. **Write it and name the exact path.** `writeLayer(name, layer, config)` refuses any config carrying an inlined secret and gitignores the local layer at write time — the only reliable moment. If you write the file with the `Write` tool instead, run the skill's gitignore command (`fellow.ts config gitignore`), which is `ensureGitignored()` underneath.

5. **Verify with one real call.** Resolve the credential, hit the API, show the user the identity that came back. **"Configured" means a call succeeded, not that a file was written** — don't report success before this step passes.

A failure at step 5 means the config is fine and the secret isn't reachable. Name the reference that failed and the fix (`op signin`, an unset variable); don't rewrite the user's config.

## Wiring config into a component

1. **Vendor the library.** Add the component's vendor directory to `CONSUMERS` in `plugins/agent-config/skills/agent-config/scripts/vendor.sh`, then run `vendor.sh sync`. It writes `lib/config.ts` and `lib/credentials.ts` into `<skill>/scripts/lib/vendor/agent-config/` under a provenance header. Copies, not a cross-plugin import: a runtime dependency breaks for anyone who installed one plugin and not the other.

2. **Write the component's own `scripts/lib/config.ts`** holding three things and nothing else — its config interface extending `BaseConfig`, a `validate(c)` returning human-readable problems (empty array = ready), and thin wrappers binding `<name>` so callers keep their zero-argument call shape. Re-export what the rest of the skill needs (`repoRoot`, `expandPath`, `Layer`) from there, so nothing else ever imports the vendor path. Worked example, 87 lines: `plugins/fellow/skills/fellow/scripts/lib/config.ts`.

3. **Check for drift** with `vendor.sh check` — it diffs every copy below the sentinel line and exits non-zero if one has been edited or left stale. Run it after any change to the canonical files; edits made in a vendored copy are silently overwritten by the next sync.

4. **Ship a `config.example.json`** next to the component documenting every supported key, once per `<name>`. Never ship a populated `config.json` — the user would act on settings they never chose.

The API, in `plugins/agent-config/skills/agent-config/lib/` — read the signatures there rather than trusting any prose copy:

- `config.ts` — `loadConfig<T>(name)` → `{ config, found, missing, legacy }`, `layerPath`, `legacyLayerPath`, `writeLayer`, `ensureGitignored`, `assertNoInlineSecrets`, `validateCredentialRef`, `expandPath`, `repoRoot`.
- `credentials.ts` — `resolveCredential(ref, name?)`, `describeCredential(ref)`.

## Subagents never onboard

A subagent reads config exactly as a skill does and fails differently, because it starts with no conversation context and often runs with nobody watching.

**Missing config** → report which keys are missing and the exact path they belong in, then stop. No questions, no guessed values, no config file written. An interview hangs until the subagent is killed, and since the namespace is shared, invented settings would then be picked up by the skill too. Onboarding belongs to the invoking skill or the human.

**Unresolvable credential** → return the logical name, the source, and the fix as part of the result and exit non-zero. Never block on a Touch ID or `op signin` prompt no one is there to answer; a hang teaches the caller nothing, a reported failure lets it ask the human once and retry.

## Two rules with no exceptions

- **A config file never holds a secret**, only a reference to where one lives. The repo layer is committed, so an inlined token leaks eventually. `assertNoInlineSecrets` enforces this on every write — don't route around it.
- **A resolved secret never reaches argv, logs, stdout, or disk.** argv is world-readable through `ps`; pass secrets by environment or stdin. Resolve lazily, so listing config never fires a password-manager prompt, and cache only in the environment via `cacheVar` — never in a file.

## Legacy path

`.agents/skill-config/<name>/` is still read, at lower precedence within each layer, so existing setups keep working untouched. Write only to `.agents/config/`, and document only that; `loadConfig` returns any legacy files it read in `legacy`, so a component can mention the move once, naming both paths.
