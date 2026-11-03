# facts

```bash
bun <this-skill-dir>/scripts/pr-facts.ts [github|gitlab] [PR]   # number, URL, or omit for the current branch
```

Outcomes: exit 2 prints the open PRs (`ambiguous`), exit 3 means there are none (`no-open-prs`). `mergeable: CONFLICTING` is `conflicting`, whatever CI says.

- A PR already merged or closed is `ok`: judge what was asked, safety rather than readiness, and say it landed.
- `mergeable: UNKNOWN` is not a conflict. It is computed lazily: poll again.
- Only the checks named in the branch rules block a merge. A failing advisory check is still evidence.
- `BLOCKED` with every check green usually means a required review.
- Convention docs hold rules no API exposes, such as the trailers a release tool reads.
- In `choose_pr`, list number, author and subject, most recently updated first, or red first if the question was about a pipeline.
