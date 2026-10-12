# Upstream Modifications (`ml-upstream:fork`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standard and a skill that keep a modified copy of an upstream repo current, proven by vendoring `jasonku09/grill-with-ui` into `ml-grilling` with the remote-Tailscale modification and updating it across 31 upstream commits.

**Architecture:** A bash helper (`upstream.sh`) owns the mechanical part: a bare-clone cache per upstream and a per-file classification (what upstream changed between base and ref × what the target changed against base, and which modification claims it). The skill `fork` reads that classification and does the judgment: copy clean files, re-apply modifications on overlaps from their recorded prompts, stop for the user only there. The record is a `.upstream/` folder in the target (`upstream.json` + one markdown file per modification), specified in `standards/upstream.md`. The first target is built at the old base and then updated, so the update path is exercised on real history before anything ships.

**Tech Stack:** bash, git, jq (the helper and its test), Node 20+ (upstream's own tests: `node --test`), Claude Code plugin layout (`plugin.json`, `skills/<name>/SKILL.md`), Tailscale + `ssh mac open` for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-10-12-upstream-fork-design.md`

## Global Constraints

- Plugin `ml-upstream`, skill `fork`, invoked as `/ml-upstream:fork`; plugin directory = marketplace `name` = `plugin.json` `name`; skill frontmatter `name: fork`, bare. `bash scripts/validate-naming.sh` must end with `Naming is valid.`
- The record folder is `.upstream/` holding `upstream.json` (`version` 1, `url`, `ref`, `base` full SHA, `takenAt` ISO date, `path`, `exclude`) and `modifications/NN-<slug>.md` (frontmatter `name`, `added`, `files`; sections `## Modification` and `## Applied`). `## Modification` is the user's and is never rewritten by the skill.
- Everything outside `.upstream/` is upstream's file at base or the result of a recorded modification. A hand edit no modification claims is drift and is reported, never absorbed.
- `update` applies clean files and reports; it stops only on overlap (upstream changed a claimed file) and shows upstream's change, the modification's current form, and a proposed merge before writing.
- `exclude` entries are paths relative to `path`; a trailing `/` means a directory. Upstream's licence file is never excluded.
- Verification is upstream's own test command; the skill writes no tests for upstream code.
- The helper caches bare clones under `~/.cache/ml-upstream/<host>/<owner>/<repo>.git`; `ML_UPSTREAM_CACHE` overrides the root (tests use it).
- The spec names the helper `classify.sh`; it is `upstream.sh` here because it also owns the `cache` verb that `fork` needs before any classification exists. Same responsibility, one more entry point.
- First target: `plugins/ml-grilling/skills/grill-with-ui/`, upstream `https://github.com/jasonku09/grill-with-ui`, excludes `.github/`, `.no-mistakes.yaml`, `design/`, `docs/demo.gif`. Built at `61eb282bdbc79ff73451f309979c46175664052d`, updated to `main` (`c8f699d3dd99eaf7af168e21acb355184a354f1b` at the time of writing; use whatever `main` resolves to, and record it).
- `GRILL_HOST` / `GRILL_OPEN` stay environment variables. `~/.zshenv` already sets them; do not touch it.
- Versions: `ml-upstream` 0.1.0; `ml-grilling` 0.1.0 → 0.2.0 in both `plugin.json` and `marketplace.json`.
- Commit messages: gitmoji + conventional type, e.g. `✨ feat(ml-upstream): …`, each ending with the line `Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS`.
- Work on the current worktree branch `worktree/clear-forest-f11a`; one PR at the end.
- Destructive steps outside this repo (removing the `~/.agents/skills/grill-with-ui` symlink, resetting `~/git/github/grill-with-ui`) are confirmed with the user in the terminal before running, per the spec.

## Review Focus

Inputs the spec implies but no test would otherwise pin; each has a test in the task that owns it.

1. A target file upstream never had (`upstream: none`) must be reported as drift, not silently kept — Task 1 test (`notes.md`).
2. Upstream deleting a claimed file is an overlap, not a deletion: `deleted` × `claimed` — Task 1 test (`d.txt`).
3. A file under an excluded path that exists in the target anyway is drift, while the same path absent from the target is `excluded` — Task 1 test (`ci/x.yml` vs `ci/keep.yml`).
4. A ref that does not exist upstream (typo, deleted branch) exits non-zero with a one-line message and prints no header — Task 1 test.
5. After the update, a browser on the Tailscale address must still be able to Send: upstream's new `Origin` check only knows `127.0.0.1` and `localhost`, so the re-applied modification must add the bound host to `selfOrigins` — Task 5 curl check with an `Origin` header.

## File map

| Path | Responsibility | Task |
| --- | --- | --- |
| `plugins/ml-upstream/skills/fork/scripts/upstream.sh` | cache a bare clone; classify a target against upstream | 1 |
| `plugins/ml-upstream/skills/fork/scripts/upstream.test.sh` | fixture upstream repo + target; asserts the classification | 1 |
| `standards/upstream.md` | Upstream Modification Standard v1 | 2 |
| `plugins/ml-upstream/.claude-plugin/plugin.json`, `plugins/ml-upstream/README.md` | plugin manifest and page | 3 |
| `plugins/ml-upstream/skills/fork/SKILL.md` | the verbs, the update flow, the report | 3 |
| `plugins/ml-upstream/skills/fork/references/reapply.md` | how to re-apply a modification on a rewritten file | 3 |
| `.claude-plugin/marketplace.json` | `ml-upstream` entry; `ml-grilling` 0.2.0 | 3, 6 |
| `plugins/ml-grilling/skills/grill-with-ui/` | the first target, at 61eb282 | 4 |
| same, at `main` | the proof: `update` | 5 |
| `plugins/ml-grilling/.claude-plugin/plugin.json`, `README.md`, `docs/adr/0002-vendored-upstream-copies.md` | housekeeping | 6 |

---

### Task 1: `upstream.sh` — cache and classify

**Files:**
- Create: `plugins/ml-upstream/skills/fork/scripts/upstream.sh`
- Create: `plugins/ml-upstream/skills/fork/scripts/upstream.test.sh`

**Interfaces:**
- Produces: `upstream.sh cache <url>` → prints the bare clone's path after fetching (`refs/heads/*`, `refs/tags/*`); exit 2 on clone/fetch failure.
- Produces: `upstream.sh classify <target> [--ref REF]` → stdout line 1 is a header `{"type":"header","url","ref","base","new","commits","cache"}`; then one line per file whose state is not unchanged: `{"file","upstream":"same|modified|added|deleted|none","target":"same|claimed|drift|excluded","by":[names]}` (`by` only when claimed). Exit 2 with `upstream: <message>` on stderr when the target has no `.upstream/upstream.json`, the ref does not resolve, or `base` is not in upstream.
- Later tasks read the cache with plain git: `git -C "$cache" show "$new:$prefix$file"`, `git -C "$cache" diff "$base" "$new" -- "$prefix$file"`, `git -C "$cache" archive "$new" [path]`.

- [ ] **Step 1: Write the failing test**

`plugins/ml-upstream/skills/fork/scripts/upstream.test.sh`:

```bash
#!/usr/bin/env bash
# Builds a throwaway upstream repo and a target, then checks upstream.sh's classification.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SUT="$HERE/upstream.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export ML_UPSTREAM_CACHE="$TMP/cache"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fail=0
check() { # check <description> <jq filter over the classification lines> <expected>
  local got; got=$(jq -c "$2" "$OUT" | paste -sd, -)
  if [[ "$got" == "$3" ]]; then echo "✓ $1"; else echo "✗ $1"; echo "    want: $3"; echo "    got:  $got"; fail=1; fi
}

# ---- upstream: v1 then v2 ----
UP="$TMP/upstream"; mkdir -p "$UP/ci" "$UP/pkg"; cd "$UP"; git init -q -b main
printf 'a1\n' > a.txt; printf 'b1\n' > b.txt; printf 'd1\n' > d.txt; printf 'MIT\n' > LICENSE
printf 'ci1\n' > ci/x.yml; printf 'keep\n' > ci/keep.yml; printf 'p1\n' > pkg/inner.txt
git add -A; git commit -qm v1; V1=$(git rev-parse HEAD); git tag v1
printf 'a2\n' > a.txt; printf 'b2\n' > b.txt; printf 'c2\n' > c.txt; git rm -q d.txt
printf 'ci2\n' > ci/x.yml; printf 'p2\n' > pkg/inner.txt
git add -A; git commit -qm v2; V2=$(git rev-parse HEAD)

# ---- target: v1 minus ci/, with one modification claiming b.txt and d.txt, plus drift ----
TG="$TMP/target"; mkdir -p "$TG/.upstream/modifications" "$TG/ci"
for f in a.txt b.txt d.txt LICENSE; do cp "$UP/$f" "$TG/$f"; done
git -C "$UP" show "$V1:ci/x.yml" > "$TG/ci/x.yml"          # kept under an excluded path: drift
printf 'b1\nmine\n' > "$TG/b.txt"; printf 'd1\nmine\n' > "$TG/d.txt"; printf 'notes\n' > "$TG/notes.md"
jq -n --arg url "$UP" --arg base "$V1" '{version:1,url:$url,ref:"main",base:$base,takenAt:"2026-10-12",path:"",exclude:["ci/"]}' > "$TG/.upstream/upstream.json"
cat > "$TG/.upstream/modifications/01-mine.md" <<'EOF'
---
name: mine
added: 2026-10-12
files: [b.txt, d.txt]
---

## Modification

Append "mine" to b and d.

## Applied

- b.txt, d.txt: one line appended.
EOF

# ---- classify ----
OUT="$TMP/out.jsonl"
bash "$SUT" classify "$TG" > "$OUT"
jq -c --arg v1 "$V1" --arg v2 "$V2" 'select(.type=="header") | [.base==$v1, .new==$v2, .commits, .ref]' "$OUT" | grep -qx '\[true,true,1,"main"\]' && echo "✓ header" || { echo "✗ header: $(head -1 "$OUT")"; fail=1; }
check "a.txt clean"              'select(.file=="a.txt")    | [.upstream,.target]'     '["modified","same"]'
check "b.txt overlap"            'select(.file=="b.txt")    | [.upstream,.target,.by]' '["modified","claimed",["mine"]]'
check "c.txt new"                'select(.file=="c.txt")    | [.upstream,.target]'     '["added","same"]'
check "d.txt deleted but claimed" 'select(.file=="d.txt")   | [.upstream,.target,.by]' '["deleted","claimed",["mine"]]'
check "ci/x.yml excluded yet present = drift" 'select(.file=="ci/x.yml") | [.upstream,.target]' '["modified","drift"]'
check "ci/keep.yml excluded, absent, unchanged: not listed" 'select(.file=="ci/keep.yml")' ''
check "notes.md drift"           'select(.file=="notes.md") | [.upstream,.target]'     '["none","drift"]'
check "LICENSE unchanged: not listed" 'select(.file=="LICENSE")' ''
check "pkg/inner.txt clean"      'select(.file=="pkg/inner.txt") | [.upstream,.target]' '["modified","same"]'

# ---- --ref overrides upstream.json ----
bash "$SUT" classify "$TG" --ref v1 > "$OUT"
check "--ref v1: no commits" 'select(.type=="header") | .commits' '0'
check "--ref v1: only target-side lines" '[select(.type!="header") | .file] | sort' '["b.txt","ci/x.yml","d.txt","notes.md"]'

# ---- path: a subdirectory of upstream ----
TP="$TMP/target-path"; mkdir -p "$TP/.upstream"; git -C "$UP" show "$V1:pkg/inner.txt" > "$TP/inner.txt"
jq -n --arg url "$UP" --arg base "$V1" '{version:1,url:$url,ref:"main",base:$base,takenAt:"2026-10-12",path:"pkg",exclude:[]}' > "$TP/.upstream/upstream.json"
bash "$SUT" classify "$TP" > "$OUT"
check "path: inner.txt listed without the prefix" '[select(.type!="header") | .file]' '["inner.txt"]'
check "path: inner.txt clean" 'select(.file=="inner.txt") | [.upstream,.target]' '["modified","same"]'

# ---- failures ----
if bash "$SUT" classify "$TG" --ref no-such-branch > "$OUT" 2> "$TMP/err"; then echo "✗ bad ref should fail"; fail=1
else grep -q "ref not found upstream: no-such-branch" "$TMP/err" && [[ ! -s "$OUT" ]] && echo "✓ bad ref: exit non-zero, no header" || { echo "✗ bad ref message: $(cat "$TMP/err")"; fail=1; }; fi
if bash "$SUT" classify "$TMP" > /dev/null 2> "$TMP/err"; then echo "✗ missing upstream.json should fail"; fail=1
else grep -q "no .upstream/upstream.json" "$TMP/err" && echo "✓ missing upstream.json" || { echo "✗ missing upstream.json message: $(cat "$TMP/err")"; fail=1; }; fi

# ---- cache verb ----
C1=$(bash "$SUT" cache "$UP"); C2=$(bash "$SUT" cache "$UP")
[[ "$C1" == "$C2" && -d "$C1" && "$C1" == "$ML_UPSTREAM_CACHE"/local/* ]] && echo "✓ cache: stable path under ML_UPSTREAM_CACHE/local" || { echo "✗ cache: $C1 / $C2"; fail=1; }
git -C "$C1" rev-parse --verify -q refs/tags/v1 >/dev/null && echo "✓ cache: tags fetched" || { echo "✗ cache: tag v1 missing"; fail=1; }

[[ $fail -eq 0 ]] && echo "all passed" || { echo "FAILED"; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash plugins/ml-upstream/skills/fork/scripts/upstream.test.sh`
Expected: fails immediately (`upstream.sh: No such file or directory`) under `set -e`.

- [ ] **Step 3: Write `upstream.sh`**

```bash
#!/usr/bin/env bash
# ml-upstream helper: the mechanical half of keeping a modified upstream copy current.
#
#   upstream.sh cache    <url>                     bare-clone <url> into the cache (or fetch it) and print the clone's path
#   upstream.sh classify <target> [--ref REF]      header line, then one JSON line per file whose state is not unchanged:
#                                                  {"file","upstream":same|modified|added|deleted|none,
#                                                   "target":same|claimed|drift|excluded,"by":[modification names]}
#
# Cache root: $ML_UPSTREAM_CACHE, default ~/.cache/ml-upstream. Needs git and jq.
set -euo pipefail

die() { echo "upstream: $*" >&2; exit 2; }
command -v git >/dev/null || die "git is required"
command -v jq  >/dev/null || die "jq is required"
CACHE_ROOT="${ML_UPSTREAM_CACHE:-$HOME/.cache/ml-upstream}"

# <host>/<owner>/<repo>.git for a URL; local/<abs path>.git for a path.
cache_dir() {
  local url="$1" key
  if   [[ "$url" =~ ^[a-z+]+://([^/@]+@)?([^/:]+)(:[0-9]+)?/(.+)$ ]]; then key="${BASH_REMATCH[2]}/${BASH_REMATCH[4]}"
  elif [[ "$url" =~ ^[^@/]+@([^:]+):(.+)$ ]]; then key="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else key="local$(realpath "$url")"; fi
  key="${key%/}"; key="${key%.git}"
  echo "$CACHE_ROOT/$key.git"
}

cmd_cache() {
  local url="${1:-}"; [[ -n "$url" ]] || die "usage: upstream.sh cache <url>"
  local dir; dir=$(cache_dir "$url")
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$(dirname "$dir")"
    git clone --quiet --bare "$url" "$dir" >&2 || die "clone failed: $url"
  fi
  # A bare clone has no fetch refspec, so name the refs; tags too, so a tag can be a ref.
  git -C "$dir" fetch --quiet --prune "$url" '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*' >&2 || die "fetch failed: $url"
  echo "$dir"
}

# Branch, then tag, then anything rev-parse accepts (a SHA).
resolve() {
  git -C "$1" rev-parse --verify --quiet "refs/heads/$2^{commit}" \
    || git -C "$1" rev-parse --verify --quiet "refs/tags/$2^{commit}" \
    || git -C "$1" rev-parse --verify --quiet "$2^{commit}" \
    || die "ref not found upstream: $2"
}

# {"<file>":["<modification name>",...]} from every modifications/NN-*.md, in NN order.
# `files:` is a YAML flow list on one line: files: [a.txt, dir/b.txt]
claims_json() {
  local out="{}" m name list f
  for m in "$1"/.upstream/modifications/*.md; do
    [[ -e "$m" ]] || continue
    name=$(awk '/^---[[:space:]]*$/ { n++; next } n == 1 && /^name:/ { sub(/^name:[[:space:]]*/, ""); print; exit }' "$m")
    list=$(awk '/^---[[:space:]]*$/ { n++; next } n == 1 && /^files:/ { sub(/^files:[[:space:]]*/, ""); print; exit }' "$m" \
      | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; /^$/d')
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      out=$(jq -c --arg f "$f" --arg n "$name" '.[$f] += [$n]' <<<"$out")
    done <<<"$list"
  done
  echo "$out"
}

excluded() {
  local f="$1" e
  for e in "${EXCLUDES[@]}"; do
    [[ -n "$e" ]] || continue
    if [[ "$e" == */ ]]; then [[ "$f" == "$e"* ]] && return 0; else [[ "$f" == "$e" ]] && return 0; fi
  done
  return 1
}

cmd_classify() {
  local target="" ref_override=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ref) [[ $# -ge 2 ]] || die "--ref needs a value"; ref_override="$2"; shift 2 ;;
      *) target="$1"; shift ;;
    esac
  done
  [[ -n "$target" && -f "$target/.upstream/upstream.json" ]] || die "no .upstream/upstream.json in ${target:-<target>}"
  target=$(realpath "$target")
  local cfg="$target/.upstream/upstream.json"
  local url ref base path prefix=""
  url=$(jq -r '.url' "$cfg"); base=$(jq -r '.base' "$cfg"); path=$(jq -r '.path // ""' "$cfg")
  ref=${ref_override:-$(jq -r '.ref' "$cfg")}
  path="${path%/}"; [[ -n "$path" ]] && prefix="$path/"
  mapfile -t EXCLUDES < <(jq -r '.exclude // [] | .[]' "$cfg")

  local cache new commits
  cache=$(cmd_cache "$url")
  new=$(resolve "$cache" "$ref")
  git -C "$cache" cat-file -e "$base^{commit}" 2>/dev/null || die "base $base is not a commit upstream"
  commits=$(git -C "$cache" rev-list --count "$base..$new")
  jq -cn --arg url "$url" --arg ref "$ref" --arg base "$base" --arg new "$new" --arg cache "$cache" --argjson commits "$commits" \
    '{type:"header",url:$url,ref:$ref,base:$base,new:$new,commits:$commits,cache:$cache}'

  local claims; claims=$(claims_json "$target")

  # Every path upstream had at base or has at new (under path), plus every file in the target.
  local files
  files=$(
    {
      {
        git -C "$cache" ls-tree -r --name-only "$base" ${path:+-- "$path"}
        git -C "$cache" ls-tree -r --name-only "$new"  ${path:+-- "$path"}
      } | { if [[ -n "$prefix" ]]; then sed "s#^$prefix##"; else cat; fi; }
      (cd "$target" && find . -type f ! -path './.upstream/*' ! -path './.git/*' | sed 's#^\./##')
    } | sort -u
  )

  local f b n t up tg by
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    b=$(git -C "$cache" rev-parse --verify --quiet "$base:$prefix$f" || true)
    n=$(git -C "$cache" rev-parse --verify --quiet "$new:$prefix$f"  || true)
    if [[ -f "$target/$f" ]]; then t=$(git hash-object "$target/$f"); else t=""; fi
    if   [[ -z "$b" && -z "$n" ]]; then up=none
    elif [[ -z "$b" ]];            then up=added
    elif [[ -z "$n" ]];            then up=deleted
    elif [[ "$b" == "$n" ]];       then up=same
    else                                up=modified; fi
    by=$(jq -c --arg f "$f" '.[$f] // []' <<<"$claims")
    if   [[ "$t" == "$b" ]];  then tg=same       # equal content, or absent on both sides
    elif [[ "$by" != "[]" ]]; then tg=claimed
    else                           tg=drift; fi
    # Under an excluded path: absent is the expected state; present is drift unless claimed (rule 3).
    if excluded "$f"; then
      if [[ -z "$t" ]]; then tg=excluded; elif [[ "$by" == "[]" ]]; then tg=drift; fi
    fi
    [[ "$up" == same && ( "$tg" == same || "$tg" == excluded ) ]] && continue
    jq -cn --arg f "$f" --arg up "$up" --arg tg "$tg" --argjson by "$by" \
      '{file:$f, upstream:$up, target:$tg} + (if $by != [] then {by:$by} else {} end)'
  done <<<"$files"
}

case "${1:-}" in
  cache)    shift; cmd_cache "$@" ;;
  classify) shift; cmd_classify "$@" ;;
  *) die "usage: upstream.sh cache <url> | classify <target> [--ref REF]" ;;
esac
```

Then `chmod +x plugins/ml-upstream/skills/fork/scripts/upstream.sh plugins/ml-upstream/skills/fork/scripts/upstream.test.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash plugins/ml-upstream/skills/fork/scripts/upstream.test.sh`
Expected: every line starts with `✓`, last line `all passed`. If `a.txt clean` prints `["modified","drift"]`, the fixture copied `a.txt` after modifying it; check the `cp` loop runs before the `printf` lines. If the header check fails on `commits`, the `fetch` refspec did not bring `main`: confirm the bare clone has `refs/heads/main` (`git -C <cache> show-ref`).

- [ ] **Step 5: Run it against the real upstream, read-only**

```bash
bash plugins/ml-upstream/skills/fork/scripts/upstream.sh cache https://github.com/jasonku09/grill-with-ui
git -C ~/.cache/ml-upstream/github.com/jasonku09/grill-with-ui.git rev-parse refs/heads/main
```

Expected: the path printed is `~/.cache/ml-upstream/github.com/jasonku09/grill-with-ui.git`; the second command prints a 40-hex SHA.

- [ ] **Step 6: Commit**

```bash
git add plugins/ml-upstream/skills/fork/scripts
git commit -m "$(cat <<'EOF'
✨ feat(ml-upstream): upstream.sh — bare-clone cache and per-file classification against base

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

---

### Task 2: The standard — `standards/upstream.md`

**Files:**
- Create: `standards/upstream.md`
- Modify: `README.md` (Standards table, after the Agent Config row)

**Interfaces:**
- Produces: the file formats and seven rules that `SKILL.md` (Task 3) summarises and links. The `files:` frontmatter must be a one-line YAML flow list, which is what `upstream.sh` parses.

- [ ] **Step 1: Write the standard**

`standards/upstream.md`:

````markdown
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
````

- [ ] **Step 2: Add the Standards table row in `README.md`**

After the Agent Config Standard row, add:

```markdown
| [Upstream Modification Standard](standards/upstream.md) | How a modified copy of someone else's repo records its upstream, base commit and each modification as a prompt in `.upstream/`, so it can be updated without redoing the changes by hand. Canonical implementation: [`ml-upstream`](plugins/ml-upstream). First target: [`grill-with-ui`](plugins/ml-grilling/skills/grill-with-ui). |
```

- [ ] **Step 3: Check the standard against the helper**

Run: `grep -c '' standards/upstream.md` and read the `files` paragraph once more against `claims_json` in `upstream.sh`: both say one-line flow list, no quotes. Confirm the table in "What a check reports" names exactly the states `upstream.sh` emits (`same|modified|added|deleted|none` and `same|claimed|drift|excluded`).

- [ ] **Step 4: Commit**

```bash
git add standards/upstream.md README.md
git commit -m "$(cat <<'EOF'
📝 docs(standards): Upstream Modification Standard v1 — .upstream/ records upstream, base and modifications as prompts

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

---

### Task 3: Plugin `ml-upstream` and skill `fork`

**Files:**
- Create: `plugins/ml-upstream/.claude-plugin/plugin.json`
- Create: `plugins/ml-upstream/README.md`
- Create: `plugins/ml-upstream/skills/fork/SKILL.md`
- Create: `plugins/ml-upstream/skills/fork/references/reapply.md`
- Modify: `.claude-plugin/marketplace.json` (append an entry)
- Modify: `README.md` (plugin table row)

**Interfaces:**
- Consumes: `upstream.sh cache|classify` from Task 1; the rules in `standards/upstream.md` from Task 2.
- Produces: the procedure Tasks 4 and 5 follow by hand.

- [ ] **Step 1: Write `plugin.json`**

```json
{
  "name": "ml-upstream",
  "description": "Keep a modified copy of someone else's repo current. fork vendors an upstream repo, or a directory of it, into a target with your changes recorded as prompts in .upstream/, reports what upstream changed since the base commit, applies the changes that touch nothing of yours, and re-applies your modifications where they overlap, stopping only there.",
  "version": "0.1.0",
  "license": "MIT",
  "author": {
    "name": "Max Levitskiy",
    "url": "https://github.com/Max-Levitskiy"
  },
  "homepage": "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-upstream",
  "keywords": [
    "fork",
    "vendoring",
    "upstream",
    "sync",
    "patch",
    "maintenance",
    "skills",
    "claude-skill"
  ]
}
```

- [ ] **Step 2: Write `plugins/ml-upstream/README.md`**

````markdown
# ml-upstream

Keep a modified copy of someone else's repo current.

```bash
/plugin install ml-upstream@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-upstream:fork <url> [--into <dir>] — <modification>` | Copy an upstream repo (or `--path` a directory of it) into a target, apply your modification, record both in `.upstream/` |
| `/ml-upstream:fork add <dir> — <modification>` | Apply and record one more modification |
| `/ml-upstream:fork check <dir>` | What upstream changed since the base commit, per file, and any drift. Writes nothing |
| `/ml-upstream:fork update <dir>` | Apply upstream's clean changes, re-apply your modifications where they overlap, stop only there |

## `/ml-upstream:fork`

A modification is a prompt in your words, not a patch. The target keeps the upstream URL, the
commit it reflects, and each modification with the files it touched, under `.upstream/`. An
update is then mechanical where upstream and you touched different files, and a judgment call,
shown to you before it is written, only where you both touched the same one.

- *"Fork grill-with-ui into ml-grilling; make it serve on the Tailscale address and open my Mac's browser."*
- *"Check upstream for the vendored grill-with-ui."*
- *"Update grill-with-ui from upstream."*
- *"Add a modification to the vendored copy: …"*
- *"What did we change in this copy compared to upstream?"*

The format and the rules are the [Upstream Modification Standard](../../standards/upstream.md).
Needs `git` and `jq`. Upstream clones are cached under `~/.cache/ml-upstream/`.
````

- [ ] **Step 3: Write `SKILL.md`**

`plugins/ml-upstream/skills/fork/SKILL.md`:

````markdown
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
````

- [ ] **Step 4: Write `references/reapply.md`**

`plugins/ml-upstream/skills/fork/references/reapply.md`:

````markdown
# Re-applying a modification on a rewritten file

You have: the modification's `## Modification` (the intent), its `## Applied` (what it did
last time, per file), upstream's change to this file (`git diff <base> <new> -- <file>`), the
modification's current form (`git show <base>:<file> | diff -u - <target>/<file>`), and
upstream's new version of the file. You produce one file: upstream's new version with the
intent satisfied.

