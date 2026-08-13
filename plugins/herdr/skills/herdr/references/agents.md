# Agents

An agent is an AI process (usually `claude`) attached to a pane. `<target>` accepts a
pane id, a terminal id, a unique agent name, or a detected agent label.

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

## `agent send` does not submit

This is the one that bites. `herdr agent send` types text into the agent's composer and
stops there; the message sits unsent and the agent stays idle, so a naive
send-then-wait-then-read returns the *previous* reply and looks like the agent ignored
you. herdr's own help says it outright: *"agent send writes literal text; use pane run
when you want command text plus Enter."*

Submit explicitly:

```bash
herdr agent send   <pane_id> "your message"
herdr pane send-keys <pane_id> Enter
```

Splitting it this way is a feature, not just a wart - it is how you pre-fill a prompt for
a human to edit, or answer an agent's y/n without committing.

## Recipe: spawn an agent and hold a conversation

```bash
# 1. start it (same tab, split beside you; --no-focus keeps the user's view put)
herdr agent start probe --cwd /path/to/repo --workspace w1 --no-focus -- claude
#    → result.agent.pane_id, e.g. w1:p2N

# 2. wait for the TUI to boot before typing at it
herdr wait agent-status w1:p2N --status idle --timeout 60000

# 3. ask, submit, wait, read
herdr agent send     w1:p2N "What model are you? One line."
herdr pane send-keys w1:p2N Enter
herdr wait agent-status w1:p2N --status idle --timeout 120000
herdr agent read     w1:p2N --lines 60 --format text
```

Repeat step 3 for each turn; the agent keeps its conversation state, so follow-ups that
reference the previous answer work.

Notes on each step:

- **Step 1 cwd.** Pick deliberately. A cwd inside a project makes the new agent inherit
  that project's `CLAUDE.md`, hooks and `SessionStart` output - sometimes what you want,
  sometimes a startup that claims work or takes locks. A scratch directory keeps it inert.
- **Step 2 is not optional.** A freshly started agent reports `unknown`, and text sent
  before the TUI is listening is dropped.
- **Step 3 read.** `agent read --format text` returns the *rendered TUI*, banner and
  status bar included, not a clean transcript. Grep for the reply marker (`⏺`) or for
  your own prompt text rather than taking the tail.

## Reading output without a conversation

`herdr agent read` and `herdr pane read` differ only in what `<target>` accepts. For
watching a long build or test run, prefer waiting on a marker over polling:

```bash
herdr wait output <pane_id> --match "tests passed" [--regex] [--timeout MS]
herdr wait agent-status <pane_id> --status idle|working|blocked|done|unknown [--timeout MS]
```

`wait agent-status` accepts `done`, which `agent wait` does not.

## Gotchas

- **Status is a claim, not proof.** `idle` means the agent stopped producing, including
  when it stopped to ask a question. Read the pane before assuming the task finished.
- **`--takeover` on `agent attach`** seizes an agent another client is attached to.
  Confirm with the user first.
- **Names must be unique** to be usable as `<target>`. When in doubt use the pane id.
