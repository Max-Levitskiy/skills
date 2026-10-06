# GitLab

The rest of this skill shows `gh`. This file is the GitLab side of the same
gate: the `glab` command for each step, and the places where GitLab's model
differs enough to change a verdict.

- [How the terms map](#how-the-terms-map)
- [What misleads in the facts output](#what-misleads-in-the-facts-output)
- [CI: watch, read, classify](#ci-watch-read-classify)
- [Fixing forward, and forks](#fixing-forward-and-forks)
- [Review threads](#review-threads)
- [Merging](#merging)

Every command below takes the project from the checkout:

```bash
P="projects/:fullpath"          # glab fills :fullpath from the checkout's remote
# For an MR in another project or on another host:
#   P="projects/<group%2Fsubgroup%2Fproject>"  and add  --hostname <host>  to each glab api call
#   add  -R <project URL>  to each glab mr call: without it glab looks the IID up in the checkout's project
```

---

## How the terms map

| This skill says | On GitLab |
|---|---|
| PR, `#12` | Merge request (MR), `!12` |
| Required vs advisory checks | Blocking vs `allow_failure` jobs in one pipeline. The project setting "pipelines must succeed" decides whether the pipeline blocks the merge at all |
| `mergeable` / `mergeStateStatus` | `detailed_merge_status` |
| `UNKNOWN` | `unchecked`, `checking` |
| `CONFLICTING` | `conflict`, or `conflicts: YES` beside any other status |
| `BEHIND` | `need_rebase` |
| Review thread, `PRRT_…` | Discussion, a 40-character hex ID |
| Branch rules | Project merge settings, plus approval rules on paid tiers |
| `--match-head-commit` | `--sha` |

---

## What misleads in the facts output

- **`mergeable` says nothing about CI when `pipeline must succeed` is false.**
  GitLab then merges over a red pipeline, or over none. The PIPELINE section is
  the CI gate on such a project; the status line is not.
- **A `success` pipeline can hold failed jobs.** Jobs marked `allow_failure`
  fail without failing the pipeline. They are listed as advisory: a failed one
  is still evidence about the change, and still needs an explanation.
- **A pipeline that ran on another commit is not this MR's CI.** `ran on: … NOT
  the MR head` and `no pipeline on this MR` both mean CI has not run on the code
  you are judging. The usual causes: `rules:` or `workflow:rules` excluded the
  change, a `[skip ci]` commit, a fork pipeline waiting for a project member to
  start it, or no runner picked it up.
- **A blocking `manual` job stops the pipeline until a person runs it.** The
  pipeline waits forever, so waiting is not the fix. Report it. Manual jobs are
  often deploys, so start one only when the user asks.
- **`need_rebase` comes from the merge method.** With `ff` or `rebase_merge`,
  one new commit on the target makes every open MR unmergeable until it is
  rebased. The rebase moves the head SHA and starts a new pipeline, so the
  validation starts over.
- **`approvals: none required` is what GitLab enforces.** The Free tier
  enforces none. Read the convention docs for the review the team expects.
- **The `agent` tag is a guess.** It comes from GitLab's `bot` flag (project and
  group access tokens, service accounts) and a name pattern. A review bot that
  runs on an ordinary user account shows as `human`. Name such accounts:
  `AGENT_USERS=review-bot,ci-reviewer bun pr-facts.ts <MR>`.

---

## CI: watch, read, classify

**Watch** the MR's own pipeline to a settled result:

```bash
bun "<this-skill-dir>/scripts/pr-facts.ts" --wait <MR>      # run it in the background
```

It exits 0 on success, 10 on failed or canceled, 11 when there is nothing to
wait for (no pipeline on the head commit, or a blocking manual job), and 12
when the pipeline is still running after `WAIT_TIMEOUT` seconds (3600 by
default), then prints the facts. It
follows the MR's head pipeline. `glab ci status --wait` follows a branch, and
misses merge request pipelines.

The exit code covers the pipeline alone. An `external status check` line under
MERGE GATES that is not `passed` is a gate the watch did not wait for: exit 0
beside one is not green.

**Read the real failure.** Job IDs are in the `FAILING / STALLED` section:

```bash
glab api "$P/jobs/<job-id>/trace" | tail -200                        # the job log
glab api "$P/pipelines/<pipeline-id>/jobs?scope[]=failed&per_page=100"
glab ci config compile                                               # .gitlab-ci.yml with every include: merged in
```

A pipeline can run in another project than the MR's: a fork's pipeline runs in
the fork. The PIPELINE section then prints `runs in: project N`. Its jobs,
traces and retries are under `projects/<N>`, and `$P` answers 404 for them.

The trace ends with cleanup sections, so the failing command sits above the
last screen. The job's `reason` separates the classes early: `script_failure`
is the job's own commands; `runner_system_failure`, `stuck_or_timeout_failure`
and `scheduler_failure` are the environment.

A failed `downstream of …` line means the failing job is in a child or
multi-project pipeline. Read that pipeline's jobs by its own project and ID.

**Compare with the target branch.** The facts output prints the last pipelines
on the target. To compare one job:

```bash
glab api "$P/pipelines?ref=<target>&per_page=5"
glab api "$P/pipelines/<pipeline-id>/jobs?per_page=100"
```

`rules:` often give merge request pipelines jobs that branch pipelines lack. A
job with no run on the target has its base rate in other MRs' pipelines:
`glab api "$P/pipelines?source=merge_request_event&per_page=20"`.

**Re-run** a known-flaky job, under the same honesty rule as on GitHub:

```bash
glab api -X POST "$P/jobs/<job-id>/retry"
glab api -X POST "$P/pipelines/<pipeline-id>/retry"       # every failed job
```

---

## Fixing forward, and forks

The facts output marks a fork with `(from a fork, project N)`. The branch
lives in that project, so push there:

```bash
glab api "projects/<N>" | bun -e 'console.log((await Bun.stdin.json()).ssh_url_to_repo)'
glab api "$P/merge_requests/<iid>" | bun -e 'console.log((await Bun.stdin.json()).allow_collaboration)'
```

`allow_collaboration` is the author's consent to maintainer pushes. Without
it, the push is refused.

Fork pipelines run in the fork, without the parent project's CI variables or
protected runners. A job that fails there for a missing variable is working as
designed.

---

## Review threads

Read the whole thread; the facts output shows 160 characters of it:

```bash
glab api "$P/merge_requests/<iid>/discussions/<discussion-id>"
```

Each note carries `body` and `position` (`new_path`, `new_line`, `head_sha`).
A `head_sha` older than the MR head makes the thread outdated: check the
concern against the current file.

Reply, then resolve:

```bash
glab api -X POST "$P/merge_requests/<iid>/discussions/<discussion-id>/notes" \
  -f body='Fixed in abc1234: health ports now come from the slot.'
glab api -X PUT "$P/merge_requests/<iid>/discussions/<discussion-id>?resolved=true"
```

A `suggestion` block is a proposed patch. Make the change in your own commit:
the "Apply suggestion" button commits once per suggestion and skips the
repo's gates.

Top-level comments have no thread, and GitLab cannot hide them. Answer all
the findings of one comment in one note, and say in the report that the
original stays visible:

```bash
glab mr note <iid> -m '<one line per finding: what it said, fixed in <sha> / not changing because ...>'
```

With `thread resolution required to merge: true`, every open thread blocks
the merge, human ones included. Human threads stay with their reviewer, so
report them as the blocker.

---

## Merging

The authorization rule is the same as on GitHub. The commands:

```bash
SHA=<head sha from the facts output, captured before validating>

# Merge now, pinned to the commit you validated
glab mr merge <iid> --sha "$SHA" --auto-merge=false --yes

# Auto-merge: GitLab lands it when the pipeline succeeds
glab mr merge <iid> --sha "$SHA" --yes

# An MR outside the checkout's project: add -R to either, and to mr rebase and mr note
glab mr merge <iid> -R <project URL> --sha "$SHA" --yes
```

- **`glab mr merge` schedules by default.** With a pipeline running it sets
  auto-merge and returns, so "merged" can mean "will merge later". Pass
  `--auto-merge=false` for a merge now. Tell the user which of the two
  happened. Undo a scheduled merge with
  `glab api -X POST "$P/merge_requests/<iid>/cancel_merge_when_pipeline_succeeds"`.
- **The merge method is the project's.** `ff` and `rebase_merge` need the
  branch rebased first: `glab mr rebase <iid>` does it on the server when
  there are no conflicts. The rebase makes a new head SHA, so wait for its
  pipeline and take `$SHA` again. On these projects a stale branch is brought
  up to date with a rebase, which keeps the linear history the method exists
  for.
- **Squash follows the project's `squash` setting.** `always` squashes
  whatever you pass, `never` refuses `--squash`, and the `default_*` values
  follow the MR's own flag. Add `--squash` only to match what the project
  already does.
- **Protect trailers.** A default squash lands the MR title alone. Pass the
  whole message when a trailer has to survive:
  `--squash-message "$(printf '<subject>\n\nSkip-Release: true')"`. For a
  merge commit the flag is `--message`. With `ff` and no squash, the branch's
  commits land unchanged and their trailers survive.
- **Merge trains.** When the facts output shows `merge trains: true`, the
  merge adds the MR to the train. It lands after the train's own pipeline.

Confirm it landed:

```bash
glab api "$P/merge_requests/<iid>" | bun -e '
const d = await Bun.stdin.json();
console.log(d.state, "merge:", d.merge_commit_sha, "squash:", d.squash_commit_sha, "head:", d.sha, d.merged_at)'
```

`merge_commit_sha` is null after a fast-forward merge. The commit on the
target is then `squash_commit_sha` when the MR was squashed, and the head
`sha` otherwise. Report the one that is on the target branch.
