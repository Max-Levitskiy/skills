# Upstream Modification Standard (UMS v1)

How a modified copy of someone else's repository, or of a directory in it, records where it came
from and what was changed, so that it can be brought up to date without redoing the changes
by hand.

Status: **active**. Applies to any directory in this marketplace that is a copy of an upstream
repo (a vendored skill under a plugin), and to any standalone repo kept this way. Canonical
implementation: [`plugins/ml-upstream`](../plugins/ml-upstream) (`/ml-upstream:fork`). First
target: [`plugins/ml-grilling/skills/grill-with-ui`](../plugins/ml-grilling/skills/grill-with-ui).

## Why this exists

A useful tool often needs one small change to fit: a different bind address, an extra flag, a
line in its prompt. A GitHub fork records the change as commits but not as an intent, so when
upstream rewrites the file the merge conflict says nothing about *why* the lines differ. A
patch file breaks on the first rewrite. A copy with the change applied and nothing recorded is
the common case and the worst: the next update is a diff of unknown provenance.

This standard records the intent as a prompt, the upstream commit the copy reflects, and
which files the intent touched. An update is then a mechanical question (what did upstream
change, what did we change) plus a judgment call only where the two meet.

## Terms

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Upstream** | The repo the copy is taken from, at a URL and a ref. | Origin, source repo |
| **Target** | The directory holding the modified copy. Any directory: a skill inside a plugin, or a whole repo. | Fork (the GitHub feature), clone, vendor dir |
| **Base** | The upstream commit the target currently reflects. Every modification is applied on top of it. | Pinned version, snapshot |
| **Modification** | One intent, in the user's words, applied to the target. Numbered; a later one may depend on an earlier one. | Patch, override, customisation |
| **Claimed file** | A file a modification lists in its `files`. The modification owns the difference between upstream and target there. | Modified file, touched file |
| **Overlap** | Upstream changed a claimed file between base and the new ref. | Conflict (the git state is never reached) |
| **Drift** | A target file that differs from base and that no modification claims. | Dirty, uncommitted |

## Layout

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

| Key | Meaning |
| --- | --- |
| `version` | Integer, `1`. |
| `url` | Anything `git clone` accepts. |
| `ref` | Branch or tag the target follows. Resolved to a commit at every check or update. A pinned SHA is allowed. |
| `base` | Full SHA of the upstream commit the target reflects. |
| `takenAt` | ISO date `base` was taken. |
| `path` | Subdirectory of upstream the target copies; `""` for the whole repo. Excludes and claimed files are relative to it. |
| `exclude` | Upstream paths never carried into the target. A trailing `/` means a directory. Typical: CI workflows, demo assets, upstream's own tooling. |

### `modifications/NN-<slug>.md`

```markdown
---
name: remote-tailscale
added: 2026-10-12
files: [server.mjs, SKILL.md, README.md]
---

## Modification

Run the skill on a remote Linux box with the browser on a Mac on the same tailnet. Serve the
page on the machine's Tailscale address instead of 127.0.0.1 and open it in the Mac's default
browser as soon as the server is up, on every start and resume. Keep the default behaviour
exactly as upstream when nothing is configured.

## Applied

- `server.mjs`: `GRILL_HOST` selects the bind address (`tailscale` resolves this machine's
  100.64.0.0/10 IPv4); `GRILL_OPEN` is a shell command run with the url once listening.
- `SKILL.md`: Start step 5 says "opened" instead of asking the user to open the url.
- `README.md`: "Running the agent on a remote machine" section.
```

- `NN` orders modifications (`01`, `02`, …); they are re-applied in that order. `name` equals
  the slug in the file name.
- `added` — ISO date the modification was first applied.
- `files` — the claimed files, as a **one-line YAML flow list** (`[a, dir/b]`; no quotes, so
  no commas or brackets in paths). The skill keeps it current after every apply.
- `## Modification` — the prompt, owned by the user. The skill never rewrites it. Write it
  for a reader who has the upstream in front of them and nothing else: what should be
  different, and what must stay the same.
- `## Applied` — written by the skill after each apply: per file, what the modification does
  there. It is the reference for the next re-apply and the human-readable changelog. The
  exact diff is always recoverable (upstream at base vs the target), so it is not stored.

## Rules

1. **Base is the only upstream state in the target.** A file equals upstream at base unless a
   modification claims it.
2. **A hand edit is drift until recorded.** A check lists drift. The user records it as a new
   modification (prompt written from the diff, confirmed by them) or reverts it. Drift is
   never silently absorbed into an update, and a drifted file is not updated until resolved.
3. **Excludes are not modifications.** Dropping CI or assets is configuration in
   `upstream.json`; a new upstream file under an excluded path is skipped without comment.
   A file present in the target under an excluded path is drift.
4. **Updates stop only on overlap.** Clean files (changed upstream, unclaimed) are applied and
   reported. On overlap the skill shows upstream's change, the modification's current form,
   and a proposed merge, and waits for a yes before writing that file.
5. **Intent is re-checked after the mechanics.** Once files are merged, each modification's
   prompt is read against the updated target. Where upstream's *new* content contradicts the
   intent in a file the modification did not claim before (a new doc line saying "served on
   127.0.0.1", a new code path hardcoding what the modification makes configurable), the
   skill proposes extending the modification there; the user decides.
6. **Verification is upstream's own.** If the target has a test command, it runs after every
   apply and the result is reported. The skill writes no tests for upstream code; a test that
   fails after an update is reported with a note on whether upstream's own version passes.
7. **Licence travels.** Upstream's licence file is never excluded.

## What a check reports

For every file whose state is not unchanged: what upstream did between base and ref
(`modified`, `added`, `deleted`, or `none` when upstream never had it) and what the target
holds (`same` as base, `claimed` by named modifications, `drift`, or `excluded` and absent).
The combinations and what an update does with them:

| upstream × target | Meaning | Update |
| --- | --- | --- |
| `modified`/`added` × `same` | clean | copy upstream's new version |
| `deleted` × `same` | clean | delete |
| `modified`/`deleted` × `claimed` | overlap | re-apply the modification on upstream's new version; show; wait |
| any × `drift` | drift | report; leave the file |
| any × `excluded` | skipped | nothing |
| `none` × `drift` | a file upstream never had | report as drift |

## Relation to other standards

A target's own configuration, if it has any, follows the
[Agent Config Standard](agent-config.md) like any other component; UMS says nothing about
settings. The `.upstream/` folder is committed wherever the target is committed.
