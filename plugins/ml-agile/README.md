# ml-agile

Agile practice for AI agents.

```bash
/plugin install ml-agile@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-agile:size` | Give stories story points the way a Scrum team does: calibrate reference stories, size one story or sweep the backlog by agent planning poker, flag what needs refinement, propose splits |

## `/ml-agile:size`

- *"Size PROJ-42."*
- *"Go through the backlog and size everything that isn't pointed."*
- *"Size the stories labelled checkout, and tell me which ones aren't ready."*
- *"Recalibrate our reference stories."*
- *"Switch us to T-shirt sizes."*

### What it does

**Reference stories first.** Sizing is relative, so the skill first finds a yardstick. It
studies recently closed stories (40 by default), looking at their linked PRs and commits, how
long each stayed open, and their comments. It then proposes one reference story per scale value,
each with a one-line reason, and you confirm or swap each one. It does this on the first run by
itself, and suggests a refresh once the reference stories are 90 days old.

**Agent planning poker.** Every story gets three estimators, each in a fresh context and each
seeing only the story, the reference stories and the scale:

- a **developer** who reads the code the story touches;
- a **tester** who thinks about testing and edge cases;
- a **risk** estimator who looks at dependencies and integrations.

They vote blind. If they split, the outliers explain and everyone re-votes once. A split that
remains comes to you with the spread shown and the middle value proposed.

**Refinement in a sweep.** A sweep sizes open, unsized stories that match your filter, 20 per
run by default.

- A vague story still gets a best-guess size, marked low confidence, with what's missing listed.
- A story at the top of the scale gets a proposed split into smaller stories.

**You confirm every write.** Sizes, and child stories from accepted splits, are written in one
batch after one confirmation.

### Trackers

| Tracker | Through | Where the size goes |
| --- | --- | --- |
| Jira | [`ml-workplace:atlassian`](../ml-workplace) | the Story Points field, found once and saved as the Atlassian skill's `fields.points` |
| GitHub issues | `gh` | a number field on the Project board in `github.project`, or a `size:5` / `size:M` label |

Jira is chosen when the Atlassian skill is configured, GitHub when the repo has a GitHub remote.
Set `tracker` to pin one.

### Configuration

Settings live in [agent-config](../ml-agent-config) under the name `size`. They are written to
the repo layer and committed, so the whole team sizes against the same scale and reference
stories. Override any of them in your user-repo or local layer.

| Key | Default | |
| --- | --- | --- |
| `scale` | `[1,2,3,5,8,13]` | Smallest first: any numbers, or labels such as `["XS","S","M","L","XL"]` |
| `referenceStories` | `{}` | Written by calibration once you confirm |
| `tracker` | `auto` | `auto`, `jira`, `github` |
| `split.threshold` | largest value | Sizes at or above it get a split proposal |
| `sweep.max` | `20` | Stories per sweep |
| `calibration.sample` | `40` | Closed stories studied |
| `calibration.staleDays` | `90` | When to suggest recalibrating |
| `github.project`, `github.field` | `""`, `Size` | Project board (`owner/number`) and its number field; empty means labels |
| `labelPrefix` | `size:` | Size label prefix, where sizes are labels |

Needs [ml-agent-config](../ml-agent-config). Jira also needs `ml-workplace` and its `atlassian`
skill configured.
