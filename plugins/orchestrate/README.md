# orchestrate

Hand Claude a multi-part task, walk away, come back to finished work and a short list of decisions only you could have made.

```bash
/plugin install orchestrate@max-skills
```

## What it does

One parent task becomes small work packages run by parallel subagents. Every decision that genuinely needs you becomes a one-page question document with a stated default — and the work continues on that default. Nothing waits for you.

- *"Split the launch-readiness task across agents while I'm out."*
- *"Work through this migration mostly autonomously — ask me when you need a decision, but don't block."*
- *"Collect questions for me and keep going."*

It works on documents and prep material as readily as on code: the unit is a deliverable file, not a commit.

## The five invariants

Everything else adapts to the project. These don't:

| | Invariant | Why |
| --- | --- | --- |
| 1 | One package = one agent = one output file | No merge conflicts, no racing writes, trivial verification |
| 2 | Packages finish without a human | A package that must pause for an answer was cut wrong |
| 3 | Never block | Human-only decision → question doc + default + keep going |
| 4 | Only the orchestrator edits shared state | Two agents appending to one index is the classic race |
| 5 | Verify on disk before closing | Agents report success for files that are wrong, partial, or clobbered |

## The question protocol

The part that makes async work actually async. Each question is one small file:

- **plain language** — you may answer days later, on a phone, with no context loaded. Every project term is explained on first use.
- **a real default, not a shrug** — the option the evidence supports, plus what changes if you pick differently ("switching is a two-minute edit: delete one table column").
- **what's blocked, and what continues anyway** — usually nothing is blocked, which is what lets you answer slowly.

One line back is enough. If your answer matches the default, nothing needs redoing.

## Configuration

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

## Measured

One eval (`skills/orchestrate/evals/`), three runs per configuration, on a synthetic launch-prep workspace seeded with an undecided pricing question, an unconfirmed acronym, and a feature that slipped a release:

| | With skill | Without |
| --- | --- | --- |
| Pass rate | **100%** | 50% |

The failures without the skill are the predictable ones: work stalls on the pricing decision instead of proceeding on a default, or the deliverables invent one.

## What's in the box

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

## License

[MIT](LICENSE)
