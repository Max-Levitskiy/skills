# Re-applying a modification on a rewritten file

You have: the modification's `## Modification` (the intent), its `## Applied` (what it did
last time, per file), upstream's change to this file (`git diff <base> <new> -- <prefix><file>`), the
modification's current form (`git show <base>:<prefix><file> | diff -u - <target>/<file>`), and
upstream's new version of the file. You produce one file: upstream's new version with the
intent satisfied. `<prefix>` is the target's `path` plus `/` (empty for a whole-repo copy):
upstream-side paths carry it, target-side paths do not.

## Order of work

1. **Read the intent first, the diffs second.** Decide what the modification must be true of
   in this file before looking at how it was done last time. The old diff shows *a* way, taken
   against code that no longer exists.
2. **Start from upstream's new version, whole.** Never start from the target's current file and
   try to pull upstream's hunks in; upstream's version is the one with 31 commits of fixes.
   Two cases have one side missing. If upstream newly added a file a modification already
   claims, there is no base version: start from upstream's new version and treat the target's
   current file as the modification's current form. If upstream deleted a claimed file, there
   is no new version: decide from the intent whether the modification's file still has a
   purpose, and propose either keeping the target's file (now wholly the modification's) or
   deleting it, showing the user the diff and the reason before writing.
3. **Port each point of `## Applied` by meaning, not by line.** "`GRILL_HOST` selects the bind
   address" means: find where the new file chooses the address — possibly in a new helper,
   possibly in two places now — and make each one consult `GRILL_HOST`. If a hunk from the old
   diff applies cleanly and the surrounding code means the same thing, use it; otherwise
   rewrite it in the new file's idiom.
4. **Read the whole new file for the intent, not only the old hunks' neighbourhoods.**
   Upstream's new code often hardcodes, in a new place, the very thing the modification makes
   configurable: a second `127.0.0.1` literal in an origin check, a new log line printing the
   old URL, a new doc paragraph describing the old behaviour. Each such place is part of the
   re-apply, and goes into `## Applied`.
5. **Keep upstream's default when nothing is configured.** The modified file with every
   setting unset must behave exactly like upstream's new version. If the intent says otherwise,
   the intent wins, but say so in `## Applied`.
6. **Do not improve upstream.** A refactor you would like, a bug you spotted, a comment you
   would reword: not here. The smallest change that satisfies the intent keeps the next
   re-apply small too.

## What to show the user

Three things, per file, in this order, trimmed to what matters:

1. **upstream**: the hunks of upstream's change that touch or surround the modification.
2. **yours**: the modification's current form (base vs target), whole if under 40 lines.
3. **proposed**: the proposed file's diff against upstream's new version. This is what the
   modification now looks like; it should read like `yours` ported, plus any new place step 4
   found, each with a one-line reason.

Then one question: apply this merge? Nothing is written before the yes.

## Writing `## Applied`

One bullet per file. Each bullet names the mechanism (function, setting, section) and what it
does, in a sentence a reader can act on without the diff: "`serve` binds `GRILL_HOST`
(default `127.0.0.1`); `tailscale` resolves this machine's 100.64.0.0/10 address; the bound
host is added to `selfOrigins` so the page can Send from that address." Avoid line numbers and
avoid restating the diff.
