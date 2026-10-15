# ml-workflow

Run [Runspore](https://github.com/Web-tree/runspore) workflows from inside Claude Code. A job such as "Claude implements, the tests run, red goes back to Claude a few times, then I approve" runs as a durable workflow: it keeps going, or pauses cleanly, when your Claude session closes, crashes or the machine goes down, and any new session picks it up.

```bash
/plugin install ml-workflow@max-skills
```

**This release starts, shows and continues runs, does background and watched Claude steps, and writes workflows by interview.** `start`, `status` and `continue` are a basic tier over the commands `spore` 0.2.0 has; the menu, cancelling and the run line arrive in the next releases. [docs/spec.md](docs/spec.md) is the whole design and says what is built.

## Requirements

| What | Minimum | Checked by |
|---|---|---|
| Claude Code, in a terminal | **2.1.290** | every sub-skill, before anything else; the mod at session start. Older: `claude update` |
| Bun | **1.2.0** | `claude-spore`, before anything else; it exits 2 naming the version. Older: `bun upgrade` |
| [`spore`](https://github.com/Web-tree/runspore) | **0.2.0** | `start`, `status`, `continue` and `author`, after the Claude Code check; they print the install line and stop: `cargo install --git https://github.com/Web-tree/runspore --locked runspore-cli` |

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
| `/ml-workflow:start <workflow> [--key <key>]` | validates the workflow, drafts its inputs, starts the run in the background, says when it parks or ends | basic |
| `/ml-workflow:status [<runId>]` | the unfinished runs, or one run's state in words | basic |
| `/ml-workflow:continue [<runId>]` | sends the decision a run waits for, or resolves its stuck step, then works it on in the background | basic |
| `/ml-workflow:cancel <runId>` | cancels a run after a one-line confirmation | stub |
| `/ml-workflow:author [<workflow> \| --change]` | writes a new workflow, or changes one in place, through a short interview | built |

A stub checks the Claude Code version and says it is not built yet; stubs are typed only, and so is `author`, which writes files. The basic sub-skills Claude may also load on its own. They read the database spore finds itself, `$RUNSPORE_DB` or the nearest `.spore/runspore.db` above the current folder, and name it. `continue` offers only the outcomes the run's status lists, since spore 0.2.0 drops an unknown outcome without an error. Following a run with `spore continue --wait` replaces this tier later ([docs/spec.md](docs/spec.md), "Basic tier").

## Background Claude steps

A workflow step whose action runs `claude-spore run` with `"output": "result"` is done by `claude -p` in the background, keeping one conversation per node for the whole run. The node sets its parameters as `$literal` values in its `input`:

```json
"actions": {
  "review": { "kind": "command", "argv": ["claude-spore", "run"], "output": "result",
              "outcomes": ["approved", "changes"], "effect": "idempotent",
              "retry": {"maxAttempts": 3}, "timeoutMs": "3600000" }
},
"nodes": {
  "review": {
    "action": "review",
    "instructions": "steps/review.md",
    "outputSchemas": { "approved": {…}, "changes": {…} },
    "input": {
      "format":  {"$literal": "json"},
      "schema":  {"$outputSchemas": {}},
      "tools":   {"$literal": ["Read", "Grep", "Glob"]},
      "context": {"tests": {"$get": ["nodes", "test", "output", "stdout"]}}
    }
  }
}
```

`claude-spore check <folder>` checks these parameters in a workflow folder. Each try's turns, duration, cost and denied tools go to `<attempt>.facts.json` in the step's work folder. The rules are in [docs/spec.md](docs/spec.md), p.14–p.20.

## Watched Claude steps

A step you want to watch and type into runs Claude in a [herdr](https://herdr.dev) pane instead. Its action is an async command, with the same node parameters:

```json
"implement": { "kind": "command", "argv": ["claude-spore", "start"], "outcomes": ["ok"],
               "effect": "idempotent", "retry": {"maxAttempts": 3},
               "async": { "timeoutMs": "14400000",
                          "probe": {"command": {"argv": ["claude-spore", "probe"]}},
                          "watch": {"command": {"argv": ["claude-spore", "watch"]}},
                          "stop":  {"command": {"argv": ["claude-spore", "stop"]}} } }
```

`claude-spore start` opens the pane in the action's working folder, starts Claude there with the step's tools approved (anything else asks in the pane), and gives it the instructions, the input and the command to hand in its answer, `claude-spore report`, which checks the answer against the step's schema and lets Claude fix it twice. The watch tells the run when the pane waits for you, and delivers the answer once Claude is quiet. A pane whose machine went down is found dead by its boot ID and process start time, and the next try resumes the same conversation in a new pane. Starting again for the same step reuses its live pane. `claude-spore check` refuses a workflow with watched steps when no herdr server answers.

## Writing a workflow

`/ml-workflow:author` asks what the workflow should do, from start to finish, and shows the whole draft as a numbered list. You correct it in plain words; it asks only what changes the outcome (who does each step, where each ending goes, loop limits, approvals, inputs, steps unsafe to repeat, running several at once) and fills in the rest. On save it runs `spore init` if needed, writes `.spore/workflows/<name>/`, runs `spore validate` and `claude-spore check` and fixes its own errors, then lists every default it filled in. It never commits. `/ml-workflow:author <workflow>` changes a workflow in place, keeping comments, hand-written instructions and render attributes.

Saying you'll run several at once adds a first step that makes a git worktree per run, beside the repository, and runs every later step in it. The guide the interview follows, and the two folders it copies, are in [skills/author/references/](skills/author/references/).

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

The helper's specs put a fake `claude` and a fake `herdr` (`test/fixtures/bin/`) first on PATH. The ones that run a real `spore` use `$SPORE`, else `spore` on PATH, and are skipped when that is not 0.2, or for the watched step when it does not run async commands. CI runs both, against `spore` built from a pinned runspore commit, and runs the helper under Bun 1.1 to check that it refuses.

## License

[MIT](LICENSE)