## Order of work

1. **Read the intent first, the diffs second.** Decide what the modification must be true of
   in this file before looking at how it was done last time. The old diff shows *a* way, taken
   against code that no longer exists.
2. **Start from upstream's new version, whole.** Never start from the target's current file and
   try to pull upstream's hunks in; upstream's version is the one with 31 commits of fixes.
3. **Port each point of `## Applied` by meaning, not by line.** "`GRILL_HOST` selects the bind
   address" means: find where the new file chooses the address — possibly in a new helper,
   possibly in two places now — and make each one consult `GRILL_HOST`. If a hunk from the old
   diff applies cleanly and the surrounding code means the same thing, use it; otherwise
   rewrite it in the new file's idiom.
4. **Read the whole new file for the intent, not only the old hunks' neighbourhoods.**
   Upstream's new code often hardcodes, in a new place, the very thing the modification makes
   configurable: a second `127.0.0.1` literal in an origin check, a new log line printing the
   old URL, a new doc paragraph describing the old behaviour. Each such place is part of the
   re-apply, and goes into `## Applied`.
5. **Keep upstream's default when nothing is configured.** The modified file with every
   setting unset must behave exactly like upstream's new version. If the intent says otherwise,
   the intent wins, but say so in `## Applied`.
6. **Do not improve upstream.** A refactor you would like, a bug you spotted, a comment you
   would reword: not here. The smallest change that satisfies the intent keeps the next
   re-apply small too.

