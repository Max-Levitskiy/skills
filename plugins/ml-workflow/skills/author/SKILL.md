---
name: author
description: Write a new Runspore workflow, or change one in place, through a short interview — the whole draft first, then only the questions that change the outcome, then save, validate and check.
argument-hint: "[<workflow> | --change]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
disable-model-invocation: true
---

# /ml-workflow:author

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Check spore's version

Run `spore --version`. It prints `spore <major>.<minor>.<patch>`. If the command is not found, or the version is below 0.2.0 compared as three numbers, reply with exactly this and stop:

> ml-workflow needs spore 0.2.0 or later; this is <the version, or "not installed">. Install it with `cargo install --git https://github.com/Web-tree/runspore --locked runspore-cli`, then try again.

## 3. Run the interview

Read [references/authoring.md](references/authoring.md) and follow it. Its `examples/` folders are the shapes to copy.

- No argument: write a new workflow (its §1).
- `--change`: list the workflows under `.spore/workflows/` and ask which to change (its §8).
- `<workflow>`: change that workflow (its §8).

Write files only after the person says save. Never commit, stage or push.
