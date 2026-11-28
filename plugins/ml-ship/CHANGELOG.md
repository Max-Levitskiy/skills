# Changelog

What each ml-ship version changed.

## 0.8.0

- pr-gate checks a major dependency bump past its types: each breaking change the upstream notes list maps to a call site or 'not used', and the new peers are checked against what the workspace declares, since bun and npm install a missing peer silently.
- pr-gate tells a lockfile's toolchain drift from the bump by regenerating with the bump reverted, and merges the base first when the base has moved its toolchain pin.
- pr-gate probes cluster or cloud CLI access with a short timeout before relying on it to explain a red check.

## 0.7.0

- pr-gate's node instructions change without copying the graph: a layer's `references` folder holds `<node id>.md` to replace a node's instructions, or `<node id>.extend.md` to add to them.

## 0.6.0

- pr-gate walks a dependency-bot route: it reads a Renovate or Dependabot PR's own report, holds a coupled update group that has not arrived whole, and writes the lockfile or other artifacts the bot could not, with the repo's pinned toolchain.

## 0.5.0

- Package PR and MR validation for Codex and use the host's available question tool.
