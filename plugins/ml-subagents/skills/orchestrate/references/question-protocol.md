# Question protocol — async human decisions that never block

The mechanism that lets orchestrated work run while the human is away: every decision
only the human can make becomes one small document with a stated default, work
continues on the default, and the human answers whenever they get to it — one line is
enough. This file holds the folder layout, the template, the writing rules, and a
worked example.

## Folder layout

Create `questions/` next to the work (inside the workspace's working directory, not at
repo root). One file per question, named `YYYY-MM-DD_<short-slug>.md`, plus a README
that holds the template and the index.

**Only the orchestrator edits the README** — workers create question files only. Two
agents appending to the same index file at the same time is a write race; this split
removes it.

## README skeleton

```markdown
# Questions for <human> — index

> Questions that came up during autonomous work on <parent task link>. One file per
> question. Answer by writing one line in a file's "Your answer" section, or just say
> it in chat.

## How this works
- Anyone (agent or person) who hits a decision only <human> can make creates one file
  here, named `YYYY-MM-DD_<short-slug>.md`, using the template below.
- **Work never stops for an answer.** Each file states a default assumption and work
  continues with it. The answer later confirms or reverses it.
- Writing rules: short sentences, plain words, every abbreviation or project term
  explained on first use. A reader with no project context should understand it.
- Agents do not edit this index file. The orchestrator updates the tables below.

## Template
<the template block below>

## Open questions
| File | Question in one line | Default we proceed with | Status |
|---|---|---|---|

## Answered / closed
| File | Answer | Date |
|---|---|---|
```

## Question file template

```markdown
---
status: open          # open | answered | overtaken-by-events
created: YYYY-MM-DD
raised-by: <package or agent name>
task: <link to the tracker entry, in the project's link style>
---
# Question: <one line>

**What we need from you.** <one sentence — the decision or the missing fact>

**Why this came up.** <2–4 short sentences of context, plain language>

**Options.**
- **A)** <option> — <what happens if chosen>
- **B)** <option> — <what happens if chosen>

**Our default while waiting.** <what we assume and keep doing>

**What this blocks.** <the specific item on hold, if any — often "nothing">
**What continues anyway.** <everything else>

**Your answer.** _(one line is enough)_
```

## Writing rules (why they matter)

- **Plain language, no unexplained terms.** The human may batch-answer days later, on
  a phone, with none of the working context loaded. Every abbreviation, system name,
  or project term gets a bracketed plain-word explanation on first use — even ones
  "everyone knows". Test: would a stranger understand the question?
- **A real default, not a shrug.** "We'll wait for your input" is not a default. Pick
  the option the evidence best supports, say which work proceeds on it, and make the
  later switch cheap — name exactly what changes if the human picks differently
  ("switching is a two-minute edit: delete one table column").
- **Name what's blocked — usually nothing.** The blocks/continues pair is what gives
  the human permission to answer slowly. If something genuinely is blocked, say
  precisely what, so they can prioritize.
- **Options carry consequences, not adjectives.** "A) faster but riskier" is useless;
  "A) real dates on the slide — concrete and checkable, and the point lands without
  anyone saying it" lets the human decide in one read.
- **Don't manufacture questions.** If you can infer the answer confidently, infer it
  and annotate the reasoning in the work itself. A question doc is for genuine forks
  where the human's choice changes the output.

## Worked example

```markdown
---
status: open
created: 2026-07-22
raised-by: delivery-deck package
task: "[[exec-deck-draft]]"
---
# Question: does the delivery calendar show real dates, or only "weeks after signature"?

**What we need from you.** Decide whether the calendar slide carries actual dates
("work starts around 17 August") or only counts weeks from contract signature.

**Why this came up.** The plan cannot start before the contract is signed, and the
signature date is unknown. Real dates make the plan concrete — and quietly show that
a later signature means less delivered by December. Week-counts are softer but can
feel evasive to a decision-maker who wants something he can put in a calendar.

**Options.**
- **A)** Real dates, labelled as a reference calendar assuming an early-August
  signature — concrete and checkable; the shrinking-December point lands on its own.
- **B)** Week-counts only, with the dated example kept in the speaker notes — softer,
  harder to misread as a deadline demand, less tangible.

**Our default while waiting.** Option A. Switching to B is a two-minute edit:
delete one table column and one reference line.

**What this blocks.** Nothing — the deck is presentable under either option.
**What continues anyway.** All ten slides, speaker notes, and the pending-input list.

**Your answer.** _(one line is enough)_
```

## Processing answers

When an answer arrives (in the file or in chat):

1. **Answer = default** → set `status: answered`, move the index row to the answered
   table with the answer and date. No work changes.
2. **Answer overrides the default** → apply the delta. Well-written question docs name
   exactly what the default touched, so this is a targeted edit, not a rework. Then
   update status and index, and add a change note where the affected document's
   conventions require one.
3. **Events made it moot** → set `status: overtaken-by-events` with a one-line note of
   what happened, move to the answered table.

Surface every new question in your report to the human — one line plus the default —
and say which are worth answering soon versus safely deferrable. The index is for
lookup; the report is how questions actually get seen.
