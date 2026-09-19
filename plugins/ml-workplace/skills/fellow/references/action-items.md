# Action items

```bash
bun "$F" action-items --open --all                # every outstanding item — note the --all
bun "$F" action-items --open --all --scope all    # the whole workspace, not just this user
```

**Use `--all` here.** Pages cap at 50, and a workspace easily has more open items than that. Without it you get the first 50 and no error — an answer that looks complete and isn't. The CLI now says so when a result fills a page, but it's easier to just always pass `--all` for a question like "what's outstanding", where a partial answer is worthless.

`--scope` defaults to `assigned_to_me`, which is what people mean by "my action items". `assigned_to_others` and `all` widen it. A non-privileged API key only ever sees the authenticated user's own data, so `--scope all` returning just their items may be the key's permissions rather than the filter — mention that possibility rather than reporting it as the team having no work.

Project scoping does **not** apply to action items: the API scopes them by assignee, and an item's link back to a meeting is optional. Each row prints its source note id so you can look up the meeting when it matters.
