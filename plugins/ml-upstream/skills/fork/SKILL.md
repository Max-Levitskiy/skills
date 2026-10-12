---
name: fork
description: Keep a modified copy of someone else's repo, or a directory of it, current. Vendors an upstream repo into a target with the user's changes recorded as prompts in .upstream/, reports what upstream changed since the base commit, and updates — applying clean upstream changes, re-applying the modifications where they overlap, and stopping only there. Use when the user wants to fork, vendor or copy a repo or skill "with a change", keep a vendored copy up to date, says "check upstream" or "update from upstream", wants to add a modification to a vendored copy, or asks what they changed versus upstream. Any target — a skill directory inside a plugin, or a whole repo.
---

# Upstream modifications

`$SKILL` is this skill's directory. `bash $SKILL/scripts/upstream.sh` does the mechanical half
(cache the upstream, classify every file); you do the judgment half. The record format and the
rules are the Upstream Modification Standard, `standards/upstream.md` in this marketplace;
the summary below is enough for the common case, and the standard settles anything it does not.

Words used below: the **upstream** is the repo being copied; the **target** is the directory
holding the copy; the **base** is the upstream commit the target reflects; a **modification**
is one intent in the user's words, applied on top of base; a modification **claims** the files
it changed; an **overlap** is upstream changing a claimed file; **drift** is a target change no
modification claims.

```
<target>/.upstream/
├── upstream.json                  url, ref, base, takenAt, path, exclude
└── modifications/NN-<slug>.md     frontmatter name/added/files; ## Modification (the user's); ## Applied (yours)
```

## Verbs

The first word after the skill name picks the verb; a `—` (or `--`, or a colon) separates the
modification text from the arguments.

