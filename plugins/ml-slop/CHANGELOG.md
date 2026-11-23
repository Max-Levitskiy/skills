# Changelog

## 0.4.1

- Add paired text rewrite controls that distinguish authored emotional
  intensity from hollow promotional intensifiers.
- Clarify that the text density score is not an authorship verdict.
- Document the source provenance and matched base-versus-candidate harness
  protocol. Methods, weights, thresholds, and score bands are unchanged.

## 0.4.0

- Package all three skills for Codex, including the explicit-only code comment guidelines.

## 0.3.2

- Detect repetitive valid-import streaks that add no bindings and can crowd out
  the intended code body.
- Add paired positive and negative import fixtures, provenance, functional
  oracles, and deterministic construction checks. Scoring is unchanged and the
  new expected findings still require external model-harness validation.

## 0.3.1

- Repair the correctness-boundary fixture: keep its functional contract outside analyzed source and align the expected scope text with the report template.
- Add paired stale/correct public-API docstring controls and a deterministic fixture checker. No scoring or skill-prompt changes.
