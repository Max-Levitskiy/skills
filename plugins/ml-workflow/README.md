# ml-workflow

Run [Runspore](https://github.com/Web-tree/runspore) workflows from inside Claude Code. A job such as "Claude implements, the tests run, red goes back to Claude a few times, then I approve" runs as a durable workflow: it keeps going, or pauses cleanly, when your Claude session closes, crashes or the machine goes down, and any new session picks it up.

```bash
claude plugin marketplace add Max-Levitskiy/skills   # once, adds the max-skills marketplace
claude plugin install ml-workflow@max-skills
```

To try it in one project without changing your own plugin set, install it there with `--scope project`:

```bash
claude plugin install ml-workflow@max-skills --scope project
```

**This release starts, follows, continues and cancels runs, names each unfinished run when a session starts, offers what each run needs in a menu, shows where a followed run is in a line above the prompt and in a live view, does background and watched Claude steps, writes workflows by interview, and installs or updates `spore` when you say yes.** [docs/spec.md](docs/spec.md) is the whole design and says what is built.

## Requirements

| What | Minimum | Checked by |
|---|---|---|
| Claude Code, in a terminal | **2.1.290** | every sub-skill, before anything else; the mod at session start. Older: `claude update` |
| Bun | **1.2.0** | `claude-spore`, before anything else; it exits 2 naming the version. Older: `bun upgrade` |
| [`spore`](https://github.com/Web-tree/runspore) | **0.2.0**, answering `spore capabilities` with the `cli`, `host`, `kernel` and `store` contracts at 0.2 | `claude-spore doctor`: the mod at session start, silent when it fits, and `start`, `status`, `continue` and `author` after the Claude Code check. Missing or older: one line with the install or update command, run only when you say yes |

claude.ai and Cowork refuse a plugin with a top-level `bin/`, so this plugin is for terminal Claude Code only.

## Getting spore

The plugin uses your own `spore` whenever it fits. When it is missing or too old, it offers `claude-spore install-spore`, which downloads the release for your machine, checks the Ed25519 signature on `SHA256SUMS` against the release key pinned in the plugin and the archive's SHA-256 against `SHA256SUMS`, and only then writes `spore`. It updates the copy your PATH selects, or installs into `~/.local/bin` when there is none. A copy you cannot write is left alone: the plugin names it and gives the command of what installed it. `SPORE_VERSION` and `SPORE_DOWNLOAD_URL` work as in runspore's `install.sh`.

**Updating.** `claude plugin marketplace update max-skills`, then `claude plugin update ml-workflow@max-skills` (add `--scope project` for a project install). Every change to the plugin ships at a new version, so an update always brings it in; [CHANGELOG.md](CHANGELOG.md) says what each version changed. After the plugin is updated, a session that loaded the older version asks you to run `/reload-plugins` before it starts anything.

**The launcher.** The first `start` offers to put a `claude-spore` launcher in `~/.local/bin`, so a `spore worker` you start in a plain terminal can still run Claude steps. It runs the helper of the `ml-workflow` installation for the folder you are in, a project's own before your user one. `claude-spore launcher install` installs it later.

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
| `/ml-workflow:menu` | the unfinished runs and what each needs, the workflows to start, writing or changing one, in a pane | built |
| `/ml-workflow:start <workflow> [--key <key>]` | checks the workflow, drafts its inputs, starts the run and follows it; offers to copy a shipped workflow the project lacks | built |
| `/ml-workflow:status [<runId>]` | the unfinished runs and what each needs, or one run's state in words | built |
| `/ml-workflow:continue [<runId>]` | follows a run, and offers what it needs when it stops for you: the decision, the stuck step's Retry, Mark done or Fail, the release, the claim line | built |
| `/ml-workflow:cancel [<runId>] [--reason <text>]` | cancels a run after a one-line confirmation | built |
| `/ml-workflow:author [<workflow> \| --change]` | writes a new workflow, or changes one in place, through a short interview | built |
| `/ml-workflow:act <runId> <action>` | one action a menu row hands to: decide, retry, mark done, fail, release, abandon or show a step, or open its pane | built |
| `/ml-workflow:view [<runId>]` | opens a run's live view in a pane | built |

**The menu.** `/ml-workflow:menu` opens a pane with one row per unfinished run, those that need you first, then the workflows to start, then writing or changing one. A stuck or quarantined run's row says why, in the kept error's code and first words. Each row offers what its run needs: Decide for a decision, Retry, Mark done or Fail for a stuck step, Open its pane, Continue or Abandon for a held one, Show the step for one waiting for its actor, Release for a quarantine, Continue for a working one, and View and Cancel for every run. A pick closes the pane and runs the sub-skill it names; after an action that lets the run move, Claude follows it. View opens the run's live view.

`menu` is typed only, and so are `act`, which the menu hands to, and `author`, which writes files; Claude may load the other five on its own, and each asks you before it sends a decision, a resolution, a release or a cancel, or starts a run. They read the database spore finds itself, `$RUNSPORE_DB` or the nearest `.spore/runspore.db` above the current folder, and name it.

**Following a run.** `start` and `continue` run `spore continue <runId> --wait --json` in the background and end the turn. When the run needs you or ends, Claude says so in one line and offers what to do right there: the outcomes of a decision, Retry, Mark done or Fail for a stuck step, the release of a quarantine, the claim line of a step waiting for its actor, or that a watched step waits for you in its pane. After you act it follows again; a watched step needs nothing typed here, so Claude says it once and keeps following until the pane's answer lands. Closing Claude stops the follow; the run stays where it was, and `/ml-workflow:continue` picks it up. Only outcomes the run lists are offered.

**The run line and the live view.** While Claude follows a run, a line above the prompt says where it is and for how long, refreshed once a second, led by `needs you` when it waits for you, with a `view` button (hotkey `v`):

```text
coding-loop-0238a2a3 at implement for 13 min, visit 3, from test on red, try 1/3, red 2/3 in a row [ view ]
needs you  nightly-mon at publish for 2 min, visit 2, from check on ok [ view ]
```

A narrow terminal gets the arrow cut down (`from check:ok`), then left out, before the line is cut.

`view`, the menu's View or `/ml-workflow:view` opens the live view: the workflow drawn from the `workflow.dot` the run pinned, the current node in yellow and the arrow just taken in orange, beside `workflow.dot`, the node's `settings.json` lines and the head of its instructions (`more` for all of it). Where Claude Code draws pictures (kitty, Ghostty) it is a Graphviz picture; elsewhere, herdr included, a drawing in Braille dots. The drawing fits the pane's height, as a compact tree of the workflow (as `argo watch` prints one) when it cannot, and the current node is scrolled into view as the run moves; long lines wrap, and the pane scrolls with the arrows, PgUp and PgDn once it has the keys (ctrl+x tab). Graphviz and resvg ship inside the plugin as WebAssembly (`vendor/`), so nothing else is installed; `claude-spore draw --run <runId> --png <file>` or `--plain` draws a run outside Claude. Nothing is polled while neither the line nor the view shows. A view Claude opens on a narrow terminal waits undrawn, and Claude names the keys that show it: ctrl+x tab, then `v`, for the newest run line, else `/ml-workflow:view <runId>`.

**Unfinished runs at session start.** A new session in a project with unfinished runs shows one line per run before you type anything, the way `git status` tells you about an unfinished rebase, and as `gh run list` shows each run with its conclusion: those that need you first, a stuck or quarantined one with why, then one hint:

```text
coding-loop-11111111 at test, stuck after attempt 3 of 3 for 40 s: command.exit: exit code 1
coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago
/ml-workflow:menu to pick them up
```

With none, or when `spore` cannot list them, it shows nothing; when every run is running by itself, it gives no hint.

Following and cancelling need a `spore` with `continue --wait` and `cancel`, which the v0.2.0 release predates. Until a release has them, build `spore` from runspore's main branch: `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli`.

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

`claude-spore start` opens the pane in the action's working folder, starts Claude there with the step's tools approved (anything else asks in the pane), and gives it the instructions, the input and the command to hand in its answer, `claude-spore report`, which checks the answer against the step's schema and lets Claude fix it twice. The message goes only once Claude is ready for it, like traffic to a Kubernetes container whose readiness probe passed, and is typed again until Claude takes it. The watch tells the run when the pane waits for you, including a pane that stays quiet with no answer, and delivers the answer once Claude is quiet. A pane whose machine went down is found dead by its boot ID and process start time, and the next try resumes the same conversation in a new pane. Starting again for the same step reuses its live pane. The pane closes once the run leaves the step: when the watch hands in the answer, when the run is cancelled, or when a later visit opens its own. Set `keepSeconds` on the node to keep it open that long after the answer, like a Kubernetes Job's `ttlSecondsAfterFinished`. `claude-spore check` refuses a workflow with watched steps when no herdr server answers.

## Writing a workflow

`/ml-workflow:author` asks what the workflow should do, from start to finish, and shows the whole draft as a numbered list. You correct it in plain words; it asks only what changes the outcome (who does each step, whether you watch each Claude step, where each ending goes, loop limits, approvals, inputs, steps unsafe to repeat, running several at once) and fills in the rest. On save it runs `spore init` if needed, writes `.spore/workflows/<name>/`, runs `spore validate` and `claude-spore check` and fixes its own errors, then lists every default it filled in. It never commits. `/ml-workflow:author <workflow>` changes a workflow in place, keeping comments, hand-written instructions and render attributes.

**The shipped workflows.** The plugin ships the reference coding loop, `coding-loop`; `parallel-coding-loop`, the same loop with a git worktree per run; and `watched-coding-loop`, the same loop with `implement` in a herdr pane and the tests run by a helper program. `/ml-workflow:start coding-loop` in a project that lacks it offers to copy it to `.spore/workflows/coding-loop/`, running `spore init` first if needed, and asks of each Claude step whether it runs in the background or in a herdr pane you watch. `/ml-workflow:start` with no workflow in a project that has none offers each. The copy is yours to commit and change; `claude-spore example list` and `claude-spore example copy <name> <folder> [--watch <node>]` do the same by hand.

Saying you'll run several at once adds a first step that makes a git worktree per run, beside the repository, and runs every later step in it. Saying you want to watch a Claude step writes it as a [watched step](#watched-claude-steps). A step that needs more than a command line gets a helper program written into the workflow folder as `bin/<program>`, which spore seals into each run as an asset and runs as `./bin/<program>`. The guide the interview follows, and the three folders it copies, are in [skills/author/references/](skills/author/references/).

## What's in the box

```
ml-workflow/
├── .claude-plugin/plugin.json   name, version, the mod's hooks file
├── CHANGELOG.md                 what each version changed
├── bin/claude-spore             the helper (Bun); checks Bun first, then runs src/cli.ts
├── src/                         the helper's code; version.ts holds the minimums and contracts
├── launcher/claude-spore        the launcher `claude-spore launcher install` copies to ~/.local/bin
├── claude-code/                 the mod: register.ts and its registration test
├── skills/                      the seven sub-skills
├── types/index.d.ts             the session state the mod keeps: the menu's rows
├── test/                        the helper's specs, run as a subprocess
└── docs/spec.md                 the plugin's spec
```

## Tests

```bash
bun test plugins/ml-workflow/test                # the helper, run as a subprocess
claude plugin test plugins/ml-workflow           # the mod, in the engine's own runner
bun test --bail ./plugins/ml-workflow/test/reference-loop.e2e.ts   # before a release: real Claude, spore and herdr
```

The last is the end-to-end check, gated because it spends real Claude turns and opens herdr panes: `bun test` leaves it out. It kills the reference coding loop at every row of the C11 table, with `implement` in the background and in a pane. [docs/release-check.md](docs/release-check.md) says how to run it and what to check by hand in Claude Code.

The helper's specs put a fake `claude` and a fake `herdr` (`test/fixtures/bin/`) first on PATH. The install specs need `ssh-keygen` and `tar`: they sign local release folders with a throwaway key pinned into a copy of the plugin. The ones that run a real `spore` use `$SPORE`, else `spore` on PATH, and are skipped when that is not 0.2, for the watched step when it does not run async commands, and for following a run when it has no `continue --wait` or `cancel`. CI runs both, against `spore` built from a pinned runspore commit, and runs the helper under Bun 1.1 to check that it refuses.

## License

[MIT](LICENSE)
