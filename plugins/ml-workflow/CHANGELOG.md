# Changelog

What each ml-workflow version changed. Every change to the plugin raises the version and adds its section here with `bun scripts/plugin-version.ts bump` (AGENTS.md, Releasing a plugin). Versions up to 0.9.0 are in the git history of `.claude-plugin/plugin.json`.

## 0.14.0

- The Claude step runner module, runner/claude-runner.wasm: a Rust WebAssembly component of world runspore:runner/runner@0.2.0 that starts, probes and stops Claude Code for a step, in a herdr pane over herdr's socket or as a windowless claude -p, handing the attempt's token to the hooks through a 0600 file in the work folder (skills#152). The shipped workflows do not use it yet (skills#154).
- The oldest supported spore is 0.7.0, the first that hosts step runner modules.
- The agent-config key claude.runMode, the default run mode of a Claude step.

## 0.13.0

- A run held by a watched Claude step's herdr pane gets a `pane` button (hotkey p) on its run line and in its live view, which brings that pane to the front with `herdr agent focus`.

## 0.12.0

- The live view draws the workflow as a graph where it showed the compact tree: laid out top to bottom in character cells, whatever the workflow's `rankdir`, to the pane's width, in the roomiest of four layouts that fits, scrolling with the current node in view; the tree only where none fits.
- The graph shows two arrows around the current node; `fold` (hotkey f) and `unfold` (u) show one arrow less or more, up to the whole graph. Each node past the fold is a dashed box saying how many more it hides.
- A `text`/`graph` button (hotkey t) switches the live view between the graph and the compact tree.
- Node IDs with characters other than letters, digits, `_` and `-`, such as `review/a` and `review?a`, or `foo~2` beside `foo` folded at depth 2, no longer share a cached picture or layout, so the view never shows the other node's.
- `claude-spore --help` lists `view`'s `--depth`.

## 0.11.5

- claude-spore doctor needs spore 0.6.0, the first release that marks a try cut off by a kill (runspore#224), and offers the update for v0.4.0 and v0.5.0, on which the start line's "was cut off" and the menu's Continue never appeared (skills#133)
- CI runs the specs against spore 0.6.0 and the newest release

## 0.11.4

- The start line and the menu understand spore's `needs` `driver` (runspore#224, first released in spore 0.6.0): a try cut off after a kill reads "attempt 1 of 3 was cut off 32 s ago; nothing is running it" and the menu offers Continue. `child` has its words too, and a `needs` spore adds later reads as itself (skills#125).
- CI also runs the real-spore specs against runspore's main, so a `needs` spore adds there fails before a release has it.

## 0.11.3

- claude-spore doctor needs spore 0.4.0, the first release with continue --wait, cancel and the checkpoint E and F fixes, and offers the update for an older one instead of passing v0.2.0 and v0.3.0
- CI runs the specs against spore 0.4.0 and the newest release instead of a pinned runspore commit

## 0.11.2

- A watched step's message goes only once Claude is ready, and counts as sent once it lands: Claude turns working or its transcript gains a turn; one that does not land is typed again, 3 times in all, then the watch tells the person. A pane that stays quiet with no answer for a minute after its message needs the person (skills#118).

## 0.11.1

- Opening a watched step's pane no longer loses a try when the pane's shell is slow to its prompt: start tries agent start again for up to 60 s while no Claude holds the session (skills#119).

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

