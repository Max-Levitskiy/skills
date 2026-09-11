# Working an agent-config plan

`agent-config start <name>` is the first thing a component's skill runs, and this file is the
protocol for what comes back. `start` returns the path to this document in its `guide` field so
that the protocol lives in one place instead of being restated — and drifting — inside every
consumer's `SKILL.md`.

Read this when a `start` came back with `ready: false`.

## What `start` returns

```json
{ "acs": 2, "name": "fellow", "harness": "claude",
  "repo": { "checkout": "…", "root": "…", "identity": "github.com/Owner/Name",
            "registered": true, "alias": "skills" },
  "ready": false,
  "guide": "…/agent-config/docs/working-actions.md",
  "config":     { "…merged over four layers, defaults applied, credential references verbatim…" },
  "provenance": { "tracker.kind": "repo", "tracker.path": "default" },
  "actions":  [ { "id": "onboard", "path": "…/actions/onboard.md", "type": "prompt",
                  "command": null, "parallel": false, "requires": [],
                  "keys": ["credentials.apiKey", "workspace.subdomain"], "context": {} } ],
  "problems": [] }
```

- **`ready`** is the one field to branch on. `true` means there is nothing to do: go and do the
  work the user asked for. Do not read `actions.length` instead; `ready` is explicit so that it
  stays the contract.
- **`config`** is returned always, ready or not — it is most useful precisely when something is
  wrong. Credential references appear verbatim, because a reference is not a secret and hiding it
  destroys debuggability.
- **`provenance`** maps each leaf key to the layer it came from, or `default` when the declaration
  supplied it. Use it when the user asks why a setting has the value it has.
