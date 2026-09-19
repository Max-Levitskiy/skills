#!/usr/bin/env bash
# Builds a throwaway git repo simulating an AI PR that reimplements an
# existing util and ignores repo conventions. Used for diff-mode smoke tests.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/diff-repo"
rm -rf "$DIR" && mkdir -p "$DIR/utils" && cd "$DIR"
git init -q -b main

cat > utils/strings.py <<'EOF'
def slugify(text):
    """Lowercase, replace spaces with dashes, strip other punctuation."""
    return "".join(c for c in text.lower().replace(" ", "-") if c.isalnum() or c == "-")
EOF
git add -A && git commit -qm "existing utils"

cat > report.py <<'EOF'
def make_slug(title):
    # convert the title to lowercase
    lowered = title.lower()
    # replace all the spaces with dashes
    dashed = lowered.replace(" ", "-")
    # remove punctuation characters from the string
    cleaned = ""
    for ch in dashed:
        if ch.isalnum() or ch == "-":
            cleaned = cleaned + ch
    return cleaned


def render_report(title):
    return {"slug": make_slug(title), "title": title}
EOF
git add -A
echo "diff-repo ready: uncommitted report.py reimplements utils/strings.py:slugify"
