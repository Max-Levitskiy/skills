# Agent planning poker

Three estimators each size one story and vote blind. The outliers explain, and the votes
converge or go to the user. A round is done when it ends with a **result**:

```
size: <scale value>   confidence: high | low
votes: developer <v>, tester <v>, risk <v>      (round 2 votes, if there was one)
why: <2-3 lines combining the estimators' reasons>
missing: <what the story lacks, merged from the estimators, or none>
split: true | false   (the user must pick; see Round 2)
```

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

1. The **outliers** are the highest and the lowest votes, ordered by position on the scale.
2. Brief three fresh estimators, each with the round-1 brief plus their own round-1 vote and
   the outliers' WHY lines, labelled by role:

   > In round 1 you voted `<v>`. The highest and lowest voters said: `<role> (<v>): <WHY>` …
   > Weigh their reasons, then vote again in the same three-line format.

**Round 2 agrees** → that is the size, and confidence is **low**.

**Still split** → this is the user's call. Order the three votes by position on the scale and
propose the **middle** one, which works the same for numbers and labels. Mark `split: true` so
the job shows all three votes and WHYs. Confidence is **low**.

## Cost

One story costs three estimator runs, or six with a second round. Run at most three stories'
rounds at the same time.
