---
name: questions
description: How to pick and write the questions you put to a person in a design interview. Use whenever you draft questions for someone to decide — in /grilling, /grill-me, /grill-with-docs, /grill-with-ui, a wayfinder grilling ticket, or any round of "options plus a recommendation". Covers which questions to ask at all (only ones whose answer changes the outcome), what to settle yourself and where to put it, and how to word a question so it reads in seconds.
---

# Interview questions

The person's attention is the scarce resource in an interview. Every question costs a round
trip, so ask only what they alone can decide. Write each question so they can answer it in
seconds, without knowing your vocabulary.

## 1. Sort before you ask

For every candidate question, decide whether it needs the person at all. Ask only when **their
answer changes what they, or the people using the thing, end up with**. Settle everything
else yourself:

| Settle it yourself when… | How |
| --- | --- |
| Established tools agree on the answer (standard practice) | Name the precedent in the doc ("as systemd and Kubernetes do"). Do not ask. |
| The answer is a fact you can look up: docs, `--help`, the code, a quick experiment | Look it up, and use the result in the design. Never ask the person about a tool's flags or behaviour. |
| An earlier decision already implies it | Follow it, and cite that decision. |
| It is routine: naming inside a spec, defaults, timings | Pick a sensible value, and put it in the doc's routine choices. |

What is left is a real trade-off between outcomes the person cares about, such as cost, safety
versus speed, what they will see or type, or what runs while they are away. Often only one
question is left. Sometimes none is: then show what you settled and let them finish.

**A placeholder is not a decision.** A provisional name or default carried over from earlier
work was never the person's choice. If it matters, ask about it; otherwise label it as a
placeholder. Never present it as settled.

## 2. Where the settled points go

- Put them in **one line above the questions** (a grill page's `note`) or in a short list in the
  terminal: at most five items, one line each, in plain words, open to reopening.
- **Never make them a question card** (for example "Settled — no answer needed" with no options).
  An open card with nothing to answer makes the round look unfinished and breaks the flow.
- Mechanisms, file paths, timings and precedents go into the design doc, not on the page.

## 3. Writing a question

- **Title:** the situation in everyday words, told from what happens to the person. For example:
  "The worker dies mid-step. What happens to its command?"
- **Body:** two or three lines, saying only what hangs on the decision. Repository facts go into
  the doc; mention one in a clause at most.
- **Options:** two to four, one line each, in plain words. Use labels like "rerun on its own"
  and "ask me first", not mechanism names.
- **Recommendation and why:** about three sentences. Name the pick, the trade-off it accepts,
  and why each other option loses. Be as honest about the pick's costs as about the rest.
- **No code in the question.** Leave flags, JSON, schema terms and spec vocabulary out of the
  title, body and options. If the doc needs a term, add it in brackets.
- **Define any term the question leans on**, in a clause, the first time it appears. Give a
  concrete example ("Claude is halfway through a step and the session is killed") when an
  option is abstract.
- **Refer to tickets and earlier decisions by name**, never by a bare number.

## 4. Rounds and replies

- Ask up to three questions per round, and only when they are independent of each other.
  Otherwise ask one. Stop when the tree is walked, and never pad a round.
- When the person answers in free text that reframes the question, restate your reading in one
  or two lines in the thread. Fold their idea into the design and into the next round, rather
  than defending the options you started with. Rewrite the recommendation of any open question
  the answer changes.
- When they ask what a word means, answer it, then write the next questions so they would not
  have needed to ask.

## Before you send a round

1. Does every question pass the value test in §1? Settle any that don't.
2. Can someone read each question in ten to twenty seconds, with no code in it?
3. Are the settled points in one line, not on a card?
4. Is every term defined and every ticket named?