## What to show the user

Three things, per file, in this order, trimmed to what matters:

1. **upstream**: the hunks of upstream's change that touch or surround the modification.
2. **yours**: the modification's current form (base vs target), whole if under 40 lines.
3. **proposed**: the proposed file's diff against upstream's new version. This is what the
   modification now looks like; it should read like `yours` ported, plus any new place step 4
   found, each with a one-line reason.

Then one question: apply this merge? Nothing is written before the yes.

## Writing `## Applied`

One bullet per file. Each bullet names the mechanism (function, setting, section) and what it
does, in a sentence a reader can act on without the diff: "`serve` binds `GRILL_HOST`
(default `127.0.0.1`); `tailscale` resolves this machine's 100.64.0.0/10 address; the bound
host is added to `selfOrigins` so the page can Send from that address." Avoid line numbers and
avoid restating the diff.
````

- [ ] **Step 5: Register the plugin and add the README row**

Append to `.plugins` in `.claude-plugin/marketplace.json`:

```bash
tmp=$(mktemp)
jq --indent 2 '.plugins += [{
  "name": "ml-upstream",
  "source": "./plugins/ml-upstream",
  "description": "Keep a modified copy of someone else'"'"'s repo current. fork vendors an upstream repo, or a directory of it, into a target with your changes recorded as prompts in .upstream/, reports what upstream changed since the base commit, applies the changes that touch nothing of yours, and re-applies your modifications where they overlap, stopping only there.",
  "version": "0.1.0",
  "license": "MIT",
  "author": { "name": "Max Levitskiy" },
  "category": "development",
  "keywords": ["fork", "vendoring", "upstream", "sync", "patch", "maintenance", "skills", "claude-skill"]
}]' .claude-plugin/marketplace.json > "$tmp" && mv "$tmp" .claude-plugin/marketplace.json
```

