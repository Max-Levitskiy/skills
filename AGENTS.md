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

## Plugin naming

Plugins are `ml-<domain>` and skills are bare, giving `/ml-<domain>:<skill>`. The rules are
in CONTRIBUTING.md § Naming and ADR 0001. Run `bash scripts/validate-naming.sh` after adding,
renaming, or moving any plugin or skill.

## Releasing a plugin

`claude plugin update` compares versions only, so a change merged at the old version never reaches
an installed copy. Every PR that changes a plugin's files raises its version in the same PR, as
release-please does, by its conventional type: `fix` a patch, `feat` a minor, a breaking change a
major. For ml-workflow, run `bun scripts/plugin-version.ts bump ml-workflow <patch|minor|major>
"<what changed>"...`: it writes `plugin.json`, the marketplace entry and `src/version.ts`, and adds
the `CHANGELOG.md` section. Update the README's "This release" line when what the plugin does
changes. CI's `version raised` job refuses a change under `plugins/ml-workflow/` whose version is
not above `main`'s, as npm refuses to publish over an existing version; after a rebase onto a
`main` that raised it too, bump again.
