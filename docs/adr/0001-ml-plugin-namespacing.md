# 0001 — Plugins are `ml-<domain>`; skills are bare

**Date:** 2026-09-19 · **Status:** accepted

## Context

Seven plugins each held one skill named after the plugin (`/fellow:fellow`), with
nothing marking them as this marketplace's and no room for a second skill. Claude Code
namespaces a plugin's skills as `<plugin.json name>:<skill name>` — one level, added
by the harness.

## Decision

- A plugin is named `ml-<domain>`, lowercase kebab-case, and the same string is its
  `plugins/` directory, its marketplace entry `name`, and its `plugin.json` `name`.
  `<domain>` says what the plugin is for, not which tool its first skill wraps.
- A skill's frontmatter `name:` equals its directory and is bare: `text`, never
  `ml-slop:text` (that yields `/ml-slop:ml-slop:text`).
- `scripts/validate-naming.sh` enforces both.

## Why `ml-` and not `ml:`

A colon in `plugin.json`'s `name` does work: installed from a marketplace, Claude Code
2.1.278 resolves `/ml:slop:text`. But claude.ai marketplace sync requires kebab-case
plugin names and rejects the colon, and these plugins must sync there. If that
constraint ever lifts, only the `plugin.json` `name` field would change.

## Consequences

- Grouped skills install together, and every installed skill's description costs context
  in every session. Group by what a user wants together, not by theme alone.
- Config names (`~/.agents/config/<name>/`) name the tool, not the plugin, so renaming or
  regrouping a plugin never moves a user's settings.
- Renaming a plugin is a hard cut for existing installs: they must uninstall the old name
  and install the new one.
