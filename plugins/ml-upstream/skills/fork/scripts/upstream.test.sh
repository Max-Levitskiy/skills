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
ln -s a.txt link.txt
printf 'MIT\n' > pkg/LICENSE
printf 'c1\n' > café.txt; printf 'ci1\n' > ci/x.yml; printf 'keep\n' > ci/keep.yml; printf 'p1\n' > pkg/inner.txt
git add -A; git commit -qm v1; V1=$(git rev-parse HEAD); git tag v1
printf 'a2\n' > a.txt; printf 'b2\n' > b.txt; printf 'c2\n' > c.txt; git rm -q d.txt
printf 'c2\n' > café.txt; printf 'ci2\n' > ci/x.yml; printf 'p2\n' > pkg/inner.txt
git add -A; git commit -qm v2; V2=$(git rev-parse HEAD)

# ---- target: v1 minus ci/, with one modification claiming b.txt and d.txt, plus drift ----
TG="$TMP/target"; mkdir -p "$TG/.upstream/modifications" "$TG/ci" "$TG/pkg"
for f in a.txt b.txt d.txt LICENSE café.txt; do git -C "$UP" show "$V1:$f" > "$TG/$f"; done
git -C "$UP" show "$V1:pkg/inner.txt" > "$TG/pkg/inner.txt"
git -C "$UP" show "$V1:pkg/LICENSE" > "$TG/pkg/LICENSE"
git -C "$UP" show "$V1:ci/x.yml" > "$TG/ci/x.yml"          # kept under an excluded path: drift
ln -s a.txt "$TG/link.txt"                                  # same symlink as upstream: unchanged
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
check "symlink unchanged on both sides: not listed" 'select(.file=="link.txt")' ''
ln -s a.txt "$TG/extra-link.txt"
bash "$SUT" classify "$TG" > "$OUT"
check "symlink added by hand = drift" 'select(.file=="extra-link.txt") | [.upstream,.target]' '["none","drift"]'
rm "$TG/extra-link.txt"

# ---- --ref overrides upstream.json ----
bash "$SUT" classify "$TG" --ref v1 > "$OUT"
check "--ref v1: no commits" 'select(.type=="header") | .commits' '0'
JQS=-s check "--ref v1: only target-side lines" '[.[] | select(.type!="header") | .file] | sort' '["b.txt","ci/x.yml","d.txt","notes.md"]'

# ---- path: a subdirectory of upstream ----
TP="$TMP/target-path"; mkdir -p "$TP/.upstream"; git -C "$UP" show "$V1:pkg/inner.txt" > "$TP/inner.txt"
git -C "$UP" show "$V1:pkg/LICENSE" > "$TP/LICENSE"
jq -n --arg url "$UP" --arg base "$V1" '{version:1,url:$url,ref:"main",base:$base,takenAt:"2026-10-12",path:"pkg",exclude:[]}' > "$TP/.upstream/upstream.json"
bash "$SUT" classify "$TP" > "$OUT"
JQS=-s check "path: inner.txt listed without the prefix" '[.[] | select(.type!="header") | .file]' '["inner.txt"]'
check "path: inner.txt clean" 'select(.file=="inner.txt") | [.upstream,.target]' '["modified","same"]'

TPL="$TMP/target-path-lic"; mkdir -p "$TPL/.upstream"
jq '.exclude=["LICENSE"]' "$TP/.upstream/upstream.json" > "$TPL/.upstream/upstream.json"
if bash "$SUT" classify "$TPL" > "$OUT" 2> "$TMP/err"; then echo "✗ path: excluded licence should fail"; fail=1
else grep -q "exclude lists the licence file LICENSE" "$TMP/err" && [[ ! -s "$OUT" ]] && echo "✓ path: excluded licence: exit non-zero, no header" || { echo "✗ path: excluded licence message: $(cat "$TMP/err")"; fail=1; }; fi

