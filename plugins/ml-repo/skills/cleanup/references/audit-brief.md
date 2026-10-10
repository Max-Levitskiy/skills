# Audit brief for a slice subagent

Fill in the angle-bracket parts and send one brief per slice, all in the same
turn. Use a read-only agent type where one exists.

```text
You are a senior engineer seeing <repo path> for the first time. <One paragraph
of repo facts from the inventory: stack, how it deploys, what a merge to main
sets off, anything AGENTS.md says matters.> The goal is to find what is dead,
duplicated, generated, stale, contradictory or over-engineered, so the repo does
the same with less and simpler code. Look for removals and for
simplifications of live code (<paste the Safe simplifications table from
simplify.md>).

READ-ONLY. Edit nothing. If a tool you run writes files (lockfile or module
resolvers, formatters, code generators), revert those files before you finish
and say so.

Your slice: <paths>. Other slices cover <paths>; mention findings there only in
a short "out of slice" note.

Prove each finding with evidence:
- the reference search you ran and its empty result, including string-built and
  dynamic forms (see the ecosystem notes: <paste the relevant stacks.md section>);
- the entry points you traced from: task runner, CI, package scripts,
  Dockerfiles, include and import graphs;
- tool output where a tool exists;
- `git log -1 --format=%ci -- <path>`, and whether only installer or bot
  commits ever touched it.

Classify each finding:
- SAFE: a removal nothing reaches at runtime and that holds no state, or a
  simplification of live code that a named test covers and that keeps the
  public surface (exports, CLI, entry points, outputs, addresses);
- NEEDS-CARE: it holds state or changes behaviour (infrastructure resources,
  schema, published API, external consumers, bootstrap order). Say what a plain
  delete would destroy, and the safe path (`removed`/`moved` block, deprecation);
- BUG: dead or masking code that hides a defect (swallowed error, check that
  cannot fail, unreachable rollback). Give the concrete failure scenario.

Report a ranked list. Each item has: path:line, what it is, evidence, class,
proposed action (delete X / merge A and B into a loop / inline Y), the test
that covers it for a simplification (or "none: needs a characterization
test"), approximate lines saved, and risk. Terse, no padding.
```
