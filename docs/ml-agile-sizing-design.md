# ml-agile: story sizing (`/ml-agile:size`)

`ml-agile` is a new plugin in this marketplace. Its first skill, `/ml-agile:size`, assigns
story points to stories in Jira or GitHub issues. It works the way a Scrum team does. The
team agrees on **reference stories**, one finished story for each value on the **scale**.
Each new story is sized against them by **agent planning poker**: three estimators in
different roles vote independently, and the outliers explain their number. Nothing reaches
the tracker until a person confirms. One command does three jobs:

- **Calibration** studies recently closed stories (diffs, how long they stayed open,
  comments) and proposes the reference stories.
- **Single sizing** sizes one story.
- **A sweep** sizes the open unsized backlog. It also flags stories that need refinement
  and proposes splits for oversized ones.

The scale and the reference stories live in agent-config, so the team shares them and anyone
can override them through the usual layers. The skill loads only the instructions for the
current job and tracker.

## Terms

- **Story point** — A relative measure of a story's effort, complexity and uncertainty
  compared with other stories, not hours. _Avoid_: estimate in hours, time estimate.
- **Scale** — The ordered set of values a story may receive: Fibonacci by default, or a
  custom list of numbers or T-shirt labels. _Avoid_: range, steps, sizes list.
- **Reference story** — A finished story the team agrees represents one value on the scale,
  used as the yardstick when sizing new stories. _Avoid_: golden story, anchor ticket, example.
- **Calibration** — Building or refreshing the set of reference stories from recently closed
  work. _Avoid_: training, setup.
- **Estimator** — One of the three independent agents that vote a size for a story during
  agent planning poker, each in a fixed role. (Used in this doc; no Avoid list was set.)
- **Sweep** — One run over a filtered set of open, unsized stories: size each, flag what needs
  refinement, propose splits. (Used in this doc.)

## Why

In the user's words: "the main idea that we are assigning story points to our stories, so we
are using agent config for configuring story points like minimum, maximum, the steps of it,
like maybe it can be the standard Fibonacci, or a user can add their own size … like S, L, XL,
medium … but the default should be the standard Fibonacci numbers."

The user wants reference stories found the way Scrum teams find them, with the agent doing the
legwork. In their words, it should "do some analysis of the latest stories which were closed …
to understand how much changes was done, how much effort it was, like maybe analyze some
comments related to that story." Once configured, it should "size the story … or just go
through all our backlog and suggest to refine the story", applying "standard Scrum practices
… for the AI agentic flows". It must also be frugal with context: "the skill should load the
needed files, depends on the configuration … not drop everything in the context".

## Locked decisions

### 1. Trackers: Jira and GitHub issues, one adapter each

The skill supports both trackers. Jira goes through the existing `ml-workplace:atlassian` skill
and its CLI; GitHub goes through `gh`. **If agent-config already has the Atlassian skill
configured, Jira is the default tracker for ml-agile too.** Otherwise the tracker follows the
repo (a GitHub remote means GitHub), or the user says. Each adapter is a short reference file
loaded only when that tracker is in use.

Rejected:
- **Jira only** — leaves every GitHub-tracked repo (this one included) unsized.
- **GitHub only** — leaves the user's Jira work unsized.
- **Tracker-agnostic text only** (the skill sizes whatever is pasted) — most portable, but it
  cannot sweep a backlog or study closed stories, which are the heart of the request.

### 2. Reference stories come from calibration over closed work, confirmed by a person

Calibration studies about the last 40 closed stories, including their linked PRs and commits
(size and spread of the diff), how long each stayed open, and the comment thread (rework,
surprises, scope changes). It proposes one reference story per scale value with a one-line
reason, and the user confirms or swaps each. Calibration runs on request. It also runs by
itself on the first run when no reference stories exist. The skill nudges the user to
recalibrate when the reference stories are more than 90 days old.

Rejected:
- **The user names reference stories by hand** — cheap, but leaves the research to the user,
  which is the work they wanted the agent to do.
- **No reference stories, size from text alone** — numbers drift because nothing anchors them,
  so "a 5" means different things from run to run.

### 3. Scale and reference stories live in agent-config, written to the repo layer