In `README.md`, add a plugin table row after the `ml-agent-config` row:

```markdown
| [`ml-upstream`](plugins/ml-upstream) | `/ml-upstream:fork` | Keep a modified copy of someone else's repo current. Vendor an upstream repo or a directory of it with your changes recorded as prompts in `.upstream/`; check what upstream changed since; update by applying the clean changes and re-applying your modifications where they overlap, stopping only there. | `/plugin install ml-upstream@max-skills` |
```

- [ ] **Step 6: Validate naming and JSON**

Run: `bash scripts/validate-naming.sh && jq -e '.plugins[] | select(.name=="ml-upstream") | .version' .claude-plugin/marketplace.json`
Expected: a `✓ /ml-upstream:fork` line, `Naming is valid.`, then `"0.1.0"`.

- [ ] **Step 7: Commit**

```bash
git add plugins/ml-upstream .claude-plugin/marketplace.json README.md
git commit -m "$(cat <<'EOF'
✨ feat(ml-upstream): fork skill — vendor an upstream with modifications as prompts, check and update it

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

---

### Task 4: First target — `grill-with-ui` at 61eb282 with `remote-tailscale`

This task performs the `fork` verb by hand, exactly as `SKILL.md` describes, so the skill text is exercised while the modification is still a known quantity: at 61eb282 the applied form is today's uncommitted diff in `~/git/github/grill-with-ui`.

**Files:**
- Create: `plugins/ml-grilling/skills/grill-with-ui/` (upstream tree minus excludes, modified)
- Create: `plugins/ml-grilling/skills/grill-with-ui/.upstream/upstream.json`
- Create: `plugins/ml-grilling/skills/grill-with-ui/.upstream/modifications/01-remote-tailscale.md`

**Interfaces:**
- Consumes: `upstream.sh cache`; `~/git/github/grill-with-ui` working tree (the reference for the applied form).
- Produces: a target whose `classify` against `main` is Task 5's input.

- [ ] **Step 1: Export upstream at 61eb282**

```bash
cd /home/max/.herdr/worktrees/skills/worktree-clear-forest-f11a
cache=$(bash plugins/ml-upstream/skills/fork/scripts/upstream.sh cache https://github.com/jasonku09/grill-with-ui)
base=61eb282bdbc79ff73451f309979c46175664052d
T=plugins/ml-grilling/skills/grill-with-ui
mkdir -p "$T" && git -C "$cache" archive "$base" | tar -x -C "$T"
rm -rf "$T/design" "$T/.github" "$T/.no-mistakes.yaml" "$T/docs/demo.gif"   # the two last don't exist at 61eb282; rm -rf tolerates that
ls "$T"
```

Expected: `LICENSE README.md SKILL.md docs page.html server.mjs test visual-brief.md` plus `.gitignore`.

- [ ] **Step 2: Apply the modification**

The applied form at this base is known exactly: the uncommitted diff in the clone. Save it as a reference (not as the record), then make the same edits in the target. Using `patch` here is acceptable only because the target *is* at the diff's base; the skill itself edits by intent.

```bash
git -C /home/max/git/github/grill-with-ui diff > /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/mod01-at-61eb282.diff
(cd "$T" && patch -p1 < /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/mod01-at-61eb282.diff)
diff -r --exclude=.git --exclude=design --exclude=.upstream /home/max/git/github/grill-with-ui "$T" && echo IDENTICAL
```

Expected: `patching file README.md`, `… SKILL.md`, `… server.mjs`, then `IDENTICAL`.

- [ ] **Step 3: Write `.upstream/`**

```bash
mkdir -p "$T/.upstream/modifications"
jq -n --arg base "$base" '{version:1, url:"https://github.com/jasonku09/grill-with-ui", ref:"main", base:$base, takenAt:"2026-10-12", path:"", exclude:[".github/", ".no-mistakes.yaml", "design/", "docs/demo.gif"]}' > "$T/.upstream/upstream.json"
```

`ref` is `main` even though base is pinned behind it: that is the point of Task 5.

`$T/.upstream/modifications/01-remote-tailscale.md`:

```markdown
---
name: remote-tailscale
added: 2026-10-12
files: [server.mjs, SKILL.md, README.md]
---

## Modification

I run the agent on a remote Linux machine (WSL) and read the page on my Mac, both on the same
Tailscale network. Serve the grill page on the machine's Tailscale address instead of
127.0.0.1, and open it in the Mac's default browser automatically as soon as the server is
listening, on every start and resume, so I never have to copy a URL. Configuration is two
environment variables, `GRILL_HOST` (the address to bind, with `tailscale` meaning "this
machine's Tailscale IPv4") and `GRILL_OPEN` (a shell command run with the URL). With neither
set, behave exactly as upstream. Never bind `0.0.0.0` by default: the Send endpoint must not be
exposed beyond the tailnet. The skill text should say the page was opened rather than asking
the user to open it.

## Applied

- `server.mjs`: `bindHost()` reads `GRILL_HOST` (default `127.0.0.1`; `tailscale` resolves the
  first 100.64.0.0/10 IPv4 on any interface, dying with a message when there is none) and
  `serve` binds it and puts it in the url (IPv6 bracketed). `openUrl()` runs `GRILL_OPEN` with
  the url as `$1` once listening, detached, stdout dropped so the agent's event stream stays
  clean, errors to stderr. A header comment documents both variables.
- `SKILL.md`: Start step 5 adds "When `GRILL_OPEN` is set, `serve` has already opened the URL
  in the user's browser; say "opened" rather than asking them to open it."
- `README.md`: section "Running the agent on a remote machine" after the `GRILL_HOME` line,
  with the Tailscale + `ssh mac open` example and the warning against `0.0.0.0`.
```

- [ ] **Step 4: Run upstream's tests in the target, and classify against the pinned base**

```bash
(cd "$T" && node --test test/server.test.mjs 2>&1 | tail -8)
bash plugins/ml-upstream/skills/fork/scripts/upstream.sh classify "$T" --ref "$base"
```

Expected: `pass 9`, `fail 0`. The classify output is the header with `"commits":0` and exactly three lines, all `"upstream":"same","target":"claimed","by":["remote-tailscale"]` for `README.md`, `SKILL.md`, `server.mjs`. Any `drift` line means a file differs from base that the modification does not claim: fix `files` or the file.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-grilling/skills/grill-with-ui
git commit -m "$(cat <<'EOF'
✨ feat(ml-grilling): vendor grill-with-ui at 61eb282 with the remote-tailscale modification

Upstream jasonku09/grill-with-ui (MIT, LICENSE kept), recorded per standards/upstream.md.

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

---

### Task 5: The proof — `update` to `main`

This task performs the `update` verb by hand on real history. Expected classification (from `git diff --stat 61eb282 origin/main` taken on 2026-10-12; a newer `main` may add lines, which is fine):

| file | upstream | target |
| --- | --- | --- |
| `README.md`, `SKILL.md`, `server.mjs` | modified | claimed `[remote-tailscale]` |
| `page.html`, `visual-brief.md`, `docs/design.md`, `docs/visualize-design.md`, `test/server.test.mjs`, `test/page.e2e.mjs`, `test/manual-visual.e2e.mjs` | modified | same |
| `test/subagent-toggle.e2e.mjs` | added | same |
| `.github/dependabot.yml`, `.github/workflows/{ci,e2e,static}.yml`, `.no-mistakes.yaml`, `design/record-demo.mjs`, `docs/demo.gif` | added | excluded |

**Files:**
- Modify: everything under `plugins/ml-grilling/skills/grill-with-ui/` the table lists
- Modify: `plugins/ml-grilling/skills/grill-with-ui/.upstream/upstream.json` (`base`, `takenAt`)
- Modify: `plugins/ml-grilling/skills/grill-with-ui/.upstream/modifications/01-remote-tailscale.md` (`## Applied`; `files` if the intent check adds one)

**Interfaces:**
- Consumes: Task 4's target; `upstream.sh classify`; `references/reapply.md`.
- Produces: the target at `main`; evidence for the PR description.

- [ ] **Step 1: Classify and show the table**

```bash
T=plugins/ml-grilling/skills/grill-with-ui
bash plugins/ml-upstream/skills/fork/scripts/upstream.sh classify "$T" | tee /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/classify.jsonl
cache=$(jq -r 'select(.type=="header") | .cache' /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/classify.jsonl)
new=$(jq -r 'select(.type=="header") | .new' /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/classify.jsonl)
```

Expected: header `"base":"61eb282…"`, `"commits":31` (or more), and the lines in the table above. Print the table to the user in the report format before writing anything.

- [ ] **Step 2: Apply clean files**

```bash
jq -r 'select(.target=="same" and (.upstream=="modified" or .upstream=="added")) | .file' /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/classify.jsonl | while read -r f; do
  mkdir -p "$T/$(dirname "$f")"; git -C "$cache" show "$new:$f" > "$T/$f"; echo "applied $f"; done
jq -r 'select(.target=="same" and .upstream=="deleted") | .file' /tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/classify.jsonl | while read -r f; do rm "$T/$f"; echo "deleted $f"; done
```

Expected: eight `applied` lines (the seven modified + `test/subagent-toggle.e2e.mjs`), no `deleted`.

- [ ] **Step 3: Overlap — `server.mjs`**

Gather the three inputs:

```bash
git -C "$cache" diff 61eb282 "$new" -- server.mjs | grep -n "^[-+].*\(127.0.0.1\|listen(\|selfOrigins\|child_process\)"
git -C "$cache" show 61eb282:server.mjs | diff -u - "$T/server.mjs"
git -C "$cache" show "$new:server.mjs" > "$T/server.mjs"     # start from upstream's new version, whole
```

Then edit `$T/server.mjs` per `reapply.md`. The result, against upstream's new version:

1. Header comment, after the `// Files (per session folder)` block and before `import http`:

```js
//
// Remote use: GRILL_HOST sets the address `serve` binds and puts in the url (default 127.0.0.1;
// "tailscale" means this machine's Tailscale IPv4). GRILL_OPEN is a shell command that `serve`
// runs with the url as its last argument once it is listening, e.g. `ssh mac open`.
```

2. Import: `import { execFileSync } from "node:child_process";` → `import { execFileSync, spawn } from "node:child_process";`

3. In `cmdServe`, the port/listen block becomes (upstream's new `selfOrigins` line gains the bound host — the place step 4 of `reapply.md` exists for):

```js
  const explicit = o.port !== undefined && o.port !== true;
  let attempt = explicit ? Number(o.port) : rememberedPort(serverFile);
  const host = bindHost();
  const hostInUrl = host.includes(":") ? `[${host}]` : host;
  srv.on("error", (e) => {
    if (!srv.listening && !explicit && attempt !== 0 && e.code === "EADDRINUSE") { attempt = 0; srv.listen(0, host); return; }
    die(`server error: ${e.message}`, 1);
  });
  srv.on("listening", () => {
    const { port } = srv.address();
    const url = `http://${hostInUrl}:${port}/`;
    // The page is opened at `url`, so its Origin is that host; keep the loopback spellings too.
    selfOrigins = [`http://${hostInUrl}:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`];
    writeJson(serverFile, { url, port, pid: process.pid, started: new Date().toISOString() });
    print({ type: "ready", url, session });
    openUrl(url);
  });
  srv.listen(attempt, host);
```

4. Before `function rememberedPort(serverFile) {`:

```js
function bindHost() {
  const h = process.env.GRILL_HOST || "127.0.0.1";
  if (h !== "tailscale") return h;
  // Tailscale hands out IPv4s from 100.64.0.0/10; take the first one on any interface.
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const [x, y] = a.address.split(".").map(Number);
      if (a.family === "IPv4" && x === 100 && y >= 64 && y <= 127) return a.address;
    }
  }
  die("GRILL_HOST=tailscale but this machine has no Tailscale IPv4", 1);
}

