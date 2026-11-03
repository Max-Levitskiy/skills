# classify_red

```bash
gh run view <run-id> --log-failed                 # the failed steps only; read past the summary line
gh run list --branch <base> --workflow "<same>" --limit 5 --json conclusion,createdAt,headSha
```

The check name is a label, not a diagnosis. A job can go red with zero failing tests: a shutdown race, a lost container. Check what happened after the tests.

- `regression`: this PR caused it.
- `pre-existing`: the same check fails on the base branch, or the environment failed. Typical shapes: a container reaper misreported as database startup, a registry or cache timeout, a runner lost mid-job. Keep it out of the verdict on the PR, and report it as unrelated.
- `unexplained`: you cannot say why. It stays this even if a re-run goes green. `gh run rerun <id> --failed` answers a known flake, and it is not a diagnosis.

Fork PRs run with restricted secrets, so a job failing on a missing secret may be working as designed. Never loosen a workflow's permissions to fix that.
