---
name: view
description: Open a Runspore run's live view — the workflow drawn with where the run is and the arrow it just took, beside the matching lines of workflow.dot, settings.json and the step's instructions.
argument-hint: "[<runId>]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *) mcp__ml-workflow__open_view
---

# /ml-workflow:view

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

## 3. Take the run

This skill only shows. It sends no signal, resolution or run.

**A run ID given.** Run `spore status <runId> --json` for its `db`, the database it was read from. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`), and stop.

**No run ID given.** Run `spore list --unfinished --json`. It prints `{"db", "runs"}`, the unfinished runs newest first. With none, say there is no unfinished run in that database and stop. With one, take it. With several, ask which, one option per run: its ID, workflow, node, what it needs and how long ago it changed; then end the turn and go on with the answer.

## 4. Open the view

The live view is a pane that ml-workflow's mod draws. Call `mcp__ml-workflow__open_view` with `{"runId": "<runId>", "db": "<db>"}`, loading it with ToolSearch first when its schema is not loaded. Reply with what it answered, in one line, and stop; when the pane waits undrawn the answer names the keys that show it, so keep them. The pane follows the run by itself while it is open.

When no such tool exists, the mod is not loaded in this session. Run `claude-spore view <runId> --db <db>` and show what it printed in a code block: the run's facts, the drawing, and the lines of its files, the current node's marked `>` and the arrow just taken `*`. Then say that `/reload-plugins` loads the mod, which draws the view in a pane and keeps it up to date.
