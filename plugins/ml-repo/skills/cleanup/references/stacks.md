# Entry points and dead-code probes per ecosystem

Read only the sections for stacks the inventory found. A tool's verdict is a
lead, not a finding: confirm each item against the entry points before calling
it dead. Prefer running tools ephemerally (`npx`, `bunx`, `uvx`, `go run
pkg@version`) so the repo is not modified.

## Contents
- Generated scaffolding and docs
- JavaScript / TypeScript
- Python
- Go
- Rust
- JVM (Java, Kotlin)
- Terraform / OpenTofu
- Ansible
- Kubernetes, Helm, GitOps
- CI workflows
- Task runners and scripts

## Generated scaffolding and docs

- **AI-tool installer output**: `_bmad/`, `.specify/`, `.claude/commands/`,
  `.cursor/`, `.gemini/`, `.agent(s)/`, `.codex/`, `.windsurf/`. The usual
  pattern is one installer commit, never edited, and the same stub copied once
  per tool. The inventory's identical-file groups show the copies. The owner
  decides, because people use the slash commands. If they go, gitignore the
  dirs so a local reinstall is not committed again. Keep hand-written skills.
- **IDE files** tracked despite `.gitignore`: `git ls-files -ci --exclude-standard`.
- **Specs, plans and PRDs for merged or abandoned work**: check whether the
  feature exists in code, and whether checkboxes and statuses ever moved. Keep
  design docs that live code links to.
- **Agent context files**: a generated `CLAUDE.md` that disagrees with
  `AGENTS.md` actively misleads. Check each claim against the tree.
- **Stale docs**: commands and task names that no longer exist (compare with
  the task runner's `--list`), and components that were replaced.

## JavaScript / TypeScript

- Entry points: `package.json` `main`, `exports`, `bin`, `scripts`; framework
  routes (file-system routing in Next, Remix, SvelteKit); config files loaded
  by tools.
- Tools: `npx knip` (unused files, exports, dependencies), `npx depcheck`,
  `npx ts-prune`, and `tsc --noEmit` for leftovers that no longer type-check.
- Dynamic reach: `import()` with template strings, `require(variable)`,
  framework conventions (`pages/`, `app/`), and plugin arrays in config.

## Python

- Entry points: `[project.scripts]`, `entry_points`, `__main__.py`,
  `manage.py`, task and cron definitions.
- Tools: `uvx vulture` (low confidence, verify each item), `uvx deptry` (unused
  or missing dependencies), and `ruff` with rules F401 and F841.
- Dynamic reach: `importlib.import_module`, plugin registries,
  `getattr(module, name)`, Django `INSTALLED_APPS`, and Celery task names as
  strings.

## Go

- Entry points: `main` packages and exported identifiers used by other modules.
- Tools: `go run golang.org/x/tools/cmd/deadcode@latest ./...`, `staticcheck`
  (U1000). Run `go vet` without `-mod=mod`, which rewrites `go.mod`. Code
  generation (`dagger develop`, protobuf) may be needed first; if it writes
  files, run it in a scratch copy.
- Error swallowing (`if err != nil { return zero, nil }`) is a classic BUG
  finding.

## Rust

- Tools: `cargo +nightly udeps` or `cargo machete` (unused dependencies),
  compiler `dead_code` warnings, `cargo clippy`.
- Dynamic reach: feature flags, `#[cfg]`, and build scripts.

## JVM (Java, Kotlin)

- Dynamic reach dominates: reflection, Spring component scan, service loaders
  (`META-INF/services`), and serialization. Treat unused-class reports with
  suspicion until each one is traced.

## Terraform / OpenTofu

- A root is a directory with a backend. Find who applies each root: CI paths,
  task targets, or nobody. A root with no applier and no commits for a long time
  is a candidate for deleting the code, but its state still holds live
  resources: file a ticket for those.
- Unused variables, locals and outputs: search each name across the root, the
  task runner, scripts, `terraform_remote_state` consumers and other repos.
  Removing them is no-op in plans, apart from outputs disappearing.
- Modules that are never instantiated, or only in commented-out code, can be
  deleted.
- Resources whose role moved elsewhere, such as DNS moved to another provider
  or a chart now owned by GitOps, are NEEDS-CARE: removing them deletes live
  objects. See live-state.md.
- Fake toggles: a variable whose validation allows only one value but drives
  `count`. Removing it needs `moved` blocks from `x[0]` to `x`.

## Ansible

- Trace the include graph from every playbook a task target runs: `roles:`,
  `import_*`, `include_*`, handlers notified by name or `listen`, templates.
- Unused vars: compare defaults against uses (`grep -rn '{{ *name'` and
  `when:` conditions). Vars defined in several roles' defaults can move to
  `group_vars`.
- Repeated copy tasks become loops. Keep `no_log` on secrets, use
  `loop_control.label`, and keep the same handler names.
- `--check` skips `command` and `shell` tasks. See live-state.md.

## Kubernetes, Helm, GitOps

- Manifests or charts that nothing applies: check the GitOps app definitions
  (`repoURL` and `path` in Argo CD or Flux, across repos), the task runner and
  CI.
- **Name collisions**: an unapplied Application or Kustomization that shares a
  name with a live one can replace it if anyone applies it. Delete it.
- **Dual ownership**: the same object managed by IaC and by GitOps. Hand it to
  one owner with a `removed { lifecycle { destroy = false } }` block on the IaC
  side.

## CI workflows

- Check every `on.paths` and `working-directory` against the tree.
- Triggers vs job conditions: for example, `workflow_dispatch` only, with jobs
  gated on `pull_request` or `push`, never runs anything.
- Caller workflows that differ only in inputs can collapse into one job.
  Check-name changes matter only if branch protection requires them.
- Concurrency groups shared by PR runs and deploys on main let a PR run cancel
  a pending deploy. Key PR runs by ref.

## Task runners and scripts

- For each target in the Taskfile, Makefile, justfile or `package.json`
  scripts, check that every file it calls exists and every resource it applies
  is still there.
- For each script, search for callers across the task runner, CI, docs and
  other scripts. A script whose only reference is its own usage line is dead.
- One-time migrations that already ran can be deleted, and they stop the
  churn from dependency bots.
