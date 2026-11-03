# GitLab

What differs from `gh`. Commands take the project from the checkout:

```bash
P="projects/:fullpath"
# Another project or host: P="projects/<group%2Fproject>", add --hostname <host> to glab api, and -R <project URL> to glab mr
```

| The skill says | On GitLab |
|---|---|
| PR, `#12` | MR, `!12` |
| Required vs advisory | Blocking vs `allow_failure` jobs. "Pipelines must succeed" decides whether the pipeline blocks at all |
| `UNKNOWN` | `unchecked`, `checking` |
| `CONFLICTING` | `conflict`, or `conflicts: YES` beside any status |
| `BEHIND` | `need_rebase` |
| Thread, `PRRT_…` | Discussion, a 40-character hex ID |
| `--match-head-commit` | `--sha` |

## facts

- With `pipeline must succeed` false, `mergeable` says nothing about CI: read the PIPELINE section.
- A `success` pipeline can hold failed `allow_failure` jobs. They still need explaining.
- `ran on: … NOT the MR head` and `no pipeline on this MR` mean CI has not run on this code: `rules:`, `[skip ci]`, a fork pipeline awaiting a member, or no runner.
- A blocking `manual` job waits forever. Report it, and start one only if asked: they are often deploys.
- With `ff` or `rebase_merge`, any new target commit gives `need_rebase`. The rebase moves the head, so validation restarts.
- `approvals: none required` is only what GitLab enforces. Free enforces none: read the convention docs.
- The `agent` tag is a guess. Name bots on ordinary accounts with `AGENT_USERS=a,b`.

## ci_result, classify_red

`--wait` also exits 11 on a blocking manual job. An `external status check` not `passed` under MERGE GATES is not waited for, so exit 0 beside one is not green. Do not use `glab ci status --wait`: it misses MR pipelines.

```bash
glab api "$P/jobs/<id>/trace" | tail -200
glab api "$P/pipelines/<id>/jobs?scope[]=failed&per_page=100"
glab api "$P/pipelines?ref=<target>&per_page=5"                    # the same job on the target
glab api "$P/pipelines?source=merge_request_event&per_page=20"     # a job the target never runs
glab api -X POST "$P/jobs/<id>/retry"
```

- `runs in: project N` means the jobs are under `projects/<N>`, and `$P` answers 404.
- The trace ends in cleanup, so the failure sits above the last screen.
- `reason`: `script_failure` is the job's commands. `runner_system_failure`, `stuck_or_timeout_failure` and `scheduler_failure` are the environment.
- A failed `downstream of …` is in a child pipeline: read that one by its own project and ID.

## fix

`(from a fork, project N)`: push to `ssh_url_to_repo` of `projects/<N>`, and only with `allow_collaboration` true on the MR. Fork pipelines lack the parent's variables and protected runners, so a missing variable there is by design.

## triage_reviews

```bash
glab api "$P/merge_requests/<iid>/discussions/<id>"                        # position.head_sha older than the head = outdated
glab api -X POST "$P/merge_requests/<iid>/discussions/<id>/notes" -f body='...'
glab api -X PUT "$P/merge_requests/<iid>/discussions/<id>?resolved=true"
glab mr note <iid> -m '<one line per finding>'                             # top-level comments cannot be hidden: say so
```

With `thread resolution required to merge: true`, a person's open thread blocks the merge. Report it.

## merge

```bash
glab mr merge <iid> --sha "$SHA" --auto-merge=false --yes    # now
glab mr merge <iid> --sha "$SHA" --yes                       # when the pipeline succeeds
glab api "$P/merge_requests/<iid>"                           # confirm: state, merge_commit_sha, squash_commit_sha, sha
```

- `glab mr merge` schedules by default when a pipeline runs. Say which happened. Undo: `POST $P/merge_requests/<iid>/cancel_merge_when_pipeline_succeeds`.
- `ff` and `rebase_merge` need a rebase first: `glab mr rebase <iid>`. Then wait for the new pipeline and take `$SHA` again.
- Add `--squash` only to match the project's setting: `always` squashes anyway, `never` refuses.
- A default squash lands the title alone. Keep trailers with `--squash-message`, or `--message` for a merge commit.
- `merge trains: true`: it lands after the train's pipeline.
- `merge_commit_sha` is null after a fast-forward: report `squash_commit_sha`, else `sha`.
