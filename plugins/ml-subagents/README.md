# ml-subagents

Run and coordinate AI subagents from Claude Code.

```bash
/plugin install ml-subagents@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-subagents:orchestrate` | Split a multi-part task into tracked, parallel work packages, and collect the decisions only you can make |
| `/ml-subagents:herdr` | Start, message, read, and stop subagents in herdr panes, and drive the herdr workspace manager |

## `/ml-subagents:orchestrate`

Hand Claude a multi-part task, walk away, come back to finished work and a short list of decisions only you could have made.

### What it does

One parent task becomes small work packages run by parallel subagents. Every decision that genuinely needs you becomes a one-page question document with a stated default — and the work continues on that default. Nothing waits for you.

- *"Split the launch-readiness task across agents while I'm out."*
- *"Work through this migration mostly autonomously — ask me when you need a decision, but don't block."*
- *"Collect questions for me and keep going."*

It works on documents and prep material as readily as on code: the unit is a deliverable file, not a commit.

### The five invariants

Everything else adapts to the project. These don't:

| | Invariant | Why |
| --- | --- | --- |
| 1 | One package = one agent = one output file | No merge conflicts, no racing writes, trivial verification |
| 2 | Packages finish without a human | A package that must pause for an answer was cut wrong |
| 3 | Never block | Human-only decision → question doc + default + keep going |
| 4 | Only the orchestrator edits shared state | Two agents appending to one index is the classic race |
| 5 | Verify on disk before closing | Agents report success for files that are wrong, partial, or clobbered |

### The question protocol

The part that makes async work actually async. Each question is one small file:

- **plain language** — you may answer days later, on a phone, with no context loaded. Every project term is explained on first use.
- **a real default, not a shrug** — the option the evidence supports, plus what changes if you pick differently ("switching is a two-minute edit: delete one table column").
- **what's blocked, and what continues anyway** — usually nothing is blocked, which is what lets you answer slowly.

One line back is enough. If your answer matches the default, nothing needs redoing.

### Configuration

Optional — with no config the skill discovers the project's tracker and runs on defaults. Configure it to skip that discovery, tier models, or point work at a hosted issue tracker.

Settings follow the [Agent Config Standard](../../standards/agent-config.md): `global` → `repo` → `local`, deep-merged, with a bundled CLI.

```bash
O="$CLAUDE_PLUGIN_ROOT/skills/orchestrate/scripts/orchestrate-config.ts"
bun "$O" check     # layers, effective settings, what's missing
bun "$O" verify    # resolve the credential and make one real call
```

| Tracker | `tracker.kind` | Credential |
| --- | --- | --- |
| A `tasks.md` / `TODO.md` file | `file` | none |
| Task folder with frontmatter files (e.g. Obsidian TaskNotes) | `tasknotes` | none |
| GitHub issues | `github` | `githubToken`, or none if the `gh` CLI is authenticated |
| Jira | `jira` | `jiraToken` (+ `tracker.email`) |
| Linear | `linear` | `linearToken` |

Credentials are stored as *references* — 1Password, an env var, a `.env` file, macOS Keychain, or a shell command — never as values. They resolve lazily, so `check` and `show` never trigger a password-manager prompt, and a resolved secret never reaches argv, logs, or stdout. Add `"cacheVar": "GITHUB_TOKEN"` to a reference and export that variable once per shell session to skip re-resolving (and re-prompting) in every one of the short-lived processes an orchestration spawns; nothing is cached to disk. Writing the local layer gitignores it for you, and `write` refuses any config with a token inlined.

Every supported key is documented in [`config.example.json`](skills/orchestrate/config.example.json).

### Measured

One eval (`skills/orchestrate/evals/`), three runs per configuration, on a synthetic launch-prep workspace seeded with an undecided pricing question, an unconfirmed acronym, and a feature that slipped a release:

| | With skill | Without |
| --- | --- | --- |
| Pass rate | **100%** | 50% |

The failures without the skill are the predictable ones: work stalls on the pricing decision instead of proceeding on a default, or the deliverables invent one.

### What's in the box

```
skills/orchestrate/
├── SKILL.md                        the orchestration loop — invariants, four phases, anti-patterns
├── references/
│   ├── agent-prompt.md             worker prompt scaffold + a worked example
│   └── question-protocol.md        folder layout, question template, writing rules
├── scripts/orchestrate-config.ts   ACS v1 config CLI
├── config.example.json             every supported key
└── evals/                          eval set + fixture workspace
```

## `/ml-subagents:herdr`