| Invocation | Verb |
| --- | --- |
| `fork <url> [--into <dir>] [--path <sub>] [--ref <ref>] — <modification>` | [Fork](#fork) |
| `fork add <dir> — <modification>` | [Add](#add) |
| `fork check <dir>` | [Check](#check) |
| `fork update <dir> [--ref <ref>]` | [Update](#update) |

When the user names a target loosely ("the vendored grill-with-ui"), find it: the directory
holding `.upstream/upstream.json` whose name or `url` matches. Several or none: ask in one line.

## Reading the cache

Every verb starts with `cache=$(bash $SKILL/scripts/upstream.sh cache <url>)`, which prints a
bare clone's path (fetched just now). Read upstream with plain git on it; never check it out:

```sh
git -C "$cache" rev-parse "refs/heads/<ref>"            # resolve a branch (tags: refs/tags/<ref>)
git -C "$cache" log --oneline "<base>..<new>"           # what happened upstream
git -C "$cache" show "<new>:<prefix><file>"             # upstream's new version of one file
git -C "$cache" diff "<base>" "<new>" -- "<prefix><file>"   # upstream's change to it
git -C "$cache" show "<base>:<prefix><file>" | diff -u - "<target>/<file>"   # the modification's current form
git -C "$cache" archive "<new>" <path> | tar -x -C <dir> [--strip-components=<depth of path>]   # export a tree
```

`<prefix>` is `path` + `/`, or empty when `path` is `""`.

## Fork

1. `cache=$(bash $SKILL/scripts/upstream.sh cache <url>)`. The ref defaults to upstream's
   default branch: `git -C "$cache" symbolic-ref HEAD` → `refs/heads/<name>`. Resolve it to
   `new`.
2. The target defaults to `./<repo name>`. It must not exist, or must be empty. Export the tree
   (`git archive`, above) into it.
3. Propose excludes from what landed: `.github/`, other CI and bot config (`.gitlab-ci.yml`,
   `.no-mistakes.yaml`, `renovate.json`, `dependabot`), any file over 200 KB, directories
   that are plainly design records or demos (`design/`, `mockups/`, `docs/*.gif`). Show the
   list in one line and ask the user to confirm or edit it; never propose a licence file.
   Delete the excluded paths from the target.
4. Write `.upstream/upstream.json` (`version` 1, `url`, `ref`, `base` = `new`, `takenAt` =
   today, `path`, `exclude`).
5. If a modification was given: apply it as [Applying a modification](#applying-a-modification)
   describes, then write `.upstream/modifications/01-<slug>.md` with the user's text under
   `## Modification`, your per-file notes under `## Applied`, and `files` = every file you
   changed. The slug is two to four words from the intent, kebab-case.
6. Run the [tests](#tests).
7. Print the summary: target, upstream and `new` (short SHA), the excludes, the modification's
   files, the test result. One screen at most.

## Add

1. Read `.upstream/upstream.json` and the existing modifications. Apply the new one
   ([Applying a modification](#applying-a-modification)); a later modification may build on an
   earlier one's result.
2. Write `NN+1-<slug>.md` with `files` = the files this one changed (a file may be claimed by
   several modifications). Run the tests. Summary as for Fork.

## Check

1. `bash $SKILL/scripts/upstream.sh classify <dir> [--ref <ref>]`. The first line is the
   header (`base`, `new`, `commits`, `cache`); each further line is a file whose state is not
   unchanged: `upstream` ∈ `same|modified|added|deleted|none`, `target` ∈
   `same|claimed|drift|excluded`, `by` = the claiming modifications.
2. Print: the commit range and count, `git -C "$cache" log --oneline <base>..<new>` when it
   is twenty lines or fewer (otherwise the first ten and "… and N more"), then the per-file
   table in the [report format](#report), then drift as its own list. `commits` 0 and no lines:
   "up to date, no drift". Write nothing.

## Update

Mechanical first, judgment second, bookkeeping last: a re-apply that goes wrong leaves clean
files applied and the overlapping file untouched.

1. Classify as in Check and show the user the header and the table **before** writing, in
   one message. Then, in the same turn, continue: no approval is needed for the clean part.
2. **Clean** files — `modified` or `added` × `same`: write upstream's new version
   (`git show "<new>:<prefix><file>" > <target>/<file>`, creating directories). `deleted` ×
   `same`: delete the file and prune empty directories.
3. **Overlap** — `modified` or `deleted` × `claimed`: for each such file, follow
   `$SKILL/references/reapply.md` to produce the proposed merge. Then stop and show the user,
   per file: (a) upstream's change (`git diff <base> <new> -- <file>`, trimmed to the hunks
   that matter), (b) the modification's current form (base vs target diff), (c) the proposed
   file's diff against upstream's new version. Ask one question: apply this merge? On yes,
   write the file. On no, ask what to change, in one line, and propose again. The file is
   never left half-merged: either upstream's new version with the modification re-applied, or
   untouched. Several overlapping files may be shown in one message when the proposals are
   short; otherwise one file per message.
4. **Drift** — any × `drift`: report; do not touch those files. Offer, in one line, to record
   the drift as a new modification (you write a prompt from the diff and the user confirms it)
   or to revert it to base. Do either only when the user says so.
5. **Intent check**: for each modification, read its `## Modification` once more against the
   updated target as a whole, including files it never claimed. Look for upstream's new
   content that contradicts the intent: a literal the modification makes configurable now
   hardcoded in a new place, a doc line stating the behaviour the modification changes, a new
   code path that bypasses it. For each hit, propose the extension in one line per file; apply
   only what the user accepts, and add the file to that modification's `files`.
6. Bookkeeping: set `base` = `new` and `takenAt` = today in `upstream.json`; if `--ref` was
   given, set `ref` too. For each modification, refresh `files` and rewrite `## Applied` to
   describe its current form. `## Modification` is never edited.
7. Run the [tests](#tests).
8. Print the [report](#report).

## Applying a modification

A first apply works on files at base; a re-apply works on upstream's new version of a file.
Both follow `$SKILL/references/reapply.md`: read the intent, find every place in the target the
intent touches, change the least that satisfies it, keep upstream's defaults when nothing is
configured, and write `## Applied` as per-file notes a future re-apply can follow. Make the
change with the ordinary editing tools; do not shell out to `patch` with a stored diff, because
the diff is not the record — the prompt is.

## Tests

Detect the target's own test command and run it from the target directory: `package.json`
with a `test` script → `npm test` (or `bun test` when a `bun.lock` exists); `test/*.test.mjs`
or `*.test.js` with no package manager → `node --test <files>`; a `Makefile` with a `test`
target → `make test`; `pyproject.toml`/`pytest.ini` → `pytest`; `Cargo.toml` → `cargo test`;
`go.mod` → `go test ./...`. No command found: say so in the report. Report pass/fail with the
counts the runner prints. A failure after an update is a finding, not something to fix
quietly: name the test, then run the same command on a clean export of `new` in a temporary
directory to say whether upstream's own version passes (then the merge broke it) or fails too
(then upstream did).

## Report

```
upstream 61eb282 → c8f699d, 31 commits
  page.html              changed upstream, unclaimed             → applied
  test/server.test.mjs   changed upstream, unclaimed             → applied
  test/subagent.e2e.mjs  new upstream                            → added
  server.mjs             overlap with remote-tailscale           → merged (approved)
  SKILL.md               overlap with remote-tailscale           → merged (approved)
  docs/demo.gif          new upstream, excluded                  → skipped
  notes.md               drift (no modification claims it)      → left; record or revert?
tests: node --test — 14 passed
```

Group excluded files into one line when there are more than three ("7 files under excluded
paths → skipped"). After Fork or Add, the report lists the modification's files instead of the
upstream column.
