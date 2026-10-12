# Upstream modifications: keep a modified copy of someone else's repo current

**Date:** 2026-10-12
**Status:** Approved, not yet implemented
**Scope:** new plugin `ml-upstream`, new standard `standards/upstream.md`, ADR 0002, the first
fork: `jasonku09/grill-with-ui` vendored into `plugins/ml-grilling/skills/grill-with-ui`

## Problem

`grill-with-ui` is installed as a symlink into a clone of `jasonku09/grill-with-ui`, with an
uncommitted change on top: serve the page on the Tailscale address and open it in the Mac's
browser when the agent runs on a remote box. Upstream has since moved 31 commits (`61eb282` →
`c8f699d`), rewriting the two files the change touches. Nothing records which upstream commit
the change was made against, what the change was *for*, or which files it touched, so bringing
it up to date means redoing it by hand, every time.

The same shape recurs for any repo worth modifying: a prompt-sized intent, a base commit, and
an upstream that keeps moving.

## Goal

A modified copy of any upstream repo or directory, where

- the modification is recorded as a prompt in the user's words, not as a patch;
- the base commit is recorded, so "what changed upstream since" is one command;
- an update applies upstream's changes that touch nothing the modification touched, and
  re-applies the modification where they overlap, stopping for the user only there;
- the whole thing is a plain directory, so it can sit inside another repo (a skill inside
  this marketplace) or be a repo of its own.

## Terms

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Upstream** | The repo the copy is taken from, at a URL and a ref. | Origin, source repo |
| **Target** | The directory holding the modified copy. Any directory: a skill dir inside a plugin, or a whole repo. | Fork (the GitHub feature), clone, vendor dir |
| **Base** | The upstream commit the target currently reflects. Every modification is applied on top of it. | Pinned version, snapshot |
| **Modification** | One intent, in the user's words, applied to the target. Numbered; later ones may depend on earlier ones. | Patch, override, customisation |
| **Claimed file** | A file a modification lists in its `files`. The modification owns the difference between upstream and target there. | Modified file, touched file |
| **Overlap** | Upstream changed a claimed file between base and the new ref. | Conflict (the git state is never reached) |
| **Drift** | A target file that differs from base and that no modification claims. | Dirty, uncommitted |

## The standard: Upstream Modification Standard (UMS v1), `standards/upstream.md`

A target carries a `.upstream/` folder. Everything outside it is either upstream's file at
base, or the result of a recorded modification. Nothing else.

```
.upstream/
├── upstream.json
└── modifications/
    ├── 01-remote-tailscale.md
    └── 02-<slug>.md
```

### `upstream.json`

```json
{
  "version": 1,
  "url": "https://github.com/jasonku09/grill-with-ui",
  "ref": "main",
  "base": "c8f699d3dd99eaf7af168e21acb355184a354f1b",
  "takenAt": "2026-10-12",
  "path": "",
  "exclude": [".github/", ".no-mistakes.yaml", "design/", "docs/demo.gif"]
}
```

- `version` — integer, `1`.
- `url` — anything `git clone` accepts.
- `ref` — branch or tag the target follows. `update` resolves it to a commit each time.
- `base` — full commit SHA of upstream the target reflects.
- `takenAt` — ISO date `base` was taken.
- `path` — subdirectory of upstream the target is a copy of; `""` for the whole repo.
- `exclude` — upstream paths (relative to `path`) never carried into the target. A trailing
  `/` means a directory. Typical: CI workflows, demo assets, the upstream's own tooling.

### `modifications/NN-<slug>.md`

```markdown
---
name: remote-tailscale
added: 2026-10-12
files: [server.mjs, SKILL.md, README.md]
---

## Modification

Run the skill on a remote Linux box with the browser on a Mac on the same tailnet. Serve the
page on the machine's Tailscale address instead of 127.0.0.1 and open it in the Mac's
default browser as soon as the server is up, on every start and resume. Keep the default
behaviour exactly as upstream when nothing is configured.

## Applied

- `server.mjs`: `GRILL_HOST` selects the bind address (`tailscale` resolves this machine's
  100.64.0.0/10 IPv4); `GRILL_OPEN` is a shell command run with the url once listening,
  detached, stdout dropped so the agent's event stream stays clean.
- `SKILL.md`: Start step 5 says "opened" instead of asking the user to open the url when
  `GRILL_OPEN` is set.
- `README.md`: "Running the agent on a remote machine" section.
```

