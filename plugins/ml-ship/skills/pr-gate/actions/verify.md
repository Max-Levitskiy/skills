---
id: verify
type: prompt
parallel: false
---

Run `agent-config load pr-gate --from <this-skill-dir>` and read the file at `config.workflow`. It must be a `digraph` with a `start`, and every path must reach a `complete` or `fail` node. When `provenance.references` is a layer, every file in the folder at `config.references` is named `<node id>.md` or `<node id>.extend.md` for a node of that graph.
