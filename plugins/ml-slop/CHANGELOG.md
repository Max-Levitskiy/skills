# Changelog

## 0.3.3

- Add paired text rewrite controls that distinguish authored emotional
  intensity from hollow promotional intensifiers.
- Document the source provenance and matched base-versus-candidate harness
  protocol. Methods, prompts, weights, thresholds, and score bands are
  unchanged.

## 0.3.2

- Detect repetitive valid-import streaks that add no bindings and can crowd out
  the intended code body.
- Add paired positive and negative import fixtures, provenance, functional
  oracles, and deterministic construction checks. Scoring is unchanged and the
  new expected findings still require external model-harness validation.

## 0.3.1

- Repair the correctness-boundary fixture: keep its functional contract outside analyzed source and align the expected scope text with the report template.
- Add paired stale/correct public-API docstring controls and a deterministic fixture checker. No scoring or skill-prompt changes.
