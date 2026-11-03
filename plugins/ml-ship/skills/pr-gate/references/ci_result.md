# ci_result

The watcher's report is a claim: it extracts, you classify. Open the log link before a fix or a verdict rests on its lines.

If the watcher never reports, re-run the facts and read the state yourself, and say so.

- `green`: settled and passing on the head SHA. Green covers only the commands in `verify`'s trace: a package listed in the log is only in scope, a bundler may not type-check, and a path filter can leave every green check testing something else. Whatever no check ran, say so, and let your own gates carry it.
- `red`: at least one check failed.
- `pending`: the person needs an answer before it settles. The verdict is "pending on `<check>`", beside what is already proven. Minutes old is in flight; hours with no runner is a stuck pool, and waiting will not fix it.
- `nothing-ran`: no check on the head SHA, which is not green. The watch's three-minute grace separates checks not yet registered from checks never coming. Find the reason: a run awaiting approval (`gh run list --branch <head>`), a path filter, a pipeline on an older commit, a merge conflict (GitHub runs no `pull_request` workflow on one), no CI at all. The reason goes in the verdict. A repo shown to have no CI stays that way this run: `watch_ci` is skipped, and the gates you ran are the evidence.

A failing check blocks the verdict even where the forge would merge over it, until it is fixed or shown to fail on the base too.
