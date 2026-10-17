# Calibration

The goal is one **reference story** per scale value: a finished story the team will agree is
"a 3" or "an M". The user confirms every choice. Calibration is done when each scale value
has a confirmed story or is reported as a gap, and the result is written to the repo layer.

## 1. Gather

Run the tracker's *Find recently closed stories* with `config.calibration.sample`. Keep only
the list (key, title, created, closed, current size if any, linked PRs) in this session.

## 2. Summarise in batches

Split the list into batches of 10. Brief one subagent per batch, up to three at a time:

> Summarise these closed stories for story-point calibration. For each, read the story and its
> comments, and look at its linked change with the commands below. Reply with one line per
> story, no other text:
> `KEY | title | size on ticket or - | files changed, +added/-deleted lines or no linked change | days open | signals`
> **Signals** are what the comments show about effort: rework, a reopened story, scope added
> mid-way, waiting on others, surprises, or *clean* when nothing stands out. At most 12 words.
> Stories: `<keys>`. Commands: `<the tracker's Read one story and linked-change commands>`.

## 3. Rank by effort

Order the summary lines from least to most effort. Weigh the evidence together:

- **Spread beats size.** Ten files across three areas is more effort than 400 lines in one
  generated file.
- **Rework and scope signals add effort.**
- **Days open is the weakest signal.** A story can sit in review for a week and still be small.
- **Sizes already on tickets** show what the team meant by each value. Where a story's size
  matches its evidence, it is a strong candidate for that value. Where the size and the evidence
  disagree, leave it out.

## 4. Propose

Walk the ranked list against the scale, smallest first. For each value, pick the story that
best typifies it, preferring:

1. stories with a linked change;
2. *clean* signals;
3. recent ones;
4. different areas of the codebase across the set.

Each step up the scale should look like clearly more work than the one below. When no story
fits a value (big values often have none), mark it as a **gap**. Never stretch a story to fill a
value.

Show one table:

| Size | Story | Title | Why this size |
| --- | --- | --- | --- |
| 1 | #118 | Fix typo in config error | 1 file, 4 lines, closed same day, clean |
| … | | | |
| 13 | — | gap: no closed story this large | |

Then ask the user to confirm the set, swap any row for another story, or drop one. If they name
a story to swap in, run the tracker's *Read one story* for it and write its row.

## 5. Write

Build `referenceStories`:

- one entry per confirmed value, keyed by the value as a string (`"3"`, `"M"`), shaped
  `{key, title, why}`;
- plus `"calibratedAt": "<today, YYYY-MM-DD>"`;
- gaps left out.

Replace the old object whole, then merge it into the repo layer, with `$P` from SKILL.md, Writing config:

```bash
{ cat "$P" 2>/dev/null || echo '{}'; } | jq --argjson rs "$REFS" '.referenceStories = $rs' \
  | "$AC" write size --layer repo --from <this-skill-dir>
```

Tell the user which file to commit, and list any gaps. Until a gap is filled, estimators size
against the neighbouring values. A later calibration, once larger stories have closed, fills it.

## After a scale change

Do the same steps against the new scale. Sizes already on tickets are not converted. They stay
evidence of what the team did before, and step 3 uses them only when the old and new scales
share that value.
