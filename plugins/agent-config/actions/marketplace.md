---
id: agent-config:marketplace
type: code
parallel: true
---

This action registers a plugin marketplace that the harness does not yet know about, so that a
following `agent-config:install` action can resolve the plugin it needs from that marketplace.

Run the `command` verbatim. The CLI has already filled it in for the detected harness:
- Claude Code: `claude plugin marketplace add <source>`
- Codex: `codex plugin marketplace add <source>`

The `context` object carries:
- `marketplace` — the marketplace's name
- `url` — the marketplace's source

On failure, the two most common causes are no network connectivity and a private repository the
user does not have access to. Report the marketplace name and URL to the user, and state that the
dependent install cannot proceed without this marketplace. Everything that transitively requires
this action — the install it feeds, and anything that in turn requires that install — is skipped.
Unrelated actions in the same batch still run; do not stop the whole batch over this failure.