// Fire and forget: the opener's output must not reach stdout, which is the agent's event stream.
function openUrl(url) {
  const cmd = process.env.GRILL_OPEN;
  if (!cmd) return;
  const child = spawn("sh", ["-c", `${cmd} "$1"`, "grill-open", url], { stdio: ["ignore", "ignore", "inherit"], detached: true });
  child.on("error", (e) => process.stderr.write(`grill: GRILL_OPEN failed: ${e.message}\n`));
  child.on("exit", (code) => { if (code) process.stderr.write(`grill: GRILL_OPEN exited ${code}\n`); });
  child.unref();
}
```

Show the user the three forms (upstream's hunks around `listen`/`selfOrigins`; yours; `git -C "$cache" show "$new:server.mjs" | diff -u - "$T/server.mjs"`) and ask: apply this merge? Proceed on yes. `node --check "$T/server.mjs"` must print nothing.

- [ ] **Step 4: Overlap — `SKILL.md`**

```bash
git -C "$cache" show "$new:SKILL.md" > "$T/SKILL.md"
grep -n "Print ONE line" "$T/SKILL.md"
```

Upstream's step 5 now ends "Return to listening." Edit that step to:

```markdown
5. Print ONE line: the URL, how many questions wait, and the doc path (say the user can change
   the path by typing in the terminal). When `GRILL_OPEN` is set, `serve` has already opened
   the URL in the user's browser; say "opened" rather than asking them to open it. Return to
   listening.
