---
name: menu
description: Open the ml-workflow menu — the unfinished Runspore runs with what each needs, the workflows to start, and writing or changing a workflow.
allowed-tools: Bash(claude --version) Bash(spore *) Bash(claude-spore *) mcp__ml-workflow__open_menu
disable-model-invocation: true
---

# /ml-workflow:menu

## 1. Check Claude Code's version

This Claude Code reports: !`claude --version`

ml-workflow needs Claude Code 2.1.290 or later. Compare the version above with 2.1.290 as three numbers: major, then minor, then patch (2.1.99 is older than 2.1.290; 2.1.290, 2.1.296 and 2.2.0 are not). If it is older, or the line shows no version, reply with exactly this and stop:

> ml-workflow needs Claude Code 2.1.290 or later; this is <the version above, or "unknown">. Run `claude update`, then try again.

## 2. Open the menu

The menu is a pane that ml-workflow's mod draws. When the person types `/ml-workflow:menu`, the mod normally opens it and this skill does not run. Reading this text means the mod could not open it from there, so open it with the mod's tool:

Call `mcp__ml-workflow__open_menu`, loading it with ToolSearch first when its schema is not loaded. It takes no input. Reply with what it answered, in one line, and stop; when the pane waits undrawn the answer names the keys that show it, so keep them: the person picks from the pane, and each pick runs the sub-skill it names.

When no such tool exists, the mod is not loaded in this session: reply "ml-workflow's menu is not loaded in this session. Run `/reload-plugins`, then try again." and stop.