Run AI subagents in [herdr](https://herdr.dev) panes and drive the terminal workspace manager itself, from Claude Code. Start a subagent from a named preset, give it a task, read its answer, keep the conversation going, see which agents are running - plus rearranging the layout and managing git worktrees. No MCP server; it shells out to the `herdr` CLI you already have.

Requires the `herdr` binary on `PATH` and a running herdr server; the subagent runner also needs `bun`. Verified against herdr 0.7.3 (protocol 16), Claude Code 2.1, Codex 0.146, omp 4.

### What it does

Ask Claude to run another agent, or to move your terminal around, and it will:

- *"Run a subagent to review the uncommitted diff."*
- *"Ask the other Claude which fix it would do first."*
- *"Which agents are running, and is any of them stuck?"*
- *"Start Codex in a scratch directory and have it explain this stack trace."*
- *"Rename this session to backups."*
- *"Make a worktree for branch `feat/auth` and open it."*

### Running subagents

`skills/herdr/scripts/herdr-agent.ts` (bun) collapses the whole exchange into one command per step:

```bash
skills/herdr/scripts/herdr-agent.ts presets                     # configured subagents, and what is installed
skills/herdr/scripts/herdr-agent.ts start reviewer --prompt "…" # spawn, wait for boot, ask once, print the reply
skills/herdr/scripts/herdr-agent.ts ask rev "and then?"         # next turn, same context
skills/herdr/scripts/herdr-agent.ts running                     # who is alive, and their status
skills/herdr/scripts/herdr-agent.ts stop rev --force            # close the pane
```

Which agents exist is configuration, not a guessed command line. Presets live under `agents` in [agent config](../../standards/agent-config.md) (`~/.agents/config/herdr/config.json`, or the repo/local layers), each holding argv plus cwd, env, herdr session, pane placement, timeouts, and the TUI markers used to scrape replies. Eight are built in - claude, codex, omp, gemini, opencode, droid, copilot, cursor - so it works with no config file; `skills/herdr/config.example.json` shows how to override one or add a role such as `reviewer` or `scratch`.

### Why a skill and not just `herdr --help`

Three things go wrong when an agent drives herdr from the help text alone. The skill exists to prevent them.

**1. "Session" is overloaded, in both directions.** The labeled thing in the sidebar is a *workspace*; `herdr session` is a separate background server with its own socket and its own workspace tree. When a user says "rename this session" they nearly always mean the workspace. But sessions are real and plural too: `default` is frequently **stopped** while the work lives in named per-project sessions, and workspace `w1` in one session is unrelated to `w1` in another. Guess wrong in either direction and you rename the wrong thing or report a workspace as missing when it is one session over.

**2. Talking to an agent has four traps, and all four look like being ignored.** `herdr agent send` types text but does not press Enter. An Enter sent in the same breath is swallowed by the TUI's redraw. A status wait straight after submitting returns instantly, because the agent has not started working yet - so you read back the *previous* answer. And agents disagree on which status means finished: Claude Code lands on `idle`, Codex on `done`, either can stop at `blocked` to ask a question. The runner handles all four; the skill documents them for when you drive the raw verbs:

```bash
herdr agent send        <pane> "your question"
herdr pane send-keys    <pane> Enter
herdr wait agent-status <pane> --status idle --timeout 120000
herdr agent read        <pane> --lines 60 --format text
```

**3. Ids are opaque and easy to invent.** Workspaces are `w1`, tabs `w1:t1X`, panes `w1:p2M` - same colon, different letter, and the format has changed between versions. The skill's rule is to read ids from output, never construct them, and it ships a resolver for the label-to-id step.

### Layout

`SKILL.md` carries only the object model, the session trap, id rules, and the gotchas that cause damage. The verb lists load on demand, so a rename does not pull in the agent-messaging reference:

| File | Covers |
| --- | --- |
| `skills/herdr/references/workspaces.md` | workspace and worktree verbs; `create` vs `open`; which delete removes what |
| `skills/herdr/references/tabs-and-panes.md` | tab verbs; pane split, move, zoom, resize, swap, read, and the three input verbs |
| `skills/herdr/references/agents.md` | subagent presets and config; the one-shot runner; raw `agent` verbs; status semantics |
| `skills/herdr/references/sessions.md` | the literal session/server: list, attach, stop, `--session`, `--remote` |

Scripts: `skills/herdr/scripts/herdr-agent.ts` (subagents, needs `bun`), `skills/herdr/scripts/herdr_here.py` (label-to-id resolution).

### Resolving "current"

herdr sets `$HERDR_PANE_ID` in every pane, so the native call is exact even from a subdirectory:

```bash
herdr pane current --current
```

The bundled `skills/herdr/scripts/herdr_here.py` adds label-to-id lookup and a rename that defaults to the current object, which is the common request:

```bash
skills/herdr/scripts/herdr_here.py whoami                  # workspace + tab + pane + agent + cwd
skills/herdr/scripts/herdr_here.py resolve <label>         # label to workspace id, errors on ambiguity
skills/herdr/scripts/herdr_here.py rename backups          # renames the CURRENT workspace
skills/herdr/scripts/herdr_here.py rename api --what pane  # ...or the current tab / pane / agent
```

### Safety

Renames, focus and splits are reversible and the skill treats them as free. These are not, and it asks first:

| Command | Removes |
| --- | --- |
| `herdr worktree remove` | the git worktree **on disk**, uncommitted work included |
| `herdr workspace close` | the sidebar entry (leaves the worktree) |
| `herdr tab close` | every pane in the tab |
| `herdr pane close` | the process running in it, including a working agent |
| `herdr session stop/delete` | every agent in that session; `delete` removes the session |

## License

[MIT](LICENSE)
