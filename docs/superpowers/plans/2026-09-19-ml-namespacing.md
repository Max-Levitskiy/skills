# `ml-` Namespacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup seven single-skill plugins into four `ml-<domain>` plugins so every skill is invoked as `/ml-<domain>:<skill>`.

**Architecture:** A naming validator is written first and fails against today's layout. Each of the next four tasks builds one new plugin with `git mv`, rewrites its manifest, README, and marketplace entry, and turns its lines of the validator green. The last two tasks update repo-wide docs and verify by installing the working tree as a marketplace.

**Tech Stack:** bash, `jq`, `git mv`, `bun` (existing tests), `claude plugin validate` / `claude plugin details` (Claude Code 2.1.278).

**Spec:** `docs/superpowers/specs/2026-09-19-ml-namespacing-design.md`

## Global Constraints

- Plugin directory = marketplace entry `name` = `plugin.json` `name` = `ml-<domain>`, lowercase kebab-case. No colon anywhere in a plugin name (claude.ai marketplace sync rejects it).
- Skill directory = frontmatter `name:`, bare lowercase kebab-case, never containing the plugin name.
- Command form `/ml-<domain>:<skill>`; install key `ml-<domain>@max-skills`. Marketplace name stays `max-skills`.
- Every move is `git mv`. Never delete-and-recreate a file that is moving.
- Config names under `~/.agents/config/<name>/` do not change: `fellow`, `atlassian`, `herdr`, `orchestrate`, `agent-config`.
- The `agent-config` CLI binary name and `AGENT_CONFIG_ROOT` do not change.
- Skill directories `fellow`, `atlassian`, `orchestrate`, `herdr` keep their names.
- Historical docs keep old names: `docs/superpowers/plans/*`, `docs/superpowers/specs/*`, `docs/orchestration/*`.
- Versions: `ml-slop` 0.2.0, `ml-workplace` 0.3.0, `ml-subagents` 0.3.0, `ml-agent-config` 0.3.0.
- The Web-Tree MIT `LICENSE` stays attached to the text analyzer's files.
- Commit messages follow the repo style: gitmoji + conventional type, e.g. `♻️ refactor(marketplace): …`.
- Work on branch `ml-namespacing` (already created; the spec is committed there).

## File map

| New path | Built from | Task |
| --- | --- | --- |
| `scripts/validate-naming.sh` | new | 1 |
| `plugins/ml-slop/` | `text-density-analyzer/`, `code-density-analyzer/` | 2 |
| `plugins/ml-workplace/` | `atlassian/`, `fellow/` | 3 |
| `plugins/ml-subagents/` | `orchestrate/`, `herdr/` | 4 |
| `plugins/ml-agent-config/` | `agent-config/` | 5 |
| `docs/adr/0001-ml-plugin-namespacing.md` | new | 6 |
| `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `standards/agent-config.md`, `docs/proposals/atlassian-multi-site-routing.md` | edited | 6 |

The marketplace entry swap in Tasks 2–5 uses this helper each time. It removes the named old entries and appends the new one:

```bash
# usage: swap_entries '<new entry JSON>' old-name [old-name...]
swap_entries() {
  local entry="$1"; shift
  local olds; olds=$(printf '%s\n' "$@" | jq -R . | jq -s .)
  local tmp; tmp=$(mktemp)
  jq --indent 2 --argjson e "$entry" --argjson olds "$olds" \
    '.plugins |= (map(select(.name as $n | $olds | index($n) | not)) + [$e])' \
    .claude-plugin/marketplace.json > "$tmp" && mv "$tmp" .claude-plugin/marketplace.json
}
```

---

### Task 1: Naming validator

**Files:**
- Create: `scripts/validate-naming.sh`

**Interfaces:**
- Produces: `bash scripts/validate-naming.sh [ROOT]`. `ROOT` defaults to the repo root. It prints `✓ /<plugin>:<skill>` for each valid skill and `✗ <reason>` for each violation, then exits 0 if everything is valid or 1 if anything fails. Tasks 2–5 read the `✓`/`✗` lines, and Task 7 needs exit 0.

- [ ] **Step 1: Write the validator**

```bash
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
```

Then `chmod +x scripts/validate-naming.sh`.

- [ ] **Step 2: Run it against the current repo and confirm it fails**

Run: `bash scripts/validate-naming.sh; echo "exit=$?"`
Expected: `exit=1`, with an `✗ entry '<name>': must be ml-<domain>…` line for each of the 7 current entries and no `✓` lines.

- [ ] **Step 3: Check it against throwaway fixtures (one good, three bad)**

```bash
F=$(mktemp -d)
mk() { # $1 root, $2 entry, $3 plugin.json name, $4 skill dir, $5 frontmatter name
  mkdir -p "$1/.claude-plugin" "$1/plugins/$2/.claude-plugin" "$1/plugins/$2/skills/$4"
  printf '{"name":"t","owner":{"name":"t"},"plugins":[{"name":"%s","source":"./plugins/%s"}]}\n' "$2" "$2" > "$1/.claude-plugin/marketplace.json"
  printf '{"name":"%s"}\n' "$3" > "$1/plugins/$2/.claude-plugin/plugin.json"
  printf -- '---\nname: %s\ndescription: x\n---\n' "$5" > "$1/plugins/$2/skills/$4/SKILL.md"
}
mk "$F/good"   ml-demo ml-demo  text text
mk "$F/colon"  ml-demo ml:demo  text text
mk "$F/prefix" ml-demo ml-demo  text ml-demo:text
mk "$F/noml"   demo    demo     text text
for c in good colon prefix noml; do bash scripts/validate-naming.sh "$F/$c" >/dev/null; echo "$c exit=$?"; done
rm -rf "$F"
```

Expected:
```
good exit=0
colon exit=1
prefix exit=1
noml exit=1
```

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-naming.sh
git commit -m "✅ test(marketplace): add the ml- naming validator"
```

---

### Task 2: `ml-slop` (text + code)

