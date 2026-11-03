# fix

Reproduce first, with the exact command CI ran (`gh run view <id> --log-failed | grep -A3 "##\[group\]Run "`) and the versions the repo pins. Prefer fixing the cause over reverting a bump: a revert hides the break.

The branch lives in the PR's head repository, which on a fork is not `origin`:

```bash
HEAD_REPO=$(gh pr view <PR> --json headRepositoryOwner,headRepository --jq '"\(.headRepositoryOwner.login)/\(.headRepository.name)"')
HEAD_URL=$(gh repo view "$HEAD_REPO" --json sshUrl --jq .sshUrl)
git fetch "$HEAD_URL" <head-branch> -q && git worktree add -q "$WT" FETCH_HEAD
# fix, run the repo's gates, commit in the repo's convention
git -C "$WT" push "$HEAD_URL" HEAD:<head-branch>
```

- **Renovate / Dependabot** may force-push over your commit. Change the bot's config, or land the fix on the base and let it rebase.
- **Forks**: push only if `maintainerCanModify` is true.
- A commit that fails the repo's grammar can silently drop out of a release.
- Tell the person if their own checkout is on this branch: it is now behind.

The outcome is `ok`, back to `facts`. Do not carry the old SHA across the push.