- **`problems`** are things to tell the human. A problem has no action that fixes it, which is what
  separates it from `actions` — see [Problems](#problems).
- **`repo.identity`** is `null` in a repository with no git origin and no minted id. The user-repo
  layer is unavailable there until the repository is registered.

Exit codes, for a script that cares: `0` a plan was produced (ready or not), `1` internal, `2` the
declaration is missing or invalid or the name is ambiguous, `3` a credential is unresolvable
(`load` only), `4` a config file's schema version is behind the declaration's (`load` only).
**Needing onboarding is exit 0** — it is the expected first-run state, not a failure.

## Working the action list

`actions` is a **flat list with an explicit dependency graph**, not an ordered script. Each entry
carries `requires`, the ids that must complete before it, and `parallel`, whether it may run
alongside actions it has no edge to.

Sort it yourself, or let the helper beside this file do it:

```bash
agent-config start fellow > /tmp/plan.json
bun <dir-of-this-file>/plan-actions.ts < /tmp/plan.json
```

The helper prints the same actions grouped into ordered steps, marks which steps may run
concurrently, tells you where the batch stops, and reports a dependency cycle rather than
deadlocking on one. The rules it applies, if you would rather sort by hand:

1. A **step** is a set of actions whose `requires` are all already complete.
2. Inside a step, every `parallel: true` action may be tasked out **concurrently**. Any
   `parallel: false` action runs **alone** — give it its own step.
3. `parallel` never overrides `requires`. An edge always wins.

### Executing one action

| `type` | what to do |
| --- | --- |
| `code` | Run `command` verbatim. Non-zero exit is a failure. |
| `prompt` | Read the file at `path` and do what its body says, using your own judgment. |
| `manual` | Read the file at `path`, relay its instruction to the human, and **stop**. |

Every action's `path` points at a markdown file whose body is written for you: what the action
does, and what to do when it fails. Read it. `keys` carries the declared config keys that triggered
the action — five missing keys pointing at one onboarding action arrive as one action carrying all
five, not five identical interviews. `context` carries whatever else that action's body needs: the
dependency being installed, the layer being migrated, a marketplace URL.

### When an action fails

Abort **only the failed action's dependent subtree**.

- Any action with no `requires` edge on the failed one still gets attempted, even mid-step. An
  unrelated onboarding step should not be blocked by a flaky credential resolver.
- Anything that transitively requires the failed action is **skipped, not attempted**.
- **Surface the failure to the user and help debug it.** This is a live interaction, not a batch
  job: a terse pass/fail table is not an acceptable report.
- The batch ends there. Do not retry in a loop.

### `manual` ends the turn

A `manual` action cannot be completed by you or by any command — the canonical case is
`/reload-plugins`, a built-in slash command that only a human typing it into the session can
dispatch. So on reaching a `manual` action: deliver its instruction, attempt no further actions,
and **do not re-run `start` in this turn**. There is nothing left you can do until the human acts.

### After the batch

Re-run `agent-config start <name>`. **Always the full command, never a partial re-check of the
keys that were missing** — writing one answer can reveal required keys that did not exist a moment
earlier, because a conditional group's condition may now hold. `start` re-derives everything from
declaration-minus-config on every call, so a session that just onboarded and a session arriving a
week later take the identical path. There is no state to resume.

If the fresh `start` returns the same action you just completed, that is not a loop to break: read
`problems`, and check whether a `manual` reload is still outstanding.

## Problems

A `problem` is reported, not worked. Each carries a `code` and a `message` written for the human.

| `code` | meaning |
| --- | --- |
| `credential-malformed` | A reference is present but unusable — a `1password` source with no `ref`. There is *also* an action for it, because "your reference is broken" and "you have nothing configured" are different conversations. |
| `schema-rolled-back` | A config file is stamped ahead of the installed component: the plugin was downgraded. Proceeding is deliberate — a rollback has no repair path, and refusing would brick the install. |
| `dependency-ambiguous` | A declared dependency uses a bare name that several installed plugins also carry. The component's author must qualify it as `<plugin>:<skill>`; nothing you install will fix it. |
| `legacy-config-path` | A pre-rename `.agents/skill-config/` file exists and is **not** being read. Tell the user, and offer to move it. |
| `dirty-checkout` | A registry write would land in a repository with uncommitted changes. |

## Changing an answer that is already set

With `ready: true` the action list is empty, so there is no onboarding action to re-run. Editing an
existing answer is a three-step protocol:

1. `agent-config describe <name>` — every declared key with its description, recommended layer,
   default and condition, **plus the current answers and the layer each came from**. Onboarding is
   the case where the answers are empty; editing is the same questionnaire, filled in. It also
   returns each user-side layer's `journal`: the previous contents of that file, newest first, so a
   bad edit can be put back.
2. `agent-config write <name> --layer <layer>` — the whole layer as JSON on stdin. It **replaces**
   the layer, so read the current one first (`describe`, or `path --layer <layer>`) and write the
   merged whole. A partial write cannot express deleting a key. `write` stamps the schema version,
   saves the schema snapshot beside the file, gitignores the local layer, and journals the previous
   contents.
3. Run the component's own `verify` action. "Configured" means a real call succeeded, and only the
   component knows what to call.

Never edit a config file with the file-writing tool. `write` is the only path that gitignores,
stamps and snapshots — and the snapshot is what the next migration diffs against.

## For a consumer script

A script reads config with `load`, never `start`:

```bash
agent-config load fellow --secrets credentials.apiKey 3>&1 1>/dev/null
```

- Config and provenance on **stdout**; requested secrets as one JSON object on **fd 3**. One
  invocation, so a script needing two secrets pays one process and one credential prompt.
- Secrets never touch stdout, argv, a log, or disk. fd 3 is a deliberate act by the caller: a
  naive `agent-config load … --secrets …` run by an agent gets nothing on it.
- `load` **requires readiness** and **never returns an action list**. That is what makes "a
  subagent must not open an interview" structural rather than a rule in prose: a subagent's whole
  surface is `load`, so it has nothing to work. Its failures are reports — exit 2 names the missing
  keys, exit 3 names the unresolvable reference and the fix, exit 4 names both schema versions.

There is no importable library. The CLI is the only interface, which is what stops a credential
resolver spreading by copy the way v1's did.

## Finding the binary

**`PATH` is a property of the harness process, not of the plugin system, so the bare name is not
always enough.** Measured on this machine: Claude Code prepends every installed plugin's `bin/` to
`PATH` at session start, so `agent-config` resolves bare; **Codex never does**, and a third harness
hosting Claude Code may add nothing at all. Use the chain — four steps, first hit wins:

```sh
# 1. explicit override  2. PATH  3. the harness's own plugin cache  4. give up with an install link
agent_config() {
  if [ -n "$AGENT_CONFIG_ROOT" ]; then "$AGENT_CONFIG_ROOT/bin/agent-config" "$@"; return; fi
  if command -v agent-config >/dev/null 2>&1; then agent-config "$@"; return; fi
  for candidate in \
    "$HOME"/.claude/plugins/cache/*/agent-config/*/bin/agent-config \
    "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/agent-config/*/bin/agent-config; do
    [ -x "$candidate" ] && { "$candidate" "$@"; return; }
  done
  echo "agent-config is not installed: https://github.com/Max-Levitskiy/skills/tree/main/plugins/agent-config" >&2
  return 127
}
```

Step 3 globs the documented cache layouts rather than computing a path: version segments are
semver on one harness and git SHAs on the other, the marketplace segment differs per harness for
the same plugin, and Codex keeps backup directories beside real ones. Never reconstruct an install
path, and never read `$CLAUDE_PLUGIN_ROOT` — it is unset in agent-run bash.

Once any call has succeeded, `agent-config path <name>` returns `agentConfig.root` and
`agentConfig.bin`: the absolute paths to hand to a consumer script, or to export as
`AGENT_CONFIG_ROOT` for the rest of the session.

Last resort, when agent-config is not installed at all and installing it is not possible right
now — **always pinned**, because the unpinned form freezes on its first resolved commit forever:

```sh
bunx github:Max-Levitskiy/skills#<commit-sha> agent-config start fellow
```

This re-downloads on every fresh `$TMPDIR`, so it is an escape hatch and never the install path.

## What a consumer's SKILL.md says

Five lines. Nothing more belongs there, because everything else is in this file.

````markdown
Run this first, before anything else:

```bash
AC=$(command -v agent-config || ls -d "$HOME"/.claude/plugins/cache/*/agent-config/*/bin/agent-config \
     "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/agent-config/*/bin/agent-config 2>/dev/null | tail -1)
"$AC" start fellow
```

Prints JSON. `ready: true` → proceed. `ready: false` → read the file at `guide` and follow it to
work the `actions` list, then re-run. An empty `$AC` or `command not found` means agent-config
isn't installed; tell the user and offer to install it from <link>.
````

It resolves the binary once and invokes it once, so a legitimate exit 2 is not re-run and the
agent never sees two diagnoses. The glob branch is the normal case on Codex.
