# Agent planning poker

Three estimators each size one story and vote blind. The outliers explain, and the votes
converge or go to the user. A round is done when it ends with a **result**:

```
size: <scale value>   confidence: high | low
votes: developer <v>, tester <v>, risk <v>      (round 2 votes, if there was one)
why: <2-3 lines combining the estimators' reasons>
missing: <what the story lacks, or none>
unresolved: true | false   (true: the votes never converged and the user picks; see Round 2)
```

**missing** merges the MISSING items of the last round held: duplicates and rewordings
become one item, and each item is kept in the estimators' own words.

## Round 1: blind votes

Launch the three estimators **in parallel**, as subagents, one per role: `developer`, `tester`,
`risk`. Each brief is the same except for the role, and no brief contains another estimator's
vote:

> You are an estimator in a planning poker round. First read
> `<this-skill-dir>/references/roles/<role>.md` and size from that seat.
> **Scale**, smallest first: `<config.scale>`.
> **Reference stories**, the team's agreed examples of each size: `<value: key — title — why,
> one per line; gaps say "no reference">`.
> **Story** `<key>`: `<title>`
> `<description and comments, as the tracker returned them>`
> Compare this story with the reference stories for effort, complexity and uncertainty. Pick
> exactly one value from the scale. Reply with exactly three lines:
> `SIZE: <value>`
> `WHY: <2-3 lines, naming the reference story you compared it with>`
> `MISSING: <what the story lacks for a confident size, comma separated, or none>`

A reply whose SIZE is not on the scale is sent back once with the scale restated.

## Agreement

**All three SIZE values equal** → that is the size. Confidence is **high**, unless two or more
estimators listed MISSING items; then it is **low**.

## Round 2: outliers explain, everyone re-votes

Any disagreement, adjacent values included, goes to round 2.

1. **Find the outliers.** Two votes agree and one differs → the one who differs is the
   outlier, and the pair's shared reasoning is the other side. All three differ → the highest
   and the lowest by position on the scale are the outliers.
2. **Brief three fresh estimators.** Each gets the round-1 brief, its own round-1 vote, and the
   WHY lines of every voter on the other side of the disagreement, labelled by role. Never
   quote an estimator's own WHY back to it.

   > In round 1 you voted `<v>`. On the other side: `<role> (<v>): <WHY>` …
   > Weigh their reasons, then vote again in the same three-line format.

**Round 2 agrees** → that is the size, and confidence is **low**.

**Still no agreement** → this is the user's call. Order the three votes by position on the scale and
propose the **middle** one, which works the same for numbers and labels. Mark
`unresolved: true` so the job shows all three votes and WHYs. Confidence is **low**.

## Cost

One story costs three estimator runs, or six with a second round. Run at most three stories'
rounds at the same time.
