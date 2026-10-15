---
name: start
description: Start a Runspore workflow — check it, draft each declared input from the conversation for the person to confirm, start the run, then follow it in the background and react when it needs the person or ends.
argument-hint: <workflow> [--key <key>]
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
---

# /ml-workflow:start

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Check spore

If a `<claude-spore-doctor>` block is above this skill, its JSON is the check's answer. Otherwise run `claude-spore doctor --json`. It prints `{"ok", "spore", "problems", "launcher"}`, and `ok` is true when spore fits; then go on.

Otherwise, take each problem in order:

- `plugin.reload`: reply with its `message` and stop.
- Any other: show its `message`, ask "Run `<fix>` now?", and end the turn. Run the fix only on a yes, show what it printed, then run `claude-spore doctor --json` again and go on only when `ok` is true. A no, or a fix that fails, stops the skill. It installs nothing on its own.

If `claude-spore` itself does not run:

- The shell cannot find `claude-spore`: reply "ml-workflow's helper is not on this session's PATH. Run `/reload-plugins`, then try again." and stop.
- It fails because `bun` is not found (exit 127): say "ml-workflow needs Bun 1.2.0 or later, and none is on PATH." and ask "Run `curl -fsSL https://bun.sh/install | bash` now?". On a yes, run it, then tell the person to restart Claude Code so its PATH has Bun, and stop.
- It exits 2 saying it needs a newer Bun: show that line and ask "Run `bun upgrade` now?". On a yes, run it, then run the check again.

Keep `launcher` for step 4.

## 3. Find and check the workflow

The arguments are `<workflow>`, then optionally `--key <key>`. `<workflow>` is a workflow's name in the project folder, a workflow folder, or its `workflow.dot`.

The project's workflows live in `workflows/` inside the `.spore` folder that holds the database; `spore list --unfinished --json` gives the database's path as `db`. Find the workflow's folder: for a name, the folder there whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name; for a folder, itself; for a `workflow.dot`, the folder holding it. With no `<workflow>`, list the workflows in that `workflows/` folder and ask which to start.

Run both checks, and show each one's report as it printed it:

1. `spore validate <workflow>`: the workflow and its actions.
2. `claude-spore check <workflow folder>`: the parameters of its Claude steps. Warnings are shown and do not stop the start.

If either exits non-zero, say nothing was started, and stop.

## 4. Draft the input

Read `inputSchema` from the folder's `settings.json`. Ask for every property in one message, then end the turn. For each: its `description` as the question, and a value drafted from this conversation as the answer to confirm, marking which properties are required. Leave a property with no grounded draft blank for the person to fill. Without an `inputSchema`, the input is `{}`: ask the person to confirm starting the workflow with no input, and end the turn.

When step 2's `launcher` was `offer`, add one question to the same message: "Install the `claude-spore` launcher in `~/.local/bin`, so a worker you start in a plain terminal can run Claude steps? This is asked once." Run `claude-spore launcher install` on a yes and `claude-spore launcher decline` otherwise, before the start.

When the person answers, build the input object from the confirmed values. It must fit the whole schema: types, `required`, `enum`, `const`, lengths, patterns, bounds, nested objects and arrays, and no undeclared property when `additionalProperties` is `false`. Ask again about any value that does not fit.

## 5. Start the run

The key is `--key` when given. Otherwise make a fresh one, `<workflow name>-<8 random hex characters>`, e.g. `coding-loop-3f9a1c2e`: a fresh key makes a new run.

Run this in the foreground, from the current folder. It creates the run and works nothing:

```
spore start <workflow> --key <key> --input '<input JSON>' --json
```

Write the input JSON on one line; inside the single quotes, write each `'` as `'\''`. It prints the new run's `runId`. By the answer:

- `input.invalid` (exit 2): it created no run. Show each of `details.errors` (`path`, `message`), ask again about those values, and start again with the same key.
- `run.key-reused` (exit 2), which only a `--key` the person gave can meet: the key already names the run `details.runId`, started with another input. Show spore's message, and ask whether to follow that run instead or start again with another key; end the turn.
- Any other non-zero exit: show what spore printed, and stop.

The answer holds no database path, so run `spore status <runId> --json` for the run's `db`, then follow the new run.

## Following a run

Run this with the Bash tool in the background (`run_in_background`), `<db>` being the absolute path the last `--json` answer about this run gave as `db`:

```
spore continue <runId> --wait --json --db <db>
```

Keep `--db` after the other arguments, so the line starts `spore continue <runId> --wait`. Then end the turn with one line: the workflow, the key, the run, the database, and that you will say when the run needs the person or ends.

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

A usage error (exit 2) about `--wait` means this `spore` predates following, as the v0.2.0 release does: say that the run was started and waits where it is, that ml-workflow follows runs with `spore continue --wait`, which a `spore` built from runspore's main branch has until a release does, and give `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli`. Run it only on a yes.

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