# ---- failures ----
if bash "$SUT" classify "$TG" --ref no-such-branch > "$OUT" 2> "$TMP/err"; then echo "✗ bad ref should fail"; fail=1
else grep -q "ref not found upstream: no-such-branch" "$TMP/err" && [[ ! -s "$OUT" ]] && echo "✓ bad ref: exit non-zero, no header" || { echo "✗ bad ref message: $(cat "$TMP/err")"; fail=1; }; fi
if bash "$SUT" classify "$TMP" > /dev/null 2> "$TMP/err"; then echo "✗ missing upstream.json should fail"; fail=1
else grep -q "no .upstream/upstream.json" "$TMP/err" && echo "✓ missing upstream.json" || { echo "✗ missing upstream.json message: $(cat "$TMP/err")"; fail=1; }; fi

# ---- licence is never excluded (rule 7); unknown flags ----
TL="$TMP/target-lic"; mkdir -p "$TL/.upstream"
jq '.exclude=["LICENSE"]' "$TG/.upstream/upstream.json" > "$TL/.upstream/upstream.json"
if bash "$SUT" classify "$TL" > "$OUT" 2> "$TMP/err"; then echo "✗ excluded licence should fail"; fail=1
else grep -q "exclude lists the licence file LICENSE" "$TMP/err" && [[ ! -s "$OUT" ]] && echo "✓ excluded licence: exit non-zero, no header" || { echo "✗ excluded licence message: $(cat "$TMP/err")"; fail=1; }; fi
# A second upstream: a submodule (gitlink), a directory with a regex character in its name, and a
# directory that v2 deletes; v2 also adds a LICENSE and makes x.txt executable (mode only).
U2="$TMP/upstream2"; mkdir -p "$U2/p#q" "$U2/gone"; git -C "$U2" init -q -b main
printf 'x\n' > "$U2/x.txt"; printf 'y\n' > "$U2/p#q/y.txt"; printf 'g\n' > "$U2/gone/g.txt"
git -C "$U2" add -A; git -C "$U2" update-index --add --cacheinfo "160000,$V1,sub"; git -C "$U2" commit -qm w1; W1=$(git -C "$U2" rev-parse HEAD)
printf 'MIT\n' > "$U2/LICENSE"; printf 'z\n' > "$U2/p#q/z.txt"; git -C "$U2" rm -rq gone
git -C "$U2" add -A; git -C "$U2" update-index --chmod=+x x.txt; git -C "$U2" commit -qm w2; W2=$(git -C "$U2" rev-parse HEAD)
TS="$TMP/target-sub"; mkdir -p "$TS/.upstream" "$TS/p#q" "$TS/gone"; cp "$U2/x.txt" "$TS/x.txt"
git -C "$U2" show "$W1:p#q/y.txt" > "$TS/p#q/y.txt"; git -C "$U2" show "$W1:gone/g.txt" > "$TS/gone/g.txt"; chmod -x "$TS/x.txt"
printf 'gitdir: /elsewhere\n' > "$TS/.git"                       # a linked worktree's control file
jq -n --arg url "$U2" --arg base "$W1" '{version:1,url:$url,ref:"main",base:$base,takenAt:"2026-10-12",path:"",exclude:[]}' > "$TS/.upstream/upstream.json"
bash "$SUT" classify "$TS" --ref "$W1" > "$OUT"
check "submodule (gitlink) and a worktree's .git file: not listed" 'select(.type!="header") | .file' ''
bash "$SUT" classify "$TS" > "$OUT"
check "mode-only upstream change (chmod +x) is modified" 'select(.file=="x.txt") | [.upstream,.target]' '["modified","same"]'
TQ="$TMP/target-regex-path"; mkdir -p "$TQ/.upstream"; cp "$TS/p#q/y.txt" "$TQ/y.txt"
jq '.path="p#q"' "$TS/.upstream/upstream.json" > "$TQ/.upstream/upstream.json"
bash "$SUT" classify "$TQ" > "$OUT"
JQS=-s check "path with a regex character: prefix stripped literally" '[.[] | select(.type!="header") | .file]' '["z.txt"]'
TD="$TMP/target-gone"; mkdir -p "$TD/.upstream"
jq --arg base "$W2" '.path="gone" | .base=$base' "$TS/.upstream/upstream.json" > "$TD/.upstream/upstream.json"
bash "$SUT" classify "$TD" > "$OUT" 2> "$TMP/err" && JQS=-s check "subtree deleted upstream, base already past it: checks still work" '[.[] | select(.type!="header")]' '[]' \
  || { echo "✗ subtree deleted upstream: $(cat "$TMP/err")"; fail=1; }
