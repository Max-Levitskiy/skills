---
name: setup
description: >-
  Set up, repair, or relocate the settings and credentials a skill, subagent, command, or
  hook depends on — layered `.agents/config` files plus credential *references* (1Password,
  environment variable, dotenv, macOS Keychain, any shell command) that keep secrets out of
  git. Use when a component reports missing or incomplete configuration, when its credential
  won't resolve, when the user asks where an API key or setting is stored or wants to move
  one between the global, context, repo, and local layers, and when a skill author is adding
  configuration to a new skill or subagent. Other skills invoke this instead of restating
  any of it.
---

# Agent Config (ACS v2)

The rules live in [`standards/agent-config.md`](../../../../standards/agent-config.md) — precedence, merge semantics, every credential shape, the full checklist. The protocol for working a plan lives in [`docs/working-actions.md`](../../docs/working-actions.md). This skill makes them actionable and deliberately does not repeat them; read those when something here doesn't answer the question.

Two jobs arrive here: a user needs configuring → [Onboarding](#onboarding); a skill needs config wired into it → [Wiring config into a component](#wiring-config-into-a-component).

## The shape

Four fixed layers, and two for each context that applies; later overrides earlier:

| layer | path | committed |
| --- | --- | --- |
| global | `~/.agents/config/<name>/config.json` | outside the repo |
| `context:<context>` | `~/.agents/contexts/<context>/<name>/config.json` | outside the repo; the team's |
| `context:<context>:me` | `~/.agents/contexts/<context>/<name>/config.me.json` | outside the repo; yours only |
| repo | `<repo>/.agents/config/<name>/config.json` | **yes** |
| user-repo | `~/.agents/config/<name>/user-repo/<repo identity>/config.json` | outside the repo |
| local | `<repo>/.agents/config/<name>/config.local.json` | **no — gitignored** |

`<name>` is the tool's name: one namespace, so a plugin's skill and its subagent read the same file instead of asking the user the same questions twice. `schemaVersion` and `credentials` are reserved; every other key belongs to the component and is declared in its `agent-config.json`. Outside a git repo the repo, user-repo and local layers do not exist, and a component must still work with only the global layer.

A context groups one organisation's repositories: it matches by git remote (its team file, `~/.agents/contexts/<context>/context.json`) or by local path (your own `context.me.json` beside it), and its layers sit between global and repo, outermost context first. `agent-config context explain` shows which contexts apply here and why, and `agent-config context list` shows them all. The matching rules are in the standard, under *Contexts*.

Every call goes through the `agent-config` CLI. Find it the way `working-actions.md` says (`command -v agent-config`, else the harness plugin caches), and pass `--from <the component's skill dir>` when working on a checkout rather than an install.

## Onboarding

Missing config is the expected first-run state, not a failure — never report it to the user as an error. It is re-runnable: changing an answer means writing the layer again, not hand-editing JSON.

1. **Detect before doing any work.** `agent-config start <name>`. `ready: true` means there is nothing to do. `ready: false` carries an action list — work it as `working-actions.md` says. A v1 file under `.agents/skill-config/<name>/` arrives as an `agent-config:adopt` action ahead of onboarding.

2. **Ask only the questions that matter**, with `AskUserQuestion` so the user picks rather than types. `agent-config describe <name>` lists every declared key with its description, recommended layer, default and current answer; the component's `actions/onboard.md` says which questions it needs. Skip any that don't apply — a component with no credential asks none of the first one:
   - **Where does the credential live?** 1Password (`op`), an environment variable, a gitignored `.env` file, macOS Keychain, or any shell command that prints the secret (Bitwarden, pass, Doppler, `vault`). **Never accept the secret itself as text.** The exact JSON for each source is in the standard; `agent-config 1password items` lists 1Password items by name, never a value. Read a `command` source back to the user before saving — it runs on every call.
   - **Which account, workspace, or project?** Whatever identifies the target of the call.
   - **What gets written, and where?** Say plainly that anything not configured simply isn't written, and that bulky or sensitive output can stay out of the repo entirely via an absolute path.

3. **Recommend a layer and say why** — most users don't know which is right:
   - **global** — credentials and personal identity; they follow the person across every project.
   - **context** — what one organisation shares across all its repositories: a site, issue prefixes. Its team file, `context:<context>`, holds those; its me file, `context:<context>:me`, holds the person's own answers there, credentials included.
   - **repo** — project identity the whole team shares; it gets committed.
   - **user-repo** — your own settings for one repository, shared by all its worktrees.
   - **local** — per-checkout overrides on a shared repo; gitignored.

   A credential reference counts only in a layer the user wrote here: global, user-repo, a context's me file, or a local file git does not track. `load` ignores one anywhere else and reports `untrusted-layer-key`, so never recommend the repo layer or a context's team file for a credential.

   **When a key recommends `context`**, offer three choices with `AskUserQuestion`, and recommend the first one that fits:
   - **This context** — the onboarding action carries `context.layer`, so a context applies. Name it (the last entry of `start`'s `contexts`) and save there. Offer the outer contexts in `contexts` too, for an answer the whole organisation shares.
   - **A new context** — the plan holds `agent-config:context-add`, so none applies yet. Follow that action's body: propose `suggestedName` with its `remote` and `path`, and create it with `agent-config context add`. A narrower group inside a context that does apply can get one too: `agent-config context add <name> --parent <that context>` with its own `--remote` or `--path`, which then applies after it.
   - **Global** — the answer then applies in every repository, not only this organisation's. Always offer it: it is `context-add`'s `alternative`.

   Credentials and keys the declaration marks `personal` go to `context:<context>:me`, never to the team file, which `write` refuses them for. Nothing is created without the user's answer; re-run `start` after creating a context, and the onboarding action names its layer.

4. **Write it and name the exact path.** `agent-config write <name> --layer <layer>` with the whole layer as JSON on stdin — it replaces the layer, so read the current one first and write the merged whole. `write` refuses an inlined secret or a value the declared schema refuses, stamps the schema version, journals the old contents, and gitignores the local layer. Never write a config file with a file-writing tool.

5. **Verify with one real call** — the component's `verify` action. **"Configured" means a call succeeded, not that a file was written** — don't report success before this step passes.

A failure at step 5 means the config is fine and the secret isn't reachable. Name the reference that failed and the fix (`op signin`, an unset variable); don't rewrite the user's config.

On Claude Code, `/agent-config` opens a settings pane that runs the same `describe` and `write`, so the user can change any answer themselves.

## Wiring config into a component

There is no library to copy: the CLI is the only interface. Worked example: fellow, in `plugins/ml-workplace/skills/fellow/`.

1. **Declare the keys** in `agent-config.json` — at the plugin root for a one-tool plugin, in `skills/<skill>/` for a plugin holding several. Each key gets a `description`, a recommended `layer`, a `default` when it has one (a key with none is required and triggers onboarding), and JSON Schema for anything more than text. Keys that matter only in some setups (a credential only some tracker kinds need) go in `groups` with a `when`. The format is `plugins/ml-agent-config/agent-config.schema.json`.

2. **Write the actions** beside the declaration, in `actions/`: `onboard.md` for the questions when any key is required, `verify.md` for one real call. Their bodies are read by an agent mid-plan, so say what to ask, which layer to recommend, and what to do on failure.

3. **Put the five lines first in `SKILL.md`** — copy them from "What a consumer's SKILL.md says" in `working-actions.md`, with the component's name. On Claude Code the hooks module runs that `start` itself when the skill expands.

4. **Read config in scripts with `load`, never `start`.** Spawn `agent-config load <name> --from <skill dir> [--secrets <key>...]`: config on stdout, secrets as one JSON object on fd 3. Fellow's `scripts/lib/config.ts` is the pattern — binary discovery, one spawn per call, typed results, `AgentConfigError` carrying the CLI's exit code (2 config, 3 credential, 4 schema).

5. **Add `"dependencies": ["ml-agent-config"]`** to the plugin's `plugin.json`, so installing the component installs the CLI.

6. **Ship a `config.example.json`** documenting every supported key, once per `<name>`. Never ship a populated `config.json` — the user would act on settings they never chose.

## Subagents never onboard

A subagent reads config exactly as a skill does and fails differently, because it starts with no conversation context and often runs with nobody watching. Its whole surface is `agent-config load`, which never returns an action list, so it has nothing to onboard with.

A skill that starts a subagent in another directory runs `agent-config start <name> --cwd <that directory>` first, so it onboards the contexts the subagent's `load` will resolve there.

**Missing config** → `load` exits 2 naming the missing keys; report them and the layer they belong in, then stop. No questions, no guessed values, no config file written. An interview hangs until the subagent is killed, and since the namespace is shared, invented settings would then be picked up by the skill too. Onboarding belongs to the invoking skill or the human.

**Unresolvable credential** → `load` exits 3 naming the reference and the fix; return that as part of the result and exit non-zero. Never block on a Touch ID or `op signin` prompt no one is there to answer; a hang teaches the caller nothing, a reported failure lets it ask the human once and retry.

## Two rules with no exceptions

- **A config file never holds a secret**, only a reference to where one lives. The repo layer is committed, so an inlined token leaks eventually. `write` refuses one — don't route around it.
- **A resolved secret never reaches argv, logs, stdout, or disk.** argv is world-readable through `ps`; secrets come back on fd 3 of `load` and stay in the process's memory. On Claude Code the hooks module asks 1Password once per session; elsewhere a reference's `cacheVar` lets the user seed the secret once per shell.

## Legacy path

v2 does not read `.agents/skill-config/<name>/`. `start` plans an `agent-config:adopt` action that copies a v1 file into the layer that has no v2 file yet, through `write`, and leaves the old file in place. Write and document only `.agents/config/`.
