# conflict

```bash
MB=$(git merge-base origin/<base> origin/<head>)
git log --oneline "$MB"..origin/<base> | wc -l                 # how far behind
git log --oneline "$MB"..origin/<base> -- <the PR's files>     # what overlapped
```

Read the diffs of the overlapping commits, and name them in the report. Git's clean auto-merge proves the hunks did not overlap, not the features: a removed filter can come back, or a new field go empty, with no conflict marker.

If the update is declined, the rest of the gate still runs on the head as it stands. The conflict stays in the verdict.
