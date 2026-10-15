---
name: status
description: Runspore run status — list the unfinished runs, or say in words where one run is, what it waits for and since when.
argument-hint: "[<runId>]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
---

# /ml-workflow:status

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Check spore

Run `claude-spore doctor --json`. It prints `{"ok", "spore", "problems", "launcher"}`, and `ok` is true when spore fits; then go on.

Otherwise, take each problem in order:

- `plugin.reload`: reply with its `message` and stop.
- Any other: show its `message`, ask "Run `<fix>` now?", and end the turn. Run the fix only on a yes, show what it printed, then run `claude-spore doctor --json` again and go on only when `ok` is true. A no, or a fix that fails, stops the skill. It installs nothing on its own.

If `claude-spore` itself does not run:

- The shell cannot find `claude-spore`: reply "ml-workflow's helper is not on this session's PATH. Run `/reload-plugins`, then try again." and stop.
- It fails because `bun` is not found (exit 127): say "ml-workflow needs Bun 1.2.0 or later, and none is on PATH." and ask "Run `curl -fsSL https://bun.sh/install | bash` now?". On a yes, run it, then tell the person to restart Claude Code so its PATH has Bun, and stop.
- It exits 2 saying it needs a newer Bun: show that line and ask "Run `bun upgrade` now?". On a yes, run it, then run the check again.

## 3. Report

This step only reads. It sends no signal, resolution or run.

**No run ID given.** Run `spore list --unfinished --json`. It prints `{"db", "runs"}`: `db` is the database it read, and `runs` the unfinished runs newest first, each with `runId`, `workflow`, `nodeId`, `needs`, `since` (when it last changed, in milliseconds), `startKey` and `actor`. Name the database, then one line per run with what it needs in words, e.g. `run_edcfc217…  coding-loop at approve: waits for a decision, changed 2 h ago (key coding-loop-3f9a1c2e)`. By `needs`:

- `signal`: waits for a decision;
- `stuck`: its step is stuck;
- `working`: a worker has something to do, or a step is working;
- `held`: its step is held, by its pane or by its actor (`actor`);
- `external-ready`: its step waits for its actor (`actor`) to claim it;
- `quarantined`: it is quarantined;
- `capability-missing`: this `spore` cannot run its step.

A run with no `nodeId` has not taken its first turn: say it is not started yet, and that following it starts it. With none, say there are no unfinished runs in that database.

**A run ID given.** Run `spore status <runId> --json`. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`). Otherwise say in plain words, naming `db`:

- where the run is: `position.nodeId`, its visit, and the arrow into it (`position.from`: which node, on which outcome);
- what it waits for and since when (`sinceMs`, `forMs`), from whichever is set:
  - `waiting`: a decision, signal `waiting.signal`, with the outcomes `waiting.outcomes`, noting each one that needs data (`waiting.outputSchemas`);
  - `intervention`: a stuck step, its `error.code` and `error.message`, after `attempt` of `maxAttempts` tries; when `intervention.reason` is `unknown`, that its last try may have done its work without reporting it;
  - `quarantine`: the reason, and that `spore release` lifts it;
  - `step`: an async step, waiting for its actor (`step.actor`) to claim it while `step.state` is `ready`, or held by its pane or actor while it is `held`;
  - `running` or status `running`: a step is working;
- or, for an ended run, the end node (`end.nodeId`, from which node and outcome) and the `result`; for a cancelled run, `cancel.reason` and when (`cancel.at`).

Then give the commands from `waiting.commands` or `intervention.commands` as a code block, and add that `/ml-workflow:continue <runId>` follows the run and offers what it needs, and `/ml-workflow:cancel <runId>` cancels it.
