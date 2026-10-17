# Backlog sweep

A sweep sizes a slice of the open, unsized backlog and shows what needs refinement before the
team commits to it. It is done when every story in the batch has a row in the report, the user
has confirmed (or declined) the writes, and every confirmed write is on the tracker.

## 1. Pick the batch

Turn the user's words into the tracker's filter: a sprint, label, milestone, epic, assignee, or
plain JQL or `gh` search. No filter given → the whole open backlog. Run the tracker's *Find open
unsized stories* with a limit of `config.sweep.max + 1`.

- **Nothing found** → say so, and stop.
- **More than `sweep.max`** → take the first `sweep.max` in tracker order (rank, or newest
  first). Say how many more remain, and that the next run picks them up, since sized stories
  drop out of the filter.

## 2. Size each story

Read each story (the tracker's *Read one story*) and run `references/poker.md` on it, at most
three stories at a time. Keep only each story's result here, not the estimators' full replies.

For each story at or above `config.split.threshold` (by position; empty means the largest
value), draft a split and size its children, as `references/size-one.md` step 3 describes.

## 3. Report

One table, in tracker order:

| Story | Title | Size | Conf. | Needs refinement | Split |
| --- | --- | --- | --- | --- | --- |
| #142 | Export invoices as CSV | 5 | high | — | — |
| #145 | Improve search | 8 | low | acceptance criteria; which search (site or admin)? | — |
| #147 | Multi-currency checkout | 13 | low | currency source undecided | 3 stories: 5, 5, 3 |

- **Needs refinement** lists the merged MISSING items. A low-confidence row is still sized,
  because a best guess is useful for planning, and the row says what would firm it up.
- **Split rows** are listed below the table: each child's title, scope and size.
- **Split votes** (the round ended with the estimators disagreeing) are listed below the table:
  the three votes, their WHY lines, and the proposed middle value.

End with the totals: stories sized, points by confidence, and how many need refinement.

## 4. Confirm once

One question listing every write:

- each story and its size;
- each child story to create, with its title and size.

The user may accept all, change any size to another scale value, drop any row or split, or
cancel. Apply only what was confirmed, with the tracker's *Write a size* and *Create child
stories*. Write each parent before its children.

Report what was written, with links, and any failures with the tracker's message. Offer the next
batch when more remained.
