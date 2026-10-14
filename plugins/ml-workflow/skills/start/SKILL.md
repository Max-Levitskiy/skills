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

## 3. Find and check the workflow

The arguments are `<workflow>`, then optionally `--key <key>`. `<workflow>` is a workflow's name in the project folder, a workflow folder, or its `workflow.dot`.

The project's workflows live in `workflows/` inside the `.spore` folder that holds the database; `spore --json list` gives the database's path as `db`. Find the workflow's folder: for a name, the folder there whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name; for a folder, itself; for a `workflow.dot`, the folder holding it. With no `<workflow>`, list the workflows in that `workflows/` folder and ask which to start.

Run both checks, and show each one's report as it printed it:

1. `spore validate <workflow>`: the workflow and its actions.
2. `claude-spore check <workflow folder>`: the parameters of its Claude steps. Warnings are shown and do not stop the start.

If either exits non-zero, say nothing was started, and stop.

## 4. Draft the input

Read `inputSchema` from the folder's `settings.json`. Ask for every property in one message, then end the turn. For each: its `description` as the question, and a value drafted from this conversation as the answer to confirm, marking which properties are required. Leave a property with no grounded draft blank for the person to fill. Without an `inputSchema`, the input is `{}`: ask the person to confirm starting the workflow with no input, and end the turn.

When the person answers, build the input object from the confirmed values. It must fit the whole schema: types, `required`, `enum`, `const`, lengths, patterns, bounds, nested objects and arrays, and no undeclared property when `additionalProperties` is `false`. Ask again about any value that does not fit.

## 5. Start the run

The key is `--key` when given. Otherwise make a fresh one, `<workflow name>-<8 random hex characters>`, e.g. `coding-loop-3f9a1c2e`: a fresh key makes a new run, while an existing key with a different input fails with `request.digest-mismatch`.

Run this with the Bash tool in the background (`run_in_background`), from the current folder:

```
spore run <workflow> --key <key> --input '<input JSON>'
```

Write the input JSON on one line; inside the single quotes, write each `'` as `'\''`. If spore answers `input.invalid`, it created no run: show its message, ask again about the values it names, and start again with the same key. Then end the turn with one line: the workflow, the key, the database it runs in, and that you will say when the run parks or ends.

## 6. Report when it returns

When the background command finishes, read its output. The status block at its end holds `run`, `status`, `position`, and for a decision `outcomes` and `answer`. Reply with one line by the exit code:

| Exit | The run | Say |
|---|---|---|
| 0 | completed | the end node and the `result` |
| 1 | failed | the end node and the error |
| 3 | waits for a decision | the node, the signal, its outcomes, and `/ml-workflow:continue <runId>` |
| 4 | is stuck | the node, the error, and `/ml-workflow:continue <runId>` |
| other | did not start (`input.invalid` as above) or was cut off | the last lines spore printed |

The run does not need this session: if Claude closes first, the run stays where it was and `/ml-workflow:continue` picks it up.
