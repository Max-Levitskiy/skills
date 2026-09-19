# Marketplace: `ml-` namespacing and domain plugins

**Date:** 2026-09-19
**Status:** Approved, not yet implemented
**Scope:** every plugin under `plugins/`, `.claude-plugin/marketplace.json`, repo docs

## Problem

Seven plugins each carry one skill, and most repeat their name on invocation:
`/fellow:fellow`, `/herdr:herdr`, `/atlassian:atlassian`. Nothing marks a skill as coming
from this marketplace, and related skills — the text and code density analyzers — install
separately under unrelated names. A plugin named after its only skill leaves no room for a
second one.

## Goal

Every skill is invoked as `/ml-<domain>:<skill>`. A plugin is named for the domain it
serves, so it reads clearly with one skill and still fits when a second arrives.

## Constraint: why `ml-`, not `ml:`

Claude Code accepts a colon in `plugin.json`'s `name` and resolves `/ml:<domain>:<skill>`
when the plugin is installed from a marketplace (verified on 2.1.278; the pattern is in use
at `napalmpapalam/skills` with `dd:`). claude.ai marketplace sync requires kebab-case plugin
names and rejects the colon, and these plugins must sync there. The prefix is therefore
`ml-`.

## Naming rules

1. A plugin's directory, its marketplace entry `name`, and its `plugin.json` `name` are the
   same string: `ml-<domain>`, lowercase kebab-case. `<domain>` names what the plugin is
   for, not the tool its first skill wraps.
2. A skill's directory and its frontmatter `name:` are the same bare kebab-case string. It
   never repeats the plugin name — Claude Code adds `ml-<domain>:` itself.
3. The resulting command is `/ml-<domain>:<skill>`; the install key is
   `ml-<domain>@max-skills`.

## Target layout

| From | To | Command |
| --- | --- | --- |
| `text-density-analyzer/skills/analyze-density` | `ml-slop/skills/text` | `/ml-slop:text` |
| `code-density-analyzer/skills/analyze-code-density` | `ml-slop/skills/code` | `/ml-slop:code` |
| `orchestrate/skills/orchestrate` | `ml-subagents/skills/orchestrate` | `/ml-subagents:orchestrate` |
| `herdr/skills/herdr` | `ml-subagents/skills/herdr` | `/ml-subagents:herdr` |
| `atlassian/skills/atlassian` | `ml-workplace/skills/atlassian` | `/ml-workplace:atlassian` |
| `fellow/skills/fellow` | `ml-workplace/skills/fellow` | `/ml-workplace:fellow` |
| `agent-config/skills/agent-config` | `ml-agent-config/skills/setup` | `/ml-agent-config:setup` |

Seven plugins become four. Plugin-root content that is not a skill moves with its plugin:

- `agent-config/{bin,src,actions,docs,agent-config.schema.json}` → `ml-agent-config/`
- `code-density-analyzer/workspace/` (smoke test and fixtures) → `ml-slop/skills/code/workspace/`

All moves use `git mv` so history follows each file.

## Licensing

`text-density-analyzer` is MIT, copyright Web-Tree. Its `LICENSE` and `NOTICE` move into
`ml-slop/skills/text/`, keeping the notice attached to the code it covers. The code
analyzer's `NOTICE` moves to `ml-slop/skills/code/`. Each new plugin root gets one MIT
`LICENSE`, copyright Max Levitskiy. The `ml-slop` README credits Web-Tree for the text
analyzer.

## Edits beyond the moves

- **Frontmatter `name:`** — `analyze-density` → `text`, `analyze-code-density` → `code`,
  `agent-config` → `setup`. Descriptions keep their trigger phrases unchanged.
- **Vendored loader** — `vendor.sh` points at the new canonical path
  (`plugins/ml-agent-config/skills/setup/lib`) and the new consumer paths under
  `ml-workplace/skills/fellow` and `ml-subagents/skills/{herdr,orchestrate}`. `vendor.sh sync`
  regenerates the three copies, whose headers name those paths.
- **Cross-references** — where a skill or doc names "the `agent-config` skill" as something
  to invoke, it names `ml-agent-config:setup`. Invocation examples in READMEs use the new
  commands.
- **Manifests** — four `plugin.json` files, four marketplace entries. Each plugin gets a
  description covering its domain, the union of its skills' keywords, a `homepage` under
  `plugins/ml-<domain>`, and a version one minor above the highest it absorbs:
  `ml-slop` 0.2.0, `ml-subagents` 0.3.0, `ml-workplace` 0.3.0, `ml-agent-config` 0.3.0.
- **READMEs** — one per plugin, merging the absorbed READMEs under a section per skill.
  The root README's table lists four plugins with every command.

## Unchanged, on purpose

- **Config paths.** `~/.agents/config/<name>/` keys on a name hard-coded in each component's
  scripts (`fellow`, `herdr`, `orchestrate`, `atlassian`), not on the plugin name. Saved
  settings keep working without migration.
- **The `agent-config` CLI.** The `bin/agent-config` entry point and `AGENT_CONFIG_ROOT`
  keep their names; consumers spawn it by that name.
- **Skill script paths.** The fellow, atlassian, orchestrate, and herdr skill directories
  keep their names, so every `$CLAUDE_PLUGIN_ROOT/skills/<skill>/scripts/...` reference
  still resolves.
- **The marketplace name** `max-skills` — changing it would force every user to re-add it.
- **Historical docs** — plans, specs, and orchestration logs keep the names they were
  written with.

## Transition

A hard cut: the old marketplace entries are removed in the same change. Keeping them as
shims would register each skill twice for anyone holding both. The root README gains a
"Migrating from the old plugin names" block:

```bash
/plugin uninstall text-density-analyzer@max-skills   # and each other old name you have
/plugin marketplace update max-skills
/plugin install ml-slop@max-skills                   # and each new plugin you want
```

## Guardrails

- **`scripts/validate-naming.sh`** enforces the naming rules: every marketplace entry is
  `ml-` kebab-case, matches its directory and its `plugin.json` `name`; every skill's
  frontmatter `name:` equals its directory and contains no colon.
- **ADR** `docs/adr/0001-ml-plugin-namespacing.md` records the rules and the `ml-` vs `ml:`
  constraint, so the choice is not relitigated.
- **CONTRIBUTING.md** and **AGENTS.md** state the naming rules and point at the script.

## Verification

1. `bash scripts/validate-naming.sh` passes.
2. `claude plugin validate` passes, without a naming warning, for each of the four plugins
   and the marketplace.
3. `plugins/ml-agent-config/skills/setup/scripts/vendor.sh check` reports no drift.
4. The atlassian suite (`bun test` in `ml-workplace/skills/atlassian/scripts`) passes from
   its new location.
5. `grep` finds no stale old plugin name or old skill path outside historical docs and
   the README migration block.
6. Installed from the working tree as a directory marketplace in a throwaway project, all
   seven commands resolve: `/ml-slop:text`, `/ml-slop:code`, `/ml-subagents:orchestrate`,
   `/ml-subagents:herdr`, `/ml-workplace:atlassian`, `/ml-workplace:fellow`,
   `/ml-agent-config:setup`.

## Out of scope

- Splitting the atlassian skill into `jira` and `confluence`.
- A CI workflow; the validation script runs locally.
- A `displayName` for the plugin picker.
