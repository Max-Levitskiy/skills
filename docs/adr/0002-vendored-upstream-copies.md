# 0002 — A modified upstream skill is vendored under its domain plugin, with `.upstream/`

**Date:** 2026-10-12 · **Status:** accepted

## Context

`grill-with-ui` (jasonku09, MIT) needed one change to work from a remote machine: serve on the
Tailscale address and open the Mac's browser. It was installed as a symlink into a local clone
carrying that change uncommitted. Upstream then moved 35 commits and rewrote both files the
change touched. Three homes were considered: the clone as a GitHub fork, a standalone folder
under `~/.agents/skills`, or this marketplace.

## Decision

- A modified copy of an upstream skill lives in this marketplace under the plugin for its
  domain (`plugins/ml-grilling/skills/grill-with-ui`), installed as `/ml-<domain>:<skill>`
  like everything else, with upstream's licence file kept.
- The copy follows the Upstream Modification Standard (`standards/upstream.md`): a
  `.upstream/` folder records the upstream URL, the base commit, and each modification as a
  prompt with the files it claims. `/ml-upstream:fork` maintains it.
- There is one copy. The `~/.agents/skills/<name>` symlink is removed when the vendored
  skill lands; the local clone is reset to upstream.

## Why not the alternatives

- **GitHub fork.** Records commits, not intent; a conflict after an upstream rewrite says
  nothing about why the lines differ. One more repository to keep, and the marketplace entry
  would point outside it.
- **Standalone folder.** Not versioned, not reviewed, exists on one machine.

## Consequences

- Updates are a repo change like any other: a branch, a diff, a PR, the upstream range in the
  commit message.
- The marketplace carries third-party code. Each vendored copy names its upstream and
  licence in `.upstream/upstream.json` and keeps the licence file; excludes drop upstream's
  CI and assets so the plugin stays small.
- A second modification is a new numbered file, not a second copy.
