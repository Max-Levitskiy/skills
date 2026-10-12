---
name: author
description: Write a new Runspore workflow, or change one in place, through a short interview — the whole draft first, then only the questions that change the outcome, then save, validate and check.
argument-hint: "[<workflow>]"
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *)
disable-model-invocation: true
---

# /ml-workflow:author

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Not built yet

The authoring interview arrives in a later release of ml-workflow. Say in one line that `/ml-workflow:author` is not built yet, and stop.
