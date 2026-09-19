#!/usr/bin/env bash
# Enforce the plugin naming rules — see docs/adr/0001-ml-plugin-namespacing.md.
#
#   validate-naming.sh [ROOT]   ROOT defaults to this repo's top level
#
# Each marketplace entry is ml-<domain>, matches its plugins/ directory and its
# plugin.json name; each skill's frontmatter name equals its directory, bare.
set -euo pipefail

ROOT="${1:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)}"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
KEBAB='^[a-z0-9]+(-[a-z0-9]+)*$'
fail=0
bad() { echo "✗ $*"; fail=1; }

count=$(jq '.plugins | length' "$MARKETPLACE")
for ((i = 0; i < count; i++)); do
  name=$(jq -r ".plugins[$i].name" "$MARKETPLACE")
  source=$(jq -r ".plugins[$i].source" "$MARKETPLACE")
  entry_ok=1
  [[ "$name" =~ ^ml- && "${name#ml-}" =~ $KEBAB ]] || { bad "entry '$name': must be ml-<domain>, lowercase kebab-case"; entry_ok=0; }
  [[ "$source" == "./plugins/$name" ]] || { bad "entry '$name': source '$source' must be ./plugins/$name"; entry_ok=0; }
  manifest="$ROOT/plugins/$name/.claude-plugin/plugin.json"
  if [[ ! -f "$manifest" ]]; then
    bad "entry '$name': no plugins/$name/.claude-plugin/plugin.json"; continue
  fi
  pj=$(jq -r '.name' "$manifest")
  [[ "$pj" == "$name" ]] || { bad "plugins/$name: plugin.json name '$pj' must be '$name'"; entry_ok=0; }

  for skill_md in "$ROOT/plugins/$name"/skills/*/SKILL.md; do
    [[ -e "$skill_md" ]] || continue
    dir=$(basename "$(dirname "$skill_md")")
    fm=$(awk '/^---[[:space:]]*$/ { n++; next } n == 1 && /^name:/ { sub(/^name:[[:space:]]*/, ""); print; exit }' "$skill_md" | tr -d '\r')
    skill_ok=$entry_ok
    [[ "$dir" =~ $KEBAB ]] || { bad "plugins/$name/skills/$dir: directory must be lowercase kebab-case"; skill_ok=0; }
    [[ "$fm" == "$dir" ]] || { bad "plugins/$name/skills/$dir: frontmatter name '$fm' must be '$dir' (bare — Claude Code adds '$name:')"; skill_ok=0; }
    if [[ $skill_ok -eq 1 ]]; then echo "✓ /$name:$dir"; fi
  done
done

for d in "$ROOT"/plugins/*/; do
  d=$(basename "$d")
  jq -e --arg d "$d" '.plugins | any(.name == $d)' "$MARKETPLACE" >/dev/null \
    || bad "plugins/$d is not registered in .claude-plugin/marketplace.json"
done

if [[ $fail -eq 0 ]]; then echo; echo "Naming is valid."; else echo; echo "Naming is invalid."; exit 1; fi