TN="$TMP/target-newlic"; mkdir -p "$TN/.upstream"; cp "$U2/x.txt" "$TN/x.txt"
jq '.exclude=["LICENSE"]' "$TS/.upstream/upstream.json" > "$TN/.upstream/upstream.json"
if bash "$SUT" classify "$TN" > "$OUT" 2> "$TMP/err"; then echo "✗ licence added upstream and excluded should fail"; fail=1
else grep -q "exclude lists the licence file LICENSE" "$TMP/err" && [[ ! -s "$OUT" ]] && echo "✓ licence added at the new ref: exit non-zero, no header" || { echo "✗ new-ref licence message: $(cat "$TMP/err")"; fail=1; }; fi

if bash "$SUT" classify "$TG" --bogus > /dev/null 2> "$TMP/err"; then echo "✗ unknown flag should fail"; fail=1
else grep -q "unknown option: --bogus" "$TMP/err" && echo "✓ unknown flag rejected" || { echo "✗ unknown flag message: $(cat "$TMP/err")"; fail=1; }; fi

# ---- cache verb ----
C1=$(bash "$SUT" cache "$UP"); C2=$(bash "$SUT" cache "$UP")
[[ "$C1" == "$C2" && -d "$C1" && "$C1" == "$ML_UPSTREAM_CACHE"/local/* ]] && echo "✓ cache: stable path under ML_UPSTREAM_CACHE/local" || { echo "✗ cache: $C1 / $C2"; fail=1; }
CF=$(bash "$SUT" cache "file://$UP")
[[ "$CF" == "$C1" ]] && echo "✓ cache: file:// URL shares the key of the plain path" || { echo "✗ cache: file:// gave $CF, want $C1"; fail=1; }
git -C "$C1" rev-parse --verify -q refs/tags/v1 >/dev/null && echo "✓ cache: tags fetched" || { echo "✗ cache: tag v1 missing"; fail=1; }
U3="$TMP/upstream3"; mkdir -p "$U3"; git -C "$U3" init -q -b main; git -C "$U3" commit -q --allow-empty -m r1
C3=$(bash "$SUT" cache "$U3"); git -C "$U3" branch -m main trunk; bash "$SUT" cache "$U3" > /dev/null
[[ $(git -C "$C3" symbolic-ref HEAD) == refs/heads/trunk ]] && echo "✓ cache: default branch follows an upstream rename" || { echo "✗ cache: HEAD is $(git -C "$C3" symbolic-ref HEAD)"; fail=1; }
KEY=$(sed -n '/^cache_dir() {/,/^}/p' "$SUT")
K1=$(CACHE_ROOT=/c; eval "$KEY"; cache_dir ssh://git@h.example:2222/o/r.git); K2=$(CACHE_ROOT=/c; eval "$KEY"; cache_dir ssh://git@h.example/o/r.git)
K3=$(CACHE_ROOT=/c; eval "$KEY"; cache_dir https://h.example:443/o/r)
[[ "$K1" != "$K2" && "$K2" == "$K3" ]] && echo "✓ cache key: a non-default port is part of it, a default one is not" || { echo "✗ cache keys: $K1 / $K2 / $K3"; fail=1; }

[[ $fail -eq 0 ]] && echo "all passed" || { echo "FAILED"; exit 1; }
