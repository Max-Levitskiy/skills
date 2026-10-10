# ml-repo

Whole-repository maintenance.

```bash
/plugin install ml-repo@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-repo:cleanup` | Find what is dead, duplicated, generated, stale or over-engineered in a repo, then remove and simplify it without changing behaviour, verified and shipped as reviewable PRs |

## `/ml-repo:cleanup`

Same behaviour, less and simpler code. Every change is safe: a removal of something nothing reaches, or a refactor a test covers, with the public surface and live state unchanged. It works on any stack, including infrastructure repos where a deleted block can destroy something live.

- *"Look at this repo with fresh eyes. What's bullshit here?"*
- *"Make it simpler: less code doing the same."*
- *"Improve the code quality, but don't break anything."*
- *"Get rid of the leftover scaffolding and old specs."*
- *"Clean it up and split it into PRs our review bots can handle."*

### What it does

**Three modes.** It infers the mode from the request: **audit** writes a ranked report and edits nothing, **cleanup** also commits verified edits on a branch, and **ship** also opens the PRs and merges them when asked.

**Inventories first.** A bundled script lists, per top-level directory, its size, last commit and commit count. It also flags tracked directories that look generated, groups of identical files copied across folders, CI triggers and infrastructure roots. Large wins usually show up here: a directory written by one installer commit and never touched again, or the same stub copied into five AI-tool folders.

**Audits in parallel slices.** One read-only subagent per area, each required to prove every claim of *dead* with evidence: an empty reference search that includes dynamic forms, a caller graph traced from the real entry points, tool output, and git history. Each finding is classed as:

| Class | Meaning |
| --- | --- |
| SAFE | Nothing reaches it and it holds no state |
| NEEDS-CARE | It holds live state or changes behaviour: a ticket, not a silent delete |
| BUG | Dead or masking code hiding a defect, reported first |

**Keeps live state untouched.** For infrastructure code, plans of main and the branch must show no resource changes. It also lists what dry runs cannot see (Ansible `--check` skips commands) and covers those gaps with targeted read-only runs.

**Ships reviewably.** A deletions-only mass-removal PR auto-merges, and one PR per area carries the edits for the review tools. A partition check proves the PRs cover the cleanup exactly once. Review-bot findings get triaged, merges are ordered around the deploys they trigger, and NEEDS-CARE items become tickets in the repo's tracker.
