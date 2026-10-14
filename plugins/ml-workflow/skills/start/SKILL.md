---
name: start
description: Start a Runspore workflow — validate it, draft each declared input from the conversation for the person to confirm, start the run in the background, and report when it parks or ends.
argument-hint: <workflow> [--key <key>]
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
---

# /ml-workflow:start

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Check spore's version

Run `spore --version`. It prints `spore <major>.<minor>.<patch>`. If the command is not found, or the version is below 0.2.0 compared as three numbers, reply with exactly this and stop:

> ml-workflow needs spore 0.2.0 or later; this is <the version, or "not installed">. Install it with `cargo install --git https://github.com/Web-tree/runspore --locked runspore-cli`, then try again.

## 3. Validate

The arguments are `<workflow>`, then optionally `--key <key>`. `<workflow>` is a workflow's name in the project folder, a workflow folder, or its `workflow.dot`. With no `<workflow>`, list the folders under `.spore/workflows/` and ask which to start.

Run `spore validate <workflow>`. On a non-zero exit, show its report as spore printed it, say nothing was started, and stop.

## 4. Draft the input

Read `inputSchema` from the workflow's `settings.json`: for a name, the folder under `workflows/` in the `.spore` folder that holds the database (`spore --json list` gives the database's path as `db`) whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name; for a folder, its `settings.json`; for a `workflow.dot`, the `settings.json` beside it.

Ask for every property in one message, then end the turn. For each: its `description` as the question, and a value drafted from this conversation as the answer to confirm, marking which properties are required. Leave a property with no grounded draft blank for the person to fill. Without an `inputSchema`, the input is `{}` and nothing is asked.

When the person answers, build the input object from the confirmed values. It must fit the schema: each property's type, `enum`, `minLength`, and no property the schema does not declare when `additionalProperties` is `false`. Ask again about any value that does not fit.

## 5. Start the run

The key is `--key` when given. Otherwise make a fresh one, `<workflow name>-<8 random hex characters>`, e.g. `coding-loop-3f9a1c2e`: a fresh key makes a new run, while an existing key with a different input fails with `request.digest-mismatch`.

Run this with the Bash tool in the background (`run_in_background`), from the current folder:

```
spore run <workflow> --key <key> --input '<input JSON>'
```

Write the input JSON on one line; inside the single quotes, write each `'` as `'\''`. Then end the turn with one line: the workflow, the key, the database it runs in, and that you will say when the run parks or ends.

## 6. Report when it returns

When the background command finishes, read its output. The status block at its end holds `run`, `status`, `position`, and for a decision `outcomes` and `answer`. Reply with one line by the exit code:

| Exit | The run | Say |
|---|---|---|
| 0 | completed | the end node and the `result` |
| 1 | failed | the end node and the error |
| 3 | waits for a decision | the node, the signal, its outcomes, and `/ml-workflow:continue <runId>` |
| 4 | is stuck | the node, the error, and `/ml-workflow:continue <runId>` |
| other | did not start or was cut off | the last lines spore printed |

The run does not need this session: if Claude closes first, the run stays where it was and `/ml-workflow:continue` picks it up.
