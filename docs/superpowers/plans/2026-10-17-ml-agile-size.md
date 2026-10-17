# ml-agile `/ml-agile:size` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `ml-agile` plugin whose `size` skill calibrates reference stories,
sizes one story or sweeps a backlog by agent planning poker, and writes confirmed sizes to
Jira or GitHub.

**Architecture:** A prompt-only skill with no bundled code. `SKILL.md` is a short router: it
loads config with `agent-config start size`, picks the job and the tracker, then reads only the
matching files under `references/`. The trackers are reached through existing CLIs: the
`ml-workplace:atlassian` CLI for Jira, and `gh` for GitHub. Estimators are subagents, briefed
from the role files.

**Tech Stack:** Markdown skill files, agent-config declaration (ACS v2), `gh`, the `atlassian` CLI.

**Spec:** `docs/ml-agile-sizing-design.md`; issues #136 (parent), #137–#141.

## Global Constraints

- Plugin `ml-agile`, skill directory and frontmatter `name: size`, invoked `/ml-agile:size` (ADR 0001).
- Default scale Fibonacci `[1,2,3,5,8,13]`; alternatives `numbers` (custom list) and `tshirt` (ordered labels, default `["XS","S","M","L","XL"]`).
- Scale and reference stories are written to the **repo** layer, and can be overridden in user-repo or local.
- Nothing is written to a tracker without the user's confirmation; one confirmation per batch.
- Every sizing uses three estimators: `developer`, `tester`, `risk`. One re-vote on a split, then the user decides, with the middle value proposed.
- Defaults: `split.threshold` 13, `sweep.max` 20, `calibration.sample` 40, `calibration.staleDays` 90, `github.labelPrefix` `size:`.
- Config is changed only through `agent-config write`, never by editing files. `write` replaces a whole layer, so read the layer, merge the change, then write it.
- First release version `0.1.0`, in `plugin.json` and the marketplace entry alike.
- `bash scripts/validate-naming.sh` ends with `Naming is valid.`

## Review Focus

1. **A T-shirt scale.** "Middle value", the split threshold and labels must work on ordered labels, not arithmetic. Pinned in Task 4 (poker.md compares by position on the scale) and Task 1 (the `split.threshold` type is a string or a number).
2. **A Jira instance with no Story Points field found yet.** The first write must discover the field and save it as the Atlassian skill's `fields.points`, without overwriting that skill's other repo-layer keys. Pinned in Task 2.
3. **A GitHub token without `project` scope while `github.project` is set.** Writes fall back to labels with a warning instead of failing the batch. Pinned in Task 2.
4. **No reference stories, or too few closed stories to fill every scale value.** Single sizing must not size against nothing: calibration runs first, and empty values are reported as gaps rather than invented. Pinned in Task 3.
5. **A sweep filter matching more than `sweep.max` stories.** Size the first `sweep.max`, say how many remain, and offer the next batch. Pinned in Task 5.

---

### Task 1: Plugin scaffold, declaration, router (#137)

**Files:**
- Create: `plugins/ml-agile/.claude-plugin/plugin.json`, `plugins/ml-agile/LICENSE` (copy of `plugins/ml-repo/LICENSE`), `plugins/ml-agile/README.md`
- Create: `plugins/ml-agile/skills/size/SKILL.md`, `plugins/ml-agile/skills/size/agent-config.json`
- Modify: `.claude-plugin/marketplace.json` (append entry), `README.md` (Plugins table row)

**Interfaces:**
- Produces: config keys `tracker` (`auto|jira|github`), `scale.kind` (`fibonacci|numbers|tshirt`), `scale.values` (array of number or string), `referenceStories` (object: scale value → `{key,title,why}`, plus `calibratedAt` ISO date), `split.threshold` (number or string), `sweep.max`, `calibration.sample`, `calibration.staleDays` (integers), `github.project` (string, `""` means labels), `github.labelPrefix` (string). All are in the repo layer.
- Produces: the router contract that later tasks fill. SKILL.md names these files exactly: `references/calibrate.md`, `references/size-one.md`, `references/sweep.md`, `references/poker.md`, `references/roles/developer.md`, `references/roles/tester.md`, `references/roles/risk.md`, `references/tracker-jira.md`, `references/tracker-github.md`.

