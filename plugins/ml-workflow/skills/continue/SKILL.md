---
name: continue
description: Continue a Runspore run — follow it in the background with spore continue --wait, then react when it needs the person or ends, offering the decision, the stuck step's resolutions, the release or the claim line right there; asks which run when several are unfinished.
argument-hint: "[<runId>]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
---

# /ml-workflow:continue

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

With a run ID given, run `spore status <runId> --json` for its database, `db`. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`), and stop.

Otherwise run `spore list --unfinished --json`. It prints `{"db", "runs"}`, the unfinished runs newest first, each with `runId`, `workflow`, `nodeId`, `needs`, `since` (when it last changed, in milliseconds) and `startKey`. With no run, say there is no unfinished run in that database (`db`) and stop. With one, take it. With several, ask which, one option per run: its ID, workflow, node, what it needs and how long ago it changed; then end the turn.

## 4. Follow it

Follow the run as below. Nothing else is needed first: following does the next thing the run needs, and comes back at once when the run waits for the person.

## Following a run

Run this with the Bash tool in the background (`run_in_background`), `<db>` being the absolute path the last `--json` answer about this run gave as `db`:

```
spore continue <runId> --wait --json --db <db>
```

Keep `--db` after the other arguments, so the line starts `spore continue <runId> --wait`. Then end the turn with one line: the run, the database, and that you will say when the run needs the person or ends.

When the command returns, its stdout is one JSON object: the run's status (`runId`, `status`, `position`, `waiting`, `intervention`, `quarantine`, `step`, `result`, `end`, `cancel`, `db`) with `needs` and `commands`. Its stderr holds progress lines. React by the exit code, in one line, offering what the row says right there. Every outcome, resolution or command you offer comes from this object, never typed or guessed: when the person names another outcome, say the node does not route it and offer the listed ones as the only choices.

Every JSON or text value below goes on the command line in single quotes, on one line, with each `'` inside written as `'\''`.

| Exit | The run | Say | Offer |
|---|---|---|---|
| 0 | completed | the end node (`end.nodeId`) and the `result` | nothing |
| 1 | failed | the end node and `result.error`'s `code` and `message` | nothing |
| 7 | was cancelled | the reason, `cancel.reason`, when there is one | nothing |
| 3 | waits for a decision | **A decision** below | the outcomes |
| 4 | is stuck | **A stuck step** below | Retry, Mark done, Fail |
| 5 | is quarantined | the quarantine's code and details | `spore release <runId>`: run it on a yes, then follow again |
| 6 | needs someone, by `needs` | **An async step** below | as there |
| 2 | was refused | the error's `code` and `message`; `run.not-found` means the run is not in that database | nothing |
| 130 | was not followed to the end: the follow was stopped | that the run stays where it was | `/ml-workflow:continue <runId>` |
| other | — | the last lines spore printed | nothing |

A usage error (exit 2) about `--wait` means this `spore` predates following, as the v0.2.0 release does: say that ml-workflow follows runs with `spore continue --wait`, which a `spore` built from runspore's main branch has until a release does, and give `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli`. Run it only on a yes.

**A decision.** Say which node waits (`waiting.nodeId`), for which signal (`waiting.signal`), since when (`waiting.forMs`). Run `spore step show <runId> --json --db <db>`; when it names an `instructions` file, read it and give its gist in a line or two, since it says what each outcome means. Ask the person to choose one of `waiting.outcomes`, each its own option, and end the turn. When the chosen outcome has a schema in `waiting.outputSchemas`, also ask for its data, drafted from the conversation, and check it fits the schema. Then send, and follow again:

```
spore signal <runId> <waiting.signal> --outcome <outcome> --id <position.activationId> --db <db> [--data '<data JSON>']
```

The ID is the activation, so one wait takes one decision: the same decision again changes nothing. `signal.id-reused` means a different decision was already sent for this wait: say "a decision was already sent", and follow again, which acts on that one. `output.invalid` means the data does not fit: show its errors and ask again.

**A stuck step.** Say which step (`intervention.nodeId`), its error (`error.code`, `error.message`), after `attempt` of `maxAttempts` tries, and since when (`forMs`). When `intervention.reason` is `unknown`, the last try may have done its work without reporting it: say so, and that Retry runs the step again, so the person checks what the step does before choosing it. Offer, and end the turn:

- **Retry**: `spore resolve <runId> --retry --db <db>`;
- **Mark done**: `spore resolve <runId> --complete <outcome> --db <db>`, the outcome one of `intervention.outcomes`; when it has a schema in `intervention.outputSchemas`, also `--output '<output JSON>'` fitting it;
- **Fail**: `spore resolve <runId> --fail '<message>' --db <db>`, with the person's reason.

Run the one the person picks, then follow again.

**An async step**, by `needs`:

- `external-ready`: a step waits for its actor (`step.actor`) to claim it. Say which step (`position.nodeId`) and give the claim line, `spore step claim <runId> --actor <step.actor> --db <db>`. For the actor `person`, the work is the person's own: claiming prints its instructions and the commands that report it. Run nothing; say that `/ml-workflow:continue <runId>` follows the run again once the step is reported.
- `held`, with `step.waiting` `person`: say `step.message`, for an interactive Claude step "implement waits for you in its pane", and name the pane's herdr agent, `step.holder.herdrAgent`, when the holder has one. When the person says they are done there, follow again. `spore step abandon <runId> --db <db>` frees the step, and the step's effect decides what happens next; run it only when the person asks.
- `capability-missing`: say which step, and `step.missing`: what this `spore` lacks and what to restore. Run nothing.
- `held` otherwise: say who holds the step (`step.actor`, `step.holder`) and until when (`step.deadlineMs`), and that `spore step abandon <runId>` frees it. Run nothing.

The run does not need this session. Closing Claude stops the follow; the run stays where it was, and `/ml-workflow:continue` picks it up.
