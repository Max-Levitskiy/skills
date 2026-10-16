---
id: verify
type: prompt
parallel: false
---

Run orchestrate's check, from this skill's folder (the parent of this `actions/` folder):

```bash
bun <orchestrate-skill-dir>/scripts/orchestrate-config.ts verify
```

It loads the config, resolves the tracker's credential if it has one, and makes one real call: a
write check on a `file` or `tasknotes` tracker, the repository through the GitHub API or `gh`, the
Jira project, or the Linear team. Show the user the line it prints. A non-zero exit names what
failed: a missing key, an unresolvable credential reference, or the tracker refusing the call.
Relay that line, and never a token.
