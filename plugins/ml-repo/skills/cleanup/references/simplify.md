# Simplifying live code safely

A simplification is a **refactor**: the code reads better and the behaviour is
identical. The proof is a test that exercises the code and passes before and
after, plus an unchanged public surface.

## Contents
- Before you touch it
- Safe simplifications
- Not simplifications
- Infrastructure as code
- Traps

## Before you touch it

1. **Find the test that covers it.** Run the suite with coverage, or find the
   test that calls the code path. If nothing covers it, write a
   characterization test first, in its own commit, green on the base branch.
   Then refactor. If a characterization test is impractical, such as a
   deployment script or UI glue, leave the code alone and list it as a
   proposal.
2. **Name the public surface** the change must keep: exported names, CLI flags
   and output, entry points and plugin groups, HTTP routes, environment
   variables, config keys, IaC outputs and resource addresses, file paths
   other repos or jobs read. A simplification keeps every one of them.
3. **Keep each refactor small** and commit it on its own, with the test run as
   evidence. Run the repo's formatter and linter on the touched files only.

## Safe simplifications

| Smell | Simplification | Watch for |
|---|---|---|
| Duplicate function or constant | Keep the copy callers use; point the rest at it | Copies that drifted: diff them first; if they differ, the difference is a finding |
| Pass-through wrapper, one-line forwarding function | Inline it at its callers | A wrapper that is public surface stays, and becomes a re-export |
| Interface, abstract base, factory or registry with one implementation | Use the implementation directly | A plugin point that outside code registers into is public surface |
| Class with no state and one method | A function | Callers that subclass or mock it |
| Two mechanisms doing one job (two plugin systems, two config loaders) | Keep the one in use, delete the other | If the unused one is public, it is NEEDS-CARE |
| Hand-rolled code the standard library or language does | The stdlib call | Edge cases: empty input, `None`/`NaN`, ordering, rounding, locale, time zones |
| Deep nesting, flags that are always one value | Guard clauses; delete the never-taken branch | A flag read from config or the environment is not constant: search where it is set |
| The same literal in many places | One named constant or local | Literals that only look alike but mean different things |
| Docs describing commands that no longer exist | Rewrite to the current commands | Run every command you write into a doc |

## Not simplifications

These change behaviour. Report them; do them only when the owner asks, each in
its own commit or PR:

- **bug fixes**, including narrowing a swallowed exception. Write the failing
  test first, so the fix shows red then green;
- changes to error handling, retries, timeouts, logging, or output format;
- renaming or moving anything on the public surface;
- dependency upgrades, and performance work with any semantic risk;
- replacing an explicit allowlist with discovery. A hand-kept list next to
  `import_module(f"...{name}")` is also what stops arbitrary imports;
- reformatting files the cleanup does not otherwise touch, which buries the
  real diff.

## Infrastructure as code

The proof is a plan of the base branch and of your branch showing the same
resources and attributes (`references/live-state.md`).

- **Repeated literals → a local or variable**: a pure no-op when the values are
  identical.
- **Copy-pasted resources → `for_each`/`count`**: every address changes, so
  write one `moved` block per resource. The plan shows only moves. Without the
  `moved` blocks, the plan destroys and recreates each one.
- **A single-use module → inline resources**: the same, `moved` blocks from
  `module.x.res` to `res`. Usually not worth the risk for a few lines; list it
  instead.
- **Provider-level defaults** such as `default_tags` change computed
  attributes (`tags_all`). Check the plan before calling them a no-op.

## Traps

- **Tests that pass for the wrong reason** prove nothing about the refactor. A
  test that asserts a return code a function always returns, or one passing
  only because a config file is missing, is not coverage.
- **Simplifying around a bug** can quietly change it. If the code you refactor
  contains a BUG finding, keep the buggy behaviour byte for byte and report it,
  or fix it in its own commit when asked.
- **One refactor per commit.** A reviewer reads a deletion, a dedupe and an
  inline at three different speeds.
