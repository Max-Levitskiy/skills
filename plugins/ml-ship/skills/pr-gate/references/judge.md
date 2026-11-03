# judge

A declined push can bring you here before `ci_result` ran. Take the watcher's result first.

On a PR already merged or closed, readiness is moot: answer the question asked and take `verdict`.

**Ready** means all of these, on the current head SHA:

- CI has settled and required checks pass. For advisory checks still running, say which you waited for and why.
- No unexplained failure remains.
- It is mergeable and not a draft, and any review the repo demands has happened.
- Every review finding has an outcome, and no open thread blocks the merge (`thread resolution required to merge`).
- Nothing in the change is a real regression.

**`merge`** needs ready *and* a request: "merge it", "land it", "merge if it's clean". "Validate this", "is this safe?" and "why is CI red?" ask for a verdict. Permission does not carry to another PR. A condition that failed ("merge if nothing breaks", and something does) is `verdict`.

If merging is asked and only CI is left, take `merge`: auto-merge is the watch. Everything else is `verdict`.
