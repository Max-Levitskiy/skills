# Agents and subagents

An agent is an AI process (`claude`, `codex`, `omp`, …) attached to a pane. `<target>`
accepts a pane id, a terminal id, a unique agent name, or a detected agent label.

Two layers exist and both are useful:

- **`scripts/herdr-agent.ts`** (bun) - preset-driven, one command per step, all the timing
  traps handled. Use this for starting subagents and talking to them.
- **`herdr agent …`** - the raw verbs. Use for what the runner does not cover (rename,
  focus, attach, explain) or when you want to see exactly what happened.

## The runner

```bash
scripts/herdr-agent.ts presets [--json]
scripts/herdr-agent.ts running [--json]
scripts/herdr-agent.ts start [preset] [--prompt "text"] [--name N] [--cwd P]
                             [--workspace ID] [--tab ID] [--split right|down] [--focus]
                             [--env K=V] [--session S] [--timeout MS] [--json]
scripts/herdr-agent.ts ask <target> "text" [--timeout MS] [--lines N] [--json]
scripts/herdr-agent.ts read <target> [--raw] [--lines N] [--source visible|recent]
scripts/herdr-agent.ts stop <target> --force
scripts/herdr-agent.ts config check|show|path [layer]|write <layer>
```

Spawn a reviewer beside you and get an answer in one call:

```bash
scripts/herdr-agent.ts start claude --cwd /path/to/repo --split down \
  --prompt "Summarize the uncommitted diff in five bullets."
# → pane w1:p2N  (claude: claude)  tab w1:t1  workspace w1
#   ...the reply, already stripped of banner, composer and status bar
```

Then keep the conversation going - the pane keeps its context, so follow-ups referring to
the previous answer work:

```bash
scripts/herdr-agent.ts ask w1:p2N "Which of those would you fix first, and why?"
```

`--name` doubles as the target, so `start reviewer --name rev` then `ask rev "…"` reads
better than juggling pane ids. Names must be unique to be usable as targets.

### What it handles that hand-rolling does not

Four failure modes, all of which look like "the agent ignored me" or "the agent answered
the wrong question":

1. **`agent send` does not submit.** It types into the composer and stops. herdr's own help
   says so: *"agent send writes literal text; use pane run when you want command text plus
   Enter."*
2. **An immediate Enter is swallowed.** Sent in the same breath as the text, it disappears
   into the TUI's redraw and the message sits unsent. The runner delays, then re-sends
   Enter while the composer still holds the text.
3. **A status wait straight after submitting returns instantly**, because the agent has not
   started working yet - so a naive send→wait→read returns the *previous* reply. The runner
   waits for movement off idle first.
4. **Agents disagree on which status means "finished".** Claude Code lands on `idle`, Codex
   on `done`, either can stop at `blocked` to ask you something. `herdr wait agent-status`
   takes exactly one status, so the runner polls the set, and labels a `blocked` result as a
   question rather than passing it off as an answer.

It also waits for the TUI to stop drawing before typing. Status is not enough: Codex
reports `idle` while its model line still says `loading`, and text typed into a
half-drawn TUI is silently truncated - the prompt arrives as `+3.` instead of the sentence.

### Reading replies

`agent read` returns the *rendered screen* - banner, composer, status bar - not a
transcript. The runner cuts it down using per-agent markers from config: everything below
the last full-width rule goes, then the echoed prompt, then everything before the agent's
own output marker (`⏺` for Claude Code, `•` for Codex), then per-agent furniture patterns.
`read --raw` gives you the untouched screen when the scrape looks wrong.

## Presets live in agent config

Which subagents exist is configuration, not a command line the model invents. Presets sit
under `agents` in ACS v1 agent config (see `standards/agent-config.md`); the plugin's
`config.example.json` documents every key.

```bash
scripts/herdr-agent.ts config path global     # ~/.agents/config/herdr/config.json
scripts/herdr-agent.ts config check           # layers read, presets available, problems
scripts/herdr-agent.ts config write global < my-config.json
```

| Key | Means |
|-----|-------|
| `command` | argv herdr spawns. The only required key. |
| `description` | one-liner shown by `presets` |
| `cwd` | where it starts (`~` expands, relative resolves from the repo root) |
| `env` | extra environment, passed as `--env K=V` |
| `session` | run it in another herdr session (background server) |
| `split` / `focus` | pane placement, and whether it steals your focus |
| `bootTimeoutMs` / `replyTimeoutMs` / `readLines` | patience and read depth |
| `replyMarker` / `composerMarker` / `chrome` | TUI markers used to scrape replies |
| `defaults.agent` | which preset `start` uses with no argument |

Eight presets are built in - `claude`, `codex`, `omp`, `gemini`, `opencode`, `droid`,
`copilot`, `cursor` - so the runner works with no config file. A config entry with the same
name overrides it key by key; any other name is purely yours. A preset is a *role*, not
just a binary:

```json
{
  "version": 1,
  "agents": {
    "reviewer": {
      "command": ["claude", "--permission-mode", "plan"],
      "description": "read-only reviewer, cannot edit files",
      "split": "down",
      "replyMarker": "⏺"
    }
  }
}
```

`presets` cross-checks each preset against `$PATH` and against `herdr integration status`.
An agent with no herdr integration still runs, but reports status by heuristic, so waits
are less exact.

**cwd is a real decision.** A cwd inside a project makes the new agent inherit that
project's `CLAUDE.md`, hooks and `SessionStart` output - sometimes what you want, sometimes
a startup that claims work or takes locks. A scratch directory keeps it inert.

## Raw verbs

```bash
herdr agent list
herdr agent get <target>
herdr agent read <target> [--source visible|recent|recent-unwrapped] [--lines N] [--format text|ansi]
herdr agent send <target> <text>            # writes literal text - does NOT press Enter
herdr agent rename <target> <name>|--clear
herdr agent focus <target>
herdr agent attach <target> [--takeover]
herdr agent explain <target>
herdr agent wait <target> --status idle|working|blocked|unknown [--timeout MS]
herdr agent start <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split right|down] \
                         [--env KEY=VALUE] [--focus|--no-focus] -- <argv...>
```

The manual conversation, if you need to see each step:

```bash
herdr agent send     <pane> "your message"
herdr pane send-keys <pane> Enter
herdr wait agent-status <pane> --status idle --timeout 120000
herdr agent read     <pane> --lines 60 --format text
```

## Watching without a conversation

`herdr agent read` and `herdr pane read` differ only in what `<target>` accepts. For a long
build or test run, wait on a marker instead of polling:

```bash
herdr wait output <pane_id> --match "tests passed" [--regex] [--timeout MS]
herdr wait agent-status <pane_id> --status idle|working|blocked|done|unknown [--timeout MS]
```

`wait agent-status` accepts `done`, which `agent wait` does not.

## Gotchas

- **Status is a claim, not proof.** A quiet status includes "stopped to ask a question".
  Read the pane before assuming the task finished.
- **`stop` is destructive** - it closes the pane and kills whatever is running, so it
  demands `--force` and you should confirm with the user first.
- **`--takeover` on `agent attach`** seizes an agent another client is attached to. Confirm
  first.
- **Names must be unique** to be usable as `<target>`. When in doubt use the pane id.
