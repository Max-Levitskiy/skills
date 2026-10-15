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

The project's workflows live in `workflows/` inside the `.spore` folder that holds the database; `spore --json list` gives the database's path as `db`. Find the workflow's folder: for a name, the folder there whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name; for a folder, itself; for a `workflow.dot`, the folder holding it. With no `<workflow>`, list the workflows in that `workflows/` folder and ask which to start.

Run both checks, and show each one's report as it printed it:

1. `spore validate <workflow>`: the workflow and its actions.
2. `claude-spore check <workflow folder>`: the parameters of its Claude steps. Warnings are shown and do not stop the start.

If either exits non-zero, say nothing was started, and stop.

## 4. Draft the input

Read `inputSchema` from the folder's `settings.json`. Ask for every property in one message, then end the turn. For each: its `description` as the question, and a value drafted from this conversation as the answer to confirm, marking which properties are required. Leave a property with no grounded draft blank for the person to fill. Without an `inputSchema`, the input is `{}`: ask the person to confirm starting the workflow with no input, and end the turn.

When step 2's `launcher` was `offer`, add one question to the same message: "Install the `claude-spore` launcher in `~/.local/bin`, so a worker you start in a plain terminal can run Claude steps? This is asked once." Run `claude-spore launcher install` on a yes and `claude-spore launcher decline` otherwise, before the start.

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
