# ml-workflow: the plugin's spec

The Claude half of the Claude Code profile for Runspore. The generic runtime this plugin drives, `spore` 0.2, is specified in the [runspore spec](https://github.com/Web-tree/runspore/issues/50); build against its CLI contract. Runspore's spec never names Claude; this document is where Claude lives ([C10][c10] R4).

Sources: the spec issue [skills#59](https://github.com/Max-Levitskiy/skills/issues/59) and the checklist [C21 §1.8, p.1–p.25][c21]. Each section below carries the p-item it settles. Where this document and a design record in Web-tree/runspore `docs/design/` disagree, this document wins.

## Build state

Each part is built by one ticket of skills#59. This table says what exists in the plugin now.

| Part | Items | State |
|---|---|---|
| Skeleton: packaging, minimum versions, `claude-spore --version`, the mod registering, sub-skill stubs, README rules, CI | p.1, p.2, p.6 | built (skills#60) |
| Getting and checking `spore`, the launcher, helper/mod version match | p.3, p.4, p.5 | not built |
| Entry points, menu, session-start line, following a run | p.7–p.12 | the basic tier of `start`, `status` and `continue` (skills#74); `menu` and `cancel` are stubs that check the host version and say they are not built |
| Profile kinds, node parameters, `claude-spore check` | p.13–p.15 | built (skills#62), except the herdr check |
| Background Claude step: `claude-spore run`, session table, repair, facts | p.16, p.18, p.19, p.20 | built (skills#62) |
| Interactive Claude step: `start`, `probe`, `watch`, `report`, `stop` | p.17 | not built |
| Authoring interview | p.21–p.23 | not built |
| Run line and live view | p.24 | not built |
| Reference loop as the end-to-end check | p.25 | not built |

## Terms

- **Plugin**: `ml-workflow`, installed from the `max-skills` marketplace. *Avoid:* extension, addon.
- **Mod**: the plugin's hooks module, `claude-code/register.ts`. It is one part of the plugin.
- **Helper**: `claude-spore`, the plugin's own program. `spore` never knows about it. *Avoid:* wrapper, shim.
- **Sub-skill**: one of the plugin's skills, typed as `/ml-workflow:<name>`.
- **Following a run**: the person's own session running `spore continue <runId> --wait --json` in the background and reacting when it returns.
- **Oldest supported spore**: the lowest `spore` version the plugin works with, `0.2.0`.

## Home and packaging (p.1)

- The plugin is `plugins/ml-workflow` in `Max-Levitskiy/skills`, listed in the `max-skills` marketplace with the relative source `./plugins/ml-workflow`. It releases on this repository's flow, separately from runspore ([C10][c10] L1).
- `claude-spore` is a `#!/usr/bin/env bun` script in the plugin's top-level `bin/`, with its code in `src/`, the pattern of `ml-agent-config`'s `bin/agent-config` ([C10][c10] L3).
- The mod ships in the plugin as `claude-code/register.ts`, named by `claude-code/hooks.json` from `plugin.json`'s `hooks`.
- Terminal Claude Code only. claude.ai and Cowork refuse a plugin with a top-level `bin/` ([C10][c10] R10).

## Minimum versions (p.2)

Claude Code **2.1.290** (mods need 2.1.287; 2.1.290 fixed lost plugin `bin/` path entries) and Bun **1.2.0**. No manifest field enforces either, so each is checked where it can be:

| Where | What it does |
|---|---|
| The marketplace description and the README | Show both minimums next to the install command. |
| Every sub-skill | Reads `claude --version` before anything else. On a version below 2.1.290 it prints the minimum and `claude update`, then stops. A skill loads where mods do not, so this explains a missing menu. |
| The mod's `session.start` | Reads `$.session.version()`. On a release below 2.1.290 it writes one transcript line with the minimum and `claude update`. A version it cannot read as a release is let through. |
| The helper | Checks `Bun.version` before it loads anything else. Below 1.2.0 it exits 2 and names the version it needs and `bun upgrade`. |

Both minimums are written once, in `src/version.ts`, which the helper and the mod import. The skills and the README repeat the Claude Code number in text.

## Getting and checking `spore` (p.3, p.4)

- The plugin never carries or quietly downloads `spore`. When `spore` or Bun is missing, or older than the oldest supported version, it shows one line with the install or update command and runs it only on a yes ([C10][c10] L2).
- The helper's installer downloads the release archive for this platform and checks, before running anything:
  - the Ed25519 signature on `SHA256SUMS`, against the release key pinned in the plugin;
  - the archive's SHA-256 against `SHA256SUMS`.

  The format is runspore's `release.md`. The installer puts `spore` in `~/.local/bin`.
- An update targets the path `command -v spore` resolves. If that file is not writable, the plugin names it and gives the package manager's command. After an install or update it runs the version check again and reports success only if the check passes.
- **The version check** runs `spore capabilities --json`:
  - `version` must be at least 0.2.0;
  - `contracts` must hold `cli`, `host`, `kernel` and `store`, each in range; below 1.0 a range is one minor version (`0.2`);
  - a missing field, a missing contract or a contract out of range shows the update line and starts nothing.

  It runs at session start, silently when everything fits, and before every start.
- The plugin uses the person's own `spore` whenever it is new enough ([C10][c10] R1).

## The helper outside Claude (p.5)

- `claude-spore --version` prints the plugin's version, the `version` in `.claude-plugin/plugin.json`, and nothing else.
- The mod compares that with its own version at session start and before every start. On a mismatch it asks for `/reload-plugins` and starts nothing.
- **The launcher**, offered once and installed at `~/.local/bin/claude-spore`, reads the `ml-workflow@max-skills` entry in `~/.claude/plugins/installed_plugins.json`. A project-scope entry whose project contains the current folder beats the user-scope entry. It runs that installation's `bin/claude-spore`, and exits 2 if no entry exists.
- The mod calls the helper by `$.plugin.root + "/bin/claude-spore"`, since `$.process.run` does not see the plugin's `bin/`. Steps find `claude-spore` on PATH: the worker started from Claude's Bash tool inherits the plugin's `bin/`.

## Permissions (p.6)

A plugin cannot ship standing allow rules. Each sub-skill pre-approves `Bash(spore *)` and `Bash(claude-spore *)` in its `allowed-tools`, for the turn it runs in. The README shows the two standing rules for a project's `.claude/settings.json` ([C10][c10] R11).

## Entry points (p.7, p.8)

- **Sub-skills** ([C06][c06] L4):
  - `menu`: opens the pop-up;
  - `start <workflow>`: check, then the input draft, then `spore start`, then follow;
  - `status [<runId>]`: the unfinished runs, or one run's state in words;
  - `continue [<runId>]`: follows a run, and asks which when several are unfinished;
  - `cancel <runId>`: confirms in one line, then runs `spore cancel`;
  - `author [<workflow>]`: the interview; its guide ships as `skills/author/references/authoring.md`.
- **Opening the pop-up.** The mod hooks `skill.prompt` for `ml-workflow:menu`, opens the pane with `$.ui.open` and returns "The workflow menu is open." If opening from that hook is refused, the skill tells Claude to call the mod tool `open_menu`.
- **The menu widget** is a pane with a `Select` ([C05][c05]).
- **The mod stays thin.** The helper works out what the mod shows (the start line, the menu rows, the run line text, the drawings) and returns it as JSON from subcommands named in implementation. The mod only calls the helper and renders what comes back, so the helper's tests cover the logic.

## The session-start line (p.9)

`spore list --unfinished --json` must answer within the 10 s hook budget. If runs are listed, the mod prints one line naming `/ml-workflow:menu`, for example `1 run waiting: coding-loop at approve (decision), 2 h — /ml-workflow:menu`. With no unfinished run, or on any error, it prints nothing.

## Following a run (p.10)

- `start` and `continue` tell Claude to run `spore continue <runId> --wait --json` as a background shell command, setting `RUNSPORE_DB` when the database is not found by walking up, and then to end the turn ([C06][c06] L3).
- When the command returns, Claude reacts to its exit code:
  - **3, a decision:** show the step and offer the outcomes.
  - **4, stuck:** show the kept error and the three `resolve` forms.
  - **5, quarantined:** the reason and `spore release`.
  - **6:** a ready external step names the actor label and the claim line; a watch's `waiting: person` says so with its message ("implement waits for you in its pane"); a missing capability says what to restore.
  - **0, 1, 7:** one line with the end state.
- After the person acts, the skill runs `continue --wait` again. Closing Claude pauses the runs it followed.

## Menu rows (p.11)

| `needs` | Actions | Runs |
|---|---|---|
| `signal` | Decide | Reads `spore events <run> --json` and `spore step show <run>`, shows the instructions and each earlier step's latest result, asks for an outcome (and data when its schema needs it), then runs `spore signal <run> <name> --outcome <o> [--data …] --id <activationId>` |
| `stuck` | Retry / Mark done / Fail | `spore resolve` with `--retry`, `--complete <o> [--output]` or `--fail <message>` |
| `held`, the plugin's interactive handle | Open its pane / Continue / Abandon | herdr focus by the handle's `herdrAgent`; the `continue` sub-skill; `spore step abandon` |
| `held`, another holder | Shows holder and deadline / Continue / Abandon | |
| `external-ready` | Shows the step | `spore step show`, plus the claim line `spore step claim <run> --actor <label>` |
| `working` | Continue | the `continue` sub-skill |
| `quarantined` | Shows the reason, offers release | `spore release` |
| any | View / Cancel | the live view; the `cancel` sub-skill |

Unfinished runs come first, newest first. Workflows under `.spore/workflows/` (by graph id) run `ml-workflow:start`. "Write a new workflow" and "change a workflow" run `ml-workflow:author`. A row hands off with `$.command.run`; after an action that lets the run move, the row hands to `continue` ([C08][c08], [C11][c11] R3, R4, R12).

## The start flow (p.12)

Choosing a workflow runs `claude-spore check` first and shows any errors without starting. The flow then asks for each declared input, using the property's `description` as the question and Claude's draft from the conversation as the answer to confirm. It runs `spore start` and ends by following the new run ([C08][c08] R5, R9).

## Basic tier: `start`, `status`, `continue` on spore 0.2.0 (skills#74)

Until spore has `continue --wait` and `cancel` (Web-tree/runspore#74), the three sub-skills are thin prose over commands spore 0.2.0 has. This section is what they do now. p.10–p.12 replace it in skills#64.

**Before anything**, after the Claude Code check, each runs `spore --version`. A missing `spore`, or one below 0.2.0, gets one line with the install command, `cargo install --git https://github.com/Web-tree/runspore --locked runspore-cli`, and the skill stops. Installing it for the person is p.3, skills#61.

**The database.** The skills pass no `--db`: spore takes `$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`. Every `--json` answer carries the database path as `db`, and the skills name it whenever they report runs.

**Exit codes** of `spore run` and `spore worker --run <id> --until-parked`, checked against 0.2.0:

| Exit | Run | One line |
|---|---|---|
| 0 | `completed` | the end node and the result |
| 1 | `failed` | the end node and the error |
| 3 | `waiting` for a signal | the node, the signal and its outcomes |
| 4 | `needs-intervention` | the node and the kept error |
| other | — | the last lines spore printed |

The lines for 3 and 4 name `/ml-workflow:continue <runId>`.

**`status [<runId>]`.** Without an ID it runs `spore list`, whose rows say how long each run has been where it is, and `spore --json list` for `db`, and lists the unfinished runs (status not `completed`, `failed` or `cancelled`): ID, node, status, how long. With an ID it runs `spore --json status <runId>` and says in words where the run is (`position`), what it waits for and since when (`waiting`, `intervention`, `quarantine`, `step`), or how it ended (`end`, `result`), then gives the commands `waiting.commands` or `intervention.commands` hold. It runs nothing else.

**`start <workflow> [--key <key>]`.**

1. `spore validate <workflow>`. On a non-zero exit it shows spore's report and starts nothing.
2. Reads `inputSchema` from the workflow's `settings.json`. spore finds a named workflow by its graph ID, so a name means the folder under `.spore/workflows/` whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name. Without a workflow, `start` lists the workflows there and asks which. It asks for every property in one message, the `description` as the question and a value drafted from the conversation as the answer to confirm.
3. Without `--key` it makes a fresh key, `<workflow>-<8 hex>`, so a repeated start is a new run and never `request.digest-mismatch`.
4. Runs `spore run <workflow> --key <key> --input '<json>'` as a background shell command, ends the turn, and gives the one line from the table when it returns.

**`continue [<runId>]`.** Without an ID, `spore list` and `spore --json list`: no unfinished run says so; one is taken; several are asked about. Then `spore --json status <runId>`, and by what it holds:

- **`waiting`, a signal.** It offers exactly `waiting.outcomes`, never free text: spore 0.2.0 stores an outcome the node does not route and drops it without an error (`signal.outcome-unrouted`). An outcome with an entry in `waiting.outputSchemas` also needs data fitting that schema. It sends `spore signal <run> <signal> --outcome <o> --id <activationId> [--data '<json>']`. The ID is `position.activationId`, so one wait takes one decision: the same decision again is a no-op, and a different one fails with `request.digest-mismatch`, which the skill reports as "a decision was already sent" before going on. A sent signal leaves the run `waiting` until a worker consumes it.
- **`needs-intervention`.** It shows the node, `intervention.error` and the tries, and offers Retry (`spore resolve <run> --retry`; when `intervention.reason` is `unknown` the last try may have done its work, and the skill says that Retry runs it again), Mark done (`--complete <o>` with `o` from `intervention.outcomes`, plus `--output '<json>'` when `intervention.outputSchemas` has one) and Fail (`--fail <message>`).
- **`running`.** It says which step runs and sends nothing.
- **Quarantined, an external step, or ended.** It says so, with the commands status gives, sends nothing and stops.

After a decision, a resolution, or a `running` run, it runs `spore worker --run <runId> --until-parked` in the background and reports as `start` does.

**Continuing by `worker`, not by `spore run` again.** Running `spore run <workflow> --key <key> --input <same>` again also continues a run, but needs the workflow's name, the key and the original input, and neither `status` nor `list` gives the name. `worker --run` needs only the run ID, the run already holds its own input and artifact, and a changed input can never reach it.

**Claude may load these three on its own**, unlike the stubs, which stay typed only: each asks the person before it sends a decision, a resolution or starts a run.

**Closing Claude** stops the background command; the run stays where it was, and `continue` picks it up.

## Profile kinds (p.13)

The kinds `cmd`, `skill`, `agent` and `human` are words only. Workflow files hold plain actions ([C07][c07] L1):

| Kind | Action |
|---|---|
| `cmd` | `command` |
| `agent`, background | `command` running `claude-spore run`, `output: "result"` |
| `agent`, interactive | async `command` running `claude-spore start`, with probe, watch and stop set to `claude-spore probe\|watch\|stop` |
| `skill` | as `agent`, plus a `skill` parameter |
| `human`, a decision | `await-signal` |
| `human`, manual work | `external` with actor `person` |

The plugin recognises a step by the program it runs, or by its actor label.

## Node parameters (p.14)

The set is closed: `format`, `schema`, `outcome`, `model`, `tools`, `skill` and `context`. They are `$literal` values in the node's `input`; `schema` is `{"$outputSchemas": {}}`. Only `context` carries data to Claude. The instructions file is plain prose that explains what each outcome means ([C10][c10] R7, [C14][c14]).

| Parameter | Value | Absent |
|---|---|---|
| `format` | `"json"` or `"text"` | `"json"`: a Claude step's output is its checked answer ([C12][c12] R5) |
| `schema` | outcome → JSON Schema; in `settings.json` `{"$outputSchemas": {}}` or a `$literal` map | an error when `format` is `json` |
| `outcome` | the one outcome a `text` step ends with | an error when `format` is `text` |
| `model` | a model name for `--model` | no `--model` |
| `tools` | a list of Claude Code tool names: a built-in tool such as `Read` or `Bash`, or an MCP tool `mcp__<server>__<tool>` | no `--tools`/`--allowedTools`: Claude has its default tools, and in the background every call that needs permission is denied |
| `skill` | a skill name, `name` or `plugin:name` | no slash command |
| `context` | any mapping: the data Claude sees as the step's input | `null` |

## What `claude-spore check <folder>` checks (p.15)

- No parameter key outside the closed set.
- `schema` is present when `format` is `json`, and every outcome of a `json` Claude step has a schema.
- `outcome` is present, and is the node's only outcome, when `format` is `text`.
- Tool names are valid Claude Code tools.
- herdr is reachable when the workflow has interactive steps.
- A schema Claude Code's strict form cannot use is a warning, not a refusal.

The interview and every start run the check; the helper checks the same again when a step starts.

A Claude step is a `command` action whose `argv` runs `claude-spore run` or `claude-spore start` (by name or by a path ending in `/claude-spore`). Its outcomes are the action's `outcomes`, `["ok"]` when it declares none. The check reads the folder's `settings.json` and builds nothing; `spore validate` checks the rest.

- **Strict form.** A schema fits Claude Code's strict form when it uses only `$schema`, `type`, `description`, `title`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const` and `anyOf`; every object declares `properties`; `additionalProperties` is absent or `false`; `anyOf` stands alone (beside `description` or `title` at most); and it is at most 32 levels deep ([C12][c12] W02).
- **Output.** One line per problem, `error: <node>: <message>` or `warning: <node>: <message>`, and exit 2 when there is an error, else 0. With `--json`, one object `{"ok", "errors", "warnings"}`, each problem `{"node", "code", "message"}`, with the same exit codes.
- **Codes.** `params.unknown`, `params.not-literal`, `params.format`, `params.schema-missing`, `params.schema-outcome`, `params.outcome`, `params.model`, `params.tools`, `params.skill`; the warning `schema.not-strict`; and `workflow.unreadable` for a folder without a readable `settings.json`.

## Background step, `claude-spore run` (p.16)

- Reads its parameters from stdin and the prose from `RUNSPORE_INSTRUCTIONS`.
- With `format: "json"` it builds one `--json-schema`: a fixed root object whose `answer` is an `anyOf` with one `{outcome: const, output: schema}` branch per outcome.
- Runs `claude -p --output-format json` with `--session-id` or `--resume`; `--add-dir "$RUNSPORE_STEP_FILES"`; `--tools <tools>` and `--allowedTools <tools>` with `--permission-mode default`; `--model` only when set; the skill as a slash command when set; and `MAX_STRUCTURED_OUTPUT_RETRIES=3`.
- Prints result mode (`{"outcome", "output"}`), turning integral floats into integers.
- Writes run facts (session, turns, duration, cost in integer micro-dollars, denied tools) to `$RUNSPORE_WORK_DIR/<attempt>.facts.json`, never into the answer. Denied tools are reported, never failed.
- Claude runs in the process's working folder, the action's `cwd`, including a `fromInput` worktree.

How it does this:

- **Its environment.** It needs `RUNSPORE_RUN_ID`, `RUNSPORE_NODE_ID`, `RUNSPORE_VISIT` and `RUNSPORE_ATTEMPT`; without them it exits 2, since it only runs as a spore step. `RUNSPORE_INSTRUCTIONS`, `RUNSPORE_STEP_FILES` and `RUNSPORE_WORK_DIR` are used when set.
- **The parameters are checked again** with the rules of `check` that need no workflow folder. A parameter that does not pass is the non-retryable `params.invalid`, with one problem per line in the message: the same input would fail every try. A non-strict schema is a warning on stderr.
- **The message goes on stdin**, never in `argv`, so an instructions file that starts with `-` cannot read as a flag. Lists go as one comma-joined argument each (`--tools Read,Grep --allowedTools Read,Grep`). The start message is the instructions, then where the step files are, then the input (`context`) as JSON; with `skill` set it starts with `/<skill> `.
- **Its stdout** is always one result-mode object on exit 0. Exit 2 is a usage error; any other exit is a bug, which spore records as the retryable `command.exit`.
- **A `claude` that fails** for another reason (a limit, an API error, a crash; a non-zero exit or `is_error`) is the retryable `claude.failed`, with Claude's `errors` or the end of its stderr. The next try resumes the conversation.
- **Text.** With `format: "text"` it prints `{"outcome": <outcome>, "output": {"text": <Claude's last reply>}}`. A reply too long for 63 KiB keeps its end, after a line saying how much was cut, the way spore's text mode keeps the end of a log.
- **Numbers.** An integral float in the answer (`2.0`) is printed as an integer. A number with a fraction has no place in spore's data; it is the non-retryable `output.invalid`, naming its JSON Pointer.
- **Facts.** `<attempt>.facts.json` is `{"session", "turns", "durationMs", "costMicroUsd", "deniedTools"}`, summed over the `claude` calls of the try (a nudge is a second call). `deniedTools` lists `{"tool", "input"}` from Claude's `permission_denials`. The file is written for every try that got an answer from `claude`, success or not; without `RUNSPORE_WORK_DIR` nothing is written.

## Interactive step (p.17)

- **`start`** saves the parameters to `$RUNSPORE_WORK_DIR/params.json` and names the herdr agent after the run and node. If a live pane for this session exists it prints that pane's handle instead of opening another. Otherwise it opens a herdr pane in its working folder; the pane's launcher records its own PID and start time, then execs `claude` with `--session-id` or `--resume`, `--add-dir`, the same `--tools`/`--allowedTools` with `--permission-mode default`, and `--model` and the skill when set. It passes `RUNSPORE_WORK_DIR` and `RUNSPORE_DB` into the pane, seeds the message with the instructions, the input, the exact report command for this attempt and each outcome's format, prints the handle `{herdrAgent, session, pid, started, boot, machine}`, and exits 0.
- **`probe`** answers `dead` when the boot ID differs from the machine's, or when no process has that PID and start time; `alive` when one does; `unknown` from another machine or on any doubt.
- **`watch`** waits until herdr shows the session idle or done and `$RUNSPORE_WORK_DIR/<attempt>.result.json` exists, then prints it. Quiet with no file, it prints `{"needs": "person", "message": "<node> waits for you in its pane"}`. A later try first copies an earlier try's success result in the same invocation to its own name; a failure result is never carried over.
- **`report --outcome <o>`** reads the answer as JSON on stdin and checks it against `params.json`. If it fits, it writes the result file and prints "accepted". If not, it prints one error per line, exits 1 and counts the bad answer in `<attempt>.answers`; the third bad answer writes a non-retryable `output.invalid` result.
- **`stop`** closes the pane by the handle.

## Session ID and the message to send (p.18)

A name-based UUID over `RUNSPORE_RUN_ID` and `RUNSPORE_NODE_ID`, under a namespace fixed in the plugin. Every visit and try of one node in one run shares one conversation ([C13][c13] L3).

| Session exists? | Visit | Attempt | Action |
|---|---|---|---|
| no | 1 | any | Start with `--session-id`, the instructions and the input |
| no | >1 | any | Non-retryable failure: the conversation is lost |
| yes | >1 | 1 | Resume, saying the run came back, with the new input |
| yes | any | >1 | Resume, saying "you were cut off, finish the step", with the current input |
| yes | 1 | 1 | Non-retryable failure: the ID belongs to another run |

The name is `<RUNSPORE_RUN_ID>/<RUNSPORE_NODE_ID>` and the namespace `40c82ef1-afd2-4dda-b095-47327517b1dc`, giving a version 5 UUID. Changing either would cut every unfinished run off from its conversations.

**Whether the session exists** is learned from `claude` itself, not from its transcript files, whose folder depends on where the session started ([C04][c04]): `--session-id` on an existing session exits 1 with `Session ID <uuid> is already in use`, and `--resume` on a missing one exits 1 with `No conversation found with session ID: <uuid>`. So the step tries the row it expects and falls to the other on that answer:

- visit 1, attempt 1: start; "already in use" is the non-retryable `session.foreign`;
- attempt above 1: resume; "no conversation" on visit 1 starts instead (the first try died before Claude made the session), and on a later visit is the non-retryable `session.lost`;
- visit above 1, attempt 1: resume; "no conversation" is `session.lost`.

Each resume message carries the current input. "The run came back" names the visit; "you were cut off" asks Claude to check what it already did before it goes on.

## Repair (p.19)

`MAX_STRUCTURED_OUTPUT_RETRIES=3` gives Claude two repairs in the same conversation. When they run out, the step prints the non-retryable `output.invalid`. A null `structured_output` gets one nudge by resume, then the non-retryable `output.missing`. A conversation that cannot be resumed is non-retryable ([C12][c12]).

The answer schema, built from `schema`, with one branch per outcome in the map's order:

```json
{"type": "object", "additionalProperties": false, "required": ["answer"],
 "properties": {"answer": {"anyOf": [
   {"type": "object", "additionalProperties": false, "required": ["outcome", "output"],
    "properties": {"outcome": {"const": "<o>"}, "output": <schema of o>}}
 ]}}}
```

Claude Code reports used-up repairs as `terminal_reason: "structured_output_retry_exhausted"`; the step's `output.invalid` carries Claude Code's last errors as its message. An answer whose `outcome` is not a key of `schema` is also `output.invalid`.

## The work folder (p.20)

| File | Written by | Holds |
|---|---|---|
| `params.json` | `start` | the step's parameters, for `report` |
| `<attempt>.result.json` | `report`, or a carried-over success | the answer `watch` prints |
| `<attempt>.answers` | `report` | the count of bad answers this attempt |
| `<attempt>.facts.json` | `run` | session, turns, duration, cost, denied tools |

## Defaults the interview writes (p.21)

- Claude steps are `idempotent` with `retry.maxAttempts: 3`.
- Time limits: background 1 h, interactive 4 h, a person's manual work 7 days.
- Repeatable commands get 3 tries.
- With no `model`, the helper passes no `--model`.
- Tool sets: edits (`Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash`) and reads (`Read`, `Glob`, `Grep`).
- The default schema is `{summary: string}`.

## The authoring interview (p.22)

- Runs in the person's own session as the `author` sub-skill, following [C09][c09]: a description, then the whole draft as a numbered list, then questions only on what changes the outcome, then corrections in plain words, then save. Each step's instructions show as one line, and a picture is drawn on request.
- On save: `spore init` if needed, write `.spore/workflows/<name>/` (`workflow.dot`, `settings.json`, `steps/<node>.md`), run `spore validate` and `claude-spore check`, and fix its own errors for up to 3 rounds before asking. It never commits, stages or pushes. The ending lists every default it filled in and offers a run.
- It writes dialect `runspore/0.2` and format `runspore.workflow/0.2`, inline schemas, and `inputSchema` with descriptions. It writes `loopLimits` with an `exhausted` arrow (3 proposed) and raises `maxVisitsPerNode` only when a limit needs it. A Claude step's reason for being back is `{"$get": ["from"]}` in `context`; earlier results are `{"$get": [...], "default": null}` (`lastTest`).
- The effect class is asked for steps whose effects leave the machine; for other commands it is proposed, as `unsafe` when unclear. `pure` is never proposed.
- **Two runs at once:** when the person says yes, the interview adds a first step that makes a git worktree and returns its path, and points every later action's `cwd` at it: commands with `{"fromInput": "/workdir"}`, Claude steps with `{"fromInput": "/context/workdir"}`.
- Changing a workflow edits in place, keeps comments, hand-written instructions and render attributes, and warns that unfinished runs keep the old version. A folder that does not build is still shown, its errors first.

## Actor label (p.23)

The actor label for a person is `person`.

## Run line and live view (p.24)

- **The run line** ([C17][c17]). The mod sees Claude's Bash call `spore continue <runId> --wait` in a `tool.call` hook and shows an `AbovePrompt` row for that run: node and visit, the arrow just taken, try n/m, the loop count, and "needs you" in orange, with a `view` button (hotkey `v`). The row goes away when the run ends or is cancelled.
- **Refreshing.** While a run line or the live view is visible, the mod polls `spore status <runId> --json --no-probe` once a second and redraws only when a shown field changes. With nothing visible it polls nothing.
- **The live view** is a pane `run-<runId>`: the drawing; `workflow.dot` in full with the current node's line in yellow and the arrow just taken in orange; the node's `settings.json` block with its action's block above it; the first three lines of the instructions, the full text on request; and a facts line (status, node, visit, try, loop count). The parts sit side by side at 150 columns or wider, stacked otherwise.
- **Drawing.** `claude-spore draw --run <runId> [--at <node>] [--from <node>:<outcome>] --png <file> | --plain` reads `workflow.dot` through `spore inspect --run --file` and renders with bundled `@hpcc-js/wasm-graphviz` and `@resvg/resvg-wasm`; no system Graphviz. The display DOT shows each arrow's `on` (an explicit label wins), gives end nodes a double outline, and adds the highlight. Pictures are cached per (artifact digest, node, arrow) in the plugin's data folder.
- **The picture check.** The first picture of a session tries `$.ui.blit` on the keyed `Image`. A `deny` switches the session to a Braille-dot drawing: Graphviz's layout, curves plotted 2×4 dots per cell, boxes and labels as real text. The plugin never sets or documents `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`.

## The reference loop is the check (p.25)

The reference coding loop ([C11][c11], `docs/design/c11-reference-loop/coding-loop/` in Web-tree/runspore) is the plugin's end-to-end check. It runs in a real terminal Claude Code with herdr, is written through the interview first, and is killed at every row of the table below: background and interactive `implement`, `test`, the loop running out, both decisions, and Cancel. It is gated and run before a release, since it needs a logged-in Claude.

**C11's kill table, corrected (U4).** When the person's session dies, the follower's command is stopped by spore's guard. Nothing is recorded for that try, and its lease runs out within about 10 s. The next Continue then retries it and resumes the same conversation. The rest of C11's table stands:

| Where the run was | What the database holds | Start line and menu | After Continue: done again | Not done again |
|---|---|---|---|---|
| Starting from the menu, before `spore start` returned | No run, or a run at `implement` with nothing started | No line, or `working`: Continue, Cancel | Nothing; with no run, start again | — |
| `implement` (background), try *n* | `running`; try *n* cut off, nothing recorded, its lease running out within about 10 s | `working`: Continue, Cancel | Try *n*+1 resumes the same conversation ("you were cut off, finish the step") | Edits on disk; earlier visits; test runs; decisions; the red count; visit counts |
| `implement`, try 3 cut off | `needs-intervention`, `activity.attempts-exhausted` | `stuck`: Retry, Mark done, Fail, Cancel | Retry: try 4 resumes the same conversation | As above |
| Between steps | `running`, next step queued | `working`: Continue, Cancel | Nothing; Continue starts the next step | Everything |
| `implement` finished, its answer not yet recorded | `running`; the try cut off | `working` | Try *n*+1 resumes; Claude sees it finished and answers again | The edits |
| `test`, try *n* | `running`; try *n* cut off | `working`: Continue, Cancel | `npm test` runs again | `implement`'s result; the red count |
| `test`, try 3 cut off | stuck | Retry, Mark done, Fail | Retry runs the tests again | — |
| Waiting at `approve` or `tests_stuck` | `waiting` | `decision`: Decide, Cancel | Nothing | Everything |
| A decision sent, not yet acted on | `waiting` with the signal stored | `working`: Continue; deciding again is a no-op | Nothing; Continue acts on the stored decision | The decision |
| `implement` (interactive), the session dies | `running`, try held by the pane, which keeps working | `held`: Open its pane, Continue, Abandon, Cancel | Nothing; Continue runs the watch again | Everything |
| `implement` (interactive), the machine goes down | `running`, held by a pane that no longer exists | `held`, pane gone | The probe answers `dead`; try *n*+1 opens a new pane and resumes | Edits on disk |
| Completed, failed or cancelled | Ended | No line | — | — |

A SIGKILL of the Claude process alone leaves its `continue --wait` running as an orphan ([C05][c05]); it drives the run until the run needs a person, and a second driver started meanwhile is safe ([C06][c06] L1).

## Testing

- **A good test drives a public surface** and checks what a person or `spore` would see: the helper's stdout, exit code and files in the work folder; the `spore` run state after it; which processes are alive. It never tests private functions.
- **Seam 1, the `claude-spore` executable,** run as a subprocess, with the real `spore` binary and fake `claude` and `herdr` programs first on PATH. Its specs are `test/*.spec.ts`, run by `bun test`.
- **Seam 2, mod registration,** tested the way `ml-agent-config`'s register test is, under `claude plugin test`: the hooks, commands, tool and panes are registered, and each hook passes the helper's JSON through to the UI unchanged. No logic is tested there.
- **The fake `claude`** (`test/fixtures/bin/claude`) keeps sessions the way the real one answers `--session-id` and `--resume`, records each call's arguments, stdin, working folder and environment, and plays back a scripted list of envelopes, raw stdout included, so a test can send `2.0`.
- **The real `spore`** is the one the `SPORE` variable names, else `spore` on PATH. A spec that needs it is skipped, with the reason printed, when that `spore` is not 0.2, unless `REQUIRE_SPORE=1`, which CI sets.
- **CI** runs both seams; once the helper drives `spore`, against the newest `spore` release and against 0.2.0. Until runspore publishes 0.2.0, CI builds `spore` from a pinned runspore commit instead. It also runs the helper under Bun 1.1 and expects exit 2.
- **The end-to-end check** is p.25, gated, before a release.

## Out of scope

The Desktop app, claude.ai, Cowork, and `claude -p` as a surface for the menu; running a step in the person's own session; parallel steps; the delivery flow; sub-workflows; an always-on daemon or orchestrator agent; run history beyond the live view, and pruning work folders; sandboxing Claude steps and narrowing `Bash` in the edits set (until then the reference loop is for trusted repositories); a browser view; starter workflows in the interview; a per-step "fresh conversation" switch; a Homebrew tap; a Web-tree marketplace listing; closing the old `workflow` map (skills#18); everything generic, which belongs to the runspore spec.

## Risks

- Claude Code internals are undocumented: `MAX_STRUCTURED_OUTPUT_RETRIES`, the strict-schema allowlist, `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`.
- The shape of `installed_plugins.json`, read by the launcher.
- herdr's state output as a contract.
- Process start times and boot IDs must be read the same way by the launcher and the probe on macOS and Linux.

[c04]: https://github.com/Web-tree/runspore/blob/main/docs/research/c04-headless-agent-step.md
[c05]: https://github.com/Web-tree/runspore/tree/main/docs/research
[c06]: https://github.com/Web-tree/runspore/blob/main/docs/design/c06-loop-owner.md
[c07]: https://github.com/Web-tree/runspore/blob/main/docs/design/c07-four-kinds.md
[c08]: https://github.com/Web-tree/runspore/blob/main/docs/design/c08-entry-menu.md
[c09]: https://github.com/Web-tree/runspore/blob/main/docs/design/c09-authoring.md
[c10]: https://github.com/Web-tree/runspore/blob/main/docs/design/c10-plugin-home.md
[c11]: https://github.com/Web-tree/runspore/blob/main/docs/design/c11-reference-loop.md
[c12]: https://github.com/Web-tree/runspore/blob/main/docs/design/c12-output-schemas.md
[c13]: https://github.com/Web-tree/runspore/blob/main/docs/design/c13-bounded-loops.md
[c14]: https://github.com/Web-tree/runspore/blob/main/docs/design/c14-step-files.md
[c17]: https://github.com/Web-tree/runspore/blob/main/docs/design/c17-live-run-view.md
[c21]: https://github.com/Web-tree/runspore/blob/main/docs/research/c21-records-cross-check.md#18-the-plugins-spec-pluginsml-workflowdocsspecmd-in-max-skills-25
