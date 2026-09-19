# Method 5: Boilerplate & Template Structure

Follow the shared conventions in `_conventions.md`. Method id: `boilerplate-template`.

Your job: find generic tutorial-style scaffolding — the code equivalent of
template openings/closings in AI prose.

## Patterns

- `tutorial-scaffold` (low): step-by-step narrative comment blocks ("First we...,
  Then we..., Finally we...") framing straightforward code
- `generic-naming` (low): placeholder names carrying no domain meaning where the
  domain is known (`data`, `result`, `item`, `helper`, `process_data`) used
  pervasively, not incidentally
- `ceremony-imports` (low): imported-but-unused modules from a template
- `empty-sections` (low): commented-out section headers or region markers with
  nothing meaningful inside

## Decision rule

Would this text appear nearly unchanged in ANY project's version of this file?
If yes and it adds no project-specific information → finding.

Return ONLY the JSON envelope. No commentary.
