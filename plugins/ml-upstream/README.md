# ml-upstream

Keep a modified copy of someone else's repo current.

```bash
/plugin install ml-upstream@max-skills
```

| Command | What it does |
| --- | --- |
| `/ml-upstream:fork <url> [--into <dir>] — <modification>` | Copy an upstream repo (or `--path` a directory of it) into a target, apply your modification, record both in `.upstream/` |
| `/ml-upstream:fork add <dir> — <modification>` | Apply and record one more modification |
| `/ml-upstream:fork check <dir>` | What upstream changed since the base commit, per file, and any drift. Writes nothing |
| `/ml-upstream:fork update <dir>` | Apply upstream's clean changes, re-apply your modifications where they overlap, stop only there |

## `/ml-upstream:fork`

A modification is a prompt in your words, not a patch. The target keeps the upstream URL, the
commit it reflects, and each modification with the files it touched, under `.upstream/`. An
update is then mechanical where upstream and you touched different files, and a judgment call,
shown to you before it is written, only where you both touched the same one.

- *"Fork grill-with-ui into ml-grilling; make it serve on the Tailscale address and open my Mac's browser."*
- *"Check upstream for the vendored grill-with-ui."*
- *"Update grill-with-ui from upstream."*
- *"Add a modification to the vendored copy: …"*
- *"What did we change in this copy compared to upstream?"*

The format and the rules are the [Upstream Modification Standard](../../standards/upstream.md).
Needs `git`, `jq`, and bash 4 or newer (the script uses `mapfile`; stock macOS bash is 3.2). Upstream clones are cached under `~/.cache/ml-upstream/`.
