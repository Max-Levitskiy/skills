---
id: verify
type: prompt
parallel: false
---

Run `agent-config load pr-gate --from <this-skill-dir>` and read the file at `config.workflow`. It must be a `digraph` with a `start`, and every path must reach a `complete` or `fail` node.
