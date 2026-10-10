#!/usr/bin/env bash
# Repo inventory for a cleanup audit (read-only).
#
#   inventory.sh [REPO_ROOT]
#
# Prints, as Markdown: tracked size per top-level directory with its last commit
# and commit count, tracked directories that look generated, groups of identical
# files copied across directories, CI workflows with triggers, task runners, and
# infrastructure roots.
set -euo pipefail

ROOT="$(git -C "${1:-.}" rev-parse --show-toplevel)"
cd "$ROOT"

echo "# Inventory: $(basename "$ROOT")"
echo
echo "Tracked files: $(git ls-files | wc -l | tr -d ' ') · HEAD $(git log -1 --format='%h %cs')"
echo

echo "## Top-level directories"
echo
echo "| dir | files | lines | last commit | commits |"
echo "|---|---:|---:|---|---:|"
git ls-files | awk -F/ 'NF>1 {print $1}' | sort -u | while read -r d; do
  files=$(git ls-files -- "$d" | wc -l | tr -d ' ')
  lines=$(git ls-files -z -- "$d" | xargs -0 cat 2>/dev/null | wc -l | tr -d ' ')
  last=$(git log -1 --format='%cs %s' -- "$d" | cut -c1-60)
  commits=$(git rev-list --count HEAD -- "$d")
  echo "| $d | $files | $lines | $last | $commits |"
done
echo
echo "Root files: $(git ls-files | awk -F/ 'NF==1' | tr '\n' ' ')"
echo

echo "## Tracked directories that look generated or local"
echo
found=0
for p in _bmad _bmad-output .specify .claude/commands .cursor .gemini .agent .agents .codex .windsurf \
         .idea .vscode node_modules dist build out coverage vendor __pycache__ .terraform .venv target; do
  n=$(git ls-files -- "$p" ":(glob)**/$p/**" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "0" ]; then
    echo "- \`$p\`: $n files, last commit $(git log -1 --format='%cs %s' -- "$p" ":(glob)**/$p/**" | cut -c1-60)"
    found=1
  fi
done
ignored=$(git ls-files -ci --exclude-standard | wc -l | tr -d ' ')
[ "$ignored" != "0" ] && { echo "- $ignored tracked files match .gitignore (\`git ls-files -ci --exclude-standard\`)"; found=1; }
[ "$found" = "0" ] && echo "none"
echo

echo "## Identical files across directories (top 15 groups)"
echo
git ls-files -s | awk '{sha=$2; $1=$2=$3=""; sub(/^ +/,""); print sha "\t" $0}' \
  | awk -F'\t' '{n=split($2,p,"/"); dir=(n>1)?p[1]:"."; cnt[$1]++; dirs[$1]=dirs[$1] " " dir; ex[$1]=$2}
      END {for (s in cnt) if (cnt[s]>1) {
             m=split(dirs[s],a," "); delete seen; u=""; k=0
             for (i=1;i<=m;i++) if (!(a[i] in seen)) {seen[a[i]]=1; u=u a[i] " "; k++}
             if (k>1) print cnt[s] "\t" u "\t" ex[s]}}' \
  | sort -rn | head -15 | awk -F'\t' '{printf "- %s copies across [%s] e.g. `%s`\n", $1, $2, $3}'
echo
echo "Directories sharing the most identical files:"
git ls-files -s | awk '{sha=$2; $1=$2=$3=""; sub(/^ +/,""); n=split($0,p,"/"); print sha "\t" ((n>1)?p[1]:".")}' \
  | sort -u | awk -F'\t' '{d[$1]=d[$1] " " $2; c[$1]++} END {for (s in c) if (c[s]>1) print d[s]}' \
  | sort | uniq -c | sort -rn | head -8 | sed 's/^/  /'
echo

echo "## CI workflows"
echo
if ls .github/workflows/*.y*ml >/dev/null 2>&1; then
  for f in .github/workflows/*.y*ml; do
    trig=$(awk '/^on:/{f=1; next} f && /^[^ #]/{f=0} f && /^  [a-z_]+:/{gsub(/[: ]/,""); printf "%s ", $0}' "$f")
    echo "- \`$f\`: ${trig:-?} · last $(git log -1 --format=%cs -- "$f")"
  done
fi
for f in .gitlab-ci.yml .circleci/config.yml Jenkinsfile azure-pipelines.yml bitbucket-pipelines.yml; do
  [ -f "$f" ] && echo "- \`$f\`"
done
echo

echo "## Task runners"
echo
git ls-files | grep -E '(^|/)(Taskfile\.ya?ml|Makefile|justfile|package\.json|pyproject\.toml|Cargo\.toml|go\.mod|build\.gradle(\.kts)?|pom\.xml)$' \
  | grep -v node_modules | head -40 | sed 's/^/- /'
echo

echo "## Infrastructure roots"
echo
git ls-files | grep -E '\.tf$' | xargs -r grep -l -E '^\s*(backend|cloud)\s' 2>/dev/null | xargs -r -n1 dirname | sort -u \
  | while read -r d; do echo "- terraform root \`$d\` · last $(git log -1 --format=%cs -- "$d")"; done
git ls-files | grep -E '(^|/)(ansible\.cfg|site\.ya?ml|Chart\.yaml|kustomization\.ya?ml|docker-compose\.ya?ml|compose\.ya?ml|Dockerfile)$' \
  | head -40 | sed 's/^/- /'
