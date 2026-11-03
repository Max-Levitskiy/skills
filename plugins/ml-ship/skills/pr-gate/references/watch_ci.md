# watch_ci

Watching asks for no judgment and fills your context. Dispatch one background subagent one step below your top model tier, with this brief:

```text
Watch CI on <PR URL> (head <sha>) until it settles. Read only: no push, re-run, comment or merge.

1. Run `WAIT_TIMEOUT=540 bun <this-skill-dir>/scripts/pr-facts.ts --wait <PR>`. Exit 0 is green, 10 red,
   11 nothing ran. Exit 12 means still running: run it again, up to 6 times, then report what is pending
   and how old it is. On any other exit, report the output as it is.
2. On red, read <this-skill-dir>/references/classify_red.md (on GitLab, references/gitlab.md too). For each
   failing check, pull the failing job's log and find the command that failed.
3. Look up the same check's latest runs on <base branch>.

Report the settled state and its SHA. For each failing check: name and link, the failed command, the error
lines verbatim (30 at most), its result on the base branch. Say plainly what you could not find.
```

With no subagent tool, run the same `--wait` command in the background.