- `NN` orders modifications; `update` re-applies them in order. `name` equals the slug.
- `files` — the claimed files, kept current by the skill after every apply.
- `## Modification` — the prompt, owned by the user. The skill never rewrites it.
- `## Applied` — written by the skill after each apply: per file, what the modification
  does there. It is the reference for the next re-apply, and the human-readable changelog.
  The exact diff is always recoverable as upstream-at-base vs target, so it is not stored.

### Rules

1. **Base is the only upstream state in the target.** Files equal upstream at base unless a
   modification claims them.
2. **A hand edit is drift until recorded.** `check` lists drift. The skill offers to record
   it as a new modification (prompt written from the diff, confirmed by the user) or revert
   it. Drift is never silently absorbed into an update.
3. **Excludes are not modifications.** Removing CI or assets is configuration in
   `upstream.json`, so a new upstream file under an excluded path is simply skipped.
4. **Updates stop only on overlap.** Clean files are applied and reported. On overlap the
   skill shows upstream's change, the modification's current form, and a proposed merge, and
   waits. (Decided 2026-10-12.)
5. **Intent is re-checked after the mechanics.** After files are merged, each modification's
   prompt is read against the updated target. Where upstream's *new* content contradicts the
   intent in a file the modification did not claim before (a new doc line saying "served on
   127.0.0.1"), the skill proposes extending the modification there; the user decides.
6. **Verification is upstream's own.** If the target has a test command (`package.json`
   scripts, a `test/` dir with a runner, `Makefile test`), the skill runs it after every
   apply and reports the result. No new tests are written for upstream code.
7. **Licence travels.** Upstream's licence file is never excluded.

## The skill: plugin `ml-upstream`, skill `fork`

Invoked as `/ml-upstream:fork`. One skill, four verbs; the verb is the first word.

| Invocation | Does |
| --- | --- |
| `fork <url> [--into <dir>] [--path <sub>] [--ref <ref>] — <modification>` | Clone upstream into the cache, copy `path` minus excludes into `dir` (default: basename of the repo under the cwd), propose excludes from what it sees (CI, large binaries), apply the modification, write `.upstream/`, run tests, print a one-screen summary. The modification may be omitted to vendor unchanged. |
| `fork add <dir> — <modification>` | Next `NN`, apply, write the file, refresh `files`, run tests. |
| `fork check <dir>` | Fetch; print commits `base..ref`, the per-file table, and drift. Writes nothing. |
| `fork update <dir> [--ref <ref>]` | The update flow below. `--ref` changes what the target follows from then on (a pinned commit → `main`). |

### Update flow

1. `scripts/classify.sh <dir>` fetches upstream into the cache, resolves `ref`, and prints
   one JSON line per file whose state is not "unchanged":

   ```json
   {"file":"server.mjs","upstream":"modified","target":"claimed","by":["remote-tailscale"]}
   {"file":"page.html","upstream":"modified","target":"same"}
   {"file":"docs/demo.gif","upstream":"added","target":"excluded"}
   {"file":"notes.md","upstream":"same","target":"drift"}
   ```

   `upstream` ∈ `same|modified|added|deleted`, `target` ∈ `same|claimed|drift|excluded`.
   It also prints a header line with the old and new commit and the commit count.
2. Clean (`modified|added` × `same`): copy upstream's new version. `deleted` × `same`: delete.
3. Overlap (`modified|deleted` × `claimed`): start from upstream's new version; re-apply
   each claiming modification in `NN` order from its prompt, using `## Applied` and the
   old diff as reference. Show the three forms, wait for approval, write on yes. On no, ask
   what to change and propose again; the file is not left half-merged.
