# ml-workflow

Run [Runspore](https://github.com/Web-tree/runspore) workflows from inside Claude Code. A job such as "Claude implements, the tests run, red goes back to Claude a few times, then I approve" runs as a durable workflow: it keeps going, or pauses cleanly, when your Claude session closes, crashes or the machine goes down, and any new session picks it up.

```bash
/plugin install ml-workflow@max-skills
```

**This release is the skeleton.** The helper, the mod and the sub-skills are in place and check their versions. Starting, following and writing workflows arrive in the next releases; [docs/spec.md](docs/spec.md) is the whole design and says what is built.

## Requirements

| What | Minimum | Checked by |
|---|---|---|
| Claude Code, in a terminal | **2.1.290** | every sub-skill, before anything else; the mod at session start. Older: `claude update` |
| Bun | **1.2.0** | `claude-spore`, before anything else; it exits 2 naming the version. Older: `bun upgrade` |
| [`spore`](https://github.com/Web-tree/runspore) | 0.2.0 | not yet; the plugin will offer the install line and run it only on a yes |

claude.ai and Cowork refuse a plugin with a top-level `bin/`, so this plugin is for terminal Claude Code only.

## Standing permissions

Each sub-skill approves `spore` and `claude-spore` for the turn it runs in. To stop being asked about them in later turns too, add the two rules to your project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(spore *)", "Bash(claude-spore *)"]
  }
}
```

## Sub-skills

| Typed | Does | Built |
|---|---|---|
| `/ml-workflow:menu` | the unfinished runs and what each needs, the workflows to start, writing or changing one | stub |
| `/ml-workflow:start <workflow>` | checks the workflow, drafts its inputs, starts and follows the run | stub |
| `/ml-workflow:status [<runId>]` | the unfinished runs, or one run's state in words | stub |
| `/ml-workflow:continue [<runId>]` | follows a run in the background | stub |
| `/ml-workflow:cancel <runId>` | cancels a run after a one-line confirmation | stub |
| `/ml-workflow:author [<workflow>]` | writes or changes a workflow through a short interview | stub |

A stub checks the Claude Code version and says it is not built yet. The stubs are typed only: Claude does not load them on its own until they do something.

## What's in the box

```
ml-workflow/
├── .claude-plugin/plugin.json   name, version, the mod's hooks file
├── bin/claude-spore             the helper (Bun); checks Bun first, then runs src/cli.ts
├── src/                         the helper's code; version.ts holds both minimums
├── claude-code/                 the mod: register.ts and its registration test
├── skills/                      the six sub-skills
├── test/                        the helper's specs, run as a subprocess
└── docs/spec.md                 the plugin's spec
```

## Tests

```bash
bun test plugins/ml-workflow/test                # the helper, run as a subprocess
claude plugin test plugins/ml-workflow           # the mod, in the engine's own runner
```

CI runs both, and runs the helper under Bun 1.1 to check that it refuses.

## License

[MIT](LICENSE)
