# Review comment commands

IDs come from the `REVIEW THREADS AND AGENT COMMENTS` section of `pr-facts.ts`.
A thread ID starts with `PRRT_`, a top-level comment with `IC_`, a review body
with `PRR_`.

- [Read the full thread](#read-the-full-thread)
- [Reply, then resolve](#reply-then-resolve)
- [Top-level comments and review bodies](#top-level-comments-and-review-bodies)
- [Check that nothing is left](#check-that-nothing-is-left)

---

## Read the full thread

The facts output shows 160 characters. Read the whole thing before you judge it:

```bash
gh api graphql -f id=PRRT_xxx -f query='query($id:ID!){ node(id:$id){
  ... on PullRequestReviewThread { path line isOutdated
    comments(first:50){ nodes{ author{login} body diffHunk url } } } } }' \
  --jq '.data.node'
```

`diffHunk` is the code the bot saw when it commented. If the thread is outdated,
compare it with the file at the current head before you decide.

A `suggestion` block in a comment is a patch the bot proposes. Check it like any
other claim. Do not apply it with the GitHub button: that makes one commit per
suggestion and skips the repo's gates.

---

## Reply, then resolve

Reply first, so the thread keeps the reason after it collapses:

```bash
gh api graphql -f id=PRRT_xxx -f body='Fixed in abc1234: health ports now come from the slot.' \
  -f query='mutation($id:ID!,$body:String!){
    addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id, body:$body}){ comment{ url } } }'

gh api graphql -f id=PRRT_xxx -f query='mutation($id:ID!){
    resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }'
```

Reply formats:

- Fixed: `Fixed in <short sha>: <what changed, one line>.`
- Declined: `Not changing: <reason>. <evidence: file:line, test name, or convention doc>.`

Some bots answer replies and argue. Answer a new argument only when it contains
a new fact about the code. Otherwise the thread stays resolved.

---

## Top-level comments and review bodies

These have no thread to resolve. Some bots put findings here, for example
"nitpick" lists inside a review body. Answer all the findings of one comment in
one PR comment, then hide the original as resolved:

```bash
gh pr comment <PR> --body '<one line per finding: what it said, fixed in <sha> / not changing because ...>'

gh api graphql -f id=IC_xxx -f query='mutation($id:ID!){
    minimizeComment(input:{subjectId:$id, classifier:RESOLVED}){ minimizedComment{ isMinimized } } }'
```

`minimizeComment` works for `IC_` and `PRR_` IDs. It is reversible with
`unminimizeComment`.

Read a full body by ID:

```bash
gh api graphql -f id=IC_xxx -f query='query($id:ID!){ node(id:$id){
  ... on IssueComment { body } ... on PullRequestReview { body } } }' --jq '.data.node.body'
```

---

## Check that nothing is left

Re-run `pr-facts.ts`. The agent threads still listed as unresolved must be
exactly the ones you escalated.
