# ml-ship

Get a change landed.

```bash
/plugin install ml-ship@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-ship:pr-gate` | Validate a pull request end to end, triage what the review bots said, and merge it when you ask |

## `/ml-ship:pr-gate`

A pull request is a proposal. This turns it into a verdict backed by evidence, and acts on that verdict only when you say so.

- *"Is #1043 safe to merge?"*
- *"Why is this check red?"*
- *"Renovate bumped the worker image. Does that break anything?"*
- *"Address the review comments on this PR."*
- *"Merge it if nothing is broken."*

### What it does

**Reads the facts first.** One read-only pass collects what changed, whether it is mergeable, which checks are *required* rather than merely present, what is failing, the repo's squash and trailer settings, and which convention docs exist. A wall of green checkmarks is not the gate: only the checks named in the branch rules block a merge.

**Checks claims against artifacts.** A changelog line, a PR description and a bot's review comment are hypotheses written by someone with an interest in the change landing. The skill reads the published package, the migration SQL, the workflow file, and greps for the one API that changed at your call sites. When the artifact and the prose disagree, the artifact wins, and that disagreement is usually the most valuable thing in the report.

**Triages the agent reviewers.** Codex, Copilot, CodeRabbit and friends leave findings. Each one gets checked against the code and then one outcome:

| Outcome | When | Action |
| --- | --- | --- |
| Fix | True and inside this PR's scope | Fix it, reply `Fixed in <sha>`, resolve the thread |
| Decline | False, already handled, or against the repo's conventions | Reply with the reason and the evidence, resolve the thread |
| Escalate | True, but outside this PR or needing a product decision | Leave it open, report it to you |

Fixes go in one push, so CI runs once. Human review threads are reported, never resolved for the reviewer.

**Separates the three kinds of red.** A regression from this PR, a pre-existing or environmental failure, and a mess your own validation made are three different answers. The discriminating move is cheap: reproduce on the base branch. A failure that cannot be explained is reported as unexplained, even when a re-run went green.

**Validates in a throwaway worktree**, so a changed dependency tree never lands in your checkout, and runs the repo's own gates rather than invented ones.

**Merges only when asked.** "Validate this" and "is this safe?" are requests for a verdict. "Merge it" is authorization. The merge pins to the commit that was validated (`--match-head-commit`), uses the repo's merge method, and passes the trailers a release tool depends on, which GitHub's squash body would otherwise eat.

### Requirements

`gh` (authenticated), `git`, `python3`.

### Files

| Path | What is in it |
| --- | --- |
| `skills/pr-gate/scripts/pr-facts.sh` | The read-only fact pass: PR, mergeability, required vs advisory checks, failures, review threads with their IDs, merge conventions |
| `skills/pr-gate/references/verifying-changes.md` | Blast-radius technique per change class: dependency bumps, migrations, CI/infra, app code |
| `skills/pr-gate/references/diagnosing-ci.md` | Real logs out of a failed run, classifying failures, reproducing locally, fixing forward on a PR branch |
| `skills/pr-gate/references/review-comments.md` | Reading, replying to, resolving and hiding review comments by ID |
| `skills/pr-gate/references/merge-mechanics.md` | Required vs advisory checks, squash and trailer behaviour, race safety, auto-merge, stale branches |

## License

MIT
