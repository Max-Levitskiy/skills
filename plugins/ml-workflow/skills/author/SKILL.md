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

## 2. Check spore

Run `claude-spore doctor --json`. It prints `{"ok", "spore", "problems", "launcher"}`, and `ok` is true when spore fits; then go on.

Otherwise, take each problem in order:

- `plugin.reload`: reply with its `message` and stop.
- Any other: show its `message`, ask "Run `<fix>` now?", and end the turn. Run the fix only on a yes, show what it printed, then run `claude-spore doctor --json` again and go on only when `ok` is true. A no, or a fix that fails, stops the skill. It installs nothing on its own.

If `claude-spore` itself does not run:

- The shell cannot find `claude-spore`: reply "ml-workflow's helper is not on this session's PATH. Run `/reload-plugins`, then try again." and stop.
- It fails because `bun` is not found (exit 127): say "ml-workflow needs Bun 1.2.0 or later, and none is on PATH." and ask "Run `curl -fsSL https://bun.sh/install | bash` now?". On a yes, run it, then tell the person to restart Claude Code so its PATH has Bun, and stop.
- It exits 2 saying it needs a newer Bun: show that line and ask "Run `bun upgrade` now?". On a yes, run it, then run the check again.

## 3. Run the interview

Read [references/authoring.md](references/authoring.md) and follow it. Its `examples/` folders are the shapes to copy.

- No argument: write a new workflow (its §1).
- `--change`: list the workflows under `.spore/workflows/` and ask which to change (its §8).
- `<workflow>`: change that workflow (its §8).

Write files only after the person says save. Never commit, stage or push.
