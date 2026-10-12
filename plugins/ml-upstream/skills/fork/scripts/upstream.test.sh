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
  local got; got=$(jq -c ${JQS:-} "$2" "$OUT" | paste -sd, -)
  if [[ "$got" == "$3" ]]; then echo "✓ $1"; else echo "✗ $1"; echo "    want: $3"; echo "    got:  $got"; fail=1; fi
}

# ---- upstream: v1 then v2 ----
UP="$TMP/upstream"; mkdir -p "$UP/ci" "$UP/pkg"; cd "$UP"; git init -q -b main
printf 'a1\n' > a.txt; printf 'b1\n' > b.txt; printf 'd1\n' > d.txt; printf 'MIT\n' > LICENSE
printf 'c1\n' > café.txt; printf 'ci1\n' > ci/x.yml; printf 'keep\n' > ci/keep.yml; printf 'p1\n' > pkg/inner.txt
git add -A; git commit -qm v1; V1=$(git rev-parse HEAD); git tag v1
printf 'a2\n' > a.txt; printf 'b2\n' > b.txt; printf 'c2\n' > c.txt; git rm -q d.txt
printf 'c2\n' > café.txt; printf 'ci2\n' > ci/x.yml; printf 'p2\n' > pkg/inner.txt
git add -A; git commit -qm v2; V2=$(git rev-parse HEAD)

# ---- target: v1 minus ci/, with one modification claiming b.txt and d.txt, plus drift ----
TG="$TMP/target"; mkdir -p "$TG/.upstream/modifications" "$TG/ci" "$TG/pkg"
for f in a.txt b.txt d.txt LICENSE café.txt; do git -C "$UP" show "$V1:$f" > "$TG/$f"; done
git -C "$UP" show "$V1:pkg/inner.txt" > "$TG/pkg/inner.txt"
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
check "non-ASCII name: café.txt modified, same" 'select(.file=="café.txt") | [.upstream,.target]' '["modified","same"]'
check "LICENSE unchanged: not listed" 'select(.file=="LICENSE")' ''
check "pkg/inner.txt clean"      'select(.file=="pkg/inner.txt") | [.upstream,.target]' '["modified","same"]'

# ---- --ref overrides upstream.json ----
bash "$SUT" classify "$TG" --ref v1 > "$OUT"
check "--ref v1: no commits" 'select(.type=="header") | .commits' '0'
JQS=-s check "--ref v1: only target-side lines" '[.[] | select(.type!="header") | .file] | sort' '["b.txt","ci/x.yml","d.txt","notes.md"]'

# ---- path: a subdirectory of upstream ----
TP="$TMP/target-path"; mkdir -p "$TP/.upstream"; git -C "$UP" show "$V1:pkg/inner.txt" > "$TP/inner.txt"
jq -n --arg url "$UP" --arg base "$V1" '{version:1,url:$url,ref:"main",base:$base,takenAt:"2026-10-12",path:"pkg",exclude:[]}' > "$TP/.upstream/upstream.json"
bash "$SUT" classify "$TP" > "$OUT"
JQS=-s check "path: inner.txt listed without the prefix" '[.[] | select(.type!="header") | .file]' '["inner.txt"]'
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
