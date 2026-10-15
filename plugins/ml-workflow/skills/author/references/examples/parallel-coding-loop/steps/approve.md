The tests pass. Decide whether the change is done.

The change is in this run's own git worktree, the folder the `worktree` step's result names as `workdir`, on the branch `spore/<run>`. Look at the whole change there: `git status` for new and staged files, `git diff HEAD` for every change to tracked files, and each new file itself. Then read the implement step's summary. In Claude Code, Decide in the workflow menu shows both results. In a terminal, they are the `worktree` and the last `implement` result in `spore events <run>`.

Answer one of the following. In a terminal, pass this step's activation ID as the signal ID, so that sending the same answer twice (after a lost connection, say) is a no-op instead of a second answer that would fire at a later approval. The ID is `position.activationId` in `spore status <run> --json`, for example `approve/2`.

- `approved`: the change is done and the run completes. The worktree and its branch stay; merging and removing them is yours.
  `spore signal <run> approval --outcome approved --id <activationId>`
- `rejected`: the change goes back to Claude. Say why; Claude reads your reason.
  `spore signal <run> approval --outcome rejected --data '{"reason": "…"}' --id <activationId>`

A rejection without a reason is refused.
