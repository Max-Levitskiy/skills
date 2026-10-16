# ml-workflow: the plugin's spec

The Claude half of the Claude Code profile for Runspore. The generic runtime this plugin drives, `spore` 0.2, is specified in the [runspore spec](https://github.com/Web-tree/runspore/issues/50); build against its CLI contract. Runspore's spec never names Claude; this document is where Claude lives ([C10][c10] R4).

Sources: the spec issue [skills#59](https://github.com/Max-Levitskiy/skills/issues/59) and the checklist [C21 §1.8, p.1–p.25][c21]. Each section below carries the p-item it settles. Where this document and a design record in Web-tree/runspore `docs/design/` disagree, this document wins.

## Build state

Each part is built by one ticket of skills#59. This table says what exists in the plugin now.

| Part | Items | State |
|---|---|---|
| Skeleton: packaging, minimum versions, `claude-spore --version`, the mod registering, sub-skill stubs, README rules, CI | p.1, p.2, p.6 | built (skills#60) |
| Getting and checking `spore`, the launcher, helper/mod version match | p.3, p.4, p.5 | built (skills#61) |
| Entry points, menu, session-start line, following a run | p.7–p.12 | built: `start`, `status`, `continue` and `cancel`, and following a run (skills#64); the session-start line (skills#89); the menu and `act` (skills#65); `view` (skills#66) |
| Profile kinds, node parameters, `claude-spore check` | p.13–p.15 | built (skills#62; the herdr check skills#63) |
| Background Claude step: `claude-spore run`, session table, repair, facts | p.16, p.18, p.19, p.20 | built (skills#62) |
| Interactive Claude step: `start`, `probe`, `watch`, `report`, `stop` | p.17 | built (skills#63; closing the pane as the run leaves the node, skills#92) |
| Authoring interview | p.21–p.23 | built (skills#67, watched steps and helper programs skills#86); it draws the draft as text, since `claude-spore draw` reads a run's pinned artifact and a draft has none |
| Starting a bundled example: `claude-spore example`, `start`'s offer | — | built (skills#90) |
| Run line and live view | p.24 | built (skills#66) |
| Reference loop as the end-to-end check | p.25 | built (skills#68): the gated spec and the release checklist |

## Terms

- **Plugin**: `ml-workflow`, installed from the `max-skills` marketplace. *Avoid:* extension, addon.
- **Mod**: the plugin's hooks module, `claude-code/register.ts`. It is one part of the plugin.
- **Helper**: `claude-spore`, the plugin's own program. `spore` never knows about it. *Avoid:* wrapper, shim.
- **Sub-skill**: one of the plugin's skills, typed as `/ml-workflow:<name>`.
- **Following a run**: the person's own session running `spore continue <runId> --wait --json` in the background and reacting when it returns.
- **Oldest supported spore**: the lowest `spore` version the plugin works with, `0.2.0`.

## Home and packaging (p.1)

- The plugin is `plugins/ml-workflow` in `Max-Levitskiy/skills`, listed in the `max-skills` marketplace with the relative source `./plugins/ml-workflow`. It releases on this repository's flow, separately from runspore ([C10][c10] L1).
- **Every change ships at a new version.** `claude plugin update` compares versions only, so a change merged at the old version never reaches an installed copy (skills#115). A pull request that changes anything under `plugins/ml-workflow/` raises the version, by its conventional type as release-please does (`fix` a patch, `feat` a minor), in `plugin.json`, the marketplace entry and `src/version.ts`, and adds the version's section to `CHANGELOG.md`: `bun scripts/plugin-version.ts bump ml-workflow <patch|minor|major> "<what changed>"`.
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

How it does this (skills#61):

- **`claude-spore doctor [--json] [--plugin-version <v>]`** is the check. It finds `spore` on PATH and runs `spore capabilities --json` with a 5 s limit, inside the session-start hook's 10 s. With `--plugin-version` it also compares the helper's version with `<v>` (p.5). When everything fits it prints nothing and exits 0. Otherwise it prints one line per problem, the problem and the command that fixes it, and exits 1. With `--json` it prints `{"ok", "spore", "problems", "launcher"}` with the same exit codes: `spore` is `{"path", "version"}` or null; each problem is `{"code", "message", "fix"}`, where `fix` is the command to offer, or null when there is none to run; `launcher` is `installed`, `offer` or `declined` (p.5).
- **Codes.** `spore.missing`: no `spore` on PATH. `spore.old`: `spore capabilities` failed or did not print JSON, which is what a `spore` from before the handshake does. `spore.version`: `version` is missing or below 0.2.0. `spore.contract`: a contract is missing or out of range; the message names each one. `plugin.reload`: the helper's version is not `--plugin-version`.
- **A contract is in range** when its `major.minor` equals the supported one below 1.0, and when its major is the same and its minor no lower from 1.0 on. The supported contracts are written once, in `src/version.ts`, with the oldest supported spore.
- **The fix** is `claude-spore install-spore` when `spore` is missing, or when the PATH copy (symlinks followed) sits in a folder the person can write. Otherwise it is the command of the tool that owns that copy: `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli` for a copy under `$CARGO_HOME/bin` (`~/.cargo/bin`), and for any other copy runspore's own `install.sh` run as root into that folder (`curl -fsSL https://raw.githubusercontent.com/Web-tree/runspore/main/install.sh | sudo env SPORE_INSTALL_DIR=<folder> sh`). The message names the path.
- **Bun.** The helper cannot report a missing Bun, since it does not start. Whoever runs it reads that from the failed start instead: the shell's `bun: not found` (exit 127) means Bun is missing, and the fix is `curl -fsSL https://bun.sh/install | bash`; an old Bun is the helper's own exit 2 (p.2), and the fix is `bun upgrade`.
- **`claude-spore install-spore`** installs or updates `spore`, and is only run after the person said yes:
  1. The target is the PATH copy, symlinks followed, or `~/.local/bin/spore` when there is none. A target in a folder the person cannot write stops here, naming the path and the fix above.
  2. It picks the asset for the machine from the platform and architecture, the arm64 asset under Rosetta, and downloads it, `SHA256SUMS` and `SHA256SUMS.sig` from the newest release, from `SPORE_VERSION`'s release, or from the folder `SPORE_DOWNLOAD_URL` names (a URL or a local path), the variables of runspore's `install.sh`.
  3. It checks the signature of `SHA256SUMS` itself, in TypeScript, by the steps of `release.md` §3 against the release key pinned in `src/release.ts`, then the archive's SHA-256 against its one line in `SHA256SUMS` (§2). Either failing stops with `install-spore: ` and the reason, and nothing is written.
  4. It takes `spore` out of the archive, writes it beside the target with mode 0755, and renames it over the target in one step.
  5. It runs the check again on the PATH copy. Success is reported only if the check passes and PATH selects the file just written; otherwise it says what is still wrong, for example that `~/.local/bin` is not on PATH, and exits 1.

  Exit 0 is success, 1 a refused or failed install, 2 a usage error. It changes nothing else: no shell profile, no other copy.
- **The skills** run the check in their second step, after the Claude Code check (the sub-skills, step by step, below). A problem with a `fix` is shown as its one line with the question "Run it now?"; the command runs only on a yes, then the check runs again. A problem without a fix, and a no, stop the skill.

## The helper outside Claude (p.5)

- `claude-spore --version` prints the plugin's version, the `version` in `.claude-plugin/plugin.json`, and nothing else.
- The mod compares that with its own version at session start and before every start. On a mismatch it asks for `/reload-plugins` and starts nothing.
- **The launcher**, offered once and installed at `~/.local/bin/claude-spore`, reads the `ml-workflow@max-skills` entry in `~/.claude/plugins/installed_plugins.json`. A project-scope entry whose project contains the current folder beats the user-scope entry. It runs that installation's `bin/claude-spore`, and exits 2 if no entry exists.
- The mod calls the helper by `$.plugin.root + "/bin/claude-spore"`, since `$.process.run` does not see the plugin's `bin/`. Steps find `claude-spore` on PATH: the worker started from Claude's Bash tool inherits the plugin's `bin/`.

How it does this (skills#61):

- **At session start** the mod runs `claude-spore doctor --json --plugin-version <its own version>`, the version in the `plugin.json` it loaded with. A hooks module loads only script files, so the mod reads that version from `PLUGIN_VERSION` in `src/version.ts`, which a test holds equal to `plugin.json`'s; a release bumps both. It writes each problem's message as one transcript line, and nothing when the check passes. A helper that does not start is read as p.3 says: exit 127 is the Bun line; an exit 2 is its own first stderr line; a helper file that is gone, which is what an update that removed the loaded copy leaves, is the `/reload-plugins` line. Anything else, a timeout included, prints nothing.
- **Before every start** the mod hooks `skill.prompt` for `ml-workflow:start` and runs the same command. It puts the JSON it got above the skill's text, in a `<claude-spore-doctor>` block that says the check already ran, so the skill reads it instead of running the check again. When the helper does not answer with JSON, the skill's text goes through unchanged and the skill runs the check itself. The skill stops on `plugin.reload` with "run `/reload-plugins`, then try again".
- **The launcher's file** is `launcher/claude-spore` in the plugin, a `#!/usr/bin/env bun` script that imports nothing, so a copy runs on its own. It reads `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/installed_plugins.json`. Of the entries under `ml-workflow@max-skills`, one whose `scope` is not `user` and whose `projectPath` is the current folder or above it wins, the deepest first; else the `user` entry. It runs that entry's `installPath` + `/bin/claude-spore` with its own arguments, stdin, stdout and stderr, and exits with its code. With no such entry, or an entry whose helper is gone, it prints one line naming `/plugin install ml-workflow@max-skills` and exits 2.
- **`claude-spore launcher install`** copies that file to `~/.local/bin/claude-spore` with mode 0755, and **`launcher decline`** records the no. Both write `launcher-offered` in the plugin's data folder (`$CLAUDE_PLUGIN_DATA`, else `~/.claude/plugins/data/ml-workflow-max-skills`), so the offer is made once. `install` refuses to replace a `~/.local/bin/claude-spore` that is not a copy of the launcher, naming the path. The check's `launcher` field is `installed` when the launcher is there, `declined` when the offer was made, and `offer` otherwise; the `start` skill makes the offer in the message that asks for the input.

## Permissions (p.6)

A plugin cannot ship standing allow rules. Each sub-skill pre-approves `Bash(spore *)` and `Bash(claude-spore *)` in its `allowed-tools`, for the turn it runs in; `author` also pre-approves `Bash(chmod +x *)` for the helper programs it writes (p.22), `act` `Bash(herdr agent focus *)` for opening a step's pane, `menu` the mod's tool `mcp__ml-workflow__open_menu` (p.11), and `view` its tool `mcp__ml-workflow__open_view` (p.24). The README shows the two standing rules for a project's `.claude/settings.json` ([C10][c10] R11).

## Entry points (p.7, p.8)

- **Sub-skills** ([C06][c06] L4):
  - `menu`: opens the pop-up;
  - `start <workflow>`: check, then the input draft, then `spore start`, then follow;
  - `status [<runId>]`: the unfinished runs, or one run's state in words;
  - `continue [<runId>]`: follows a run, and asks which when several are unfinished;
  - `cancel [<runId>]`: confirms in one line, then runs `spore cancel`, and asks which when several are unfinished;
  - `author [<workflow> | --change]`: the interview, new with no argument, a change of the named workflow, or with `--change` a list of workflows to change; its guide ships as `skills/author/references/authoring.md`. The menu's "write a new workflow" runs `author`, and "change a workflow" runs `author --change`;
  - `act <runId> <action>`: one action of a menu row that needs Claude, a decision, a resolution, a release, abandoning or showing a step, or opening its pane (p.11). The menu hands off to it; nobody needs to type it;
  - `view [<runId>]`: opens a run's live view (p.24), as the run line's `view` button and the menu's View do.
- **Opening the pop-up.** The mod hooks `command.run` for `ml-workflow:menu`, opens the pane with `$.ui.open` before anything else and answers "The workflow menu is open.", so the skill does not run. If opening from that hook is refused, the skill runs and tells Claude to call the mod tool `open_menu`.
- **Placed at any width (skills#105).** Claude Code places a pane the person asked for at any width, docked beside a fullscreen transcript from 110 columns and inline above the prompt below that, and an unasked one only from 144 columns. An open counts as asked only when it comes from the hook of a command the person typed, or from the handler of a Button or Select they worked, before that hook or handler awaits anything; a tool's open, a timer's, or one after an `await` is unasked. So the menu opens from its typed command's own hook, the live view from that hook, the `view` button's press and the menu's View pick, each calling `$.ui.open` first and reading the helper after, the way k9s lays its views out to whatever terminal it gets instead of refusing to draw. A pane that still waits undrawn (opened through `open_menu` or `open_view`) is said with the exact keys that show it: "Type /ml-workflow:menu and press Enter to show it.", or the same with `/ml-workflow:view <runId>`; for a view whose run line is the newest on the band, "Press ctrl+x tab, then v, to show it." (ctrl+x tab gives the band the keys, and `v` presses its view button).
- **The menu widget** is a pane with a `Select` ([C05][c05]).
- **The mod stays thin.** The helper works out what the mod shows (the start line, the menu rows, the run line text, the drawings) and returns it as JSON from subcommands named in implementation. The mod only calls the helper and renders what comes back, so the helper's tests cover the logic.

## The session-start line (p.9)

`spore list --unfinished --json` must answer within the 10 s hook budget. The mod prints one line per unfinished run, the way `git status` names an unfinished rebase as soon as you look and `gh run list` shows each run with its conclusion: where the run is, what it waits for and, for a stuck or quarantined one, why; then one hint with the command that picks them up. For example:

```text
coding-loop-11111111 at test, stuck after attempt 3 of 3 for 40 s: command.exit: exit code 1
coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago
/ml-workflow:menu to pick them up
```

With no unfinished run, or on any error, it prints nothing. The hint names `/ml-workflow:menu`, which offers what each run needs (skills#65); the lines named `/ml-workflow:continue` before the menu was built, and each carried the hint until checkpoint F (skills#109).

How it does this (skills#89):

- **`claude-spore unfinished [--json]`** works out the lines. It runs `spore list --unfinished --json` from the session's folder, so it reads the database spore finds from there, and `spore status <runId> --json --no-probe --db <db>` for each row, side by side, each cut off after 4 s. `--no-probe` and the read-only commands change nothing and create no database. It prints one line per run, those that need the person first (`needs` `signal`, `stuck` or `quarantined`, or `external-ready` for the actor `person`), each part in spore's order, newest first; then the hint `/ml-workflow:menu to pick it up` (`them` for several), left out when every run is running by itself (`working` at a node, `running.state` `started`). With `--json`, `{"db", "lines"}`, the hint the last line. A `spore` that is missing or cannot list gives no line, `db` null and exit 1; a status that fails leaves its run a line without the attempt. In a Claude that spore started for a step (`RUNSPORE_RUN_ID` or `RUNSPORE_WORK_DIR` set) it asks spore nothing and prints no line: that session is the step, not the person's.
- **A line** is `<start key, else run ID> at <node>, <state> <age>`, the age being since the run last changed (`since`) in its largest unit (`40 s`, `14 min`, `2 h`, `3 d`). By `needs`:

  | `needs` | State |
  |---|---|
  | `working`, its try claimed (`running.state` `started`) | `attempt n of m, running for <age>` |
  | `working`, otherwise | `attempt n of m, paused <age> ago`: nobody runs the try, as after the session that followed the run closed (p.10) |
  | `signal` | `waiting for your decision for <age>` |
  | `stuck` | `stuck after attempt n of m for <age>: <code>: <words>` (from `intervention` and its kept `error`'s `code` and `message`) |
  | `held` | `held by its pane (<herdr agent>) for <age>`, or by the step's actor |
  | `external-ready` | `waiting for <actor> to claim it for <age>` |
  | `quarantined` | `quarantined for <age>: <code>: <words>` (from `quarantine`'s `code` and `details`) |
  | `capability-missing` | `at a step this spore cannot run for <age>` |

  A run at no node reads `<key>, not started yet, created <age> ago`. `attempt n of m` comes from `running` or `intervention`, and is left out when the status does not give it. `<words>` is the first line of the message or details, cut at the last whole word within 60 characters and ended `…`; either part is left out when spore gives none, and with neither so is the `: `.
- **The mod** runs `claude-spore unfinished --json` beside the doctor at session start, only when a person is at the prompt (`isInteractive`) and the Claude Code version fits, and writes each line after the doctor's problems. Anything but a `lines` list prints nothing.

## Following a run (p.10)

- `start` and `continue` tell Claude to run `spore continue <runId> --wait --json` as a background shell command, setting `RUNSPORE_DB` when the database is not found by walking up, and then to end the turn ([C06][c06] L3).
- When the command returns, Claude reacts to the run's `status` and `needs` in its JSON, not to its exit code:
  - **`signal`, a decision:** show the step and offer the outcomes.
  - **`stuck`:** show the kept error and the three `resolve` forms.
  - **`quarantined`:** the reason and `spore release`.
  - **`external-ready`, `held`, `capability-missing`:** a ready external step names the actor label and the claim line; a watch's `waiting: person` says so with its message ("implement waits for you in its pane"); a missing capability says what to restore.
  - **`completed`, `failed`, `cancelled`:** one line with the end state.
- After the person acts, the skill runs `continue --wait` again. Closing Claude pauses the runs it followed.

How it does this (skills#64):

- **The command** is `spore continue <runId> --wait --json --db <db>`, run with the Bash tool's `run_in_background`, `<db>` being the absolute path the last `--json` answer about the run gave as `db`. Naming the database always is the simplest form of "when it is not found by walking up", and needs no condition. It goes as `--db` after the subcommand, not as a `RUNSPORE_DB=` prefix, so the line still starts `spore continue <runId> --wait`, which the run line (p.24) looks for, and still fits the skill's `Bash(spore *)` rule, which a leading variable would not. The turn then ends with one line: the run, the database, and that Claude will say when the run needs the person or ends.
- **The answer** is one JSON object on stdout, the run's `status` with `needs` and `commands`; the progress lines go to stderr. Every value Claude offers comes from that object: an outcome, a resolution or a command is one it lists, never typed or guessed.
- **The answer decides, not the exit code.** With `--json`, `spore continue --wait` exits 0 whenever it printed the run's status, whatever the run needs (runspore#213), so a run that waits for a decision is not a failed background command. The run's own codes come only with `--exit-status`, which is for scripts, and the skills do not pass it. This is `gh run watch`, whose exit 0 says the watch ended and whose `gh run view --json status,conclusion` says how the run went. A `spore` from before runspore#213 exits with the run's code beside the same object, and the skills read that one the same way.
- **The reactions**, by the answer's `status` and `needs`, the first row that fits, each one line, with what it offers right there:

  | `status` | `needs` | Claude says | It offers, and on the person's answer runs |
  |---|---|---|---|
  | `completed` | null | the run completed, its end node (`end.nodeId`) and the `result` | nothing |
  | `failed` | null | the run failed, its end node and `result.error` (`code`, `message`) | nothing |
  | `cancelled` | null | the run was cancelled, with `cancel.reason` when one was given | nothing |
  | — | `signal` | the node that waits (`waiting.nodeId`), for which signal, since when; the gist of the instructions `spore step show <runId> --json` names | one option per `waiting.outcomes`, with data drafted for an outcome that has a schema in `waiting.outputSchemas`; then `spore signal <runId> <signal> --outcome <o> --id <position.activationId> [--data '<json>']` and follows again |
  | — | `stuck` | the stuck step (`intervention.nodeId`), its kept error, after `attempt` of `maxAttempts` tries; for `reason` `unknown`, that the last try may have done its work, so Retry runs it again | Retry (`spore resolve <runId> --retry`), Mark done (`--complete <o>`, `o` from `intervention.outcomes`, with `--output '<json>'` when `intervention.outputSchemas` has one) or Fail (`--fail '<message>'`); then follows again |
  | — | `quarantined` | the quarantine's code and details | `spore release <runId>`; then follows again |
  | — | `external-ready` | the step, its actor label (`step.actor`), and the claim line `spore step claim <runId> --actor <label>`; for the actor `person`, that the work is the person's own and the claim prints its instructions and the commands that report it | nothing runs; when the step is reported, `/ml-workflow:continue <runId>` follows again |
  | — | `held`, `step.waiting` `person` | `step.message`, for an interactive Claude step "implement waits for you in its pane", and the pane's herdr agent (`step.holder.herdrAgent`) | nothing to wait for: it follows again at once, and the watch, which says this once per wait, keeps watching until the answer lands or the pane waits for the person again, as `gh run watch` keeps watching through pending and approval states; `spore step abandon <runId>` frees the step |
  | — | `capability-missing` | the step and `step.missing`: what this `spore` lacks and what to restore | nothing |
  | no status: an `error`, exit 2 | — | the error's code and message (`run.not-found`: the run is not in that database); a usage error about `--wait` means a `spore` from before it (below) | nothing |
  | no status, exit 130 | — | the follow was stopped; the run stays where it was | `/ml-workflow:continue <runId>` |
  | anything else | — | the last lines spore printed | nothing |

  A refused `signal` or `resolve` changes nothing: `output.invalid` (data that does not fit) asks again; `signal.id-reused`, which a different decision already sent for this wait gives, is reported as "a decision was already sent", and the follow goes on with that one; `signal.outcome-unrouted` cannot happen with a listed outcome.
- **Several followers.** Each follow is its own background command, so one session can follow several runs. A second follower of one run, from this session or another, is safe ([C06][c06] L1).
- **Closing Claude** stops its background commands, which spore stops as on SIGHUP (exit 130); every followed run stays where it was, and `continue` picks it up.

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

Unfinished runs come first, those that need the person ahead of the rest, each part newest first. Workflows under `.spore/workflows/` (by graph id) run `ml-workflow:start`. "Write a new workflow" and "change a workflow" run `ml-workflow:author`. A row hands off with `$.command.run`; after an action that lets the run move, the row hands to `continue` ([C08][c08], [C11][c11] R3, R4, R12).

How it does this (skills#65):

- **`claude-spore menu [--json]`** works out the rows. It lists the runs as `unfinished` does (p.9), from the session's folder, with the same 4 s limit per call, and asks spore nothing inside a step. With `--json` it prints `{"db", "rows"}`; without, each row's label and under it each option with its command. It exits 0, and 2 on a usage error.
- **A row** is `{"key", "label", "options"}`, and an option `{"label", "command", "args"}`: the sub-skill to run, without its slash, and its arguments. The rows, in order:
  - one per unfinished run, in the order of the session-start lines (p.9), keyed `run:<runId>`, labelled with the run's session-start line, a stuck or quarantined one's reason included. A run held by another holder adds `, its lease ends in <age>` (or `ended <age> ago`) from `step.deadlineMs`;
  - `spore`, "spore could not list the runs", with "Check spore" (`ml-workflow:status`), when spore is missing or cannot list;
  - `start`, "Start a workflow", one option per workflow by graph id (`ml-workflow:start <id>`), sorted; with none, "Start a bundled example" (`ml-workflow:start` with no argument, which offers them);
  - `author`, "Write or change a workflow": "Write a new workflow" (`ml-workflow:author`) and, when the project has a workflow, "Change a workflow" (`ml-workflow:author --change`).
- **The workflows** are the folders holding a `workflow.dot` under the `.spore/workflows/` beside the database spore names (its folder, when that is `.spore`), else under the nearest `.spore/` at or above the session's folder. A folder's graph id is the name after `digraph`, quoted or bare; a folder without one is left out.
- **A run's options**, by `needs`, each `act` option being `ml-workflow:act <runId> <action>`:

  | `needs` | Options |
  |---|---|
  | `signal` | Decide (`decide`) |
  | `stuck` | Retry (`retry`), Mark done (`done`), Fail (`fail`) |
  | `held`, `step.holder.herdrAgent` set | Open its pane (`pane`), Continue, Abandon (`abandon`) |
  | `held`, another holder | Continue, Abandon (`abandon`) |
  | `external-ready` | Show the step (`show`) |
  | `working`, `capability-missing`, a run at no node | Continue |
  | `quarantined` | Release (`release`) |

  then View and Cancel on every run. Continue is `ml-workflow:continue <runId>`, Cancel `ml-workflow:cancel <runId>`, and View `ml-workflow:view <runId>`, which the mod does itself: it opens the run's live view (p.24) rather than running the sub-skill.
- **The mod** registers the tool `open_menu` at session start. `ml-workflow:menu`'s `command.run` hook and the tool each open the pane `ml-workflow-menu` with focus, closing on Esc, then run `claude-spore menu --json` and keep the rows in the session's state; until they arrive the pane says "Reading the workflows…". A helper that does not answer with rows leaves one line in the pane, "The menu could not be built", with the helper's first stderr line. The pane draws one `Select` per row, its label the row's and its options the row's, its value the first option, so no row ends in an empty value (`: none ▾`), the first with `autoFocus`. A pick closes the pane and runs `$.command.run({ command, args })` with the option's command and arguments; a View pick opens the live view instead. The hook and the tool answer "The workflow menu is open." when the pane is placed, and the reason and the keys that show it when it waits undrawn; on a refused open, or a Claude Code older than the minimum, the hook runs the skill, which tells Claude to call `open_menu`.

## The start flow (p.12)

Choosing a workflow runs `claude-spore check` first and shows any errors without starting. The flow then asks for each declared input, using the property's `description` as the question and Claude's draft from the conversation as the answer to confirm. It runs `spore start` and ends by following the new run ([C08][c08] R5, R9).

## The sub-skills, step by step (skills#64)

They replace the basic tier of skills#74, which drove `spore run` and `spore worker --run --until-parked` on spore 0.2.0 before it had `continue --wait` and `cancel`. They need a `spore` with both (Web-tree/runspore#73, #74). `spore capabilities` names neither and the version stays 0.2.0, so `doctor` cannot tell such a `spore` from the v0.2.0 release, which predates both. That `spore` refuses `--wait` or `cancel` with a usage error (exit 2); the skills read that as a `spore` from before them and name the command that builds one from runspore's main branch, `cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli`, until a release has them. Nothing runs it unasked.

**Before anything**, after the Claude Code check, each runs `claude-spore doctor --json` (p.3), or reads the result the mod put above `start`. A problem is shown as its one line; its fix runs only on a yes, then the check runs again. A problem without a fix, or a no, stops the skill. A `claude-spore` that does not start is read as p.3 says (Bun missing or old), and one that is not found asks for `/reload-plugins`.

**The database.** The skills pass no `--db` until they follow: spore takes `$RUNSPORE_DB`, else the nearest `.spore/runspore.db` at or above the current folder, else `./runspore.db`. Every `--json` answer carries the database path as `db`; the skills name it whenever they report runs, and the follow passes it as `--db` (p.10).

**Unfinished runs** come from `spore list --unfinished --json`: newest first, each row with `runId`, `workflow`, `nodeId`, `needs`, `since` (when it last changed, in milliseconds), `startKey` and `actor`. A skill that needs a run and has no ID says there is none for zero rows, takes the one row, and with several asks which, one option per row: ID, workflow, node, what it needs and how long ago it changed.

**`start <workflow> [--key <key>]`.**

A name that finds no folder, or no `<workflow>` in a project with no workflows, first goes to the bundled examples (below).

1. `spore validate <workflow>`, then `claude-spore check <folder>` (p.15). On a non-zero exit from either it shows each report as printed and starts nothing; warnings alone do not stop it.
2. Reads `inputSchema` from the workflow's `settings.json`. spore finds a named workflow by its graph ID, so a name means the folder under `.spore/workflows/` whose `workflow.dot` declares `digraph "<name>"`, usually the folder of that name. Without a workflow, `start` lists the workflows in that `.spore/workflows/` and asks which. It asks for every property in one message, the `description` as the question and a value drafted from the conversation as the answer to confirm, and makes the launcher offer (p.5) in the same message. A workflow without inputs still gets one confirmation before it starts.
3. Without `--key` it makes a fresh key, `<workflow>-<8 hex>`, so a repeated start is a new run and never `run.key-reused`.
4. Runs `spore start <workflow> --key <key> --input '<json>' --json` in the foreground: it creates the run and prints its `runId`, working nothing. `input.invalid` (exit 2) creates no run: the skill shows `details.errors`, asks again about those values, and starts again with the same key. `run.key-reused`, which only a `--key` the person gave can meet, shows spore's message and asks whether to follow the run the key names (`details.runId`) or start with another key. The answer carries no `db`, so the skill reads it from `spore status <runId> --json` before it follows.
5. Follows the new run (p.10).

**Starting a bundled example (skills#90).** The plugin ships the folders under `skills/author/references/examples/`, which the interview copies (p.22). A project made by `spore init` has an empty `.spore/workflows/`, so a workflow that is only in the plugin is offered where it is asked for, the way GitHub offers starter workflows to a repository that has none:

- **`claude-spore example list [--json]`** prints each example's name, the `//` comment that opens its `workflow.dot`, and its Claude steps, by the rule of p.15; with `--json`, `{"examples": [{"name", "description", "claudeSteps"}]}`. It exits 0.
- **`claude-spore example copy <name> <folder> [--watch <node>]...`** copies the example to `<folder>`. Each `--watch` node is a Claude step whose action it rewrites in the watched form of `authoring.md` §5.3: `argv` `["claude-spore", "start"]`, no `output` and no `timeoutMs`, and the `async` block with a 4 h limit and the probe, watch and stop commands; every other key stays. Without `--watch` the copy is the example file for file; with one, `settings.json` is written again with two-space indentation. It refuses, writing nothing and exiting 1, a name the plugin does not ship, a node that is not one of the example's Claude steps, and a `<folder>` that exists. Exit 2 is a usage error.
- **`start`** reads the list when a name finds no folder, or when it was given no `<workflow>` and the project has none. For a shipped name it says the project lacks it and what it does, asks to copy it to `.spore/workflows/<name>/`, and asks of each Claude step whether it runs in the background or in a herdr pane, proposing the background, all in one message. With no `<workflow>` it offers each one. A name that is neither is said so, with both lists, and nothing runs. Only on a yes it runs `spore init` when the database is not in a `.spore/` folder (as the interview does, p.22), then `example copy`, says the folder written is uncommitted and that `/ml-workflow:author <name>` changes it, and goes on with the checks. Like the interview it never commits, stages or pushes.

**`continue [<runId>]`.** Takes the run as above, then follows it (p.10); a given ID is read with `spore status <runId> --json` only for its `db`, and `run.not-found` stops there. It acts on nothing before the follow: `continue --wait` does the next thing the run needs and returns at once for a run that waits for the person, and the reaction to its answer offers what to do.

**`status [<runId>]`.** Without an ID, the rows of `list --unfinished`, one line each with what the run needs in words (`signal`: a decision; `stuck`; `working`; `held`: by its pane or its actor; `external-ready`: for its actor to claim it; `quarantined`; `capability-missing`), or that there is none. With an ID, `spore status <runId> --json` in words: where the run is (`position`), what it waits for and since when (`waiting`, `intervention`, `running`, `quarantine`, `step`), or how it ended (`end`, `result`, `cancel`), then the commands `waiting.commands` or `intervention.commands` hold, and that `/ml-workflow:continue <runId>` follows it. It runs nothing else.

**`cancel [<runId>]`.** Takes the run as above and reads `spore status <runId> --json`. A run that has already ended is said so, and nothing is asked. Otherwise it asks in one line, naming the run, where it is, and that cancelling stops its running step and cannot be undone. Only on a yes it runs `spore cancel <runId> --json`, with `--reason '<reason>'` when the person gave one, and reports the run cancelled with each stop that ran, or for a `duplicate` that the run had already ended. A follower of the run, in this session or another, then returns with `status` `cancelled`.

**`menu` (skills#65).** Typed, the mod's hook opens the menu and the skill does not run. Reaching its text means the mod could not open the pane from the hook, so it calls `open_menu` and says what the tool answered. Without that tool, the mod is not loaded: it asks for `/reload-plugins`.

**`act <runId> <action>` (skills#65).** What a menu row's pick hands to when the action needs Claude. It reads `spore status <runId> --json` for `db` and what the run needs now. An ended run, `run.not-found`, or a run that no longer needs the action (`decide` a `signal`; `retry`, `done` and `fail` a `stuck` step; `release` a quarantine; `pane` and `abandon` a `held` step; `show` an `external-ready` one) is said in one line, naming `/ml-workflow:menu` for what the run needs now, and nothing runs. Otherwise:

| Action | Shows | Runs |
|---|---|---|
| `decide` | the node, the signal and since when; the gist of the instructions `spore step show` names; each earlier node's latest result from `spore events <runId> --json` | asks for one of `waiting.outcomes`, with data drafted when it has a schema, then `spore signal <runId> <signal> --outcome <o> --id <position.activationId> [--data]` |
| `retry` | the stuck step, its error and tries; for `reason` `unknown`, that the last try may have done its work, and it asks first | `spore resolve <runId> --retry` |
| `done` | the stuck step | the one outcome of `intervention.outcomes`, or asks which; with a schema, drafts the output and asks; `spore resolve <runId> --complete <o> [--output]` |
| `fail` | the stuck step and its error | asks for the reason, drafted from the error; `spore resolve <runId> --fail '<message>'` |
| `release` | the quarantine's code and details | `spore release <runId>` |
| `abandon` | the step and its holder | `spore step abandon <runId>` |
| `pane` | the pane's herdr agent | `herdr agent focus <step.holder.herdrAgent>`; a pane that is gone is said so, with Continue letting the probe decide |
| `show` | the step, its actor and the gist of its instructions (`spore step show`) | nothing; the claim line `spore step claim <runId> --actor <label>`, and that `/ml-workflow:continue <runId>` follows it once reported |

The menu pick is the person's choice, so an action that needs no more input runs at once; one that needs an outcome, data, a reason, or a warning heeded asks first. After `decide`, `retry`, `done`, `fail`, `release` and `abandon`, which let the run move, it loads `ml-workflow:continue <runId>` to follow the run. Refusals read as in `continue`: `output.invalid` asks again, `signal.id-reused` is "a decision was already sent". Its `allowed-tools` add `Bash(herdr agent focus *)` for `pane`.

**`view [<runId>]` (skills#66).** Typed with a run ID, the mod's `command.run` hook opens the view itself and the skill does not run (p.24). Otherwise it takes the run as above, then calls the mod's tool `open_view` with the run ID and its `db`, and says what the tool answered. Without that tool the mod is not loaded: it runs `claude-spore view <runId> --db <db>` and shows its text in a code block.

**Claude may load all five on its own**, unlike `menu`, `act`, which the menu hands to, and `author`, which writes files, all three typed only: each asks the person before it sends a decision, a resolution, a release or a cancel, or starts a run; `view` only shows.

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

The set is closed: `format`, `schema`, `outcome`, `model`, `tools`, `skill`, `keepSeconds` and `context`. They are `$literal` values in the node's `input`; `schema` is `{"$outputSchemas": {}}`. Only `context` carries data to Claude. The instructions file is plain prose that explains what each outcome means ([C10][c10] R7, [C14][c14]).

| Parameter | Value | Absent |
|---|---|---|
| `format` | `"json"` or `"text"` | `"json"`: a Claude step's output is its checked answer ([C12][c12] R5) |
| `schema` | outcome → JSON Schema; in `settings.json` `{"$outputSchemas": {}}` or a `$literal` map | an error when `format` is `json` |
| `outcome` | the one outcome a `text` step ends with | an error when `format` is `text` |
| `model` | a model name for `--model` | no `--model` |
| `tools` | a list of Claude Code tool names: a built-in tool such as `Read` or `Bash`, or an MCP tool `mcp__<server>__<tool>` | no `--tools`/`--allowedTools`: Claude has its default tools, and in the background every call that needs permission is denied |
| `skill` | a skill name, `name` or `plugin:name` | no slash command |
| `keepSeconds` | a whole number of seconds, 0 or more: how long a watched step's pane stays open after the watch hands its answer to the run, as a Kubernetes Job's `ttlSecondsAfterFinished`. A background step has no pane and ignores it | `0`: the pane closes as the run leaves the node |
| `context` | any mapping: the data Claude sees as the step's input | `null` |

## What `claude-spore check <folder>` checks (p.15)

- No parameter key outside the closed set.
- `schema` is present when `format` is `json`, and every outcome of a `json` Claude step has a schema.
- `outcome` is present, and is the node's only outcome, when `format` is `text`.
- Tool names are valid Claude Code tools.
- `keepSeconds` is a whole number, 0 or more.
- herdr is reachable when the workflow has interactive steps.
- A schema Claude Code's strict form cannot use is a warning, not a refusal.

The interview and every start run the check; the helper checks the same again when a step starts.

A Claude step is a `command` action whose `argv` runs `claude-spore run` or `claude-spore start` (by name or by a path ending in `/claude-spore`). Its outcomes are the action's `outcomes`, `["ok"]` when it declares none. The check reads the folder's `settings.json` and builds nothing; `spore validate` checks the rest.

- **Strict form.** A schema fits Claude Code's strict form when it uses only `$schema`, `type`, `description`, `title`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const` and `anyOf`; every object declares `properties`; `additionalProperties` is absent or `false`; `anyOf` stands alone (beside `description` or `title` at most); and it is at most 32 levels deep ([C12][c12] W02).
- **Output.** One line per problem, `error: <node>: <message>` or `warning: <node>: <message>`, and exit 2 when there is an error, else 0. With `--json`, one object `{"ok", "errors", "warnings"}`, each problem `{"node", "code", "message"}`, with the same exit codes.
- **herdr.** Like `kubectl cluster-info`, the check asks the server and says what answered. herdr 0.9 prints the answer flat, `{"status": "running", "running": true, …}`, and the server runs when `running` is `true` at the top level. A folder with an interactive step gets `<folder>: herdr server running, herdr answered <answer>` before the summary line, and `"herdr": "herdr answered <answer>"` in the `--json` object; when the server does not run, `herdr.unreachable` carries herdr's answer or error.
- **Codes.** `params.unknown`, `params.not-literal`, `params.format`, `params.schema-missing`, `params.schema-outcome`, `params.outcome`, `params.model`, `params.tools`, `params.skill`, `params.keep`; the warning `schema.not-strict`; `workflow.unreadable` for a folder without a readable `settings.json`; and `herdr.unreachable`, once for the folder, when it has an interactive step and `herdr status server --json` does not answer with a running server.

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
- **`watch`** waits until herdr shows the session idle or done and `$RUNSPORE_WORK_DIR/<attempt>.result.json` exists, then prints it. Quiet with no file after the pane was busy, or `blocked`, it prints `{"needs": "person", "message": "<node> waits for you in its pane"}`, once per wait, even across the watches the next `continue --wait` starts. A later try first copies an earlier try's success result in the same invocation to its own name; a failure result is never carried over. A message `start` could not send because Claude was working, the watch sends once Claude is quiet.
- **`report --outcome <o>`** reads the answer as JSON on stdin and checks it against `params.json`. If it fits, it writes the result file and prints "accepted". If not, it prints one error per line, exits 1 and counts the bad answer in `<attempt>.answers`; the third bad answer writes a non-retryable `output.invalid` result.
- **`stop`** closes the pane by the handle.
- **The pane closes once the run leaves its node.** The watch that hands the answer to the run closes the pane, at once or `keepSeconds` later; `stop` closes it when the run is cancelled; a later visit closes it before it opens its own (skills#92).

How it does this (skills#63):

- **The action** is the one the interview writes (`skills/author/references/authoring.md` §5): `"argv": ["claude-spore", "start"]`, no `output`, and `async` with `timeoutMs` `"14400000"` and the probe, watch and stop commands `claude-spore probe|watch|stop`. No `leaseMs`: nobody renews, so the 4 h deadline is the lease. The step reports through its watch, never with `RUNSPORE_TOKEN`.
- **Its environment.** `start` and `watch` need `RUNSPORE_RUN_ID`, `RUNSPORE_NODE_ID`, `RUNSPORE_VISIT`, `RUNSPORE_ATTEMPT` and `RUNSPORE_WORK_DIR`, and exit 2 without them. `probe` and `stop` need only the handle on stdin.
- **The herdr agent** is named `sp-<node>-<10 hex>`: the node ID lower-cased with every character outside `[a-z0-9_-]` turned into `-` and cut to 16, then the first 10 hex digits of the session ID. herdr's names match `[a-z][a-z0-9_-]{0,31}` and are unique among live agents, so one run and node has one name.
- **Talking to herdr.** Every call but `status server --json`, which prints its answer flat (p.15), is `herdr … ` with JSON on stdout (`{"result": …}`) or an error on stderr (`{"error": {"code"}}`, exit 1); a code containing `not_found` means the agent is gone. The calls:

  | What | Call |
  |---|---|
  | Is the agent live, and its state | `agent get <name>`: `agent_status` (`idle`, `working`, `blocked`, `done`, `unknown`) and `pane_id` |
  | Open a pane | `workspace create --label <name> --cwd <working folder> --no-focus --env RUNSPORE_WORK_DIR=… [--env RUNSPORE_DB=…]`, then the pane `root_pane.pane_id` |
  | Start Claude in it | `agent start <name> --kind claude --pane <pane> --timeout 60000 -- <claude flags>` |
  | Seed or prompt it | `agent prompt <name> <message>` |
  | Close it | `pane close <pane>` |
  | Is herdr reachable (`check`) | `status server --json` |

- **Claude's flags** are the background step's without `-p`, `--output-format` and `--json-schema`: `--session-id` or `--resume`, `--permission-mode default`, `--tools`/`--allowedTools` when `tools` is set, `--model` when set, and `--add-dir "$RUNSPORE_STEP_FILES"`. Anything outside `tools` asks in the pane (U12). The message goes by `agent prompt`, never in `argv`; with `skill` set the start message begins `/<skill> `.
- **The PID and start time.** herdr starts the canonical `claude` itself, so no launcher of the plugin's sits between the shell and Claude. Once `agent start` returns, `start` finds the process whose arguments hold `--session-id <uuid>` or `--resume <uuid>` (`ps -A -ww -o pid= -o args=`, leaving out `herdr`, shells and `claude-spore`), for up to 10 s, and reads its start time. Without one it closes the pane and exits 1, a retryable `command.exit`.
- **The handle** is `{"herdrAgent", "session", "pid", "started", "boot", "machine"}`: `started` is the start time as a string (on Linux field 22 of `/proc/<pid>/stat`; elsewhere `ps -o lstart=` read with `LC_ALL=C` and `TZ=UTC`), `boot` the boot ID (`/proc/sys/kernel/random/boot_id` on Linux, the `sec` and `usec` of `sysctl -n kern.boottime` on macOS as `<sec>.<usec>`), and `machine` the host name. `start` and `probe` read these with one function, so they agree.
- **Which session.** `start` follows the table of p.18 before it opens anything. Whether the session exists is learned from Claude's transcript, a file `<uuid>.jsonl` in any folder under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`: an interactive Claude cannot answer "already in use" to a program, and looking in every project folder makes the answer independent of where the session started. Visit 1 starts when no transcript exists, and a first try that finds one is `session.foreign`; every other try resumes, a later visit without a transcript is `session.lost`.
- **A failure `start` finds itself** (the parameters checked again with `run`'s rules and failing as `params.invalid`, `session.foreign`, `session.lost`) is written as the non-retryable result `<attempt>.result.json`, and `start` prints a handle with `herdrAgent`, `pid` and `started` null. The watch prints that result at once, and the probe answers `unknown` for such a handle, so the failure, not an expiry, ends the try.
- **Never prompting a busy Claude.** A prompt typed while Claude is `working` is lost, and Claude can run `report` before its turn ends, so herdr can still show `working` after the answer is in. One typed while it is `blocked` would answer the question it asks. So a message goes only when `agent get` shows neither: `start` writes it to `pane.json` as `unsent`, without its report command, and sends it at once when it can. Otherwise the watch sends it at its first poll that finds Claude quiet, before it looks for the `needs` line. Either way the report command added is the one of the attempt `pane.json` records, and the sent message leaves `pane.json`.
- **Repeating a start.** `start` writes `pane.json` in the work folder: the handle, the pane, the attempt whose report command the pane was given, and the message not yet sent. When `agent get` finds the agent live:
  - with a `pane.json` here whose PID and start time still name a live process, this invocation already has its pane: `start` prints the same handle. When the attempt changed, it records that attempt and a message for it: the one never sent, when there is one, so Claude still gets its instructions; otherwise the cut-off message. It sends that message as above.
  - otherwise the pane belongs to an earlier visit, or to a start that died before writing `pane.json`: `start` closes it, waits up to 10 s until no process holds the session, and opens a new one. A new visit therefore gets a pane whose `RUNSPORE_WORK_DIR` is its own.
- **The message** is the background step's (the instructions, where the step files are, the input, or the "came back" and "cut off" lines of p.18) followed by the report command for this attempt and each outcome's shape:

  ```text
  When you have finished, hand in your answer with this command, the answer on stdin:

      claude-spore report --attempt <n> --outcome <outcome> <<'ANSWER'
      <answer>
      ANSWER

  The outcomes, each with the JSON its answer must fit:
  - `<outcome>`: <schema>
  ```

  A `text` step names its one outcome and takes its answer as plain text. The pane's Bash tool finds `RUNSPORE_WORK_DIR` in its environment.
- **`report`** checks the answer with spore's schema subset (`spec/schema.md` §3, Web-tree/runspore): every keyword of the subset, up to 16 errors, each `<path>: <message>` with `(root)` for the whole value, and a number with a fraction refused as in `run`. A `json` step's answer is JSON fitting the schema of its outcome, and an outcome outside `schema` is an error. A `text` step's answer is any text, kept as `{"text": …}`, and the outcome must be its `outcome`. A good answer writes `{"outcome", "output"}`; an attempt that already has a result file prints that it has its answer and exits 1, writing nothing. The third bad answer writes `{"error": {"code": "output.invalid", "message": <the last errors>}, "retryable": false}` and says that the step failed. Exit 2 is a usage error, or a work folder without `params.json`.
- **`watch`** polls once a second (`CLAUDE_SPORE_WATCH_POLL_MS`, for the specs):
  - when this attempt has no result file and an earlier attempt of the work folder has a success, it copies the latest such success to this attempt's name;
  - a result file and an agent that is `idle`, `done` or gone: it prints the file and exits 0. A live agent's pane is closed first, since the answer moves the run past the node. With `keepSeconds` above 0 it starts a detached `claude-spore close-after <seconds> <agent> <pane>` instead, which sleeps that long and closes the pane only while the agent still has it, so a later visit's pane is never closed. A close that fails does not fail the step;
  - a message `start` left unsent and an agent neither `working` nor `blocked`: it sends the message, and forgets what it saw of the pane before, since the pane has not started on that message yet;
  - `blocked`, or `idle` or `done` after the agent was `working`, with no file: it prints the `needs` line once, and again only after the agent was busy in between. `blocked` counts because Claude is asking a question in the pane. A pane quiet before it was ever busy has not started on its message yet, and needs nobody. herdr shows `done` both after a question and after Claude reported, so the watch tells them apart by the result file, never by the state;
  - what it saw last, `busy` or `told`, is kept in `<attempt>.watch`, because `continue --wait` stops the watch when it says the person is needed and the next one starts another: that one does not tell the person again for the same wait, and knows a pane that went quiet after an earlier watch saw it busy;
  - the agent gone with no file: it exits 1, so the host only loses sight of the step and the probe decides;
  - herdr not answering: it keeps polling until the host stops it.
- **`probe`** answers, in order: `unknown` for a handle it cannot read, a pane-less handle, another machine, or a boot ID it cannot read; `dead` for another boot ID; `alive` when the PID's start time equals `started`; `dead` when it does not, or no process has that PID. It always exits 0.
- **`stop`** looks the agent up by `herdrAgent` and closes its pane. A pane-less handle, or an agent already gone, is nothing to do. It exits 0 unless herdr refuses the close.

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
| `params.json` | `start` | the step's parameters, defaults filled in, for `report` |
| `pane.json` | `start`, and `watch` when it sends the unsent message | the handle, the herdr pane, the attempt the pane was last given a report command for, and the message not yet sent because Claude was busy |
| `<attempt>.result.json` | `report`, `start` for a failure it finds, or a carried-over success | the answer `watch` prints |
| `<attempt>.answers` | `report` | the count of bad answers this attempt |
| `<attempt>.watch` | `watch` | what the watches of this attempt saw last: the pane `busy`, or the person `told`; removed when the watch sends the unsent message |
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
- On save: `spore init` if needed, write `.spore/workflows/<name>/` (`workflow.dot`, `settings.json`, `steps/<node>.md`, `bin/<program>` for each helper program), run `spore validate` and `claude-spore check`, and fix its own errors for up to 3 rounds before asking. It never commits, stages or pushes. The ending lists every default it filled in and offers a run.
- It writes dialect `runspore/0.2` and format `runspore.workflow/0.2`, inline schemas, and `inputSchema` with descriptions. It writes `loopLimits` with an `exhausted` arrow (3 proposed) and raises `maxVisitsPerNode` only when a limit needs it. A Claude step's reason for being back is `{"$get": ["from"]}` in `context`; earlier results are `{"$get": [...], "default": null}` (`lastTest`).
- The effect class is asked for steps whose effects leave the machine; for other commands it is proposed, as `unsafe` when unclear. `pure` is never proposed.
- **Watched Claude steps:** each Claude step is background or watched, and the interview asks for every one the description left open. A watched step is the interactive step of p.17; a person who wants to see or steer a Claude step never gets a background step followed by a decision, or a command that prompts in a terminal.
- **Helper programs:** a step whose work needs a program of its own, more than one command line or logic no project command has, gets one written into the folder as `bin/<program>`, listed in its action's `assets` and run as `./bin/<program>`.
- **Two runs at once:** when the person says yes, the interview adds a first step that makes a git worktree and returns its path, and points every later action's `cwd` at it: commands with `{"fromInput": "/workdir"}`, Claude steps with `{"fromInput": "/context/workdir"}`.
- Changing a workflow edits in place, keeps comments, hand-written instructions and helper programs, and render attributes, and warns that unfinished runs keep the old version. A folder that does not build is still shown, its errors first.

How it does this (skills#67):

- **The guide.** The skill is short: it checks the host and `spore`, then follows `skills/author/references/authoring.md`, which carries the C09 flow, the question table, the defaults, the shape of every kind of step, the worktree step, the change flow and the ending. Three folders beside it, `references/examples/coding-loop/` (the reference loop), `references/examples/parallel-coding-loop/` (the same loop with the worktree step) and `references/examples/watched-coding-loop/` (the same loop with `implement` watched and the tests run by a helper program), are what the interview writes for those descriptions; the guide points at them as the shapes to copy.
- **Typed only.** `disable-model-invocation` stays set: the interview writes files, so it starts only when the person types `/ml-workflow:author` or the menu hands off to it.
- **Claude steps' schemas use Claude Code's strict form** (p.15), so `check` reports no warning: no length bounds, patterns or numeric bounds in a Claude step's `outputSchemas`. The reference loop's `minLength` on `implement`'s `summary` is dropped for that reason. A person's answers (`await-signal` schemas) keep any keyword spore's subset has, since only spore checks them.
- **The worktree step** is a `command` action that runs `sh -c`, reading the run ID from `$RUNSPORE_RUN_ID` (not from an `argv` mapping, so it builds on every spore 0.2). It makes the worktree `<repo>/../<repo name>.worktrees/<run id>` on a new branch `spore/<run id>` from `HEAD`, or reuses the folder when a try already made it, and prints `{"workdir": "<absolute path>"}` with `output: "json"`. It is `idempotent` with 3 tries. The worktree stays when the run ends; removing it is the person's, and the ending says so.
- **Interactive steps** are written only when the helper has `start` (`claude-spore --help` lists it). Until then, a person who wants to watch a step is told that interactive steps are not built yet, the step is written as a background step, and the ending lists that.
- **Asking about watching.** The question table asks "Do you want to watch this step and type into it?" for each Claude step the description did not settle, and the draft shows each Claude step as "in the background" or "watched, in a herdr pane", so the choice is always visible. Watching already waits for the person: the step's watch says the step needs them while Claude is quiet in the pane (p.17), so no decision is drawn after it for that. The ending says that watched steps need a running herdr server, which `claude-spore check` checks; its `herdr.unreachable` is told to the person, not counted as an error of the files to fix.
- **Helper programs** are files the workflow folder carries, under runspore's rules for assets (spec/dot.md §4, spec/host.md §3): a relative path in the action's `assets`, and `argv[0]` `./bin/<program>`, which spore replaces with the step files' copy sealed into the run's artifact, so a run keeps the program it started with. The interview proposes one when a step needs more than one command line or logic no project command has, rather than a long `sh -c` string or a script outside the workflow; the worktree step stays an inline `sh -c`. A helper is a script with a shebang, `#!/bin/sh` unless the step needs another language that the project already uses, and a comment saying what it does and what its exit codes mean. It reads the step's input as JSON on stdin and `RUNSPORE_*` from its environment, works in the action's `cwd`, and ends through `exitOutcomes` or prints JSON with `output: "json"`. The interview writes it with the other files and runs `chmod +x` on it, since the step files' copy is executable only when the source file is, and the skill allows `chmod +x` for that alone. Like an instructions file, a helper is the person's once written: a change edits only the lines it needs, and a helper is deleted only when no action names it.
- **The picture on request** is a text drawing of the draft in a code block: `claude-spore draw` (p.24) draws a run from its pinned artifact, and a draft has no run.
- **The check loop.** After writing, `spore validate <folder>` and `claude-spore check <folder>`; on any problem Claude edits the files and runs both again. A third failing round stops the loop: Claude shows each remaining problem in plain words and asks the person. Errors the person's own edits caused in a change are shown the same way, never silently undone.
- **Finding a workflow to change.** By graph id among the folders under `.spore/workflows/`; with no argument, the interview lists them and asks. A new workflow's name never matches an existing folder or graph id.
- **Unfinished runs of a changed workflow** come from `spore list` and `spore --json list` (status not `completed`, `failed` or `cancelled`). Neither `list` nor `status` names a run's workflow in spore 0.2.0, so when any run is unfinished the interview counts them and says that a run keeps the version it started with; only new runs get the change.

## Actor label (p.23)

The actor label for a person is `person`.

## Run line and live view (p.24)

- **The run line** ([C17][c17]). The mod sees Claude's Bash call `spore continue <runId> --wait` in a `tool.call` hook and shows an `AbovePrompt` row for that run: "needs you" in orange first, then the node, how long the run has stood there and the visit, the arrow just taken, try n/m and the loop count, with a `view` button (hotkey `v`). It leads with what the person scans for, as `kubectl get pods` puts STATUS and AGE before the rest, and fits the band: the arrow is cut down, then left out, before the line is cut. The row goes away when the run ends or is cancelled.
- **Refreshing.** While a run line or the live view is visible, the mod polls `spore status <runId> --json --no-probe` once a second and redraws only when a shown field changes. With nothing visible it polls nothing.
- **The live view** is a pane `run-<runId>`: the drawing, which fits the pane's height (a compact tree, as `argo watch` prints, when the drawing cannot), with the current node kept in view; `workflow.dot` in full with the current node's line in yellow and the arrow just taken in orange; the node's `settings.json` block with its action's block above it; the first three lines of the instructions, the full text on request; and a facts line (status, node, visit, try, loop count). The parts sit side by side at 150 columns or wider, stacked otherwise. Long lines wrap; the pane scrolls with the arrows, PgUp and PgDn while it holds the keys.
- **Drawing.** `claude-spore draw --run <runId> [--at <node>] [--from <node>:<outcome>] --png <file> | --plain` reads `workflow.dot` through `spore inspect --run --file` and renders with bundled `@hpcc-js/wasm-graphviz` and `@resvg/resvg-wasm`; no system Graphviz. The display DOT shows each arrow's `on` (an explicit label wins), gives end nodes a double outline, and adds the highlight. Pictures are cached per (artifact digest, node, arrow) in the plugin's data folder.
- **The picture check.** The first picture of a session tries `$.ui.blit` on the keyed `Image`. A `deny` switches the session to a Braille-dot drawing: Graphviz's layout, curves plotted 2×4 dots per cell, boxes and labels as real text. The plugin never sets or documents `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`.

How it does this (skills#66). The helper works out every word and drawing; the mod polls it and draws what it says (p.7).

- **`claude-spore line <runId> [--db <db>] [--json]`** works out a run line. It runs `spore status <runId> --json --no-probe`, with `--db` when given, cut off after 4 s. With `--json` it prints `{"runId", "db", "name", "text", "shorter", "needsYou", "ended"}`, else `needs you` and two spaces when it does, then the text. `name` is the run's start key, else its ID, and the text begins with it:

  | The run | Text |
  |---|---|
  | at a node | `<key> at <node> for <age>, visit <n>`, the visit left out on the first; then the arrow just taken (`position.from`) as `, from <node> on <outcome>`; the try as `, try n/m` from `invocation`'s `attempt` and `maxAttempts`, or `, try n (past the limit of m)` once a person's `resolve --retry` went past it; then each streak, by node ID, as `, <outcome> <count>/<limit> in a row` (`streaks`; `<outcome> <count> in a row` without a limit) |
  | at no node, unfinished | `<key>, not started yet` |
  | `completed` or `failed` | `<key> completed at <node>` or `<key> failed at <node>`, from `end`, with `, from <node> on <outcome>` from `end.from` |
  | `cancelled` | `<key> cancelled at <node>`, or `<key> cancelled` at no node |

  `<age>` is how long the run has stood as it is, the `forMs` of whichever of `waiting`, `intervention` and `running` the status gives, in the session-start line's units (`40 s`, `13 min`, `2 h`, `3 d`, p.9); ` for <age>` is left out when none does, or when the try waits out its backoff. `shorter` is the text with the arrow cut down to `, from <node>:<outcome>`, then the text without it; `[]` when the text has no arrow. For example `nightly-mon at publish for 2 min, visit 2, from check on ok`, `nightly-mon at publish for 2 min, visit 2, from check:ok`, `nightly-mon at publish for 2 min, visit 2`; a first visit reads `nightly-tue at build for 13 min, try 1/3`.

  `needsYou` is true while the run waits for a person: a decision (`waiting`) not yet sent, a stuck step (`intervention`), a quarantine, or a ready external step (`step.state` `ready`) whose actor is `person`. A sent decision leaves `waiting` in spore's status until a worker applies it, so while the run waits `line` also runs `spore list --unfinished --json --db <db>`: a row whose `needs` is no longer `signal` does not need the person, and a `list` that fails keeps the wait (skills#68). `ended` is true for `completed`, `failed` and `cancelled`. A status it cannot read is `{"runId", "db": null, "error": {"code", "message"}}` and exit 1: spore's own error, such as `run.not-found`, or `spore.unavailable` when `spore` is missing, timed out or printed no JSON. Exit 2 is a usage error.
- **`claude-spore view <runId> [--db <db>] [--json]`** works out the live view. With `--json`, `{"runId", "db", "line", "facts", "picture", "dots", "tree", "dot", "settings", "instructions"}`, or the error object of `line`:
  - `line` is `line`'s object; `facts` is `<status>, at <node>, visit <n>`, then the try and the streaks as in the line;
  - `picture` is `{"file", "width", "height"}`, the PNG `draw --png` caches for this moment and its size in pixels, or null when it cannot be drawn;
  - `dots` is the dot drawing, one entry per row, each a list of `{"text", "style"}` runs, `style` one of `node`, `here`, `edge`, `taken`, `label` and `taken-label`;
  - `tree` is the compact tree, in the same form: the `start` node's label, then one row per arrow, `├─▶ <node>` or, with the arrow's label, `├─ <label> ─▶ <node>`, each node's own arrows indented under it (`│   `, or four spaces under a last one, `└`). A node already in the tree is named again as `↻ <label>` in the `label` style and not followed, so a loop ends there; nodes the start does not reach follow as trees of their own. The current node is `here`, and the arrow just taken `taken` with its label `taken-label`;
  - `dot` is `workflow.dot` in full, one `{"n", "text", "mark"}` per line: `mark` is `here` on each statement that declares the current node, `taken` on the statement of the arrow just taken, else null;
  - `settings` is the lines of `settings.json` that hold the node's action under `actions`, then the node under `nodes`, in the same form, `here` on the node's first line;
  - `instructions` is `{"file", "head", "text"}`: the node's `instructions` path, its first three lines that are not blank, and the whole file; null when the node has none.

  Without `--json` it prints the facts, the dot drawing and the marked lines of both files, for the `view` sub-skill to show where the mod is not loaded.
- **`claude-spore draw --run <runId> [--db <db>] [--at <node>] [--from <node>:<outcome>] (--png <file> | --plain)`** draws one moment of a run: by default its current node and the arrow into it (`position`, else `end`), else the node and arrow given. `--png <file>` writes the picture to `<file>`; `--plain` prints the dot drawing without colour. Exit 0; 1 when spore cannot tell the run's status or files, the node is not in the graph, or no font is found for `--png`; 2 a usage error.
  - **The files** come from `spore inspect --run <runId> --file <path>`, once per artifact: `draw` and `view` keep each file they read under `artifacts/<digest>/files/` in the plugin's data folder (p.5), `<digest>` being `artifactDigest` without its `sha256:`. An artifact never changes, so a kept file is never read again.
  - **The display DOT** is made from Graphviz's own reading of `workflow.dot` (its `dot_json` output), so IDs, escapes and chains read as Graphviz reads them. It keeps the graph's and each node's and arrow's render attributes; nodes default to rounded boxes; an arrow's label is its `label`, else its `on` when it has one; `complete` and `fail` nodes get a double outline (`peripheries=2`); the current node is filled `#ffd43b` and bold, and the arrow just taken drawn `#e8590c`, 3 wide, its label the same colour.
  - **The picture** is Graphviz's SVG of the display DOT turned into a PNG at twice its size on white by resvg. resvg-wasm has no system fonts, so the helper loads the first font file it finds among the usual ones (Helvetica or Arial on macOS; DejaVu Sans, Liberation Sans or Noto Sans under `/usr/share/fonts` on Linux); `CLAUDE_SPORE_FONTS`, a `:`-separated list of font files, replaces that list, for the specs. With none, `--png` exits 1 naming the folders it looked in, and the view's `picture` is null.
  - **The cache.** Each moment's picture is `artifacts/<digest>/<node>.png`, or `<node>@<from>.<outcome>.png` with an arrow; a moment drawn once is copied from there. The dot drawing of any moment is made from `artifacts/<digest>/layout.plain`, Graphviz's layout, kept once per artifact, since the highlight does not move a node. Each file is written beside its name and renamed over it, so a reader never sees half of it.
  - **The dot drawing** lays Graphviz's `plain` layout of the display DOT, spread wider (`nodesep=0.9`, `ranksep=1.0`) so labels fit between coarse cells, onto about 60 columns, more when two boxes of one rank would overlap, and its rows on their own scale: the nearest two rows of nodes come six rows apart, a box's three and three for the arrow and its label, so a narrow workflow is not drawn taller for being narrow. Arrow curves are sampled and plotted as Braille dots, 2×4 per cell, ending in `▼`, `▲`, `▶` or `◀` the way the curve was going; each node is a three-row box `╭─╮ │ label │ ╰─╯`, and each label is written at Graphviz's label position. The vendored modules are in `vendor/`, with their versions and licences in `vendor/README.md`.
- **Following.** The mod's `tool.call` hook on `Bash` reads a command holding `spore continue <runId> --wait`, with the `--db <db>` after it when there is one, and adds that run to the session's followed runs, newest first; the call itself goes on unchanged. It asks `line` for that run at once.
- **The run line.** An `AbovePrompt` hook draws one row per followed run: `needs you` bold in `#e8590c` and two spaces when `needsYou`, then `line`'s text, then a space and a `view` Button, the newest row's with the hotkey `v`. `needs you` and the button keep their width. The text is the first of `text` and `shorter` that fits the band's `bodyColumns` less those parts (11 and 9 columns), else the last, cut at its end. It draws nothing while a survey holds the band, or with no followed run. A run whose line comes back `ended`, or `run.not-found`, leaves the band; any other error keeps the last line.
- **The poll.** While a run line or a live view is shown, `$.clock.every(1000)` runs `line --json` for each followed run and each open view, one tick at a time; a tick that finds a shown field changed writes the new line, and for an open view runs `view --json` and writes that. State that did not change is not written, so nothing redraws. When the last run line leaves and the last view closes the timer is cancelled: nothing shown, nothing polled. An ended run's open view gets one last `view`, then is no longer polled, keeping its final picture.
- **The live view.** The `view` button, the menu's View, `/ml-workflow:view <runId>` typed, and the tool `open_view` (`{runId, db?}`, registered at session start) open the pane `run-<runId>` with focus, closing on Esc, titled with the run's key where the run line names it and with its ID otherwise, then run `view --json` (p.11, placed at any width). The pane draws the facts line (with `needs you` as on the run line), then the drawing, then `workflow.dot`, the settings lines and the instructions' head with a `more` button (hotkey `m`) for the whole text; the drawing and the files side by side when the pane's `bodyColumns` are 150 or more, stacked otherwise. Lines marked `here` are black on `#ffd43b`, `taken` bold `#e8590c`; the dot drawing's and the tree's styles map the same way. The drawing's room is the pane's `scroll.bodyRows` less two, the facts line and the row under it: the dot drawing is drawn when it has no more rows than that and no row wider than the drawing's width, else the tree. The tree and the files' lines wrap at the pane's edge (`wrap: 'wrap'`), and the dot drawing, which only shows when it fits, cuts. The row holding the current node (the middle one of its box) is keyed `here`. When the pane opens, and each time the poll writes a new view, the mod scrolls its own pane to `here`, else to `picture`, with `block: 'nearest'`, so the current node stays in view and a node already showing does not move the window. The engine scrolls the body (arrows, PgUp, PgDn) while the pane holds the keys: a pane opened from the band's `view` opens without them, and ctrl+x tab gives them. Closing the pane stops its polling.
- **Picture or dots.** The session's `pictures` is unknown until checked. While it is not `false` and the view has a picture, the pane draws an `Image` keyed `picture` from the file (`source: {file, format: "png"}`), as wide as the drawing's half of the pane (or the whole pane when stacked) up to 100 columns, its rows that width times the picture's height over its width, halved, since a cell is about twice as tall as wide. A picture with more rows than the drawing's room is drawn that many rows tall and as wide as keeps its shape. 500 ms after the first such open, the mod blits the same file to that key. A `deny` saying the Image draws its alt sets `pictures` to `false`, and every view of the session draws the dot drawing from then on; `{}` sets it to `true`; any other `deny`, such as a pane not drawn yet, leaves it unknown for the next open. A view without a picture draws the dot drawing.

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

How it does this (skills#68):

- **Two parts.** A gated spec, `test/reference-loop.e2e.ts`, kills the loop at every row of the table with the real `spore`, `claude` and `herdr`. The release checklist, `docs/release-check.md`, then has a person go once through what only Claude Code's screen shows: the interview writing the loop, the menu, the start line, the run line and the live view, and coming back in a new session and with `claude --resume`.
- **Gated.** `bun test` leaves the spec out, since its name does not end in `.spec.ts`. It runs only when named: `bun test --bail ./plugins/ml-workflow/test/reference-loop.e2e.ts`. It skips a form, saying why, without a `claude`, without a `spore` that has `continue --wait` and `cancel`, or when `claude-spore doctor` fails; the watched form also without a running herdr server, or without ml-workflow installed at user scope, whose `claude-spore` the pane's Claude reports with (a different installed version is a warning). `SPORE` names the spore, `E2E_MODEL` the model of `implement` (default `haiku`, so a run costs little), and `E2E_FORMS` one form.
- **The loop** is the bundled `coding-loop`, copied by `claude-spore example copy`, with `--watch implement` for the watched form, and the model set. The task is to write one line to `hello.txt`. A stand-in `npm` takes the tests step: it is red while the check says so, and hangs on the runs it names, so a kill lands inside a try. Claude's own Bash is always told green. In the background form a `claude` shim on PATH logs each call's arguments and message, and can hang before Claude starts; herdr starts the real `claude` for the pane.
- **The kills.** A session that dies takes its follower with it: the check kills the follower's process group outright, as runspore's H37 does (`tests/coming_back.rs`). Claude's turn is cut off once its transcript exists. The points between a command's end and the next step are spore's failpoints `host.attempt.after-effect` (an answer not recorded) and `host.attempt.after-finish` (between steps), and `store.create-run.before-commit` and `after-commit` for a start that never returned. A machine going down kills the follower and the pane's Claude and closes its pane at once. The boot ID stays the same, so the probe finds the try dead by its process; a changed boot ID takes the same branch.
- **At every row** it checks the run's state and `needs`, the run's row in `claude-spore unfinished` and its options in `claude-spore menu`, the text and `needsYou` of `claude-spore line`, and the node `claude-spore view` marks `here`. These are the start line, the menu, the run line and the live view the mod draws, which `claude-code/register.test.ts` checks it draws unchanged. After each Continue it checks what ran again: the `claude` calls (`--session-id` once, `--resume` with the same session after it, and the cut-off or came-back message), the test runs, and the edit on disk.
- **The journeys**, for each form:
  1. From the start to approval: a start cut off before and after its commit; `implement` cut off mid-turn, then cut off with its answer not recorded, then stopped between steps (the background form); the session dying while the pane works, then Continue taking the pane's answer (the watched form); `test` cut off; four reds to `tests_stuck`; keep-going sent and not yet acted on, and sent again; a rejection with its reason; then approval to the end.
  2. Stuck steps: `implement`'s three tries cut off (the background form) or lost to a machine going down three times, each opening a new pane that resumes the conversation (the watched form), then Retry resuming it; `test`'s three tries cut off, then Retry running the tests; Cancel at approval.
  3. Cancel while `implement` works: Claude stops, and the watched form's pane closes.

## Testing

- **A good test drives a public surface** and checks what a person or `spore` would see: the helper's stdout, exit code and files in the work folder; the `spore` run state after it; which processes are alive. It never tests private functions.
- **Seam 1, the `claude-spore` executable,** run as a subprocess, with the real `spore` binary and fake `claude` and `herdr` programs first on PATH. Its specs are `test/*.spec.ts`, run by `bun test`.
- **Seam 2, mod registration,** tested the way `ml-agent-config`'s register test is, under `claude plugin test`: the hooks, commands, tool and panes are registered, and each hook passes the helper's JSON through to the UI unchanged. No logic is tested there.
- **The fake `claude`** (`test/fixtures/bin/claude`) keeps sessions the way the real one answers `--session-id` and `--resume`, as transcripts under `$CLAUDE_CONFIG_DIR/projects/`, records each call's arguments, stdin, working folder and environment, and plays back a scripted list of envelopes, raw stdout included, so a test can send `2.0`. Without `-p` it is an interactive Claude: it records the call and waits until it is killed.
- **The fake `herdr`** (`test/fixtures/bin/herdr`) keeps workspaces, panes and agents in `$FAKE_HERDR_DIR`. `agent start` starts the fake `claude` detached in the pane's folder with the pane's environment, so `start` finds a real process and `probe` checks it; a test sets each agent's state, or every agent's when it cannot know the name, and `pane close` kills the process. Every call is recorded. `status server --json` prints `test/fixtures/herdr/status-server.json`, a real herdr's answer, unless a test sets another; `test/herdr.spec.ts` compares that file's keys and types with the herdr on PATH when its server runs, and is skipped otherwise. `RECORD_HERDR=1` records the real answer into the file.
- **Getting and checking `spore`** (`test/doctor.spec.ts`, `test/install.spec.ts`, `test/launcher.spec.ts`) use local fixtures only: a fake `spore` that answers `capabilities` as each test says, and release folders signed by the real `ssh-keygen` with a throwaway key, which a copy of the plugin pins in place of the release key. A tampered archive, a tampered `SHA256SUMS` that matches it, another key's signature, and a missing signature are each refused with the folder unchanged. The launcher runs against a scratch `installed_plugins.json`.
- **The interview's examples** (`test/authoring.spec.ts`): every folder under `skills/author/references/examples/` passes the real `spore validate` and `claude-spore check` with no warning, the watched one with the fake `herdr`; the worktree step's command makes one worktree per run ID and reuses it on a repeat; a real run of `parallel-coding-loop` with the fake `claude` works in the run's worktree up to the approval; and the helper program of `watched-coding-loop` is an executable asset, which a real run of its test step runs from the step files, green to the end and red along the `red` arrow. The interview itself, a conversation, is checked by the end-to-end run (p.25).
- **The bundled examples' copies** (`test/example.spec.ts`): `example list` names every folder with its comment and its Claude steps; a copy without `--watch` is the example file for file; `--watch implement` changes only that action, to the watched form; each refusal writes nothing; and every example, copied with `implement` in the background or watched, passes the real `spore validate` and `claude-spore check` with no warning.
- **The sub-skills** (`test/skills.spec.ts`): each `SKILL.md` names its own sub-skill, pre-approves `Bash(spore *)` and `Bash(claude-spore *)` (p.6), `author` also `Bash(chmod +x *)`, `act` `Bash(herdr agent focus *)` and `view` `mcp__ml-workflow__open_view`, and reads the Claude Code version first (p.2); only `menu`, `act` and `author` are typed only. Every command a menu row hands to is a sub-skill that exists. `start` and `continue` each carry the reaction table of p.10 and what it offers, word for word the same. What the skills say is checked by the end-to-end run (p.25).
- **Following a run** (`test/follow.spec.ts`) drives the real `spore` with the commands the skills run and checks that each answer holds what the reaction of p.10 reads: a fresh run from `spore start --json`, and `input.invalid` creating none; `continue --wait --json` answering `needs` `signal`, `stuck`, `external-ready` and `held`, and `status` `completed`, `failed` and `cancelled`, with the fields of each row, `--db` after the subcommand included; the reaction reads only the answer, so these checks hold for a `spore` from before runspore#213, which exits with the run's code, and after it, which exits 0; a decision sent with `--id <activationId>`, the same decision again a no-op and another one `signal.id-reused`; an interactive step whose pane waits for the person answering `needs` `held` with `step.waiting` `person` and "implement waits for you in its pane", and the follow after it watching on until the pane's answer completes the run; several unfinished runs listed by `list --unfinished`; and `spore cancel` ending a held interactive step, its pane closed by `claude-spore stop`. It needs a `spore` with `continue --wait` and `cancel`, and is skipped without one, unless `REQUIRE_SPORE=1`.
- **The session-start line** (`test/unfinished.spec.ts`) runs `claude-spore unfinished` against a fake `spore` that answers `list --unfinished` and `status` as each test says: one line per `needs`, the attempt, no line on any error, and none inside a step. `test/follow.spec.ts` checks the lines against the real `spore` for a run not started, a stuck one and one waiting for a decision.
- **The menu rows** (`test/menu.spec.ts`) run `claude-spore menu` against the same fake `spore` and a scratch project: a run's row for every `needs` with its options and commands, the holder's lease and the quarantine's code in the label, the workflows by graph id, the bundled-example option without one, "Change a workflow" only with one, the `spore` row when it cannot list, and nothing asked inside a step. `test/follow.spec.ts` checks the rows' runs against the real `spore`.
- **The menu in the mod** (`claude-code/register.test.ts`): `ml-workflow:menu`'s `command.run` hook and the `open_menu` tool open the pane before they run `claude-spore menu --json`; the hook's three answers (open, waiting with the keys that show it, refused or too old: the skill runs); the pane draws each row as a `Select` with the helper's labels; a pick closes the pane and runs the option's command with its arguments.
- **The run line and the live view** (`test/view.spec.ts`) run `claude-spore line`, `view` and `draw` against a fake `spore` that answers `status` and `inspect --run --file` as each test says, with the plugin's data folder in a scratch folder: the line of a running run, of one waiting for a person, of a try past its limit, of a streak and of each ended state; the error object for a run spore does not know; the marked lines of `workflow.dot` and `settings.json` and the instructions' head; the compact tree with the current node and the arrow just taken, and a dot drawing of a narrow workflow no taller than a wide one's; `draw --png` writing a PNG and `--plain` the dot drawing, the current node and the arrow highlighted; each artifact file read from spore once and each moment drawn once, a second `draw` copying the cached picture; and no font making `--png` fail and the view's `picture` null. `test/follow.spec.ts` checks `line` and `draw` against the real `spore` for a run at a stuck step.
- **The run line and the view in the mod** (`claude-code/register.test.ts`, with the mocked clock): a Bash call of `spore continue <runId> --wait` shows the helper's line above the prompt, with `needs you` and the `view` button; the poll runs the helper only while a line or a view is shown, and an ended run leaves the band and stops it; `view`, and `/ml-workflow:view <runId>` typed, open the pane `run-<runId>` before they run the helper, drawing its lines; a view that waits names the command that shows it; the picture check's `deny` switches the session to the dot drawing; a dot drawing taller than the pane's room gives way to the tree, its current node keyed `here`, and the files' lines wrap; a picture taller than the room is drawn narrower; the menu's View opens the view without a command.
- **The real `spore`** is the one the `SPORE` variable names, else `spore` on PATH. A spec that needs it is skipped, with the reason printed, when that `spore` is not 0.2, unless `REQUIRE_SPORE=1`, which CI sets.
- **CI** runs both seams; once the helper drives `spore`, against the newest `spore` release and against 0.2.0. Until a runspore release has async commands, `continue --wait` and `cancel` (the v0.2.0 tag predates them), CI builds `spore` from a pinned runspore commit instead. The interactive step's real-`spore` spec needs a `spore` whose `capabilities` list `command` among `asyncKinds`; it is skipped without one, unless `REQUIRE_SPORE=1`. It also runs the helper under Bun 1.1 and expects exit 2. Its `version raised` job runs `scripts/plugin-version.ts check` against the base branch's tip, as npm refuses to publish over an existing version: a change under `plugins/ml-workflow/` whose `plugin.json` version is not above the base's, whose three copies of the version differ, or whose `CHANGELOG.md` has no section for it, fails.
- **The end-to-end check** is p.25, gated, before a release: `test/reference-loop.e2e.ts`, run by name, and `docs/release-check.md`.

## Out of scope

The Desktop app, claude.ai, Cowork, and `claude -p` as a surface for the menu; running a step in the person's own session; parallel steps; the delivery flow; sub-workflows; an always-on daemon or orchestrator agent; run history beyond the live view, and pruning work folders; sandboxing Claude steps and narrowing `Bash` in the edits set (until then the reference loop is for trusted repositories); a browser view; starter workflows in the interview; a per-step "fresh conversation" switch; a Homebrew tap; a Web-tree marketplace listing; closing the old `workflow` map (skills#18); everything generic, which belongs to the runspore spec.

## Risks

- Claude Code internals are undocumented: `MAX_STRUCTURED_OUTPUT_RETRIES`, the strict-schema allowlist, `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`.
- The shape of `installed_plugins.json`, read by the launcher.
- herdr's state output as a contract, and that `agent start --kind claude` runs the `claude` on the pane's PATH with the arguments after `--`.
- Claude Code's transcript layout, `projects/<folder>/<uuid>.jsonl`, read by the interactive `start` to learn whether a session exists.
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