- [ ] **Step 1: Write the declaration** (`agent-config.json`, shape copied from `plugins/ml-workplace/skills/atlassian/agent-config.json`, keys above, every key has a default so a fresh repo is `ready: true`).
- [ ] **Step 2: Verify it** — `agent-config describe size --from plugins/ml-agile/skills/size` lists all ten keys, and `agent-config start size --from plugins/ml-agile/skills/size` prints `"ready": true` with `config.scale.values` equal to `[1,2,3,5,8,13]`.
- [ ] **Step 3: Write SKILL.md.** Include:
  - frontmatter with a trigger-rich description (story points, estimate, size, planning poker, refine backlog, Jira/GitHub);
  - "Start here" with the `$AC` lookup and `start` call, as the atlassian skill does;
  - job detection, with a one-line question when the request is ambiguous;
  - tracker resolution;
  - the load table;
  - the confirmation rule;
  - the stale-references nudge.

  Keep it under ~120 lines.
- [ ] **Step 4: plugin.json, LICENSE, README, marketplace entry, root README row.**
- [ ] **Step 5: Verify** — `bash scripts/validate-naming.sh` → `Naming is valid.`; `jq . .claude-plugin/marketplace.json >/dev/null`.
- [ ] **Step 6: Commit** `feat(ml-agile): plugin scaffold, size skill config and router (#137)`.

### Task 2: Tracker adapters (#138)

**Files:**
- Create: `plugins/ml-agile/skills/size/references/tracker-jira.md`, `plugins/ml-agile/skills/size/references/tracker-github.md`

**Interfaces:**
- Consumes: Task 1 config keys.
- Produces: both files expose the same five operations, under these exact headings, so the job files can say "the tracker's *Read one story*":
  1. `Read one story`
  2. `Find open unsized stories`
  3. `Find recently closed stories` (with linked-change evidence)
  4. `Write a size`
  5. `Create child stories`

- [ ] **Step 1: tracker-jira.md** — use `atlassian jira get/search/update/create/link`:
  - **Points field.** Find it with `atlassian jira fields --search point`. Save it as `fields.points` in the Atlassian skill's repo layer: read that layer (`agent-config path atlassian --layer repo`), merge, then `agent-config write atlassian --layer repo`.
  - **Unsized stories:** JQL `"Story Points" is EMPTY AND statusCategory != Done`, plus the user's filter.
  - **Linked changes:** `git log --all --grep <KEY>` and `gh pr list --state merged --search <KEY>`.
  - **Children:** `jira create --parent`, or `jira link` with "split from" where the issue type has no parent.
- [ ] **Step 2: tracker-github.md** — use `gh issue view/list`:
  - **Unsized issues:** search `-label:"size:*"` style filtering, done by listing labels.
  - **Linked PRs:** `gh pr list --search "closes #N"` and the timeline API.
  - **Writing a size:** `gh project item-edit` on the named Project's number field when `github.project` is set. Otherwise a `<labelPrefix><value>` label, created if missing and replacing any old one.
  - **Missing `project` scope:** detect it and fall back to labels with a warning.
  - **Children:** sub-issues via `gh api .../sub_issues`.
- [ ] **Step 3: Verify** — both files contain the five headings: `grep -c '^## \(Read one story\|Find open unsized stories\|Find recently closed stories\|Write a size\|Create child stories\)' <file>` → 5 each. Run the read-only commands against this repo (`gh issue view 136`, `gh issue list --state closed --limit 5`) to confirm the syntax.
- [ ] **Step 4: Commit** `feat(ml-agile): Jira and GitHub tracker adapters (#138)`.

### Task 3: Calibration (#139)

**Files:**
- Create: `plugins/ml-agile/skills/size/references/calibrate.md`

**Interfaces:**
- Consumes: the tracker's `Find recently closed stories`; config `calibration.sample`, `scale.values`.
- Produces: `referenceStories` written to the repo layer, `{ "<value>": {key,title,why}, "calibratedAt": "<ISO date>" }`.

