# bot_artifacts

Write what the bot could not, on the PR branch, as `fix` does (`references/fix.md` has the fork and push rules).

1. **The bot's error names the cause.** It is usually a private registry the bot holds no credential for, or a toolchain it lacks. Supply that: the token the repo's `.npmrc`, `bunfig.toml` or docs name, read from your own credentials.
2. **Run the toolchain the repo pins**, not whatever is installed: `packageManager` in `package.json`, `.tool-versions`, `rust-toolchain.toml`, the Go directive. Another version rewrites entries the bump never touched. Fetch the pinned binary into a scratch directory when the local one differs. Read the pin on the base branch's head too: when the base has moved it, merge the base first (`update_branch`'s rules), then regenerate with the base's pin.
3. **Install with scripts off**, so the bumped package's lifecycle scripts never run.
4. **Hold the diff to the bump**: the bumped packages and their own dependencies. An unrelated entry means the wrong toolchain or a stale base. Find which before you commit: regenerate once with the bump reverted. Whatever still changes is drift between the toolchain and the base's lockfile, not the bump, and a base that drifts under its own pin is stale.
5. **A frozen install passes** and leaves `git status` clean.
6. Commit in the repo's convention, as a non-releasing change unless the repo says otherwise, run its gates, and push.

The outcome is `ok`, back to `facts`. Do not carry the old SHA across the push.
