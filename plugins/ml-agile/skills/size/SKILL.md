---
name: size
description: Size stories in story points the way a Scrum team does — calibrate reference stories from recently closed work, size one story by agent planning poker, or sweep the backlog to size unsized stories, flag ones that need refinement and propose splits. Jira (through the Atlassian skill) or GitHub issues. Use when the user asks to size, estimate or point a story or ticket, groom or refine the backlog, run planning poker, set up or change the story-point scale (Fibonacci, custom numbers, T-shirt sizes), or recalibrate reference stories.
---

# Size stories

Stories are sized relative to the team's **reference stories** (one finished story per value on
the **scale**), by **agent planning poker**: three estimators vote blind, and the outliers explain
their votes. The skill proposes and the user decides. Nothing reaches the tracker until the user
confirms.

## Start here every time

```bash
AC=$(command -v agent-config || ls -d "$HOME"/.claude/plugins/cache/*/ml-agent-config/*/bin/agent-config \
     "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/ml-agent-config/*/bin/agent-config 2>/dev/null | tail -1)
"$AC" start agile --from <this-skill-dir>
```

`ready: true` → `config` holds every setting. `ready: false` → read the file at `guide`, work
the `actions` list, then re-run. Every key has a default, so a fresh repo is ready. An empty `$AC`
means agent-config isn't installed: tell the user and offer
https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config.

## Pick the tracker

`config.tracker` is `jira` or `github`, or `auto`. For `auto`, the first rule that applies wins:

1. **The story reference says.** `#142` or a github.com URL → **github**. `NEO-123` or an
   atlassian.net or Jira URL → **jira**.
2. **The Atlassian skill is set up for this repo.** `"$AC" start atlassian` prints `ready: true`,
   and `atlassian config show --json` has a non-empty `config.jira.defaultProject` or
   `config.defaultScope` → **jira**. A global Jira site with no project for this repo is someone
   else's work and does not count.
3. `git remote get-url origin` points at github.com → **github**.
4. Otherwise, ask the user in one line.

**Jira chosen** → run `atlassian config check` once. A `FAILED` line means the credential does
not resolve: relay that line, and offer GitHub when the repo has a GitHub remote. **Chosen by
asking, or the rules disagreed with the user** → offer to pin `tracker` in the repo layer (see
Writing config).

The tracker file is `references/tracker-jira.md` or `references/tracker-github.md`; read only the
one in use. Each defines the same five operations: *Read one story*, *Find open unsized
stories*, *Find recently closed stories*, *Write a size*, *Create child stories*. The job files
call them by those names.

## Pick the job

| The user… | Job | Read |
| --- | --- | --- |
| names one story (key, number, URL) | single sizing | `references/size-one.md` |
| asks about the backlog, a sprint, a label, "everything unsized" | sweep | `references/sweep.md` |
| asks to recalibrate or review reference stories | calibration | `references/calibrate.md` |
| asks to change the scale | scale change, then calibration | below, then `references/calibrate.md` |

Single sizing and sweeps also read `references/poker.md`. When the request fits no row, ask one
line: which story, or which slice of the backlog.

**Order of reading:** the tracker file first, then the job's file, then poker.md when the first
story goes to the estimators.

**Before any sizing**, check `config.referenceStories`:

- **Empty, or its values are not on the current scale** → say so in one line, run calibration
  to the end (including its write), then go back to the sizing job.
- **`calibratedAt` older than `config.calibration.staleDays`** → one line suggesting
  `/ml-agile:size recalibrate`, then go on sizing.

## The scale

`config.scale` is ordered smallest first: numbers (Fibonacci `[1,2,3,5,8,13]` by default, or any
list) or labels (`["XS","S","M","L","XL"]`). A size is always one of its values. A list that
mixes numbers and labels is invalid: stop and ask the user which kind they want, then write it.

- **Compare sizes by position on the scale, never by arithmetic.** "At or above the split
  threshold" and "the middle vote" then work for labels too.
- `config.split.threshold` empty means the largest value. A threshold that is not on the scale
  counts as empty: say so once, and offer to write the fix.

**Changing the scale:** write the new list to the repo layer (see Writing config), then
calibrate. The old reference stories map to values that may no longer exist. Sizes already on
tickets stay as they are. In the same write, set `split.threshold` back to empty when its value
is not on the new scale, and tell the user it now means the new largest value.

## Writing config

Change settings through `agent-config write`, never with a file tool. `write` checks the values
against the declaration, and it **replaces the whole layer**, so merge into what is there:

```bash
P=$("$AC" path agile --layer repo --from <this-skill-dir> | jq -r '.layers[0].path')
{ cat "$P" 2>/dev/null || echo '{}'; } | jq '. + {scale: ["XS","S","M","L","XL"]}' \
  | "$AC" write agile --layer repo --from <this-skill-dir>
```

The repo layer is committed and shared by the team. After writing it, tell the user the file to
commit. Someone who wants a private scale or private reference stories writes the same keys to
`--layer user-repo` or `--layer local` instead.

## Context budget

This session holds config, one story at a time and short summaries. Calibration evidence,
backlog pages and estimator reasoning stay in subagents or batches, and only their results come
back. Read a reference file when its job starts, not before.
