# AGENTS.md

Repo-level instructions for coding agents working in `Max-Levitskiy/skills`.

## Agent skills

### Issue tracker

Issues, specs, and wayfinder maps live as **GitHub issues** in this repo, driven through the `gh`
CLI. Sub-issues and native issue dependencies are both enabled and are the canonical representation
of parent/child and blocking — do not fall back to body conventions. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, ADRs under `docs/adr/` (created lazily, when the
first decision needs one). See `docs/agents/domain.md`.
