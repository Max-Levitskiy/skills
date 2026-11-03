# merge

Irreversible, and it may deploy. GitLab flags are in `references/gitlab.md`.

```bash
gh pr merge <PR> --<method> --match-head-commit <validated sha> [--subject ... --body ...] [--auto]
gh pr view <PR> --json state,mergedAt,mergeCommit --jq '"state=\(.state) sha=\(.mergeCommit.oid)"'
```

- **Pin to the SHA you validated**, captured before validating. A refusal because the PR moved is `moved`.
- **Method** comes from the facts: if several are allowed, follow the base's recent history.
- **Trailers.** A squash body of `COMMIT_MESSAGES` replaces the body with commit subjects and eats `Release:`, `Skip-Release:`, `Co-authored-by:` and `Fixes #`. With `COMMIT_OR_PR_TITLE`, a multi-commit PR lands under the PR title. Read the PR body for trailers and pass them with `--body`.
- **`--auto`** when only CI is left. It needs `allow_auto_merge` and a required check: with none, it merges at once. Report it as enabled, not merged, and name what it waits on.
- **Never `--admin`** on your own initiative. A refusal you cannot resolve is `refused`.
- Check that no other open PR ships the same work: `gh pr list --search "<ticket>"`.

Afterwards confirm the state, remove scratch worktrees, delete the branch if that is the repo's habit, and do any post-merge duties its docs list. The report carries the merge SHA.
