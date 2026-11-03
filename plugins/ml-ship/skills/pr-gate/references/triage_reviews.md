# triage_reviews

The facts list unresolved threads, top-level bot comments and review bodies. Status notices (preview URLs, coverage, summaries) are not findings. Read each finding in full, and the code it points at.

| Outcome | When | Action |
|---|---|---|
| Fix | True and in this PR's scope | Queue it for `fix`. When the walk returns here with the fix pushed, reply `Fixed in <sha>: <what>.` and resolve |
| Decline | False, already handled, or against the repo's conventions | Reply `Not changing: <reason>. <file:line, test or doc>.` and resolve |
| Escalate | True but out of scope, or needs a product decision | Reply with what you found, leave it open, report it |

Any queued fix makes the node's outcome `fixes`.

- An outdated thread means its lines changed, not that the concern was fixed. Check the current head.
- Do not apply `suggestion` blocks with the forge button: one commit each, gates skipped.
- Humans resolve their own threads. Report them.
- A bot's "reviewing" notice, or a head pushed minutes ago in a repo where bots review, means findings are still coming. Wait if the question was readiness; otherwise say so in the report.
- On a PR someone else wrote (`author:` vs `you:`), triage and report, and ask before you reply or resolve.
- A bot arguing back gets an answer only if it brings a new fact about the code.

Done when the only agent threads left open are the ones you escalated. Re-run the facts to confirm.

## Commands

IDs come from the facts: `PRRT_` a thread, `IC_` a comment, `PRR_` a review body. GitLab's are in `references/gitlab.md`.

```bash
# read a whole thread (the facts show 160 characters); diffHunk is what the bot saw
gh api graphql -f id=PRRT_x -f query='query($id:ID!){ node(id:$id){ ... on PullRequestReviewThread { path line isOutdated comments(first:50){ nodes{ author{login} body diffHunk url } } } } }' --jq .data.node
# reply, then resolve
gh api graphql -f id=PRRT_x -f body='...' -f query='mutation($id:ID!,$body:String!){ addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id, body:$body}){ comment{ url } } }'
gh api graphql -f id=PRRT_x -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }'
# a comment or review body has no thread: read it, answer all its findings in one comment, hide the original
gh api graphql -f id=IC_x -f query='query($id:ID!){ node(id:$id){ ... on IssueComment { body } ... on PullRequestReview { body } } }' --jq .data.node.body
gh pr comment <PR> --body '<one line per finding>'
gh api graphql -f id=IC_x -f query='mutation($id:ID!){ minimizeComment(input:{subjectId:$id, classifier:RESOLVED}){ minimizedComment{ isMinimized } } }'
```
