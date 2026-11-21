# bot_bump

The bot reports on its own PR, and that report is a claim like any other. Read it before CI, because a bot PR is often red for a reason that is no regression: the bot never wrote a file the bump needs.

```bash
gh pr view <PR> --json comments --jq '.comments[] | select(.author.login == "renovate" or .author.login == "dependabot") | .body'
gh pr checks <PR> | grep -iE 'renovate|dependabot'     # renovate/artifacts, renovate/stability-days
```

**Artifacts.** Renovate posts "Artifact update problem" with the file and the error, and fails `renovate/artifacts`. Then the manifest moved but its lockfile (or `go.sum`, `Cargo.lock`, generated code) did not, and every frozen install fails on that. Judge by the files: on a head where the lockfile already matches the manifest, the bot's stale failed status no longer counts.

**Group.** Read the bot's config (`renovate.json` packageRules, `groupName`, `minimumReleaseAge`; `dependabot.yml` groups) and the repo's docs for pins that must move together. The bot can open a group with only the halves it is allowed to move today. A half waiting out its release age arrives on this same branch later, so say when. A pair the docs couple but the bot cannot see, such as a client and its server image, needs the other half first.

**Notes.** Release notes and the bot's changelog excerpt are claims about the API. `verify` reads the published package. A runtime or image bump (a Docker base, a toolchain pin) has no API to read: there `verify` names the jobs that actually ran the new binary, and the ones that still ran the old one.

**Merged already.** On a merged or closed PR this node judges and writes nothing. A missing artifact is a finding for the report, and the outcome is `ok`. A group that landed incomplete is `incomplete-group`, with the half that is still missing.

- `ok`: every file the bump needs is in the diff and the group is whole.
- `artifacts-failed`: a file the bump needs is missing or stale. Name it and the bot's error.
- `incomplete-group`: a coupled half is missing. The verdict is hold, with what it waits for and until when.

A commit by anyone else stops Renovate rebasing the branch on its own. After `bot_artifacts`, keeping the branch current falls to whoever pushed.
