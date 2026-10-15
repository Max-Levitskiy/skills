---
name: continue
description: Continue a Runspore run — send the decision it waits for or resolve its stuck step, then work it in the background and report when it parks or ends; asks which run when several are unfinished.
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

With a run ID given, take it. Otherwise run `spore list` and `spore --json list` (its `db` is the database spore read). A run is unfinished when its status is not `completed`, `failed` or `cancelled`. With none, say there is no unfinished run in that database and stop. With one, take it. With several, ask which, one option per run: its ID, node, status and how long it has been there.

## 4. Read where it is

Run `spore --json status <runId>`. A `run.not-found` error means the run is not in this database: say so, naming the database (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`), and stop.

Every value you offer in step 5 comes from this status. The outcome a signal or resolution sends is always one listed here, never typed or guessed: spore 0.2.0 stores a signal outcome its node does not route and drops it without an error, so a near miss such as `approve` for `approved` loses the decision. This is a hard limit of the skill, for any reason the person gives, a test included: when they name or insist on another outcome, say the node does not route it and offer the listed outcomes as the only choices. `spore signal` and `spore resolve` run only with a listed outcome.

## 5. Act on what it holds

Go by `status` and whichever field is set. Name the database (`db`) when you describe the run. Every JSON or text value below goes on the command line in single quotes, on one line, with each `'` inside written as `'\''`.

**`waiting`, with `waiting` set: a decision.** Say which node waits (`waiting.nodeId`), for which signal, since when (`forMs`). Ask the person to choose one of `waiting.outcomes`, each as its own option. When the chosen outcome has a schema in `waiting.outputSchemas`, also ask for its data, drafted from the conversation, and check it fits the schema. Then send:

```
spore signal <runId> <waiting.signal> --outcome <outcome> --id <position.activationId> [--data '<data JSON>']
```

The message ID is the activation, so one wait takes one decision. If spore answers `request.digest-mismatch`, a different decision was already sent for this wait: say so, and go on to step 6, which acts on that one. After a signal the status stays `waiting` until step 6 runs the run on.

**`needs-intervention`, with `intervention` set: a stuck step.** Say which step (`intervention.nodeId`), its error (`error.code`, `error.message`), after `attempt` of `maxAttempts` tries, and since when. When `intervention.reason` is `unknown`, the last try may have done its work without reporting it (its lease ran out, or its result was lost): say so, and that Retry runs the step again, so the person checks what the step does before choosing it. Offer:

- **Retry**: `spore resolve <runId> --retry`;
- **Mark done**: `spore resolve <runId> --complete <outcome>`, the outcome one of `intervention.outcomes`; when it has a schema in `intervention.outputSchemas`, also `--output '<output JSON>'` fitting it;
- **Fail**: `spore resolve <runId> --fail '<message>'`, with the person's reason.

Run the one the person picks.

**`running`.** Say which step is working (`position.nodeId`, `running`) and send nothing. Step 6 works the run on.

**Anything else.** Say what the run is doing, give the commands its status lists, send nothing, and stop:

- `quarantine` set: the reason, and that `spore release <runId>` lifts it;
- `step` set: an external step, waiting for its actor;
- `completed`, `failed` or `cancelled`: the end node (`end`) and the `result`.

## 6. Work the run on

Run this with the Bash tool in the background (`run_in_background`):

```
spore worker --run <runId> --until-parked
```

It works only this run, using the input and workflow the run already holds, until it waits, gets stuck or ends. End the turn with one line: the run, the database, and that you will say when it parks or ends.

When it finishes, read its output; the status block at its end holds `status`, `position`, and for a decision `outcomes`. Reply with one line by the exit code:

| Exit | The run | Say |
|---|---|---|
| 0 | completed | the end node and the `result` |
| 1 | failed | the end node and the error |
| 3 | waits for a decision | the node, the signal, its outcomes, and `/ml-workflow:continue <runId>` |
| 4 | is stuck | the node, the error, and `/ml-workflow:continue <runId>` |
| other | was cut off | the last lines spore printed |

If Claude closes first, the run stays where it was and `/ml-workflow:continue` picks it up again.
