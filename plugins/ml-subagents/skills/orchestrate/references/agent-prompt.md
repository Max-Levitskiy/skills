# Worker agent prompt scaffold

Every worker prompt is self-contained: the agent starts with zero knowledge of the
project, the conversation, or the conventions. Build each prompt from these blocks,
in this order. Blocks marked (verbatim-adapt) have wording below that you copy and
adapt lightly; the rest you write per package.

## Block order

1. **Role + root.** One sentence of what kind of document/change they're producing,
   plus the absolute repository/workspace root ("call it ROOT") so every later path is
   unambiguous.
2. **Context paragraph.** 3–6 sentences: who the audience and stakeholders are, what is
   happening, why this package exists, any deadline. Written for a stranger — the
   worker has no access to your conversation.
3. **The assignment.** "YOUR TASK: create exactly one file: ROOT/<path>" (or "edit
   exactly one file, in place"). One file, named now, no ambiguity.
4. **Read-first list, in order.** The project's canonical conventions/glossary doc
   first (with a note on how to use it — e.g. "note which acronym expansions are
   UNCONFIRMED; never present those as confirmed"), then the package's specific
   inputs. Ordered, with one line each on what to take from it.
5. **Content requirements.** The concrete spec: sections, tables, what each must
   contain, what good looks like, length/format constraints. This is most of your
   prompt-writing effort. Include *why* where it shapes judgment ("read by support
   agents mid-conversation — short answers, question as the heading").
6. **Content guardrails** (when stakes warrant): locked framing decisions not to
   relitigate, tone rules, things that must never appear.
7. **Rules block** (verbatim-adapt, below).
8. **Final report format** (verbatim-adapt, below).

## Rules block (verbatim-adapt)

> RULES (non-negotiable):
> - You own exactly this one output file. Do not edit any other file.
> - Match the project's link and formatting conventions (see the conventions doc).
> - Plain, direct language. No sales tone, no metaphors. Every figure and claim must
>   trace to a source document; if a fact is unknown, write "TBD" — never invent.
> - QUESTION PROTOCOL: if you hit a decision only <human> can make, or a fact you
>   cannot derive from the sources, create a question file
>   ROOT/<questions-path>/YYYY-MM-DD_<short-slug>.md following the template in that
>   folder's README.md (read it first). Question files use short simple sentences and
>   explain every abbreviation or project term in plain language on first use — a
>   reader with zero project context must understand it. State a default assumption
>   and CONTINUE your work using that default. Never stop and wait. Do NOT edit the
>   questions README itself.
> - After your final Write, Read your output file back once to confirm the content on
>   disk matches what you wrote; rewrite if it does not. (Synced folders can clobber
>   concurrent writes.)

Adapt: fill in the human's name, the questions path, today's date; add project rules
discovered in setup (e.g. "never modify anything under docs/_sources/", "wikilinks
not markdown links", "no internal codenames in headings").

## Final report format (verbatim-adapt)

> FINAL REPORT (your last message, plain data):
> 1) output file path;
> 2) 3–5 bullet summary of key content decisions;
> 3) question files created (paths + one-line each) or "none";
> 4) assumptions you proceeded on.

Ask for package-specific extras when useful (e.g. "list every TBD marker left, grouped
by the event that resolves it" for a draft with pending inputs).

## Why these blocks earn their place

- **Self-containment**: a worker that has to guess context produces confident, wrong
  output. The context paragraph plus read-first list is cheaper than a redo.
- **Single named output file**: parallel write safety and trivial verification
  (invariant 1 of the skill).
- **The question protocol inline**: workers won't invent the never-block behavior on
  their own — without the block they either stall or silently guess. With it, they do
  both halves: surface the fork *and* keep moving.
- **Read-back verification**: catches sync clobbers and silent write failures at the
  only moment the worker can still fix them.
- **Structured final report**: completion notifications sometimes arrive without the
  report text, so you must be able to verify from disk alone (invariant 5) — but when
  the report does arrive, this format makes closing the package a 30-second job.

## Condensed example (package: launch-day customer FAQ)

Uses the workspace in `evals/fixtures/launch-prep/`, so you can run this example
end to end and compare the result against the eval's assertions.

> You are drafting one customer-facing document in a small launch-prep workspace.
> Repository root (call it ROOT): /path/to/launch-prep
>
> CONTEXT: Nimbus Notes is a note-taking app. Version 2.0 ships to the public on
> 2026-08-04. Around 400 people have been testing it since May through the Early Access
> Program. Support staff need a FAQ to answer from on launch day, covering the questions
> we already know they will get. Everything must match the notes in ROOT/notes/ — the
> product decisions are settled, this is a writing job, not a planning one.
>
> YOUR TASK: Create exactly one file: ROOT/deliverables/customer-faq.md
>
> Read first, in order:
> 1. ROOT/CLAUDE.md — workspace conventions, including the tone rules.
> 2. ROOT/glossary.md — canonical vocabulary; use terms exactly as defined, and note
>    which acronym expansions are marked unconfirmed. Never expand those.
> 3. ROOT/notes/product-notes.md — the only source for feature and platform claims,
>    including the known limitations.
> 4. ROOT/notes/pricing-notes.md — the only source for anything about price.
>
> CONTENT REQUIREMENTS: one section per question, the question itself as the heading,
> answer in 2–4 sentences. Cover at minimum: how sync keeps notes private, which
> platforms are supported, importing from other apps, the size limit on shared
> workspaces, what it costs, and what changes for Early Access testers. Answers are read
> aloud or pasted into a chat mid-conversation, so lead with the answer and keep
> sentences short. Where a limitation applies, state it plainly rather than steering
> around it. End with a "Where to send people" section listing the support and press
> contacts from the notes.
>
> GUARDRAILS: do not claim any feature the product notes mark as slipped to a later
> version. Do not state a price that is not in the pricing notes.
>
> RULES: <rules block> — questions path: ROOT/questions/
> FINAL REPORT: <report block>
