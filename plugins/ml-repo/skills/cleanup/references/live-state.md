# Cleaning code that holds live state

Infrastructure code, database migrations and anything else an apply step turns
into real objects follow one rule: **the code-only pass changes no live
object.** Every change that would create, destroy, replace or move something
becomes a ticket with its own plan.

## The no-op rule, per tool

- **Terraform / OpenTofu**: plan the default branch and your branch against the
  real backend (`-lock=false -refresh=false`, scratch `TF_DATA_DIR`). Do both,
  because drift that already exists shows up in both. Allowed differences:
  removed outputs. Everything else is a follow-up.
  - Delete a resource while keeping the object: `removed { from = X lifecycle { destroy = false } }`.
  - Rename or re-key a resource: `moved { from = X[0] to = X }`.
  - Delete an `import` block only once a plan shows nothing pending.
  - Removing a module's `required_providers` entry can leave the root lock
    without a constraint. Declare it in the root.
- **Ansible**: run `--check --diff` against the live inventory. Every file task
  must report `ok`. Then cover the blind spots below.
- **Helm / Kustomize**: render the default branch and your branch, and diff the
  output (`helm template`, `kustomize build`).
- **Database migrations**: never delete applied migrations. Squash them only
  with the tool's own mechanism.

## Abandoned roots

A root that nothing applies any more (no CI job, untouched for years) can still
have state holding real objects. Deleting its code destroys nothing, but it
removes the only handle anyone has on those objects, and the state file is
orphaned. Keep the code in the cleanup. Write a ticket: check what the state
holds (`terraform state list` against its backend); then either destroy the
objects or remove them from state on purpose, and delete the code after that.

## Dry-run blind spots

| Tool | What the dry run skips |
|---|---|
| Ansible `--check` | `command`/`shell` tasks (they report `skipping`), and anything conditioned on their registered results |
| `terraform plan -refresh=false` | drift, and data sources reading live values |
| Ansible play with a failing host | the rest of the playbook, when every host in a play fails (often a check-mode artefact in an unchanged role) |

For each skipped piece your change touches, run the real command read-only: a
throwaway playbook that runs the role's exact commands with the role's new
variables, or the repo's own verify or health gate. Paths you cannot exercise
without changing prod — bootstrap, join, wipe, upgrade — get listed in the PR
with the evidence you do have: syntax checks, task lists compared against main,
and condition algebra when you merged two conditions.

## What a merge sets off

- CI that applies on push turns merging into deploying. Check the path filters:
  a change to a shared workflow file triggers every caller.
- A plan that already contains drift gets applied by your merge. Read it. If the
  drift is permanent and every previous apply already did the same, say so. If
  it is new or destructive, keep the triggering path out of this PR.
- Applies without a reviewer gate on their environment run straight to prod.
- Watch the runs after each merge until they settle. A run that is "cancelled"
  with no jobs usually means a concurrency group replaced it. Rerun it.

## Rollout

If config management applies only when someone runs it, merging changes
nothing until the next run. If the repo's convention is that the merger runs
it, do the rollout from a clean checkout of the merge commit. Then compare the
`changed` tasks with the dry run's prediction.
