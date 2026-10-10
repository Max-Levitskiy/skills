#!/usr/bin/env bash
# Check that a set of PR branches covers a cleanup branch exactly (read-only).
#
#   partition-check.sh BASE CLEANUP_BRANCH PR_BRANCH...
#
# Reports files the cleanup changed that no PR covers, files a PR changed that
# the cleanup did not, files covered by more than one PR (expected only for
# stacked branches), and files whose content in a PR differs from the cleanup.
# Exit 1 on any missing, extra or mismatched file.
set -euo pipefail

[ $# -ge 3 ] || { sed -n '2,9p' "$0"; exit 2; }
base=$1 src=$2; shift 2
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

git diff --name-only --no-renames "$base" "$src" | sort -u > "$tmp/src"
: > "$tmp/all"; : > "$tmp/mismatch"
for b in "$@"; do
  git diff --name-only --no-renames "$base" "$b" | sort -u > "$tmp/b"
  cat "$tmp/b" >> "$tmp/all"
  while read -r f; do
    [ -n "$f" ] || continue
    if ! git diff --quiet "$src" "$b" -- "$f"; then echo "MISMATCH $b: $f" | tee -a "$tmp/mismatch"; fi
  done < "$tmp/b"
done
sort "$tmp/all" | uniq -d > "$tmp/dup"
sort -u "$tmp/all" > "$tmp/union"

status=0
comm -23 "$tmp/src" "$tmp/union" | sed 's/^/MISSING (no PR covers): /' | tee "$tmp/missing"
comm -13 "$tmp/src" "$tmp/union" | sed 's/^/EXTRA (not in cleanup): /' | tee "$tmp/extra"
sed 's/^/IN SEVERAL PRS (ok if stacked): /' "$tmp/dup"
if [ -s "$tmp/missing" ] || [ -s "$tmp/extra" ] || [ -s "$tmp/mismatch" ]; then status=1; fi
echo "cleanup files: $(wc -l < "$tmp/src" | tr -d ' ') · covered: $(wc -l < "$tmp/union" | tr -d ' ') · branches: $#"
exit $status
