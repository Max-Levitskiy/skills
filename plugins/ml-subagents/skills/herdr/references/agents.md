# Delegate or converse

Use the selected target prefix throughout; read targets.md when the server is unresolved.
Examples use a Bash array `H=(herdr --session <name>)`; replace the placeholder.
Native syntax was inspected on 0.9.3; use installed help on another version.

## Launch and give work

Create a location first; managed launch never creates layout:

```bash
created=$("${H[@]}" workspace create --cwd /path/to/repo --label review --no-focus)
pane=$(printf '%s\n' "$created" | jq -r '.result.root_pane.pane_id')
"${H[@]}" agent start reviewer --kind claude --pane "$pane" --timeout 30000
"${H[@]}" agent prompt reviewer "Review the diff; write findings to /path/review.md" \
  --wait --timeout 120000
"${H[@]}" agent read reviewer --source visible --lines 80
```

Workspace/tab creation returns root_pane; split returns result.pane.
The pane must be at an interactive shell prompt, not occupied by another foreground
process. Kind chooses a canonical executable; arguments after -- are agent arguments.
Startup timeout is >3000 and <=300000 ms. Success establishes interactive readiness,
not completed work/authentication. Failed startup may leave a named pane; retain its ID.
Give tasks output paths or unique markers and acceptance criteria. Preserve requested
models/permission modes; an executable on PATH does not prove login or model availability.

## Existing conversation

Agent list returns live names, pane IDs, state and location. Get rechecks the occupant
before input. Targets are unique live names or hosting pane IDs; disambiguate multiple
same-kind agents by inventory. Aliases vanish when their agents exit or are replaced.

Prompt idle/done agents. Native prompt can send while working, but its wait can match
that earlier active turn. Coordinate it deliberately first. Unknown is not proof of
readiness: inspect evidence before sending.
Prompt --wait guards an initially quiet agent by observing working/blocked, then
matches idle/done/blocked. Repeat --until for exact states. Standalone wait can match
immediately. Always supply bounded --timeout. Lifecycle waits do not correlate task IDs.

## Read and interpret

CLI agent read prints text; raw API agent.read returns result.read.text.
Recent sources default to 80 rendered rows. Visible reads the viewport; detection reads
the live bottom snapshot. Both are passive. Recent-unwrapped helps long lines but is
rendered output, not a complete transcript. Deep recent reads can scroll an idle
alternate-screen transcript and may fail with agent_not_idle. Bound lines and displayed
characters; collect a large answer from an output file.

Done means idle but unseen; reads do not clear it, focus does. Codex may remain unknown
after responding. Verify current artifacts even with idle/done. Derive needs-input
from a recognized blocked dialog or visible evidence; it is not another native state.
A blocked prompt is rejected before sending. Read the dialog, then use deliberate,
authorized agent send-keys esc/up/enter/ctrl+c. Stalls/timeouts/transport failures may
follow sent input: reconcile agent status/output/artifact before retrying.

## Optional presets

`bun scripts/herdr-agent.ts presets|running|start|ask|read|stop` preserves command names;
Node 24.12+ can execute the same TypeScript file. Native start/prompt capabilities are
required. Busy/ambiguous turns are refused. Replies are bounded screen text with
task_verified:false, not scraped final answers.
Use --machine, --session or --wsl for explicit routing; inspect --help.
ACS command argv/layers remain supported. Canonical binaries infer kind; arbitrary
wrappers need an explicitly supported launch design. Legacy screen markers are accepted
but unused. Default start creates a separate workspace; --pane reuses a shell and
--anchor-pane splits a known pane. The sample config documents migration.
