# ci_result

The watcher's report is a claim: it extracts, you classify. Open the log link before a fix or a verdict rests on its lines.

If the watcher never reports, re-run the facts and read the state yourself, and say so.

- `green`: settled and passing on the head SHA. Check which of those checks run the changed code: a path filter can leave every green check testing something else, and then green is not evidence. Say so, and let your own gates carry it.
- `red`: at least one check failed.
- `pending`: the person needs an answer before it settles. The verdict is "pending on `<check>`", beside what is already proven. Minutes old is in flight; hours with no runner is a stuck pool, and waiting will not fix it.
- `nothing-ran`: no check on the head SHA, which is not green. The watch's three-minute grace separates checks not yet registered from checks never coming. Find the reason: a run awaiting approval (`gh run list --branch <head>`), a path filter, a pipeline on an older commit, no CI at all. The reason goes in the verdict. A repo shown to have no CI stays that way this run: `watch_ci` is skipped, and the gates you ran are the evidence.

A failing check blocks the verdict even where the forge would merge over it, until it is fixed or shown to fail on the base too.
