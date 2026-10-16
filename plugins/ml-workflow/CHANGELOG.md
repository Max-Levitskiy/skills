# Changelog

What each ml-workflow version changed. Every change to the plugin raises the version and adds its section here with `bun scripts/plugin-version.ts bump` (AGENTS.md, Releasing a plugin). Versions up to 0.9.0 are in the git history of `.claude-plugin/plugin.json`.

## 0.11.0

- The reference coding loop is the end-to-end check: a gated spec kills it at every row of the C11 table with the real spore, claude and herdr, for background and watched implement, and docs/release-check.md lists what to check by hand in Claude Code before a release (skills#68).
- The run line no longer says `needs you` once a decision is sent and waits for Continue, found by that check (skills#68).

## 0.10.0

- The run line leads with `needs you` and how long the run has stood at its node, and fits the band (skills#108).
- Following a run reacts to the answer's `status` and `needs`, not `spore continue --wait`'s exit code (skills#107).
- The menu and the live view open at any width (skills#105).
- Menu rows show their first action, and stuck or quarantined runs say why; runs that need you come first (skills#109).
- The live view keeps the current node and its text on screen, drawing a compact tree when the dot drawing does not fit (skills#106).
- Every change to the plugin raises its version, so `claude plugin update` brings it in; CI refuses one that does not (skills#115).

