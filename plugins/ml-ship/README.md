# ml-ship

Get a change landed.

```bash
/plugin install ml-ship@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-ship:pr-gate` | Validate a GitHub pull request or GitLab merge request end to end, watch its CI, triage what the review bots said, and merge it when you ask |

## `/ml-ship:pr-gate`

A pull request is a proposal. This turns it into a verdict backed by evidence, and acts on that verdict only when you say so. It works on GitHub pull requests and GitLab merge requests.

- *"Is #1043 safe to merge?"*
- *"Why is this check red?"*
- *"Is !49 ready? The pipeline was still running."*
- *"Renovate bumped the worker image. Does that break anything?"*
- *"Address the review comments on this PR."*
- *"Merge it if nothing is broken."*

### How it works

The procedure is a graph, [`skills/pr-gate/workflow.dot`](skills/pr-gate/workflow.dot), written in [SWL-DOT](https://runspore.com/docs#notation). The agent walks it node by node: read the facts, watch CI, verify the change, triage the reviews, classify a red check, fix, judge, merge if asked, report. Every push goes back to the facts, because a result on an old commit proves nothing about the new one. `SKILL.md` only says how to walk it, and each node's detail is in `references/<node>.md`.

### Replacing the graph

Copy `workflow.dot` next to a config layer, change it, and point the `workflow` key at it:

```bash
cp <skill>/workflow.dot .agents/config/pr-gate/gate.dot
echo '{ "workflow": "gate.dot" }' | agent-config write pr-gate --layer repo
```

A node you keep reuses its `references/<node>.md`. A node you add is described by its `label`. A PR that changes the graph it would be judged by is walked with the default one instead.

### Requirements

`git`, `bun`, `ml-agent-config`, and the CLI of your forge, authenticated: `gh` for GitHub, `glab` for GitLab.

### Files

| Path | What is in it |
| --- | --- |
| `skills/pr-gate/workflow.dot` | The default graph |
| `skills/pr-gate/references/<node>.md` | What a node needs beyond its label |
| `skills/pr-gate/references/gitlab.md` | The GitLab side: term mapping, what misleads in the facts, and the `glab` commands |
| `skills/pr-gate/scripts/pr-facts.ts` | The read-only fact pass, with `--wait` to watch CI to a settled result |

## License

MIT
