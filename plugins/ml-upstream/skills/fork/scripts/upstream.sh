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