**Files:**
- Move: `plugins/text-density-analyzer/skills/analyze-density/` → `plugins/ml-slop/skills/text/`
- Move: `plugins/text-density-analyzer/{LICENSE,NOTICE}` → `plugins/ml-slop/skills/text/`
- Move: `plugins/code-density-analyzer/skills/analyze-code-density/` → `plugins/ml-slop/skills/code/`
- Move: `plugins/code-density-analyzer/NOTICE` → `plugins/ml-slop/skills/code/NOTICE`
- Move: `plugins/code-density-analyzer/workspace/` → `plugins/ml-slop/skills/code/workspace/`
- Move: `plugins/code-density-analyzer/LICENSE` → `plugins/ml-slop/LICENSE`
- Move: `plugins/code-density-analyzer/.claude-plugin/plugin.json` → `plugins/ml-slop/.claude-plugin/plugin.json` (then rewrite)
- Create: `plugins/ml-slop/README.md` (built from the two old READMEs, which are then deleted)
- Delete: `plugins/text-density-analyzer/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: `scripts/validate-naming.sh` (Task 1), `swap_entries` (File map section).
- Produces: `/ml-slop:text`, `/ml-slop:code`.

- [ ] **Step 1: Move files**

```bash
mkdir -p plugins/ml-slop/skills plugins/ml-slop/.claude-plugin
git mv plugins/text-density-analyzer/skills/analyze-density plugins/ml-slop/skills/text
git mv plugins/text-density-analyzer/LICENSE plugins/ml-slop/skills/text/LICENSE
git mv plugins/text-density-analyzer/NOTICE  plugins/ml-slop/skills/text/NOTICE
git mv plugins/code-density-analyzer/skills/analyze-code-density plugins/ml-slop/skills/code
git mv plugins/code-density-analyzer/NOTICE    plugins/ml-slop/skills/code/NOTICE
git mv plugins/code-density-analyzer/workspace plugins/ml-slop/skills/code/workspace
git mv plugins/code-density-analyzer/LICENSE   plugins/ml-slop/LICENSE
git mv plugins/code-density-analyzer/.claude-plugin/plugin.json plugins/ml-slop/.claude-plugin/plugin.json
git rm -q plugins/text-density-analyzer/.claude-plugin/plugin.json
```

- [ ] **Step 2: Rename the skills in frontmatter**

In `plugins/ml-slop/skills/text/SKILL.md` line 2 replace `name: analyze-density` with `name: text`.
In `plugins/ml-slop/skills/code/SKILL.md` line 2 replace `name: analyze-code-density` with `name: code`.

- [ ] **Step 3: Update NOTICE and SMOKE wording**

`plugins/ml-slop/skills/text/NOTICE`, replace the first two lines:
```
text-density-analyzer
=====================
```
with:
```
ml-slop — text skill (formerly the text-density-analyzer plugin)
=================================================================
```

`plugins/ml-slop/skills/code/NOTICE`, replace the first two lines with:
```
ml-slop — code skill (formerly the code-density-analyzer plugin)
=================================================================
```
In the same file, replace `Adapts the methodology of the text-density-analyzer plugin — parallel analysis` with `Adapts the methodology of the text skill (formerly text-density-analyzer) — parallel analysis`. Then replace the two lines
```
text-density-analyzer was originally authored by Web-Tree
(https://github.com/Web-tree) and is distributed in this same marketplace.
```
with
```
The text skill was originally authored by Web-Tree
(https://github.com/Web-tree) and ships in the same ml-slop plugin.
```

`plugins/ml-slop/skills/code/workspace/SMOKE.md` line 3: replace ``the `analyze-code-density` skill`` with ``the `code` skill (named `analyze-code-density` at the time)``.

- [ ] **Step 4: Write `plugin.json`**

Overwrite `plugins/ml-slop/.claude-plugin/plugin.json`:

```json
{
  "name": "ml-slop",
  "description": "Find and score AI-generation slop. text measures information density and semantic repetition in prose, and can rewrite to remove it; code scores a git diff or standalone files for duplication, dead code, redundant comments, verbosity, over-abstraction, error masking, convention violations, hallucinated dependencies, and performance waste.",
  "version": "0.2.0",
  "license": "MIT",
  "author": {
    "name": "Max Levitskiy",
    "url": "https://github.com/Max-Levitskiy"
  },
  "homepage": "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-slop",
  "keywords": [
    "ai-slop",
    "text-density",
    "information-density",
    "redundancy",
    "content-quality",
    "writing",
    "editing",
    "code-density",
    "code-quality",
    "code-review",
    "duplication",
    "dead-code",
    "code-smell",
    "claude-skill"
  ]
}
```

- [ ] **Step 5: Build the merged README**

Old READMEs, as they stand on this branch: text intro at lines 3–5, body at lines 14–47 (`## Use` up to `## License & attribution`); code intro at lines 3–7, body at lines 16–68. The body headings drop one level.

````bash
T=plugins/text-density-analyzer/README.md
C=plugins/code-density-analyzer/README.md
{
cat <<'EOF'
# ml-slop

Find and score AI-generation slop — in prose and in code. Both skills run their analysis
methods as parallel subagents and aggregate a weighted 0–100 density score.

```bash
/plugin install ml-slop@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-slop:text` | Score or fix repeated meaning, filler, and low density in any text |
| `/ml-slop:code` | Score a diff or files for duplication, dead code, over-abstraction, and other code slop |

## `/ml-slop:text`

EOF
sed -n '3,5p' "$T"; echo
sed -n '14,47p' "$T" | sed 's/^## /### /'
echo; echo '## `/ml-slop:code`'; echo
sed -n '3,7p' "$C"; echo
sed -n '16,68p' "$C" | sed 's/^## /### /'
cat <<'EOF'

## License & attribution

MIT. The `text` skill was originally authored by [Web-Tree](https://github.com/Web-tree)
and keeps its own [`LICENSE`](skills/text/LICENSE) and [`NOTICE`](skills/text/NOTICE).
The `code` skill is by [Max Levitskiy](https://github.com/Max-Levitskiy), adapting the
text skill's methodology — see [`LICENSE`](LICENSE) and [`NOTICE`](skills/code/NOTICE).
EOF
} > plugins/ml-slop/README.md
git rm -q "$T" "$C"
````

Then apply these exact replacements in `plugins/ml-slop/README.md`:

| Old | New |
| --- | --- |
| `phrasing; this plugin finds those patterns` | `phrasing; this skill finds those patterns` |
| ``The `analyze-density` skill triggers`` | ``The `text` skill triggers`` |
| `/text-density-analyzer:analyze-density` | `/ml-slop:text` |
| ``[`text-density-analyzer`](../text-density-analyzer): parallel analysis methods`` | `` `/ml-slop:text`: parallel analysis methods`` |
| ``The `analyze-code-density` skill triggers`` | ``The `code` skill triggers`` |
| `/code-density-analyzer:analyze-code-density` | `/ml-slop:code` |
| ``Five adapt the prompt patterns of their `text-density-analyzer` counterparts,`` | ``Five adapt the prompt patterns of their `text` counterparts,`` |
| `[`workspace/SMOKE.md`](workspace/SMOKE.md)` | `[`skills/code/workspace/SMOKE.md`](skills/code/workspace/SMOKE.md)` |
| ``The bundled `workspace/` holds`` | ``The bundled `skills/code/workspace/` holds`` |

Check: `grep -nE 'density-analyzer|analyze-(code-)?density' plugins/ml-slop/README.md` prints nothing, and `rmdir plugins/text-density-analyzer/.claude-plugin plugins/text-density-analyzer/skills plugins/text-density-analyzer plugins/code-density-analyzer/.claude-plugin plugins/code-density-analyzer/skills plugins/code-density-analyzer` succeeds (the directories are empty).

- [ ] **Step 6: Swap marketplace entries**

```bash
swap_entries "$(jq -c '{name, source: "./plugins/ml-slop", description, version, license, author: {name: .author.name}, category: "development", keywords}' plugins/ml-slop/.claude-plugin/plugin.json)" \
  text-density-analyzer code-density-analyzer
```

- [ ] **Step 7: Verify**

Run: `bash scripts/validate-naming.sh | grep ml-slop`
Expected: `✓ /ml-slop:text` and `✓ /ml-slop:code`, and no `✗` line mentioning `ml-slop`. The script still exits 1 because of the other plugins.

Run: `claude plugin validate plugins/ml-slop`
Expected: `✔ Validation passed`, and no warning mentions `name`.

- [ ] **Step 8: Commit**

```bash
git add -A plugins/ml-slop plugins/text-density-analyzer plugins/code-density-analyzer .claude-plugin/marketplace.json
git commit -m "♻️ refactor(ml-slop): merge the text and code density analyzers"
```

---

### Task 3: `ml-workplace` (atlassian + fellow)

**Files:**
- Move: `plugins/atlassian/skills/atlassian/` → `plugins/ml-workplace/skills/atlassian/`
- Move: `plugins/fellow/skills/fellow/` → `plugins/ml-workplace/skills/fellow/`
- Move: `plugins/fellow/LICENSE` → `plugins/ml-workplace/LICENSE`
- Move: `plugins/fellow/.claude-plugin/plugin.json` → `plugins/ml-workplace/.claude-plugin/plugin.json` (then rewrite)
- Create: `plugins/ml-workplace/README.md`
- Delete: `plugins/atlassian/{LICENSE,README.md,.claude-plugin/plugin.json}`, `plugins/fellow/README.md`
- Modify: `plugins/agent-config/skills/agent-config/scripts/vendor.sh:19`
- Modify: `plugins/agent-config/skills/agent-config/SKILL.md:58`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: validator (Task 1), `swap_entries`.
- Produces: `/ml-workplace:atlassian`, `/ml-workplace:fellow`. The fellow vendor path becomes `plugins/ml-workplace/skills/fellow/scripts/lib/vendor/agent-config`, which Task 5 relies on.

- [ ] **Step 1: Move files**

```bash
mkdir -p plugins/ml-workplace/skills plugins/ml-workplace/.claude-plugin
git mv plugins/atlassian/skills/atlassian plugins/ml-workplace/skills/atlassian
git mv plugins/fellow/skills/fellow       plugins/ml-workplace/skills/fellow
git mv plugins/fellow/LICENSE             plugins/ml-workplace/LICENSE
git mv plugins/fellow/.claude-plugin/plugin.json plugins/ml-workplace/.claude-plugin/plugin.json
git rm -q plugins/atlassian/LICENSE plugins/atlassian/.claude-plugin/plugin.json
```

The skill frontmatter names (`atlassian`, `fellow`) already match their directories. Leave them as they are.

- [ ] **Step 2: Point the fellow vendor path at its new home**

In `plugins/agent-config/skills/agent-config/scripts/vendor.sh` replace
`  "plugins/fellow/skills/fellow/scripts/lib/vendor/agent-config"` with
`  "plugins/ml-workplace/skills/fellow/scripts/lib/vendor/agent-config"`.

In `plugins/agent-config/skills/agent-config/SKILL.md` replace
`` `plugins/fellow/skills/fellow/scripts/lib/config.ts` `` with
`` `plugins/ml-workplace/skills/fellow/scripts/lib/config.ts` ``.

Run: `plugins/agent-config/skills/agent-config/scripts/vendor.sh check`
Expected: six `ok` lines, then `All vendored copies match the canonical library.`

- [ ] **Step 3: Write `plugin.json`**

Overwrite `plugins/ml-workplace/.claude-plugin/plugin.json`:

```json
{
  "name": "ml-workplace",
  "description": "The tools a team works in, driven from Claude Code through bundled zero-dependency bun CLIs, no MCP server. atlassian: Jira and Confluence over REST — JQL search, create, comment, and transition issues, sprints and boards, read and write Confluence pages, Cloud and Data Center. fellow: read-only Fellow meeting notes, transcripts, AI summaries, and action items, with recaps filed into a repo.",
  "version": "0.3.0",
  "license": "MIT",
  "author": {
    "name": "Max Levitskiy",
    "url": "https://github.com/Max-Levitskiy"
  },
  "homepage": "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-workplace",
  "keywords": [
    "atlassian",
    "jira",
    "confluence",
    "tickets",
    "issues",
    "backlog",
    "sprint",
    "wiki",
    "fellow",
    "meetings",
    "meeting-notes",
    "transcripts",
    "action-items",
    "meeting-recap",
    "api",
    "claude-skill"
  ]
}
```

- [ ] **Step 4: Build the merged README**

Old READMEs: atlassian intro at line 3, body at lines 9–52; fellow intro at line 3, body at lines 9–100. Links inside both bodies (`skills/<skill>/…`, `../../standards/agent-config.md`) still resolve from the new plugin root.

````bash
A=plugins/atlassian/README.md
W=plugins/fellow/README.md
{
cat <<'EOF'
# ml-workplace

The tools a team works in — issue tracker, wiki, meeting notes — driven from Claude Code.
Each skill ships a zero-dependency `bun` CLI and needs no MCP server.

```bash
/plugin install ml-workplace@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-workplace:atlassian` | Jira and Confluence over REST: JQL, issues, transitions, sprints, pages. Cloud and Data Center |
| `/ml-workplace:fellow` | Read-only Fellow meeting notes, transcripts, AI summaries, and action items |

## `/ml-workplace:atlassian`

EOF
sed -n '3p' "$A"; echo
sed -n '9,52p' "$A" | sed 's/^## /### /'
echo; echo '## `/ml-workplace:fellow`'; echo
sed -n '3p' "$W"; echo
sed -n '9,100p' "$W" | sed 's/^## /### /'
cat <<'EOF'

## License

[MIT](LICENSE)
EOF
} > plugins/ml-workplace/README.md
git rm -q "$A" "$W"
rmdir plugins/atlassian/.claude-plugin plugins/atlassian/skills plugins/atlassian plugins/fellow/.claude-plugin plugins/fellow/skills plugins/fellow
````

Check: `grep -nE '@max-skills|/(atlassian|fellow):' plugins/ml-workplace/README.md` prints only the `ml-workplace@max-skills` install line.

- [ ] **Step 5: Swap marketplace entries**

```bash
swap_entries "$(jq -c '{name, source: "./plugins/ml-workplace", description, version, license, author: {name: .author.name}, category: "productivity", keywords}' plugins/ml-workplace/.claude-plugin/plugin.json)" \
  atlassian fellow
```

- [ ] **Step 6: Verify**

Run: `cd plugins/ml-workplace/skills/atlassian/scripts && bun test; cd -`
Expected: all tests pass, 0 fail.

Run: `bun plugins/ml-workplace/skills/fellow/scripts/fellow.ts --help 2>&1 | head -1`
Expected: `Fellow API CLI (read-only)`. A `Cannot find module` error would mean a vendored import broke in the move.

Run: `bash scripts/validate-naming.sh | grep ml-workplace`
Expected: `✓ /ml-workplace:atlassian`, `✓ /ml-workplace:fellow`, and no `✗` line mentioning `ml-workplace`.

Run: `claude plugin validate plugins/ml-workplace`
Expected: `✔ Validation passed`, and no warning mentions `name`.

- [ ] **Step 7: Commit**

```bash
git add -A plugins/ml-workplace plugins/atlassian plugins/fellow plugins/agent-config .claude-plugin/marketplace.json
git commit -m "♻️ refactor(ml-workplace): group the atlassian and fellow skills"
```

---

### Task 4: `ml-subagents` (orchestrate + herdr)

**Files:**
- Move: `plugins/orchestrate/skills/orchestrate/` → `plugins/ml-subagents/skills/orchestrate/`
- Move: `plugins/herdr/skills/herdr/` → `plugins/ml-subagents/skills/herdr/`
- Move: `plugins/orchestrate/LICENSE` → `plugins/ml-subagents/LICENSE`
- Move: `plugins/orchestrate/.claude-plugin/plugin.json` → `plugins/ml-subagents/.claude-plugin/plugin.json` (then rewrite)
- Create: `plugins/ml-subagents/README.md`
- Delete: `plugins/herdr/{LICENSE,README.md,.claude-plugin/plugin.json}`, `plugins/orchestrate/README.md`
- Modify: `plugins/agent-config/skills/agent-config/scripts/vendor.sh:20-21`
- Modify: `plugins/ml-subagents/skills/orchestrate/SKILL.md:91`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: validator (Task 1), `swap_entries`.
- Produces: `/ml-subagents:orchestrate`, `/ml-subagents:herdr`. The vendor paths become `plugins/ml-subagents/skills/{herdr,orchestrate}/scripts/lib/vendor/agent-config`, which Task 5 relies on.

- [ ] **Step 1: Move files**

```bash
mkdir -p plugins/ml-subagents/skills plugins/ml-subagents/.claude-plugin
git mv plugins/orchestrate/skills/orchestrate plugins/ml-subagents/skills/orchestrate
git mv plugins/herdr/skills/herdr             plugins/ml-subagents/skills/herdr
git mv plugins/orchestrate/LICENSE            plugins/ml-subagents/LICENSE
git mv plugins/orchestrate/.claude-plugin/plugin.json plugins/ml-subagents/.claude-plugin/plugin.json
git rm -q plugins/herdr/LICENSE plugins/herdr/.claude-plugin/plugin.json
```

- [ ] **Step 2: Update vendor paths and the agent-config cross-reference**

In `plugins/agent-config/skills/agent-config/scripts/vendor.sh` replace
```
  "plugins/herdr/skills/herdr/scripts/lib/vendor/agent-config"
  "plugins/orchestrate/skills/orchestrate/scripts/lib/vendor/agent-config"
```
with
```
  "plugins/ml-subagents/skills/herdr/scripts/lib/vendor/agent-config"
  "plugins/ml-subagents/skills/orchestrate/scripts/lib/vendor/agent-config"
```

In `plugins/ml-subagents/skills/orchestrate/SKILL.md` replace
``**The `agent-config` skill owns the`` with ``**The `ml-agent-config:setup` skill owns the``.
(The rename to `setup` happens in Task 5. This line already names the final command.)

Run: `plugins/agent-config/skills/agent-config/scripts/vendor.sh check`
Expected: six `ok` lines, then `All vendored copies match the canonical library.`

- [ ] **Step 3: Write `plugin.json`**

Overwrite `plugins/ml-subagents/.claude-plugin/plugin.json`:

```json
{
  "name": "ml-subagents",
  "description": "Run and coordinate AI subagents. orchestrate runs a multi-part task as small, tracked, parallel work packages with an async question protocol, so waiting on human decisions never blocks progress. herdr starts, messages, reads, and stops subagents in herdr panes from named presets, and drives the herdr terminal workspace manager: workspaces, worktrees, tabs, and panes.",
  "version": "0.3.0",
  "license": "MIT",
  "author": {
    "name": "Max Levitskiy",
    "url": "https://github.com/Max-Levitskiy"
  },
  "homepage": "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-subagents",
  "keywords": [
    "subagents",
    "orchestration",
    "parallel-agents",
    "async",
    "work-packages",
    "task-tracking",
    "autonomous",
    "herdr",
    "terminal",
    "workspace",
    "worktree",
    "tmux-alternative",
    "multi-agent",
    "agent-orchestration",
    "panes",
    "claude-skill"
  ]
}
```

- [ ] **Step 4: Build the merged README**

Old READMEs: orchestrate intro at line 3, body at lines 9–86; herdr intro at line 3, body at lines 9–93. The herdr body opens with its "Requires the `herdr` binary…" paragraph.

````bash
O=plugins/orchestrate/README.md
H=plugins/herdr/README.md
{
cat <<'EOF'
# ml-subagents

Run and coordinate AI subagents from Claude Code.

```bash
/plugin install ml-subagents@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-subagents:orchestrate` | Split a multi-part task into tracked, parallel work packages, and collect the decisions only you can make |
| `/ml-subagents:herdr` | Start, message, read, and stop subagents in herdr panes, and drive the herdr workspace manager |

## `/ml-subagents:orchestrate`

EOF
sed -n '3p' "$O"; echo
sed -n '9,86p' "$O" | sed 's/^## /### /'
echo; echo '## `/ml-subagents:herdr`'; echo
sed -n '3p' "$H"; echo
sed -n '9,93p' "$H" | sed 's/^## /### /'
cat <<'EOF'

## License

[MIT](LICENSE)
EOF
} > plugins/ml-subagents/README.md
git rm -q "$O" "$H"
rmdir plugins/orchestrate/.claude-plugin plugins/orchestrate/skills plugins/orchestrate plugins/herdr/.claude-plugin plugins/herdr/skills plugins/herdr
````

Check: `grep -nE '@max-skills|/(orchestrate|herdr):' plugins/ml-subagents/README.md` prints only the `ml-subagents@max-skills` install line.

- [ ] **Step 5: Swap marketplace entries**

```bash
swap_entries "$(jq -c '{name, source: "./plugins/ml-subagents", description, version, license, author: {name: .author.name}, category: "development", keywords}' plugins/ml-subagents/.claude-plugin/plugin.json)" \
  orchestrate herdr
```

- [ ] **Step 6: Verify**

Run: `bun plugins/ml-subagents/skills/orchestrate/scripts/orchestrate-config.ts help 2>&1 | head -1`
Expected: `orchestrate config (ACS v1)`

Run: `bun plugins/ml-subagents/skills/herdr/scripts/herdr-agent.ts --help 2>&1 | head -1`
Expected: `herdr-agent.ts presets [--json]`. A `Cannot find module` error from either would mean a vendored import broke in the move.

Run: `bash scripts/validate-naming.sh | grep ml-subagents`
Expected: `✓ /ml-subagents:orchestrate`, `✓ /ml-subagents:herdr`, and no `✗` line mentioning `ml-subagents`.

Run: `claude plugin validate plugins/ml-subagents`
Expected: `✔ Validation passed`, and no warning mentions `name`.

- [ ] **Step 7: Commit**

```bash
git add -A plugins/ml-subagents plugins/orchestrate plugins/herdr plugins/agent-config .claude-plugin/marketplace.json
git commit -m "♻️ refactor(ml-subagents): group the orchestrate and herdr skills"
```

---

### Task 5: `ml-agent-config` (agent-config → setup)

**Files:**
- Move: `plugins/agent-config/` → `plugins/ml-agent-config/`
- Move: `plugins/ml-agent-config/skills/agent-config/` → `plugins/ml-agent-config/skills/setup/`
- Modify: `plugins/ml-agent-config/skills/setup/SKILL.md` (frontmatter + two paths)
- Modify: `plugins/ml-agent-config/skills/setup/scripts/vendor.sh:15,29-31`
- Modify: `plugins/ml-agent-config/.claude-plugin/plugin.json`
- Modify: `plugins/ml-agent-config/README.md`
- Modify: `plugins/ml-agent-config/agent-config.schema.json:3`
- Modify: `plugins/ml-agent-config/docs/working-actions.md:175-176,179,210-211`
- Regenerate: the six vendored files under `plugins/ml-{workplace,subagents}/skills/*/scripts/lib/vendor/agent-config/`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: the vendor consumer paths from Tasks 3 and 4.
- Produces: `/ml-agent-config:setup`. Canonical library at `plugins/ml-agent-config/skills/setup/lib/`. `vendor.sh` at `plugins/ml-agent-config/skills/setup/scripts/vendor.sh`.

- [ ] **Step 1: Move files**

```bash
git mv plugins/agent-config plugins/ml-agent-config
git mv plugins/ml-agent-config/skills/agent-config plugins/ml-agent-config/skills/setup
```

- [ ] **Step 2: Rename the skill and fix its paths**

In `plugins/ml-agent-config/skills/setup/SKILL.md`:
- line 2: `name: agent-config` → `name: setup`
- `plugins/agent-config/skills/agent-config/scripts/vendor.sh` → `plugins/ml-agent-config/skills/setup/scripts/vendor.sh`
- `plugins/agent-config/skills/agent-config/lib/` → `plugins/ml-agent-config/skills/setup/lib/`

- [ ] **Step 3: Repoint `vendor.sh` and re-sync**

In `plugins/ml-agent-config/skills/setup/scripts/vendor.sh`:
- `CANON="$ROOT/plugins/agent-config/skills/agent-config/lib"` → `CANON="$ROOT/plugins/ml-agent-config/skills/setup/lib"`
- in `header()`, replace each of the three `plugins/agent-config/skills/agent-config/` with `plugins/ml-agent-config/skills/setup/`

Run:
```bash
plugins/ml-agent-config/skills/setup/scripts/vendor.sh sync
plugins/ml-agent-config/skills/setup/scripts/vendor.sh check
git diff --stat -- 'plugins/ml-*/skills/*/scripts/lib/vendor'
```
Expected: `check` ends with `All vendored copies match the canonical library.` The diff stat shows the six vendored files, with only the three header lines changed in each.

- [ ] **Step 4: Update `plugin.json`, the schema id, and the docs' install lookup**

`plugins/ml-agent-config/.claude-plugin/plugin.json`: set `"name": "ml-agent-config"`, `"version": "0.3.0"`, and `"homepage": "https://github.com/Max-Levitskiy/skills/tree/main/plugins/ml-agent-config"`. Leave the other fields alone.

`plugins/ml-agent-config/agent-config.schema.json` line 3: replace `/plugins/agent-config/agent-config.schema.json` with `/plugins/ml-agent-config/agent-config.schema.json`.

`plugins/ml-agent-config/docs/working-actions.md`: the plugin cache folder is named after the plugin, so the fallback globs have to change. Replace every `/plugins/cache/*/agent-config/*/bin/agent-config` (four places, lines 175, 176, 210, 211) with `/plugins/cache/*/ml-agent-config/*/bin/agent-config`. On line 179 replace `tree/main/plugins/agent-config` with `tree/main/plugins/ml-agent-config`.

- [ ] **Step 5: Update the README**

In `plugins/ml-agent-config/README.md`:

| Old | New |
| --- | --- |
| `# agent-config` | `# ml-agent-config` |
| `/plugin install agent-config@max-skills` | `/plugin install ml-agent-config@max-skills` |
| `plugins/agent-config/skills/agent-config/scripts/vendor.sh sync` | `plugins/ml-agent-config/skills/setup/scripts/vendor.sh sync` |
| `plugins/agent-config/skills/agent-config/scripts/vendor.sh check` | `plugins/ml-agent-config/skills/setup/scripts/vendor.sh check` |
| `agent-config/` (first line of the "What's in the box" tree) | `ml-agent-config/` |
| `├── skills/agent-config/` | `├── skills/setup/` |
| ``Ask Claude. It invokes this skill,`` | ``Ask Claude. It invokes `/ml-agent-config:setup`,`` |

- [ ] **Step 6: Swap the marketplace entry**

```bash
swap_entries "$(jq -c '{name, source: "./plugins/ml-agent-config", description, version, license, author: {name: .author.name}, category: "development", keywords}' plugins/ml-agent-config/.claude-plugin/plugin.json)" \
  agent-config
```

- [ ] **Step 7: Verify**

Run: `bash scripts/validate-naming.sh; echo "exit=$?"`
Expected: exactly seven `✓` lines (`/ml-slop:text`, `/ml-slop:code`, `/ml-workplace:atlassian`, `/ml-workplace:fellow`, `/ml-subagents:orchestrate`, `/ml-subagents:herdr`, `/ml-agent-config:setup`), no `✗`, `Naming is valid.`, `exit=0`.

Run: `plugins/ml-agent-config/bin/agent-config --help 2>&1 | head -1`
Expected: `agent-config <command>`

Run: `claude plugin validate plugins/ml-agent-config`
Expected: `✔ Validation passed`, and no warning mentions `name`.

- [ ] **Step 8: Commit**

```bash
git add -A plugins .claude-plugin/marketplace.json
git commit -m "♻️ refactor(ml-agent-config): rename the plugin and its skill to setup"
```

---

### Task 6: Repo docs and the ADR

**Files:**
- Create: `docs/adr/0001-ml-plugin-namespacing.md`
- Modify: `README.md:15,41,54-62,70`
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`
- Modify: `standards/agent-config.md:5,28,166`
- Modify: `docs/proposals/atlassian-multi-site-routing.md:214`

**Interfaces:**
- Consumes: final names from Tasks 2–5, and `scripts/validate-naming.sh`.

- [ ] **Step 1: Write the ADR**

`docs/adr/0001-ml-plugin-namespacing.md`:

```markdown
# 0001 — Plugins are `ml-<domain>`; skills are bare

**Date:** 2026-09-19 · **Status:** accepted

## Context

Seven plugins each held one skill named after the plugin (`/fellow:fellow`), with
nothing marking them as this marketplace's and no room for a second skill. Claude Code
namespaces a plugin's skills as `<plugin.json name>:<skill name>` — one level, added
by the harness.

## Decision

- A plugin is named `ml-<domain>`, lowercase kebab-case, and the same string is its
  `plugins/` directory, its marketplace entry `name`, and its `plugin.json` `name`.
  `<domain>` says what the plugin is for, not which tool its first skill wraps.
- A skill's frontmatter `name:` equals its directory and is bare: `text`, never
  `ml-slop:text` (that yields `/ml-slop:ml-slop:text`).
- `scripts/validate-naming.sh` enforces both.

## Why `ml-` and not `ml:`

A colon in `plugin.json`'s `name` does work: installed from a marketplace, Claude Code
2.1.278 resolves `/ml:slop:text`. But claude.ai marketplace sync requires kebab-case
plugin names and rejects the colon, and these plugins must sync there. If that
constraint ever lifts, only the `plugin.json` `name` field would change.

## Consequences

- Grouped skills install together, and every installed skill's description costs context
  in every session. Group by what a user wants together, not by theme alone.
- Config names (`~/.agents/config/<name>/`) name the tool, not the plugin, so renaming or
  regrouping a plugin never moves a user's settings.
- Renaming a plugin is a hard cut for existing installs: they must uninstall the old name
  and install the new one.
```

- [ ] **Step 2: Rewrite the root README's plugin table and add the migration block**

In `README.md`, replace the two occurrences of `/plugin install <plugin-name>@max-skills` (lines 15 and 41) with `/plugin install ml-<domain>@max-skills`.

Replace the whole `## Plugins` table (lines 54–62: the header row, the separator row, and seven data rows) with:

````markdown
Every skill is invoked as `/ml-<plugin>:<skill>`.

| Plugin | Skills | What it's for | Install |
| ------ | ------ | ------------- | ------- |
| [`ml-slop`](plugins/ml-slop) | `/ml-slop:text` · `/ml-slop:code` | Find and score AI-generation slop in prose and in code: repeated meaning, filler, duplication, dead code, over-abstraction. Text can also be rewritten to remove it. | `/plugin install ml-slop@max-skills` |
| [`ml-workplace`](plugins/ml-workplace) | `/ml-workplace:atlassian` · `/ml-workplace:fellow` | The tools a team works in. Jira and Confluence over REST (Cloud and Data Center), and read-only Fellow meeting notes, transcripts, and action items. Bundled `bun` CLIs, no MCP server. | `/plugin install ml-workplace@max-skills` |
| [`ml-subagents`](plugins/ml-subagents) | `/ml-subagents:orchestrate` · `/ml-subagents:herdr` | Run and coordinate AI subagents: split a task into tracked parallel work packages with an async question protocol, or drive subagents in herdr panes from named presets. | `/plugin install ml-subagents@max-skills` |
| [`ml-agent-config`](plugins/ml-agent-config) | `/ml-agent-config:setup` | Layered settings for any skill or subagent — global, repo, and a gitignored local layer — plus credentials referenced from 1Password, the environment, a dotenv file, Keychain, or any command, so a secret never lands in a config file. | `/plugin install ml-agent-config@max-skills` |

### Migrating from the old plugin names

On 2026-09-19 the seven single-skill plugins were regrouped. Old installs stop receiving
updates; swap them once:

| Old plugin | Now |
| --- | --- |
| `text-density-analyzer`, `code-density-analyzer` | `ml-slop` → `/ml-slop:text`, `/ml-slop:code` |
| `atlassian`, `fellow` | `ml-workplace` → `/ml-workplace:atlassian`, `/ml-workplace:fellow` |
| `orchestrate`, `herdr` | `ml-subagents` → `/ml-subagents:orchestrate`, `/ml-subagents:herdr` |
| `agent-config` | `ml-agent-config` → `/ml-agent-config:setup` |

```bash
/plugin uninstall fellow@max-skills            # repeat for each old name you have installed
/plugin marketplace update max-skills
/plugin install ml-workplace@max-skills        # repeat for each new plugin you want
```

Saved settings under `~/.agents/config/` keep working; nothing there moves.
````

In the `## Standards` table row (line 70), replace
``Canonical implementation: [`agent-config`](plugins/agent-config). Reference implementations: [`fellow`](plugins/fellow) (credential-backed) and [`orchestrate`](plugins/orchestrate) (optional config, credential only for hosted trackers).``
with
``Canonical implementation: [`ml-agent-config`](plugins/ml-agent-config). Reference implementations: [`fellow`](plugins/ml-workplace/skills/fellow) (credential-backed) and [`orchestrate`](plugins/ml-subagents/skills/orchestrate) (optional config, credential only for hosted trackers).``

In `## Add your own plugin`, replace step 1 and step 2 with:

```markdown
1. Drop your plugin under `plugins/ml-<domain>/` with a `.claude-plugin/plugin.json` whose `name` is `ml-<domain>`. Name `<domain>` for what the plugin is for, so a second skill can join it later.
2. Register it in `.claude-plugin/marketplace.json` with the same `name` and a `./plugins/ml-<domain>` source, then run `bash scripts/validate-naming.sh`.
```

- [ ] **Step 3: Add the naming rules to CONTRIBUTING.md**

Insert this section before `## 1. Add your plugin files`:

```markdown
## Naming

Every skill in this marketplace is invoked as `/ml-<domain>:<skill>`.

| Thing | Value | Example |
| --- | --- | --- |
| Plugin directory, marketplace entry `name`, `plugin.json` `name` | `ml-<domain>`, all three identical | `ml-slop` |
| Skill directory and its `SKILL.md` frontmatter `name:` | bare kebab-case, identical | `text` |

`<domain>` names what the plugin is for, not the tool its first skill wraps, so a second
skill can join without a rename. Never put the plugin name in a skill's `name:`: Claude Code
adds the prefix itself. `bash scripts/validate-naming.sh` checks all of this; the reasoning is
in [ADR 0001](docs/adr/0001-ml-plugin-namespacing.md).
```

Then, in the rest of CONTRIBUTING.md, replace every `my-plugin` with `ml-my-domain`. That covers the directory tree, the minimal `plugin.json`, the marketplace entry, the `source` path, and the local test command `/plugin install ml-my-domain@max-skills`. Leave the external-repo example's `"repo": "owner/repo"` as it is. Add one line after the step 3 test commands:

```markdown
Run `bash scripts/validate-naming.sh` — it must end with `Naming is valid.`
```

- [ ] **Step 4: Point AGENTS.md at the rules**

Append to `AGENTS.md`:

```markdown
## Plugin naming

Plugins are `ml-<domain>` and skills are bare, giving `/ml-<domain>:<skill>`. The rules are
in CONTRIBUTING.md § Naming and ADR 0001. Run `bash scripts/validate-naming.sh` after adding,
renaming, or moving any plugin or skill.
```

- [ ] **Step 5: Update the Agent Config Standard**

`standards/agent-config.md` line 5: replace
``Canonical implementation: [`plugins/agent-config`](../plugins/agent-config). Reference implementations: [`fellow`](../plugins/fellow) (credential-backed), [`orchestrate`](../plugins/orchestrate) (optional config), and [`herdr`](../plugins/herdr) (no credential at all — presets only).``
with
``Canonical implementation: [`plugins/ml-agent-config`](../plugins/ml-agent-config). Reference implementations: [`fellow`](../plugins/ml-workplace/skills/fellow) (credential-backed), [`orchestrate`](../plugins/ml-subagents/skills/orchestrate) (optional config), and [`herdr`](../plugins/ml-subagents/skills/herdr) (no credential at all — presets only).``

Line 28 says one config name per plugin, which stops being true once a plugin holds several tools. Replace the whole paragraph that starts ``<name>` is the skill name, the subagent name, or the plugin name`` with:

```markdown
`<name>` names one tool — the skill name, or the name a skill and its subagent share. One namespace, deliberately: a skill and its subagent are the same tool wearing two hats, and they should read the same file. Forcing two configs would make the user answer the same questions twice and then keep both copies in sync by hand. Pick one name per tool and use it from every component that serves that tool. A plugin holding several tools uses several names (`ml-workplace` reads both `fellow` and `atlassian`), and a name never changes when its plugin is renamed or regrouped. Names are directory names, so different tools never collide.
```

Line 166: replace ``[`plugins/agent-config`](../plugins/agent-config)`` with ``[`plugins/ml-agent-config`](../plugins/ml-agent-config)``.

- [ ] **Step 6: Update the live proposal's path**

`docs/proposals/atlassian-multi-site-routing.md` line 214: replace `plugins/atlassian/skills/atlassian/` with `plugins/ml-workplace/skills/atlassian/`.

- [ ] **Step 7: Check for stale names**

```bash
git ls-files | grep -vE '^docs/(superpowers|orchestration)/' | xargs grep -nE \
  '\b(text-density-analyzer|code-density-analyzer|analyze-density|analyze-code-density)\b|plugins/(agent-config|atlassian|fellow|herdr|orchestrate)\b|(^|[^-a-z])(agent-config|atlassian|fellow|herdr|orchestrate)@max-skills|/(fellow|herdr|orchestrate|atlassian|agent-config):|skills/agent-config\b|cache/\*/agent-config/' \
  | grep -v 'formerly'
```

Expected matches only: the README's "Migrating from the old plugin names" table and its `/plugin uninstall fellow@max-skills` line; the ADR's `/fellow:fellow` example; the SMOKE.md "(named `analyze-code-density` at the time)" line. Fix anything else.

Link check (every relative Markdown link in a changed file resolves):

```bash
for f in README.md CONTRIBUTING.md AGENTS.md standards/agent-config.md docs/adr/0001-ml-plugin-namespacing.md plugins/ml-*/README.md; do
  d=$(dirname "$f")
  grep -oE '\]\([^)#:]+' "$f" | sed 's/^](//' | while read -r l; do [ -e "$d/$l" ] || echo "BROKEN $f -> $l"; done
done
```
Expected: no `BROKEN` lines.

- [ ] **Step 8: Commit**

```bash
git add -A README.md CONTRIBUTING.md AGENTS.md standards docs/adr docs/proposals
git commit -m "📝 docs(marketplace): document ml- naming and the migration from old names"
```

---

### Task 7: End-to-end verification

**Files:** none modified unless a check fails. A fix goes into its own commit that names the check it fixes.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Static checks**

```bash
bash scripts/validate-naming.sh
for p in plugins/ml-*; do claude plugin validate "$p" 2>&1 | tail -2; done
claude plugin validate . 2>&1 | tail -2
plugins/ml-agent-config/skills/setup/scripts/vendor.sh check | tail -1
(cd plugins/ml-workplace/skills/atlassian/scripts && bun test 2>&1 | tail -3)
```

Expected: `Naming is valid.`. Five `✔ Validation passed` results (four plugins plus the marketplace). The marketplace already warns that it has no description, which is fine, but no warning may mention `name`. `All vendored copies match the canonical library.` And `bun test` reports 0 fail.

- [ ] **Step 2: Install the working tree as a marketplace in a throwaway project**

The user already has a GitHub marketplace named `max-skills` registered, so the copy gets a different name:

```bash
S=$(mktemp -d)
rsync -a --exclude .git ./ "$S/mp/"
jq '.name = "max-skills-e2e"' "$S/mp/.claude-plugin/marketplace.json" > "$S/m.json" && mv "$S/m.json" "$S/mp/.claude-plugin/marketplace.json"
mkdir "$S/proj" && cd "$S/proj" && git init -q
claude plugin marketplace add "$S/mp" --scope project
for p in ml-slop ml-workplace ml-subagents ml-agent-config; do claude plugin install "$p@max-skills-e2e" --scope project; done
for p in ml-slop ml-workplace ml-subagents ml-agent-config; do claude plugin details "$p@max-skills-e2e" | grep -E '^\S|Skills'; done
```

Expected `details` output. Skill order within a line may differ:
```
ml-slop 0.2.0
  Skills (2)  code, text
ml-workplace 0.3.0
  Skills (2)  atlassian, fellow
ml-subagents 0.3.0
  Skills (2)  herdr, orchestrate
ml-agent-config 0.3.0
  Skills (1)  setup
```

- [ ] **Step 3: Confirm the commands resolve**

```bash
cd "$S/proj" && claude -p --model haiku "List the exact names of every available skill or slash command that starts with 'ml-'. Output the names only, one per line, nothing else."
```

Expected, in any order: `ml-slop:text`, `ml-slop:code`, `ml-workplace:atlassian`, `ml-workplace:fellow`, `ml-subagents:orchestrate`, `ml-subagents:herdr`, `ml-agent-config:setup`.

- [ ] **Step 4: Clean up the throwaway install**

```bash
cd "$S/proj"
for p in ml-slop ml-workplace ml-subagents ml-agent-config; do claude plugin uninstall "$p@max-skills-e2e" --scope project; done
claude plugin marketplace remove max-skills-e2e
cd / && rm -rf "$S"
claude plugin marketplace list | grep -c max-skills-e2e   # expect 0
```

- [ ] **Step 5: Report**

Summarize for the user:
- which checks passed;
- the branch's commit list (`git log --oneline main..ml-namespacing`);
- the reinstall commands for their own machine, where six `@max-skills` plugins are installed today (`herdr`, `fellow`, `agent-config`, `code-density-analyzer`, `atlassian`, and the already-removed `code-comment-guidelines`).

Do not push, merge, or reinstall anything on the user's machine without their go-ahead.
