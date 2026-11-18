# Contributing a plugin

Adding a plugin to this marketplace takes three steps.

## Naming

Every skill in this marketplace is invoked as `/ml-<domain>:<skill>`.

| Thing | Value | Example |
| --- | --- | --- |
| Plugin directory, marketplace entry `name`, `plugin.json` `name` | `ml-<domain>`, all three identical | `ml-slop` |
| Skill directory and its `SKILL.md` frontmatter `name:` | bare kebab-case, identical | `text` |

`<domain>` names what the plugin is for, not the tool its first skill wraps, so a second
skill can join without a rename. Never put the plugin name in a skill's `name:`: Claude Code
adds the prefix itself. `bash scripts/validate-naming.sh` checks all of this; the reasoning is
in [ADR 0001](docs/adr/0001-ml-plugin-namespacing.md).

## 1. Add your plugin files

Create a directory under `plugins/` with both manifests:

```
plugins/
└── ml-my-domain/
    ├── plugin.json              # portable Agent Plugins manifest, read by Codex
    ├── .claude-plugin/
    │   └── plugin.json          # only this file lives inside .claude-plugin/
    ├── commands/                # optional — slash commands (.md files)
    ├── skills/                  # optional — skills (each in its own dir with SKILL.md)
    ├── agents/                  # optional — subagents (.md files)
    ├── hooks/
    │   └── hooks.json           # optional — lifecycle hooks
    └── .mcp.json                # optional — MCP servers
```

Minimal `plugins/ml-my-domain/.claude-plugin/plugin.json` — only `name` is required:

```json
{
  "name": "ml-my-domain",
  "description": "One line on what it does.",
  "version": "0.1.0",
  "author": { "name": "Your Name" }
}
```

Claude Code auto-discovers `commands/`, `skills/`, `agents/`, `hooks/hooks.json`, and `.mcp.json` — you only add explicit paths in `plugin.json` when overriding the defaults.

The portable manifest uses the same name and version:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "ml-my-domain",
  "description": "One line on what it does.",
  "version": "0.1.0"
}
```

Codex discovers `skills/` from this manifest. Point skill commands at paths relative to the
installed skill. Claude Code can put a plugin's `bin/` on PATH. To make a skill explicit-only
in Codex, put `policy.allow_implicit_invocation: false` in its `agents/openai.yaml` as a nested
YAML field. For a plugin that bundles Codex hooks, use `.codex-plugin/plugin.json` with
`skills` and `hooks` paths, as `ml-grilling` does. Codex CLI 0.169.0 loads bundled hooks through
that manifest format. Users review and trust those hooks in Codex before they run.

## 2. Register it in the marketplace

Add an entry to the `plugins` array in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json):

```json
{
  "name": "max-skills",
  "owner": { "name": "Max Levitskiy", "email": "max.dstu@gmail.com" },
  "plugins": [
    {
      "name": "ml-my-domain",
      "source": "./plugins/ml-my-domain",
      "description": "One line on what it does."
    }
  ]
}
```

The `source` is a path relative to the repo root (not to `.claude-plugin/`). You can also point at an external repo instead of vendoring the code:

```json
{ "name": "ml-my-domain", "source": { "source": "github", "repo": "owner/repo" } }
```

## 3. Test and open a PR

Test locally before pushing:

```bash
/plugin marketplace add /path/to/this/repo      # local path works for dev
/plugin install ml-my-domain@max-skills
```

Run `bash scripts/validate-naming.sh` — it must end with `Naming is valid.`

Test the same marketplace in Codex:

```bash
codex plugin marketplace add /path/to/this/repo
codex plugin add ml-my-domain@max-skills
```

Open a new session and verify that the skill appears in the picker and can run its bundled
commands. Use the version script to bump the marketplace and both manifests together.

Every later change to the plugin raises its `version`, or `claude plugin update` keeps the old copy: see AGENTS.md § Releasing a plugin.

Then open a pull request. Also add a row to the **Plugins** table in the [README](README.md).

## References

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Package a portable plugin for Codex](https://developers.openai.com/plugins/build/plugins)
- [Codex skill metadata and invocation policy](https://learn.chatgpt.com/docs/build-skills)
