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

Operate [Herdr](https://herdr.dev) by task: delegate or converse, find the correct
server, attach to a remote named session, navigate terminals, isolate work, coordinate
a bounded fleet, or diagnose state. The router loads one focused reference normally.
It includes advanced lookup for configuration, native plugins, API events and bridges.

Requires an installed Herdr CLI and the intended running server. Native command help,
server status and API schema were inspected on Herdr 0.9.3 (protocol 22). No live
100-agent capacity result is claimed.

### Native commands first

Create/select a shell location, then use managed start and prompt:

```bash
herdr --session <name> workspace create --cwd /path/to/repo --label review --no-focus
herdr --session <name> agent start reviewer --kind claude --pane <returned-pane-id>
herdr --session <name> agent prompt reviewer "Review and write /path/review.md" --wait --timeout 120000
herdr --session <name> agent read reviewer --source visible --lines 80
```

Done/idle/unknown are lifecycle observations; verify the current task's artifact.
A wait failure can follow delivered input, so inspect before retrying.

To use the full interactive UI:
`herdr --remote <authorized-ssh-target> --session <name>`.
For headless control use an existing `--machine <profile>` or execute the remote
CLI over authorized SSH. UI machine selection does not retarget a separate CLI.
WSL distributions are separate runtimes, using their own binaries, paths and sessions.

### Optional helpers and migration

`skills/herdr/scripts/herdr-agent.ts` keeps presets/running/start/ask/read/stop
and config check/show/path/write. Run with Bun or Node 24.12+; no runtime installation
is performed. It adds ACS named presets; native Herdr owns submission/readiness/waits.

```bash
bun skills/herdr/scripts/herdr-agent.ts presets --json
bun skills/herdr/scripts/herdr-agent.ts start reviewer --prompt "Review the diff"
bun skills/herdr/scripts/herdr-agent.ts ask reviewer "Explain the tradeoff" --json
bun skills/herdr/scripts/herdr-agent.ts read reviewer --lines 80 --max-chars 8192
bun skills/herdr/scripts/herdr-agent.ts stop reviewer --force
```

Changes from the older helper:

- Requires native managed start/prompt capabilities; unsupported targets fail before
  creating a location. No fallback to a different server or obsolete Enter retries.
- Default start creates a separate workspace. `--pane ID` reuses an existing shell;
  `--anchor-pane ID` splits a known pane. Workspace/tab placement remains supported.
- Replies are bounded rendered text with task_verified:false. Legacy screen-scraping
  markers remain accepted config fields but are unused; `--raw` remains accepted.
- Existing canonical command argv infer agent kind; arbitrary wrappers/path overrides
  need a supported explicit native workflow. Presets are configuration, not proof
  of installed/authenticated agents.
- Add `--session`, `--machine`, `--wsl` and `--herdr-bin` for explicit routing.
  Machine profiles already select a session. Stopped WSL targets are refused.
- Busy/unknown/blocked agents are inspected rather than automatically prompted.
  Ambiguous delivery errors retain observation/IDs; no blind resend occurs.

ACS config layers and preset command arrays are preserved. See
[config.example.json](skills/herdr/config.example.json). Config output redacts environment
values and credential references; it does not resolve secrets or log in to agents.

`skills/herdr/scripts/herdr_here.py` keeps whoami/list/resolve/rename and adds
explicit target scope. Labels/IDs resolve from inventory. Pane rename targets are
honored; external tab/pane identities use `--tab`/`--pane` or returned IDs.

### Validation and independent evaluation

Isolated entrypoint tests run against a temporary fake CLI/HOME; they do not alter
live Herdr or user config:

```bash
HERDR_TEST_NODE=/path/to/node python3 -m unittest discover -s skills/herdr/tests -p 'test_*.py'
node --test skills/herdr/tests/test_client.mjs
```

[evals/cases.json](skills/herdr/evals/cases.json) defines independent usability tasks.
Run them only on authorized targets and unique test-owned sessions, with bounded
time/output and recorded cleanup. Models, authentication, and live launch capability
must be checked separately. Existing work agents are not test workers.

## License

[MIT](LICENSE)
