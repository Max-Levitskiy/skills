# Skills — Claude Code Plugin Marketplace: Skills, Subagents, Hooks & MCP Servers

> A **Claude Code plugin marketplace**: install curated plugins — slash commands, skills, subagents, hooks, and MCP servers — into [Claude Code](https://code.claude.com) with a single command.

Add this marketplace to Claude Code:

```bash
/plugin marketplace add Max-Levitskiy/skills
```

Then browse and install plugins:

```bash
/plugin                                          # open the interactive plugin browser
/plugin install ml-<domain>@max-skills
```

---

## What is this?

This repo is a [Claude Code](https://code.claude.com) **plugin marketplace** — a Git repository that packages and distributes Claude Code plugins so anyone can install them in seconds. A plugin can bundle any combination of:

- **Slash commands** — custom `/commands` for repeatable workflows
- **Skills** — model-invoked capabilities that trigger automatically when relevant
- **Subagents** — specialized agents for focused tasks
- **Hooks** — automation that runs on Claude Code lifecycle events
- **MCP servers** — connections to external tools and data via the Model Context Protocol

## Install

**1. Add the marketplace** (one time):

```bash
/plugin marketplace add Max-Levitskiy/skills
```

**2. Install a plugin:**

```bash
/plugin install ml-<domain>@max-skills
```

**3. Keep it current:**

```bash
/plugin marketplace update max-skills
```

Prefer a UI? Run `/plugin` to open the interactive browser, pick a plugin, and install it there.

Every skill is invoked as `/ml-<plugin>:<skill>`.

| Plugin | Skills | What it's for | Install |
| ------ | ------ | ------------- | ------- |
| [`ml-slop`](plugins/ml-slop) | `/ml-slop:text` · `/ml-slop:code` · `/ml-slop:comments` | Find and score AI-generation slop in prose and in code: repeated meaning, filler, duplication, dead code, over-abstraction. Text can also be rewritten to remove it, and `comments` is the rule for not writing the slop in the first place. | `/plugin install ml-slop@max-skills` |
| [`ml-workplace`](plugins/ml-workplace) | `/ml-workplace:atlassian` · `/ml-workplace:fellow` | The tools a team works in. Jira and Confluence over REST (Cloud and Data Center), and read-only Fellow meeting notes, transcripts, and action items. Bundled `bun` CLIs, no MCP server. | `/plugin install ml-workplace@max-skills` |
| [`ml-subagents`](plugins/ml-subagents) | `/ml-subagents:orchestrate` · `/ml-subagents:herdr` | Run and coordinate AI subagents: split a task into tracked parallel work packages with an async question protocol, or drive subagents in herdr panes from named presets. | `/plugin install ml-subagents@max-skills` |
| [`ml-ship`](plugins/ml-ship) | `/ml-ship:pr-gate` | Get a change landed. Validate a GitHub pull request or GitLab merge request against artifacts instead of prose, watch and diagnose its CI, triage what the review bots found, and merge on the commit you checked. | `/plugin install ml-ship@max-skills` |
| [`ml-agent-config`](plugins/ml-agent-config) | `/ml-agent-config:setup` | Layered settings for any skill or subagent — global, repo, and a gitignored local layer — plus credentials referenced from 1Password, the environment, a dotenv file, Keychain, or any command, so a secret never lands in a config file. On Claude Code, `/agent-config` opens a settings pane, and 1Password is approved once per session. | `/plugin install ml-agent-config@max-skills` |

### Migrating from the old plugin names

On 2026-09-19 the seven single-skill plugins were regrouped. Old installs stop receiving
updates; swap them once:

| Old plugin | Now |
| --- | --- |
| `text-density-analyzer`, `code-density-analyzer` | `ml-slop` → `/ml-slop:text`, `/ml-slop:code` |
| `atlassian`, `fellow` | `ml-workplace` → `/ml-workplace:atlassian`, `/ml-workplace:fellow` |
| `orchestrate`, `herdr` | `ml-subagents` → `/ml-subagents:orchestrate`, `/ml-subagents:herdr` |
| `agent-config` | `ml-agent-config` → `/ml-agent-config:setup` |
| `code-comment-guidelines` | `ml-slop` → `/ml-slop:comments` |

```bash
/plugin uninstall fellow@max-skills            # repeat for each old name you have installed
/plugin marketplace update max-skills
/plugin install ml-workplace@max-skills        # repeat for each new plugin you want
```

If the marketplace already updated and the old plugin no longer appears in the browser, `/plugin uninstall <old-name>@max-skills` still works by name.

Saved settings under `~/.agents/config/` keep working; nothing there moves.

## Standards

Conventions shared by plugins in this marketplace.

| Standard | What it covers |
| -------- | -------------- |
| [Agent Config Standard](standards/agent-config.md) | How a skill or subagent stores settings across global / repo / local layers, and references secrets without ever committing one. Canonical implementation: [`ml-agent-config`](plugins/ml-agent-config). Reference implementations: [`fellow`](plugins/ml-workplace/skills/fellow) (credential-backed) and [`orchestrate`](plugins/ml-subagents/skills/orchestrate) (optional config, credential only for hosted trackers). |

## Add your own plugin

Contributions welcome. In short:

1. Drop your plugin under `plugins/ml-<domain>/` with a `.claude-plugin/plugin.json` whose `name` is `ml-<domain>`. Name `<domain>` for what the plugin is for, so a second skill can join it later.
2. Register it in `.claude-plugin/marketplace.json` with the same `name` and a `./plugins/ml-<domain>` source, then run `bash scripts/validate-naming.sh`.
3. Open a pull request.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full, copy-pasteable steps.

## The Claude Code plugin ecosystem

Other places to discover Claude Code plugins, skills, and marketplaces:

| Source | What it is |
| ------ | ---------- |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Anthropic's official, curated directory of high-quality plugins |
| [Claude Code plugin docs](https://code.claude.com/docs/en/plugins) | Official documentation for creating and using plugins |
| [Plugin marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces) | How to build and distribute a marketplace |
| [claudemarketplaces.com](https://claudemarketplaces.com/) | Community directory of Claude Code skills, plugins & MCP servers |

## Related

Keywords: Claude Code, Claude Code plugins, Claude Code marketplace, Claude plugins, Claude skills, subagents, hooks, MCP servers, Anthropic, AI agents, developer tools.

## License

[MIT](LICENSE) © Max Levitskiy
