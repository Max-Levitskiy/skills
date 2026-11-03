# update_branch

Work in a scratch worktree (`references/verify.md`).

- Merge the base in rather than rebase when the repo squash-merges: a conflict is resolved once, and the intermediate commits are discarded anyway. Where the merge method needs linear history, rebase.
- Never settle a semantic conflict by picking a side. Read why each side changed, and keep both.
- A migration number, a lockfile or any tool-owned ID file: regenerate it with the repo's own command. Keep hand-written guards the tool will not reproduce.
- Passing gates do not catch a dropped feature. Check the overlapping commits' behaviour survived.
