# Changelog

What each ml-ship version changed.

## 0.6.0

- pr-gate walks a dependency-bot route: it reads a Renovate or Dependabot PR's own report, holds a coupled update group that has not arrived whole, and writes the lockfile or other artifacts the bot could not, with the repo's pinned toolchain.

## 0.5.0

- Package PR and MR validation for Codex and use the host's available question tool.