```

Also search the new SKILL.md for `127.0.0.1` and `localhost`; expected none (if upstream added one describing where the page is served, that is an intent-check hit: propose the one-line change to the user). Show the three forms; ask; write on yes.

- [ ] **Step 5: Overlap — `README.md`**

```bash
git -C "$cache" show "$new:README.md" > "$T/README.md"
grep -n 'GRILL_HOME' "$T/README.md"
```

Insert, directly after the line `` `GRILL_HOME` overrides `~/.grill-with-ui`. `` and its blank line, the section from the modification (unchanged text):

```markdown
### Running the agent on a remote machine

The page is served on `127.0.0.1` by default, so only a browser on the same machine can open
it. When the agent runs on a remote box, two environment variables let `serve` put the page
in front of you:

- `GRILL_HOST` — the address to bind and to put in the url. `tailscale` picks this machine's
  Tailscale IPv4, so the page is reachable from your tailnet and nothing else. Any other value
  is used as-is. Binding `0.0.0.0` exposes the Send endpoint to the whole network; avoid it.
- `GRILL_OPEN` — a shell command run with the url as its last argument once the server is
  listening, on every start and resume.

For a Linux box with a Mac on the same tailnet that it can SSH into without a password:

```sh
export GRILL_HOST=tailscale
export GRILL_OPEN="ssh -o BatchMode=yes mac open"
```

