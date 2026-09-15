# Skills — Claude Code Plugin Marketplace: Skills, Subagents, Hooks & MCP Servers

> A **Claude Code plugin marketplace**: install curated plugins — slash commands, skills, subagents, hooks, and MCP servers — into [Claude Code](https://code.claude.com) with a single command.

Add this marketplace to Claude Code:

```bash
/plugin marketplace add Max-Levitskiy/skills
```

Then browse and install plugins:

```bash
/plugin                                          # open the interactive plugin browser
/plugin install <plugin-name>@max-skills
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
/plugin install <plugin-name>@max-skills
```

**3. Keep it current:**

```bash
/plugin marketplace update max-skills
```

Prefer a UI? Run `/plugin` to open the interactive browser, pick a plugin, and install it there.

## Plugins

| Plugin | Description | Install |
| ------ | ----------- | ------- |
| [`text-density-analyzer`](plugins/text-density-analyzer) | Detect repeated information and measure information density in text. Score or fix AI-generated bloat, semantic repetition, and filler content. | `/plugin install text-density-analyzer@max-skills` |
| [`fellow`](plugins/fellow) | Query Fellow meeting notes, transcripts, AI summaries, and action items via the Fellow REST API. Search past meetings, write recaps into a repo, bulk-export to markdown. | `/plugin install fellow@max-skills` |
| [`orchestrate`](plugins/orchestrate) | Run a multi-part task as small, tracked, parallel work packages — one agent, one output file each — with an async question protocol so waiting on human decisions never blocks progress. | `/plugin install orchestrate@max-skills` |
| [`code-density-analyzer`](plugins/code-density-analyzer) | Detect AI-generation slop in code — duplication, dead code, redundant comments, verbosity, over-abstraction, error masking, convention violations, hallucinated dependencies, and performance waste. Scores a git diff or standalone files via 10 parallel analysis methods. | `/plugin install code-density-analyzer@max-skills` |
| [`agent-config`](plugins/agent-config) | Give a skill or subagent layered settings — global, repo, and a gitignored local layer — plus credentials referenced from 1Password, the environment, a dotenv file, Keychain, or any command, so a secret never lands in a config file. Includes a re-runnable onboarding flow and a zero-dependency loader other plugins vendor instead of rewriting. | `/plugin install agent-config@max-skills` |
| [`herdr`](plugins/herdr) | Run and manage AI subagents in herdr panes from presets stored in agent config - start, ask, read, converse, list, stop - and drive the workspace manager itself: workspaces, worktrees, tabs, panes, and "which one am I in". | `/plugin install herdr@max-skills` |
| [`atlassian`](plugins/atlassian) | Jira and Confluence over their REST APIs from a bundled `bun` CLI - JQL search, read and create issues, comment, transition, sprints and boards, and read, write, and update Confluence pages. Cloud and Data Center, no MCP server. | `/plugin install atlassian@max-skills` |
| [`code-comment-guidelines`](plugins/code-comment-guidelines) | Explicit-only code comment guidelines for Claude Code and OpenAI Codex. Comments are reserved for non-obvious constraints, invariants, workarounds, or surprising behavior. | `/plugin install code-comment-guidelines@max-skills` |

## Standards

Conventions shared by plugins in this marketplace.

| Standard | What it covers |
| -------- | -------------- |
| [Agent Config Standard](standards/agent-config.md) | How a skill or subagent stores settings across global / repo / local layers, and references secrets without ever committing one. Canonical implementation: [`agent-config`](plugins/agent-config). Reference implementations: [`fellow`](plugins/fellow) (credential-backed) and [`orchestrate`](plugins/orchestrate) (optional config, credential only for hosted trackers). |

## Add your own plugin

Contributions welcome. In short:

1. Drop your plugin under `plugins/<your-plugin>/` with a `.claude-plugin/plugin.json`.
2. Register it in `.claude-plugin/marketplace.json` with a `./plugins/<your-plugin>` source.
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
