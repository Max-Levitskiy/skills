---
name: act
description: Do one action of the ml-workflow menu on a Runspore run — decide, retry, mark done, fail, release, abandon or show its step, or open its pane — then follow the run when it can move. The menu hands off to it.
argument-hint: "<runId> decide|retry|done|fail|release|abandon|pane|show"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *) Bash(herdr agent focus *)
disable-model-invocation: true
---

# /ml-workflow:act

The person picked this action in the menu (`/ml-workflow:menu`), so the pick is their choice: an action that needs nothing more runs at once, and one that needs an outcome, data, a reason, or a warning heeded asks first.

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

## 3. Read the run

The arguments are `<runId> <action>`. Without both, or with an action not in the table below, reply "Usage: /ml-workflow:act <runId> decide|retry|done|fail|release|abandon|pane|show; /ml-workflow:menu offers them." and stop.

Run `spore status <runId> --json`. Its answer holds `db`, the database, which every command below passes as `--db <db>` after its other arguments, and `needs`, what the run needs now. A `run.not-found` error means the run is not in this database: say so, naming the database spore read (`$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`), and stop.

A run that has ended (`status` `completed`, `failed` or `cancelled`), or one whose `needs` is no longer the one the action is for, has moved since the menu was drawn: say in one line where it is now and that `/ml-workflow:menu` shows what it needs, and stop.

| Action | Needs |
|---|---|
| `decide` | `signal` |
| `retry`, `done`, `fail` | `stuck` |
| `release` | `quarantined` |
| `abandon`, `pane` | `held` |
| `show` | `external-ready` |

Every JSON or text value below goes on the command line in single quotes, on one line, with each `'` inside written as `'\''`. Every outcome you offer comes from the status, never typed or guessed.

## 4. Do the action

**`decide`.** Run `spore step show <runId> --json --db <db>` and `spore events <runId> --json --db <db>`. Say which node waits (`waiting.nodeId`), for which signal (`waiting.signal`) and since when (`waiting.forMs`). When the step names an `instructions` file, read it and give its gist in a line or two, since it says what each outcome means. From the events, give each earlier node's latest result, one line per node: its outcome and the gist of its output or error. Ask the person to choose one of `waiting.outcomes`, each its own option, and end the turn. When the chosen outcome has a schema in `waiting.outputSchemas`, also ask for its data, drafted from what you showed, and check it fits the schema. Then send:

```
spore signal <runId> <waiting.signal> --outcome <outcome> --id <position.activationId> --db <db> [--data '<data JSON>']
```

`output.invalid` means the data does not fit: show its errors and ask again. `signal.id-reused` means a different decision was already sent for this wait: say "a decision was already sent", and go on to the follow, which acts on that one.

**`retry`.** Say which step is stuck (`intervention.nodeId`), its error (`error.code`, `error.message`), after `attempt` of `maxAttempts` tries. When `intervention.reason` is `unknown`, the last try may have done its work without reporting it: say so, and that Retry runs the step again, ask "Retry it?", and end the turn; go on only on a yes. Otherwise retry at once: `spore resolve <runId> --retry --db <db>`.

**`done`.** Say which step is stuck. The outcome is the one of `intervention.outcomes` when there is one; with several, ask which, each its own option, and end the turn. When the outcome has a schema in `intervention.outputSchemas`, draft the output from the step's instructions and the conversation, show it, ask the person to confirm or correct it, and end the turn. Then `spore resolve <runId> --complete <outcome> --db <db> [--output '<output JSON>']`. `output.invalid` shows its errors and asks again.

**`fail`.** Say which step is stuck and its error. Ask for the reason the run fails with, offering one drafted from the error, and end the turn. Then `spore resolve <runId> --fail '<message>' --db <db>`.

**`release`.** Say the quarantine's code and details (`quarantine`), then `spore release <runId> --db <db>`.

**`abandon`.** Say which step is held and by whom (`step.actor`, `step.holder`), then `spore step abandon <runId> --db <db>`: the holder's claim is dropped, and the step's effect decides what happens next.

**`pane`.** The step is held by the pane `step.holder.herdrAgent`. Run `herdr agent focus <step.holder.herdrAgent>` and say the pane is in front, and that `/ml-workflow:continue <runId>` follows the run. When herdr says the agent is not found, the pane is gone, as after the machine went down: say so, and that `/ml-workflow:continue <runId>` lets spore's probe find the pane dead and start the step again. Without a herdr agent in the holder, say the step is not held by a pane and stop. Stop there: this action does not follow the run.

**`show`.** Run `spore step show <runId> --json --db <db>`. Say which step waits (`position.nodeId`), for which actor (`step.actor`), and the gist of its instructions when it names a file. Give the claim line, `spore step claim <runId> --actor <step.actor> --db <db>`; for the actor `person`, the work is the person's own, and claiming prints its instructions and the commands that report it. Run nothing; say that `/ml-workflow:continue <runId>` follows the run once the step is reported, and stop.

## 5. Follow the run

After `decide`, `retry`, `done`, `fail`, `release` and `abandon` the run can move: load the `ml-workflow:continue` skill with the Skill tool, with `<runId>` as its argument, and follow it as that skill says.
