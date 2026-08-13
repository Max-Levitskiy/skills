# Tabs and panes

## Tabs

```bash
herdr tab list [--workspace <workspace_id>]
herdr tab get <tab_id>
herdr tab create [--workspace <workspace_id>] [--cwd PATH] [--label TEXT] \
                 [--env KEY=VALUE] [--focus|--no-focus]
herdr tab focus <tab_id>
herdr tab rename <tab_id> <label>
herdr tab close <tab_id>          # destructive - takes its panes with it
```

## Panes

A pane is a terminal. Most pane commands accept the pane id positionally, or
`--pane ID`, or `--current` to mean the pane you are running in.

### Inspect

```bash
herdr pane list [--workspace <workspace_id>]
herdr pane current [--pane ID|--current]      # ids + cwd + agent + status for one pane
herdr pane get <pane_id>
herdr pane layout       [--pane ID|--current]
herdr pane process-info [--pane ID|--current]
herdr pane edges        [--pane ID|--current]
herdr pane neighbor --direction left|right|up|down [--pane ID|--current]
```

### Read output

```bash
herdr pane read <pane_id> [--source visible|recent|recent-unwrapped] [--lines N] [--format text|ansi]
```

`visible` is the current viewport, `recent` includes scrollback, `recent-unwrapped` keeps
long lines intact instead of hard-wrapping them to the pane width - use it when you need
to grep or parse output rather than eyeball it.

### Send input

```bash
herdr pane run       <pane_id> <command>      # types the command AND presses Enter
herdr pane send-text <pane_id> <text>         # types literal text, no Enter
herdr pane send-keys <pane_id> <key> [key...] # e.g. Enter, C-c
```

`run` for executing a command; `send-text` for filling a prompt you do not want submitted
yet; `send-keys` for control keys and for submitting what `send-text` or `herdr agent
send` left sitting in the composer.

### Rearrange

```bash
herdr pane split  [<pane_id>|--current] --direction right|down [--ratio FLOAT] [--cwd PATH] \
                  [--env KEY=VALUE] [--focus|--no-focus]
herdr pane focus  --direction left|right|up|down [--pane ID|--current]
herdr pane resize --direction left|right|up|down [--amount FLOAT] [--pane ID|--current]
herdr pane zoom   [<pane_id>|--current] [--toggle|--on|--off]
herdr pane swap   --direction left|right|up|down [--pane ID|--current]
herdr pane swap   --source-pane ID --target-pane ID
herdr pane move   <pane_id> --tab <tab_id> --split right|down [--target-pane ID] [--ratio FLOAT]
herdr pane move   <pane_id> --new-tab [--workspace ID] [--label TEXT]
herdr pane move   <pane_id> --new-workspace [--label TEXT] [--tab-label TEXT]
herdr pane rename <pane_id> <label>|--clear
herdr pane close  <pane_id>       # destructive - kills whatever runs in it
```

`pane move --new-workspace` promotes a pane to its own sidebar entry, which is how a
side experiment that grew into real work gets its own home without restarting it.

### Agent status reporting

`herdr pane report-agent`, `report-agent-session`, `report-metadata` and `release-agent`
exist for *agents reporting their own state* to herdr - that is how the sidebar knows an
agent is working or blocked. They are for integration authors. Do not call them to fake
or correct another pane's status; read `herdr pane --help` if you are wiring up an
integration.

## Gotchas

- **`pane close` kills the process**, including a running agent mid-task. Confirm.
- **`tab close` closes every pane in it.** Check `pane list` first when the tab is not
  obviously single-pane.
- **`--current` needs `$HERDR_PANE_ID`**, which herdr sets in every pane it spawns. It is
  absent in a terminal not started by herdr; pass an explicit id there.
- **A pane id outlives its content.** After `pane move`, ids stay valid but the tab and
  workspace ids in earlier output are stale - re-read rather than reusing them.
