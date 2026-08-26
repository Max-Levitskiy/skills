# atlassian

Jira and Confluence through their REST APIs, driven by a bundled `bun` CLI. No MCP server, no dependencies beyond `bun` itself. Works against Atlassian Cloud (email + API token) and Data Center/Server (personal access token).

```bash
/plugin install atlassian@max-skills
```

## What it does

Say what you want in plain words and Claude goes and does it:

- *"What's assigned to me and still open?"*
- *"File a bug for this stack trace."*
- *"Move NEO-123 to done and comment what changed."*
- *"What does the spec page say about retries?"*
- *"Write this up on the wiki under the platform runbooks."*

On Jira: JQL search, read and create issues, comment, transition status, log work, link issues, sprints and boards. On Confluence: read, create, and update pages, CQL search, footer and inline comments.

It speaks markdown at the edges and converts to whatever the API wants — ADF on Jira Cloud, wiki markup on Data Center, storage XHTML on Confluence. You never see a format conversion.

## Scopes

Most instances mix unrelated streams: a client engagement, an internal platform, one squad's slice of a shared project. "Which tickets are open?" almost never means all of them.

A **scope** is one stream as you name it, bound to the Jira projects and Confluence space that carry it. It supplies project, issue type, labels, space, parent page, and board, so none of that is repeated per command:

```bash
bun $A config scopes             # what's configured; * marks the default
bun $A config scope NEO-123      # which scope owns a ticket prefix
```

Whatever a scope narrowed is printed back, so a filtered answer is never mistaken for the whole picture:

```
12 issue(s).
[scope "neochain" applied: project IN (NEO, NEOINF) — use --no-scope to search everything]
```

An explicit `--project`, `--space`, or a JQL query that already constrains `project` always wins.

## Setup

Ask Claude to set up Atlassian access and it walks you through it. The config file holds a *reference* to your token — 1Password, environment variable, dotenv, macOS Keychain, or any shell command — never the token itself. See `skills/atlassian/config.example.json` for the shape and [the Agent Config Standard](../../standards/agent-config.md) for the layering rules.

Configuration currently lives under the legacy SCS v1 path `~/.agents/skill-config/atlassian/`, which ACS v1 still reads.

## Requirements

- [`bun`](https://bun.sh)
- A Jira/Confluence account with an API token (Cloud) or personal access token (Data Center)

## License

MIT
