---
name: cancel
description: Cancel a Runspore run after a one-line confirmation — it ends the run as cancelled and stops its running step; asks which run when several are unfinished.
argument-hint: "[<runId>] [--reason <text>]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
---

# /ml-workflow:cancel

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

## 3. Pick the run

With a run ID given, take it. Otherwise run `spore list --unfinished --json`. It prints `{"db", "runs"}`, the unfinished runs newest first, each with `runId`, `workflow`, `nodeId`, `needs`, `since` (when it last changed, in milliseconds) and `startKey`. With no run, say there is no unfinished run in that database (`db`) and stop. With one, take it. With several, ask which, one option per run: its ID, workflow, node, what it needs and how long ago it changed; then end the turn.

## 4. Confirm

Run `spore status <runId> --json`. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`), and stop. A run whose `status` is `completed`, `failed` or `cancelled` has already ended: say how, and stop without asking.

Otherwise ask in one line, and end the turn: "Cancel `<runId>` (key `<startKey>`), at `<position.nodeId>`, in `<db>`? It stops its running step and cannot be undone." Nothing is cancelled without a yes, whatever reason the conversation gives.

## 5. Cancel

On a yes, run:

```
spore cancel <runId> --json [--reason '<reason>']
```

with `--reason` when the person gave one, in single quotes, on one line, each `'` inside written as `'\''`. It prints `{"runId", "requestId", "disposition", "status", "cancel", "stops"}`. Reply with one line: the run is cancelled, and for each of `stops` that its step was told to stop (`exit` null: it did not exit by itself). For the disposition `duplicate`, say that the run had already ended as `status`, and that nothing changed.

A follow of this run, in this session or another, then returns with `status` `cancelled`.

A usage error (exit 2) about `cancel` means this `spore` predates it, as the v0.2.0 release does: say that ml-workflow cancels runs with `spore cancel`, which a `spore` built from runspore's main branch has until a release does, and give `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli`. Run it only on a yes.
