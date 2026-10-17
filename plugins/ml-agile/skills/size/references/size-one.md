# Single sizing

Done when the user has confirmed (or declined) the writes, and every confirmed write is on the
tracker with its link reported.

## 1. Read the story

Run the tracker's *Read one story*. If it already has a size, say so in one line and size it
anyway: the user asked for a fresh estimate.

## 2. Poker

Run `references/poker.md` on it.

## 3. Propose a split when it is big

**If the size is at or above `config.split.threshold`** (by position on the scale; empty means
the largest value), draft a split into two to four smaller stories:

- **Vertical slices.** Each one delivers something a user can see or test on its own (INVEST),
  never "backend" then "frontend". Split by workflow step, by data variation, by business rule,
  or by peeling off a spike for the unknown part.
- **Each child** gets a title, a one-line scope, and its own acceptance criteria.
- **Size each child** with `references/poker.md`.

When a child still comes out at or above the threshold, say the split needs another pass rather
than splitting recursively.

## 4. Show and confirm

```
PROJ-42  Export invoices as CSV           size 8   (high confidence)
  votes   developer 8 · tester 8 · risk 8
  why     <combined reasoning>
  missing <items, or none>
```

When the round ended split, show each estimator's vote and WHY, and the proposed middle value.
When there is a split proposal, list each child with its title, scope and size.

Then one question listing exactly what would be written:

- the size on the story;
- each child story to create, with its title and size.

The user may accept, change the size to any scale value, drop the split, or cancel.

## 5. Write

Apply only what was confirmed, using the tracker's *Write a size* and *Create child stories*.
Write the parent's size first, then each child with its size. Report each story's link. If one
write fails, finish the others and report the failure with the tracker's message.
