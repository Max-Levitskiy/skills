# triage_reviews

The facts list unresolved threads, top-level comments and review bodies, from people and agents. Status notices (preview URLs, coverage, summaries) are not findings. Read each finding in full, and the code it points at.

| Outcome | When | Action |
|---|---|---|
| Fix | True and in this PR's scope | Queue it for `fix`. When the walk returns here with the fix pushed, reply `Fixed in <sha>: <what>.` and resolve an agent's thread |
| Push back | False, already handled, or against the repo's conventions | An agent's finding: reply `Not changing: <reason>. <file:line, test or doc>.` and resolve. A person's: ask first |
| Ask the person | True but out of scope, needs a product decision, or you cannot tell | Leave it open and ask, with what you found and what you recommend |

**A person's comment carries context you cannot see**, so give it the benefit of the doubt: look for what they saw before deciding they are wrong. A taste call goes their way, so it is a fix or nothing to do. Suggest pushing back only when following the comment would do harm or it rests on a checked fact that is false. Then ask the person you work for, with the evidence and a polite draft reply, and post it only if they agree. The reviewer resolves their own thread, whatever the outcome. If you cannot tell whether a person wrote it (`references/facts.md`), treat it as a person's.

Ask first: any open question makes the outcome `questions`. Their answer turns the finding into a fix or a push-back on the way back here. With no answer, keep it open and put the question and your recommendation in the report. Otherwise, any queued fix makes the outcome `fixes`.

- An outdated thread means its lines changed, not that the concern was fixed. Check the current head.
- Do not apply `suggestion` blocks with the forge button: one commit each, gates skipped.
- A bot's "reviewing" notice, or a head pushed minutes ago in a repo where bots review, means findings are still coming. Wait if the question was readiness; otherwise say so in the report.
- On a PR someone else wrote (`author:` vs `you:`), triage and report, and ask before you reply or resolve.
- A bot arguing back gets an answer only if it brings a new fact about the code.

Done when every finding has an outcome, and the only threads left open are people's and the ones you asked about. Re-run the facts to confirm.

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