```

Show the three forms; ask; write on yes.

- [ ] **Step 6: Intent check across the whole target**

```bash
grep -rn "127.0.0.1\|localhost" "$T" --include=*.md --include=*.mjs --include=*.html | grep -v "^$T/.upstream/" | grep -v "test/"
```

Expected hits: `server.mjs` (the default and the loopback origins — intended), `README.md` (the remote section's first sentence — intended). Any other hit (a new doc paragraph, a hardcoded URL in `page.html`) is proposed to the user as an extension in one line per file; apply only what they accept and add the file to `files`.

- [ ] **Step 7: Bookkeeping**

```bash
tmp=$(mktemp); jq --arg new "$new" '.base=$new | .takenAt="2026-10-12"' "$T/.upstream/upstream.json" > "$tmp" && mv "$tmp" "$T/.upstream/upstream.json"
```

(Use today's date if this runs on another day.) Rewrite `## Applied` in `01-remote-tailscale.md`; the `server.mjs` bullet now reads:

```markdown
- `server.mjs`: `bindHost()` reads `GRILL_HOST` (default `127.0.0.1`; `tailscale` resolves the
  first 100.64.0.0/10 IPv4 on any interface, dying with a message when there is none) and
  `serve` binds it and puts it in the url (IPv6 bracketed). The bound host is added to
  `selfOrigins`, upstream's same-origin check on `POST /send`, so the page opened on that
  address can Send; the loopback spellings stay. `openUrl()` runs `GRILL_OPEN` with the url
  as `$1` once listening, detached, stdout dropped so the agent's event stream stays clean,
  errors to stderr. A header comment documents both variables.
```

The `SKILL.md` bullet changes "End the turn" context to "Return to listening"; the `README.md` bullet is unchanged. Update `files` if step 6 added one.

- [ ] **Step 8: Tests, and the Review-Focus Origin check**

```bash
(cd "$T" && node --test test/server.test.mjs 2>&1 | tail -8)
bash plugins/ml-upstream/skills/fork/scripts/upstream.sh classify "$T"
```

