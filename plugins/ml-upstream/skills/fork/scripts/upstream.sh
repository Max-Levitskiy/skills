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
shopt -s inherit_errexit 2>/dev/null || true   # bash 4.4+; the `|| die` guards cover older bash

die() { echo "upstream: $*" >&2; exit 2; }
command -v git >/dev/null || die "git is required"
command -v jq  >/dev/null || die "jq is required"
CACHE_ROOT="${ML_UPSTREAM_CACHE:-$HOME/.cache/ml-upstream}"

# <host>/<owner>/<repo>-<hash>.git for a URL (the hash covers the whole URL, so another scheme,
# user or port is another cache); local/<abs path>.git for a path.
cache_dir() {
  local url="$1" key
  if [[ "$url" =~ ^https?://[^/]*@ ]]; then
    die "url carries credentials; record it without them and let git's credential helper authenticate"
  fi
  if   [[ "$url" =~ ^[a-z+]+://([^/@]+@)?([^/:]+)(:[0-9]+)?/(.+)$ ]]; then key="${BASH_REMATCH[2]}/${BASH_REMATCH[4]}"
  elif [[ "$url" =~ ^[^@/]+@([^:]+):(.+)$ ]]; then key="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" == file://* ]]; then key="local$(realpath "${url#file://}")" || die "cannot resolve $url"
  else key="local$(realpath "$url")" || die "cannot resolve $url"; fi
  key="${key%/}"; key="${key%.git}"
  if [[ "$key" != local/* ]]; then key="$key-$(printf %s "$url" | git hash-object --stdin | cut -c1-8)"; fi
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
  # Fetch does not move HEAD; follow upstream's default branch so a rename is picked up.
  local head; head=$(git -C "$dir" ls-remote --symref "$url" HEAD 2>/dev/null | awk '/^ref:/ { print $2; exit }' || true)
  if [[ -n "$head" ]]; then git -C "$dir" symbolic-ref HEAD "$head"; fi
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
      --*) die "unknown option: $1" ;;
      *) target="$1"; shift ;;
    esac
  done
  [[ -n "$target" && -f "$target/.upstream/upstream.json" ]] || die "no .upstream/upstream.json in ${target:-<target>}"
  target=$(realpath "$target") || die "cannot resolve $target"
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
  # Keep base reachable: a force-push upstream would otherwise leave it to git's garbage collection.
  git -C "$cache" update-ref "refs/ml-upstream/bases/$base" "$base"
  # Rule 7: the licence is never excluded — at base, nor at the new ref (upstream may add one).
  local e lic rev treeish tree
  for rev in "$base" "$new"; do
    if [[ -n "$path" ]]; then treeish="$rev:$path"; else treeish="$rev"; fi
    # The subtree may not exist at a rev (upstream deleted it, and base can already be past that).
    tree=$(git -C "$cache" ls-tree --name-only "$treeish" 2>/dev/null) || continue
    while IFS= read -r lic; do
      [[ -n "$lic" ]] || continue
      for e in "${EXCLUDES[@]}"; do
        [[ -n "$e" && ( "$e" == "$lic" || "$e" == "$lic/" ) ]] && die "exclude lists the licence file $lic; the licence is never excluded (rule 7)"
      done
    done < <(grep -iE '^(licen[cs]e|copying)' <<<"$tree" || true)
  done
  commits=$(git -C "$cache" rev-list --count "$base..$new")
  jq -cn --arg url "$url" --arg ref "$ref" --arg base "$base" --arg new "$new" --arg cache "$cache" --argjson commits "$commits" \
    '{type:"header",url:$url,ref:$ref,base:$base,new:$new,commits:$commits,cache:$cache}'

  local claims; claims=$(claims_json "$target")

  # "<mode>:<blob>" for every path upstream has at base and at new (under path, prefix stripped
  # literally). Mode counts: a chmod +x upstream is a change. Submodules (gitlinks, type `commit`)
  # are not part of the copy: `git archive` leaves them out.
  local -A B=() N=()
  local rec meta p m o
  while IFS= read -r -d '' rec; do
    meta="${rec%%$'\t'*}"; p="${rec#*$'\t'}"
    read -r m o _ <<<"$meta"; [[ "$o" == commit ]] && continue
    read -r m _ o <<<"$meta"; B["${p#"$prefix"}"]="$m:$o"
  done < <(git -C "$cache" ls-tree -r -z "$base" ${path:+-- "$path"})
  while IFS= read -r -d '' rec; do
    meta="${rec%%$'\t'*}"; p="${rec#*$'\t'}"
    read -r m o _ <<<"$meta"; [[ "$o" == commit ]] && continue
    read -r m _ o <<<"$meta"; N["${p#"$prefix"}"]="$m:$o"
  done < <(git -C "$cache" ls-tree -r -z "$new" ${path:+-- "$path"})

  # Every such path, plus every file and symlink in the target (not .upstream/, not git's own .git),
  # NUL-delimited so a name with a tab, newline or quote survives.
  local f b n t up tg by d
  while IFS= read -r -d '' f; do
    [[ -n "$f" ]] || continue
    b="${B[$f]:-}"; n="${N[$f]:-}"
    # Hash in the cache repo, so a SHA-256 upstream gets SHA-256 ids.
    if   [[ -L "$target/$f" ]]; then t="120000:$(printf %s "$(readlink "$target/$f")" | git -C "$cache" hash-object --stdin)"
    elif [[ -f "$target/$f" ]]; then
      if [[ -x "$target/$f" ]]; then m=100755; else m=100644; fi
      t="$m:$(git -C "$cache" hash-object --no-filters --stdin < "$target/$f")"
    else t=""; fi
    if   [[ -z "$b" && -z "$n" ]]; then up=none
    elif [[ -z "$b" ]];            then up=added
    elif [[ -z "$n" ]];            then up=deleted
    elif [[ "$b" == "$n" ]];       then up=same
    else                                up=modified; fi
    by=$(jq -c --arg f "$f" '.[$f] // []' <<<"$claims")
    if   [[ "$t" == "$b" ]];  then tg=same       # equal content, or absent on both sides
    elif [[ "$by" != "[]" ]]; then tg=claimed
    else                           tg=drift; fi
    # A parent directory that is a symlink in the target: anything written there lands outside it.
    d="$f"; while [[ "$d" == */* ]]; do d="${d%/*}"; if [[ -L "$target/$d" ]]; then tg=drift; break; fi; done
    # Under an excluded path: absent is the expected state; present is drift unless claimed (rule 3).
    if excluded "$f"; then
      if [[ -z "$t" ]]; then tg=excluded; elif [[ "$by" == "[]" ]]; then tg=drift; fi
    fi
    [[ "$up" == same && ( "$tg" == same || "$tg" == excluded ) ]] && continue
    jq -cn --arg f "$f" --arg up "$up" --arg tg "$tg" --argjson by "$by" \
      '{file:$f, upstream:$up, target:$tg} + (if $by != [] then {by:$by} else {} end)'
  done < <(
    {
      printf '%s\0' "${!B[@]}" "${!N[@]}"
      (cd "$target" && find . \( -type f -o -type l \) ! -path './.upstream/*' ! -path './.git' ! -path './.git/*' -print0 | sed -z 's#^\./##')
    } | sort -zu
  )
}

case "${1:-}" in
  cache)    shift; cmd_cache "$@" ;;
  classify) shift; cmd_classify "$@" ;;
  *) die "usage: upstream.sh cache <url> | classify <target> [--ref REF]" ;;
esac
