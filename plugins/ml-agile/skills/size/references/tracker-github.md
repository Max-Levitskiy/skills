# Tracker: GitHub issues

Everything goes through `gh`, run inside the repo, so it picks the repo from the remote. `O/R`
below is `gh repo view --json nameWithOwner --jq .nameWithOwner`.

**Where a size lives.** `config.github.project` set (`owner/number`) → that Project's field
named `config.github.field`. A number field holds a numeric scale; a single-select field holds a
label scale (one option per scale value). Empty → a label `<config.labelPrefix><value>`, e.g.
`size:5` or `size:M`.

**Project access needs the `project` token scope.** Check once per run:
`gh auth status 2>&1 | grep -q "'project'"`. Without it, use labels for this run and tell the
user in one line: `gh auth refresh -s project` enables the board.

## Read one story

```bash
gh issue view <N> --json number,title,body,labels,state,createdAt,closedAt,comments,url
```

Pass the body and the comments to the estimators as written. Size label values found on the
issue are its current size.

## Find open unsized stories

**Labels:** exclude every size label on the scale.

```bash
# scale [1,2,3,5,8,13] with prefix size:  →  -label:"size:1" -label:"size:2" …
gh issue list --state open --limit <sweep.max + 1> \
  --search '<user filter> -label:"size:1" -label:"size:2" -label:"size:3" -label:"size:5" -label:"size:8" -label:"size:13"' \
  --json number,title,labels,url
```

The user's filter goes in the same `--search`: `label:checkout`, `milestone:"Sprint 12"`,
`assignee:@me`. Fetching one more than `sweep.max` tells you whether more remain.

**Project:** list the board's items and keep open issues whose field is empty:

```bash
gh project item-list <number> --owner <owner> --format json --limit 500
```

## Find recently closed stories

```bash
gh issue list --state closed --search "reason:completed" --limit <calibration.sample> \
  --json number,title,createdAt,closedAt,labels,closedByPullRequestsReferences
```

`reason:completed` leaves out issues closed as not planned. For each linked PR:

```bash
gh pr view <P> --json additions,deletions,changedFiles,commits,reviews,files
```

**An issue with no linked PR:** search `gh pr list --state merged --search "#<N>"`, then
`git log --all --oneline --grep "#<N>"` for commits that name it. Report it as *no linked
change* rather than guessing its effort. Add comments with `gh issue view <N> --json comments`.

## Write a size

**Label:**

1. Create the label once if it is missing:
   `gh label create "<prefix><value>" --color C5DEF5 --description "Story size"`. A failure
   because it already exists is fine.
2. Swap any old size label in one call:

   ```bash
   gh issue edit <N> --add-label "size:5" --remove-label "size:3"
   ```

**Project:**

```bash
PID=$(gh project view <number> --owner <owner> --format json --jq .id)
F=$(gh project field-list <number> --owner <owner> --format json --jq '.fields[] | select(.name=="<field>")')
ITEM=$(gh project item-add <number> --owner <owner> --url <issue url> --format json --jq .id)
gh project item-edit --project-id "$PID" --id "$ITEM" --field-id <F.id> --number 5
# single-select field: --single-select-option-id <id of the option named M>
```

`item-add` returns the existing item when the issue is already on the board. If the field is
missing, or has no option for a scale value, stop and tell the user. Never create board fields
yourself.

## Create child stories

```bash
URL=$(gh issue create --title "<title>" --body-file <file> --label "<labels of the parent>")
CHILD=$(gh api "repos/O/R/issues/${URL##*/}" --jq .id)
gh api --method POST repos/O/R/issues/<parent N>/sub_issues -F sub_issue_id="$CHILD"
```

Then write the child's size as above. Each child's body carries its own acceptance criteria and
ends with `Split from #<parent>.`.