4. Drift: report; do not update those files until recorded or reverted (rule 2).
5. Intent check (rule 5), proposals only.
6. Write `base`, `takenAt`; refresh each modification's `files` and `## Applied`.
7. Tests (rule 6).
8. Print the summary in the form the user approved:

   ```
   upstream 61eb282 → c8f699d, 31 commits
     page.html         changed upstream, unclaimed        → applied
     test/page.e2e.mjs changed upstream, unclaimed        → applied
     server.mjs        overlap with remote-tailscale      → merged (approved)
     SKILL.md          overlap with remote-tailscale      → merged (approved)
   tests: 14 passed
   ```

Order is mechanical first (steps 1–2 need no judgment), then judgment (3–5), then bookkeeping,
so a failed re-apply leaves clean files applied and the overlap untouched.

### Layout

```
plugins/ml-upstream/
├── .claude-plugin/plugin.json
├── README.md
└── skills/fork/
    ├── SKILL.md                 the verbs, the flow, the report format
    ├── references/
    │   └── reapply.md           how to re-apply a modification on a rewritten file
    └── scripts/
        └── classify.sh          bash + git + jq; cache under ~/.cache/ml-upstream/<host>/<owner>/<repo>
```

The cache is a bare clone per upstream; `classify.sh` fetches into it and reads trees with
`git show`/`git diff-tree`, never checking anything out. The base tree is always available
from the cache, so "target vs base" needs no stored copy.

## The first fork

Target `plugins/ml-grilling/skills/grill-with-ui/`, installed as `/ml-grilling:grill-with-ui`.
The ml-grilling hook already matches the prefixed name, so the questions rules load for it.

- Excludes: `.github/`, `.no-mistakes.yaml`, `design/`, `docs/demo.gif`. `LICENSE`, `README.md`,
  `docs/*.md`, `test/` stay.
- Modification 01 `remote-tailscale`: the prompt above; it is what today's uncommitted change
  in `~/git/github/grill-with-ui` does (`bindHost()`, `openUrl()`, `GRILL_HOST`, `GRILL_OPEN`).
- Configuration stays as environment variables (`~/.zshenv` already sets
  `GRILL_HOST=tailscale` and `GRILL_OPEN="ssh … mac open"`). Moving it to agent-config would
  widen the upstream diff; it can be modification 02 later.

### Proof

The fork is built the long way round, so the update flow is exercised on real history before
the skill is called done:

1. `fork` at `--ref 61eb282` with modification 01. Expected: identical to the current clone's
   working tree minus excludes.
2. `fork update` to `main` (`c8f699d`). Expected: clean copies for `page.html`, `test/*`,
   new files; overlap on `server.mjs` and `SKILL.md`, both re-applied and approved; `README.md`
   either clean or overlap depending on upstream's edits; `node --test test/server.test.mjs`
   green; the remote open still works end to end (serve on the Tailscale address, tab opens
   on the Mac).
3. `fork check` afterwards prints "up to date, no drift".

### Cleanup, after the proof

- Remove the `~/.agents/skills/grill-with-ui` symlink, so one copy exists.
- Reset `~/git/github/grill-with-ui` to `origin/main`, discarding the uncommitted edits the
  fork now carries. **Confirmed with the user before running.**
- The questions-skill hook list and `~/.zshenv` are unchanged.

## Repo housekeeping

- `.claude-plugin/marketplace.json`: entry for `ml-upstream` (0.1.0); `ml-grilling` to 0.2.0
  with `grill-with-ui` in its description. Same in both `plugin.json`s.
- `README.md`: plugin rows for `ml-upstream` and the new `ml-grilling` skill; Standards table
  row for UMS.
- `docs/adr/0002-vendored-forks-live-in-the-library.md`: why a modified upstream skill is
  vendored under its domain plugin with `.upstream/` rather than symlinked or kept as a
  GitHub fork.
- `bash scripts/validate-naming.sh` ends with `Naming is valid.`
- One PR, after the proof.

## Out of scope

- Pushing a modification upstream as a PR (the diff is recoverable; a later verb).
- Several upstreams in one target.
- Automatic, unattended updates (a schedule could call `fork check`; applying stays manual).