Both are agent-config keys. The scale defaults to Fibonacci. Calibration writes the confirmed
reference stories to the **repo layer**, so they are committed and shared by the team. Anyone
can override either key in their **user-repo** or **local layer** with agent-config's standard
layering. No separate file and no special override mechanism are needed. Each reference-story
entry is small: story key, title, and a one-line reason it is that size. The full calibration
evidence is not stored, so loading config stays cheap.

Rejected:
- **Personal only, nothing committed** — two people get different sizes for the same story
  because they measure against different yardsticks.
- **A separate committed file** (for example `docs/agile/reference-stories.md`) with a private
  override set. This was the first proposal. The user pointed out that agent-config already
  provides sharing and overriding, so a separate file only adds a second mechanism.

### 4. Every story is sized by agent planning poker

Every story, in single sizing and in a sweep, gets three independent estimators. Each runs in a
fresh context and sees the story, the reference stories and the scale. They vote without
seeing each other's numbers. If they agree, that is the size. If they split, the outliers
explain their reasoning, everyone re-votes once, and a split that remains goes to the user
with the spread shown and the middle value proposed.

Rejected:
- **One pass** (compare with reference stories, pick the closest) — cheapest, but gives no
  signal when the guess is shaky.
- **One pass by default, poker only for low-confidence or singled-out stories** — this was the
  recommendation. The user preferred to pay roughly three times the cost on every story for a
  consistent process. The cost is bounded by the sweep cap (see Routine choices).

## Routine choices

- **Writing sizes back:** the skill shows each size with its reasoning, and writes to the tracker
  only after the user confirms. A batch gets one confirmation. Rejected: suggest-only, which
  ends every sweep in manual copying, and write-immediately, which silently changes numbers
  sprints are planned on.
- **Where points go on GitHub:** a number field on a GitHub Project board when the repo's
  issues are on a board named in config, and a label (`size:5`, or `size:M` on a T-shirt scale)
  otherwise. The user first picked label-only, then changed to this.
- **Where points go in Jira:** the instance's Story Points field. It is found once and saved
  through the Atlassian skill's `fields` alias map (friendly name → custom field id).
- **Stories too vague or too big in a sweep:** the skill still gives a best-guess size, marked
  low confidence, and lists what is missing (acceptance criteria, scope, unknowns). For a story
  above the split size (13 by default, configurable) it also proposes a split into smaller
  stories. It does not comment questions on tickets, and does not leave stories unsized.
- **Accepted splits:** the skill creates the smaller stories, linked to the original (Jira
  children, GitHub sub-issues) and each sized, in the same confirmation as the sizes. The
  confirmation lists every new story's title and size before anything is written. Rejected:
  posting the split as a comment (forgotten), and keeping it in the report only (lost when the
  session ends).
- **Command shape:** one command, `/ml-agile:size`, that works out the job from the request.
  Examples: `/ml-agile:size PROJ-42`, `/ml-agile:size the backlog`,
  `/ml-agile:size recalibrate`. A vague request gets a one-line question. Rejected: separate
  `calibrate` / `size` / `refine` commands, which put rarely used jobs in the menu and leave
  the first-run order to the user.
- **Estimator roles:** three roles, like a cross-functional team:
  1. a developer who reads the code the story touches;
  2. a tester who thinks about testing and edge cases;
  3. someone who looks at dependencies, integrations and risk.

  Rejected: three identical estimators (they mostly agree, so it costs three times as much for
  little new information); roles defined in config (a config surface nobody has asked for yet,
  which can be added later without breaking this).
- **Default scale:** Fibonacci 1, 2, 3, 5, 8, 13. Alternatives: a custom list of numbers, or
  ordered T-shirt labels (XS, S, M, L, XL). The scale is configured in the repo layer.
- **Changing the scale:** the skill asks for a recalibration (old reference stories map to
  values that may no longer exist) and leaves sizes already on tickets alone.
- **Sweep scope:** open, unsized stories, narrowed by a filter the user gives (sprint, label,
  milestone, JQL or `gh` search). At most 20 stories per run by default, configurable, because
  each story costs three estimators.
- **Naming:** plugin `ml-agile`, skill `size`, which gives `/ml-agile:size`, per CONTRIBUTING.md
  § Naming and ADR 0001. Run `bash scripts/validate-naming.sh` after adding it.

### Context loading (from the user's requirement; not a separate question)

`SKILL.md` is a short router. It reads the config with `agent-config`, determines the job and
the tracker, and loads only the matching files:

