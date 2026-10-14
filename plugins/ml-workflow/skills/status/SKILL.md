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

## 2. Check spore's version

Run `spore --version`. It prints `spore <major>.<minor>.<patch>`. If the command is not found, or the version is below 0.2.0 compared as three numbers, reply with exactly this and stop:

> ml-workflow needs spore 0.2.0 or later; this is <the version, or "not installed">. Install it with `cargo install --git https://github.com/Web-tree/runspore --locked runspore-cli`, then try again.

## 3. Report

This step only reads. It sends no signal, resolution or run.

**No run ID given.** Run `spore list`, which prints one row per run: run ID, status, node, how long it has been there, start key; and `spore --json list`, whose `db` is the database it read. A run is unfinished when its status is not `completed`, `failed` or `cancelled`. Name the database, then one line per unfinished run with its status in words, e.g. `run_edcfc217…  waiting at approve for 2 h (key coding-loop-3f9a1c2e)`. With none, say there are no unfinished runs in that database.

**A run ID given.** Run `spore --json status <runId>`. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder). Otherwise say in plain words, naming `db`:

- where the run is: `position.nodeId`, its visit, and the arrow into it (`position.from`: which node, on which outcome);
- what it waits for and since when (`sinceMs`, `forMs`), from whichever is set:
  - `waiting`: a decision, signal `waiting.signal`, with the outcomes `waiting.outcomes`, noting each one that needs data (`waiting.outputSchemas`);
  - `intervention`: a stuck step, its `error.code` and `error.message`, after `attempt` of `maxAttempts` tries;
  - `quarantine`: the reason, and that `spore release` lifts it;
  - `step`: an external step, waiting for its actor;
  - `running` or status `running`: a step is working;
- or, for an ended run, the end node (`end.nodeId`, from which node and outcome) and the `result`.

Then give the commands from `waiting.commands` or `intervention.commands` as a code block, and add that `/ml-workflow:continue <runId>` sends a decision or resolution and continues the run.