- [ ] **Step 1: Write calibrate.md.**
  - Read closed stories in batches of 10. Keep a ≤3-line summary each: files and lines changed, days open, rework or scope signals from comments.
  - Rank the stories by effort and map them onto the scale.
  - Propose one per value, with a one-line why. Report values with no fitting story as gaps.
  - The user confirms or swaps each.
  - Write the result: read the repo layer, merge, then `agent-config write size --layer repo`.
  - A scale change triggers recalibration and leaves ticket sizes alone.
- [ ] **Step 2: Verify** by a dry run against this repo's closed GitHub issues, with no write. It should produce a proposal table and name any gaps.
- [ ] **Step 3: Commit** `feat(ml-agile): calibration of reference stories (#139)`.

### Task 4: Planning poker and single sizing (#140)

**Files:**
- Create: `plugins/ml-agile/skills/size/references/poker.md`, `references/roles/developer.md`, `references/roles/tester.md`, `references/roles/risk.md`, `references/size-one.md`

**Interfaces:**
- Consumes: the tracker's `Read one story` and `Write a size`; config `referenceStories`, `scale.values`.
- Produces: the poker procedure that returns `{ size, confidence: high|low, votes: {developer,tester,risk}, reasoning, missing: [] }`. `sweep.md` uses it unchanged.

- [ ] **Step 1: Role files.** Each is ≤25 lines. It says what that estimator looks at, and ends in the exact reply format: `SIZE: <value>` / `WHY: <2-3 lines>` / `MISSING: <comma list or none>`.
- [ ] **Step 2: poker.md.**
  - Launch three subagents in parallel. Each brief holds the story text, the reference-story entries, the scale and one role file. Do not include other votes.
  - Unanimous votes are the size, with high confidence.
  - Otherwise the outliers' WHY lines are shared, everyone re-votes once, and a split that remains goes to the user. The proposed value is the median **by position on the scale**, so it works for T-shirt labels too.
  - Confidence is low if the second round split, or two or more estimators listed MISSING items.
- [ ] **Step 3: size-one.md.**
  - Read the story, run poker, and show the size, the votes and the reasoning.
  - On confirmation, write the size.
  - A size at or above `split.threshold` (compared by scale position) gets a proposed split, created via `Create child stories` on confirmation.
- [ ] **Step 4: Verify** with a dry run: size one open issue of this repo end to end, stopping before the write.
- [ ] **Step 5: Commit** `feat(ml-agile): agent planning poker and single-story sizing (#140)`.

### Task 5: Backlog sweep (#141)

**Files:**
- Create: `plugins/ml-agile/skills/size/references/sweep.md`

**Interfaces:**
- Consumes: the tracker's `Find open unsized stories`, `Write a size` and `Create child stories`; `poker.md`; config `sweep.max`, `split.threshold`.

- [ ] **Step 1: Write sweep.md.**
  - Apply the user's filter.
  - Take the first `sweep.max` stories, report how many remain, and offer the next batch.
  - Poker each story; at most 3 stories run in parallel to bound concurrency.
  - Build one report table: key, title, size, confidence, missing, split proposal.
  - Get one confirmation listing every write and every new child story, then apply the writes.
- [ ] **Step 2: Verify** with a dry run on this repo's open issues, limited to 3, stopping at the confirmation.
- [ ] **Step 3: Commit** `feat(ml-agile): backlog sweep with refinement flags and splits (#141)`.

### Task 6: Evals and docs

**Files:**
- Create: `plugins/ml-agile/skills/size/evals/evals.json`
- Modify: `plugins/ml-agile/README.md`

- [ ] **Step 1: evals.json** in the atlassian skill's shape, with five prompts:
  1. size one key;
  2. sweep the backlog;
  3. recalibrate;
  4. switch to T-shirt sizes;
  5. a first run with no reference stories.

  Each has assertions on which reference files are loaded and that nothing is written before confirmation.
- [ ] **Step 2: Verify** — `jq . evals.json`; `bash scripts/validate-naming.sh`; every path named in SKILL.md exists: `grep -o 'references/[a-z/-]*\.md' SKILL.md | sort -u | xargs -I{} test -f plugins/ml-agile/skills/size/{}`.
- [ ] **Step 3: Commit** `docs(ml-agile): evals and README (#136)`.
