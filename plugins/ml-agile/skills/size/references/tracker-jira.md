# Tracker: Jira

Everything goes through the `ml-workplace:atlassian` CLI: `atlassian …` on the PATH when that
plugin is installed. Its scopes apply, so a configured `defaultScope` narrows searches the way
it narrows any other Jira command, and the output names the scope it used. Read the Atlassian
skill's own instructions only if a command fails.

**Where a size lives.** It goes in a field saved as an Atlassian skill field alias. The alias
depends on the scale, so switching scales never reuses a field of the wrong type:

| Scale | Alias | Field type (`schema.type` in `atlassian jira fields`) |
| --- | --- | --- |
| numbers | `points` | `number`: *Story Points* (company-managed) or *Story point estimate* (team-managed) |
| labels | `size` | `option`: a single-select field such as *T-Shirt Size*, one option per scale value |

1. **Read the alias** for the current scale:
   `atlassian config show --json | jq .config.fields.points` (or `.size`).
2. **Check its type** against the table: `atlassian jira fields --search <field id>`. Do this on
   every run that writes, so it catches an alias that predates a scale change. A wrong type
   counts as missing.
3. **If it is missing**, find a field of the right type with `atlassian jira fields --search
   point` (or `size`). Confirm it with the user in one line, then save the alias in the
   Atlassian skill's repo layer by merging into it:

   ```bash
   P=$("$AC" path atlassian --layer repo | jq -r '.layers[0].path')
   { cat "$P" 2>/dev/null || echo '{}'; } | jq '.fields.points = "customfield_10016"' \
     | "$AC" write atlassian --layer repo
   ```

**A label scale with no select field:** use Jira labels `<config.labelPrefix><value>` instead
(e.g. `size:M`), and tell the user once.

Below, `<alias>` is `points` or `size`, and `<alias field id>` is the `customfield_NNNNN` it
names. The CLI returns custom fields only when asked, so every read that needs the current size
lists it in `--fields`. With labels as the size store, `labels` alone carries the size.

`cf[NNNNN]` below is the number from the alias (`customfield_10016` → `cf[10016]`).

## Read one story

```bash
atlassian jira get <KEY> --comments --json --fields summary,description,status,issuetype,labels,<alias field id>
```

Pass the description and the comments to the estimators as written. The field behind `<alias>`
holds the current size.

## Find open unsized stories

```bash
atlassian jira search '<user filter> AND cf[10016] is EMPTY AND statusCategory != Done ORDER BY rank' \
  --limit <sweep.max + 1> --fields summary,status,issuetype,labels
```

The user's filter is JQL (`sprint in openSprints()`, `labels = checkout`, `project = NEO`).
Drop the leading `AND` when there is none. Leave out sub-tasks and epics
(`issuetype not in subTaskIssueTypes() AND issuetype != Epic`) unless the user asks for them.
Fetching one more than `sweep.max` tells you whether more remain. **With labels as the size
store**, replace the field clause with `(labels is EMPTY OR labels not in ("size:XS","size:S",…))`.
`not in` alone skips issues with no labels at all, which is most unsized stories. JQL cannot
match a prefix, and labels from an earlier scale still count as sizes, so search with
`--limit 200`. Drop every issue with a label starting with `config.labelPrefix`, then keep the
first `sweep.max + 1`. When all 200 come back and fewer survive, search again with `--all`.

## Find recently closed stories

```bash
atlassian jira search 'statusCategory = Done AND (resolution is EMPTY OR resolution not in ("Won'\''t Do", Duplicate)) AND issuetype not in subTaskIssueTypes() ORDER BY resolved DESC' \
  --limit <calibration.sample> --fields summary,created,resolutiondate,labels,issuetype,<alias field id> --json
```

A workflow that moves stories to Done without setting a resolution leaves `resolved` empty, so
those stories sort last. When most results come back without a `resolutiondate`, order by
`updated DESC` instead.

Comments come from `atlassian jira get <KEY> --comments`. **Linked change** comes from
whichever of these answers first:

1. `gh pr list --state merged --search "<KEY>" --json number,additions,deletions,changedFiles`,
   when the repo is on GitHub (branch names and PR titles usually carry the key).
2. `git log --all --oneline --shortstat --grep "<KEY>"` in the current repo.

When neither finds anything, mark the story *no linked change*. Its time open and comments still
count, but it ranks below stories with evidence.

## Write a size

```bash
atlassian jira update <KEY> --field points=5
atlassian jira update <KEY> --field size='{"value":"M"}'     # select field
atlassian jira update <KEY> --add-label size:M --remove-label size:S   # label store
```

`safety.readOnly` in the Atlassian config refuses every write. Report that line and stop.

## Create child stories

Check what the project accepts first: `atlassian jira meta <PROJECT> --type Story`.

```bash
atlassian jira create --project <PROJECT> --type Story --summary "<title>" \
  --description-file <file> --field <alias>=<value as in Write a size>
# label store: --labels size:M instead of --field
atlassian jira link <NEW> "Relates" <PARENT>
```

**Parent of the split:**

- If the parent is in an epic, put the children in the same epic with `--parent <EPIC>`.
- Otherwise link each child to the parent. Use `atlassian jira link-types` to find a
  "split"-style link type, and fall back to *Relates*.

Each child's description carries its own acceptance criteria and ends with
`Split from <PARENT>.`.