| File | Loaded when |
| --- | --- |
| `references/calibrate.md` | calibration (explicit, first run, or after a scale change) |
| `references/size-one.md` | single sizing |
| `references/sweep.md` | a sweep (includes refinement flags and split proposals) |
| `references/poker.md` + the three role prompts | any sizing |
| `references/tracker-jira.md` | tracker is Jira |
| `references/tracker-github.md` | tracker is GitHub |

The estimators are subagents. Their context holds the story, the reference-story entries and
their role prompt. It never holds the whole backlog or the calibration evidence. Calibration
reads closed stories in batches and keeps only a short summary per story.

### agent-config keys (as implemented in `plugins/ml-agile/skills/size/agent-config.json`)

| Key | Layer | Default | Meaning |
| --- | --- | --- | --- |
| `tracker` | repo | `auto` | `auto` (Jira if the Atlassian skill is configured, else GitHub from the remote), `jira`, `github` |
| `scale` | repo | `[1,2,3,5,8,13]` | ordered values, smallest first; numbers or labels (a list of labels is a T-shirt scale, so no separate kind key) |
| `referenceStories` | repo | `{}` | scale value → `{ key, title, why }`, plus a `calibratedAt` date |
| `split.threshold` | repo | `""` | stories at or above this value get a split proposal; empty means the largest value, so it works for any scale |
| `sweep.max` | repo | `20` | stories sized per sweep run |
| `calibration.sample` | repo | `40` | closed stories studied per calibration |
| `calibration.staleDays` | repo | `90` | age after which the skill nudges a recalibration |
| `github.project` | repo | `""` | GitHub Project board (`owner/number`) whose field holds the size; empty means labels |
| `github.field` | repo | `Size` | the Project field's name: a number field, or single-select for a label scale |
| `labelPrefix` | repo | `size:` | label prefix wherever sizes are labels (GitHub without a board; Jira with a label scale and no select field) |

## Verified facts

- Plugins here are named `ml-<domain>` and skills are bare (CONTRIBUTING.md § Naming, ADR 0001).
  `scripts/validate-naming.sh` checks this.
- A skill declares its config in an `agent-config.json` beside `SKILL.md`, with a schema of keys,
  a recommended `layer` for each, defaults and JSON Schema types. `ml-workplace/skills/atlassian`
  is the model to copy, including its `actions/onboard.md` for missing keys.
- The Atlassian skill already has a repo-layer `fields` map (friendly name → Jira field id,
  e.g. `points` → `customfield_10016`). ml-agile can reuse it for the Story Points field rather
  than keeping its own.
- agent-config layers are global → repo → user-repo → local (CONTEXT.md). The repo layer is
  committed; user-repo and local are the user's own overrides.
- AGENTS.md requires every PR that changes a plugin's files to raise that plugin's version.
  A new plugin starts at its first version and needs a marketplace entry.
- GitHub issues have no native points field; sub-issues are enabled in this repo
  (docs/agents/issue-tracker.md), so GitHub splits can be real sub-issues.

## Risks

- **Cost of always-on poker.** Three estimators per story, plus re-votes, makes a 20-story
  sweep roughly 60–80 subagent runs. The sweep cap bounds it; if it still bites, the rejected
  one-pass-by-default mode is the natural fallback.
- **Calibration evidence on Jira.** Linked PRs and commits come from Jira's development panel
  or from issue keys in commit messages. A Jira instance without either leaves only time-open
  and comments to go on, which gives weaker reference stories.
- **Atlassian skill coupling.** ml-agile reads the Atlassian skill's configuration and `fields`
  map. A change to those keys would break the Jira adapter quietly; the adapter should check
  that they are present and say so.
- **GitHub Project fields** need the `project` scope on the `gh` token. Without it, writes
  fail; the adapter should detect this and fall back to labels with a warning.
- **Reference stories in a shared repo layer.** A careless recalibration rewrites the team's
  yardstick for everyone. Because it is a committed change, it is reviewable, but only if
  someone reviews it.
- **Split creation** writes several tickets in one confirmation. A rushed "yes" makes clean-up
  work; the confirmation must list every new ticket clearly.

## Deferred

None. Nothing was deferred during the interview.

## Open threads

- Whether the skill should later compare estimates with actual effort (a retro-style
  "were our 5s really 5s?") was not discussed. The user mentioned "maybe we'll add some more
  ways to do that"; this is a candidate for a second skill in the plugin.