Expected: `fail 0` with the new upstream count (upstream's suite grew; 14+ tests). Classify prints the header with `"commits":0` and no file lines — up to date, no drift.

Then the end-to-end check on this machine (Review Focus 5):

```bash
S=/tmp/claude-1000/-home-max--herdr-worktrees-skills-worktree-clear-forest-f11a/4f8ad568-31e2-4b20-bf67-5e82fa92d9bb/scratchpad/e2e; mkdir -p "$S"; export GRILL_HOME="$S/grill"
cd "$S" && SES=$(node "$OLDPWD/$T/server.mjs" new --topic "update proof" --intent "check the remote open after the upstream update" | jq -r .session); cd "$OLDPWD"
GRILL_HOST=tailscale GRILL_OPEN="ssh -o BatchMode=yes mac open" timeout 20 node "$T/server.mjs" serve --session "$SES" & sleep 5
url=$(jq -r .url "$SES/server.json"); echo "$url"
ssh -o BatchMode=yes mac "curl -s -m5 -o /dev/null -w '%{http_code}\n' ${url}state"
curl -s -m5 -o /dev/null -w '%{http_code}\n' -H "Origin: ${url%/}" -H 'Content-Type: application/json' -d '{"actions":[{"q":"q1","type":"defer"}]}' "${url}send"
curl -s -m5 -o /dev/null -w '%{http_code}\n' -H "Origin: http://evil.example" -H 'Content-Type: application/json' -d '{"actions":[{"q":"q1","type":"defer"}]}' "${url}send"
wait
```

Expected: the url is `http://100.68.70.9:<port>/`; the Mac fetch prints `200`; the same-origin send prints `200` (the page on the Tailscale address can Send); the foreign-origin send prints `403`; a tab opened on the Mac. Ask the user to confirm the tab opened.

- [ ] **Step 9: Commit**

```bash
git add plugins/ml-grilling/skills/grill-with-ui
git commit -m "$(cat <<'EOF'
⬆️ chore(ml-grilling): update grill-with-ui from upstream 61eb282 → <new short sha>, remote-tailscale re-applied

Clean: page.html, visual-brief.md, docs/*.md, test/* (+ test/subagent-toggle.e2e.mjs).
Overlap: server.mjs (bound host added to upstream's new selfOrigins), SKILL.md, README.md.
Excluded: .github/, .no-mistakes.yaml, design/, docs/demo.gif.

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

Replace `<new short sha>` with the first seven characters of `$new`.

---

### Task 6: Housekeeping, cleanup outside the repo, PR

**Files:**
- Modify: `plugins/ml-grilling/.claude-plugin/plugin.json` (description, version 0.2.0)
- Modify: `.claude-plugin/marketplace.json` (`ml-grilling` description, version 0.2.0)
- Modify: `README.md` (`ml-grilling` row)
- Create: `docs/adr/0002-vendored-upstream-copies.md`
- Outside the repo: remove `~/.agents/skills/grill-with-ui` symlink; reset `~/git/github/grill-with-ui`

**Interfaces:**
- Consumes: Tasks 1–5 complete.

- [ ] **Step 1: `ml-grilling` manifest and marketplace entry**

New description for both files (the hook sentence stays):

```
Design interviews that respect the person's attention. questions decides which questions to ask at all (only ones whose answer changes the outcome; standard practice, look-up facts and routine choices are settled and shown in one line) and how to word them: plain words, two-line bodies, one-line options, a short honest recommendation. grill-with-ui runs the interview on a browser page instead of the terminal — every question laid out with its recommendation, answerable in any order, with a discussion thread and one Send button — vendored from jasonku09/grill-with-ui (MIT) with one modification: on a remote machine it serves on the Tailscale address and opens the page in your Mac's browser (GRILL_HOST, GRILL_OPEN). A hook adds the questions rules to the context whenever /grilling, /grill-me, /grill-with-docs, /grill-with-ui or /wayfinder starts, typed or called by Claude (needs bun).
```

```bash
tmp=$(mktemp)
desc='Design interviews that respect the person'"'"'s attention. questions decides which questions to ask at all (only ones whose answer changes the outcome; standard practice, look-up facts and routine choices are settled and shown in one line) and how to word them: plain words, two-line bodies, one-line options, a short honest recommendation. grill-with-ui runs the interview on a browser page instead of the terminal — every question laid out with its recommendation, answerable in any order, with a discussion thread and one Send button — vendored from jasonku09/grill-with-ui (MIT) with one modification: on a remote machine it serves on the Tailscale address and opens the page in your Mac'"'"'s browser (GRILL_HOST, GRILL_OPEN). A hook adds the questions rules to the context whenever /grilling, /grill-me, /grill-with-docs, /grill-with-ui or /wayfinder starts, typed or called by Claude (needs bun).'
jq --indent 2 --arg d "$desc" '.description=$d | .version="0.2.0" | .keywords += ["grill-with-ui","browser","remote","tailscale"]' plugins/ml-grilling/.claude-plugin/plugin.json > "$tmp" && mv "$tmp" plugins/ml-grilling/.claude-plugin/plugin.json
jq --indent 2 --arg d "$desc" '(.plugins[] | select(.name=="ml-grilling")) |= (.description=$d | .version="0.2.0" | .keywords += ["grill-with-ui","browser","remote","tailscale"])' .claude-plugin/marketplace.json > "$tmp" && mv "$tmp" .claude-plugin/marketplace.json
```

- [ ] **Step 2: README row for `ml-grilling`**

Replace the `ml-grilling` row's Skills cell with `` `/ml-grilling:questions` · `/ml-grilling:grill-with-ui` `` and its description with:

```
Ask a person only what they alone can decide — `questions` settles standard practice, look-up facts and routine choices in one line and words what remains so it reads in seconds. `grill-with-ui` runs the interview on a browser page, every question with its recommendation, answerable in any order, one Send button; vendored from jasonku09/grill-with-ui with a remote-machine modification (serve on Tailscale, open the Mac's browser), kept current with `/ml-upstream:fork`.
```

- [ ] **Step 3: ADR 0002**

`docs/adr/0002-vendored-upstream-copies.md`:

```markdown
# 0002 — A modified upstream skill is vendored under its domain plugin, with `.upstream/`

**Date:** 2026-10-12 · **Status:** accepted

## Context

`grill-with-ui` (jasonku09, MIT) needed one change to work from a remote machine: serve on the
Tailscale address and open the Mac's browser. It was installed as a symlink into a local clone
carrying that change uncommitted. Upstream then moved 31 commits and rewrote both files the
change touched. Three homes were considered: the clone as a GitHub fork, a standalone folder
under `~/.agents/skills`, or this marketplace.

## Decision

- A modified copy of an upstream skill lives in this marketplace under the plugin for its
  domain (`plugins/ml-grilling/skills/grill-with-ui`), installed as `/ml-<domain>:<skill>`
  like everything else, with upstream's licence file kept.
- The copy follows the Upstream Modification Standard (`standards/upstream.md`): a
  `.upstream/` folder records the upstream URL, the base commit, and each modification as a
  prompt with the files it claims. `/ml-upstream:fork` maintains it.
- There is one copy. The `~/.agents/skills/<name>` symlink is removed when the vendored
  skill lands; the local clone is reset to upstream.

## Why not the alternatives

- **GitHub fork.** Records commits, not intent; a conflict after an upstream rewrite says
  nothing about why the lines differ. One more repository to keep, and the marketplace entry
  would point outside it.
- **Standalone folder.** Not versioned, not reviewed, exists on one machine.

## Consequences

- Updates are a repo change like any other: a branch, a diff, a PR, the upstream range in the
  commit message.
- The marketplace carries third-party code. Each vendored copy names its upstream and
  licence in `.upstream/upstream.json` and keeps the licence file; excludes drop upstream's
  CI and assets so the plugin stays small.
- A second modification is a new numbered file, not a second copy.
```

- [ ] **Step 4: Validate**

Run: `bash scripts/validate-naming.sh`
Expected: `✓ /ml-grilling:questions`, `✓ /ml-grilling:grill-with-ui`, `✓ /ml-upstream:fork`, …, `Naming is valid.`

Run: `bash plugins/ml-upstream/skills/fork/scripts/upstream.test.sh | tail -1`
Expected: `all passed`.

- [ ] **Step 5: Commit the housekeeping**

```bash
git add plugins/ml-grilling/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md docs/adr/0002-vendored-upstream-copies.md
git commit -m "$(cat <<'EOF'
📝 docs: ml-grilling 0.2.0 carries grill-with-ui; ADR 0002 vendored upstream copies

Claude-Session: https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

- [ ] **Step 6: Cleanup outside the repo — ask first**

Tell the user, in one message, exactly these two commands and what they discard, and wait for a yes:

```bash
rm ~/.agents/skills/grill-with-ui                       # the symlink; the vendored copy is the one copy now
git -C /home/max/git/github/grill-with-ui checkout -- . && git -C /home/max/git/github/grill-with-ui pull --ff-only   # discards the uncommitted remote-tailscale edits, now carried by the vendored copy
```

Run them only after the yes. Then: `ls -la ~/.agents/skills | grep grill` shows no `grill-with-ui`; `git -C /home/max/git/github/grill-with-ui status --short` is empty.

Note for the user: the vendored skill becomes `/ml-grilling:grill-with-ui` after `/plugin marketplace update max-skills` and `/plugin install ml-grilling@max-skills` (or an update of the installed plugin); until then no `/grill-with-ui` is installed.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin worktree/clear-forest-f11a
gh pr create --title "✨ feat(ml-upstream): fork skill + Upstream Modification Standard; grill-with-ui vendored into ml-grilling" --body "$(cat <<'EOF'
## What

- `standards/upstream.md` — Upstream Modification Standard v1: a `.upstream/` folder records an upstream copy's URL, base commit and each modification as a prompt with the files it claims.
- `ml-upstream` 0.1.0 — `/ml-upstream:fork`: vendor an upstream (or a directory of it) with modifications, `check` what changed since base, `update` by applying clean files and re-applying modifications on overlaps, stopping only there. `scripts/upstream.sh` (bash+git+jq) does the cache and the per-file classification; `upstream.test.sh` covers clean/overlap/added/deleted/drift/excluded/path/bad-ref.
- `ml-grilling` 0.2.0 — `grill-with-ui` vendored from jasonku09/grill-with-ui (MIT) with modification `remote-tailscale` (`GRILL_HOST`, `GRILL_OPEN`), built at 61eb282 and then updated to <new short sha> with the skill's own flow: 8 clean files, 3 overlaps (server.mjs gained the bound host in upstream's new `selfOrigins`), 7 excluded.
- ADR 0002: vendored upstream copies live under their domain plugin.

## Proof

- `bash plugins/ml-upstream/skills/fork/scripts/upstream.test.sh` → all passed
- `node --test test/server.test.mjs` in the vendored copy → all pass
- `upstream.sh classify plugins/ml-grilling/skills/grill-with-ui` → up to date, no drift
- Served on the Tailscale address; the Mac loaded it, same-origin Send 200, foreign Origin 403, tab opened via `ssh mac open`.

Spec: docs/superpowers/specs/2026-10-12-upstream-fork-design.md · Plan: docs/superpowers/plans/2026-10-12-upstream-fork.md

https://claude.ai/code/session_01Ac3kRPbRr4t5R4NR7N5jXS
EOF
)"
```

Replace `<new short sha>` as in Task 5.
