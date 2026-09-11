#!/usr/bin/env bun
// The shared topo-sort, beside the protocol it implements (see working-actions.md).
//
// D3 put the sort client-side: `start` returns a flat list with `requires`/`parallel` per item and
// the agent orders it. This is that sort, written once, so no consumer reimplements it and no two
// consumers disagree about what `parallel` means.
//
//   agent-config start <name> | bun plan-actions.ts
//
// Reads `start` output (or a bare action array) on stdin, prints ordered steps on stdout.

import { readFileSync } from "fs";

interface Action {
  id: string;
  path: string;
  type: "code" | "prompt" | "manual";
  command: string | null;
  parallel: boolean;
  requires: string[];
  keys: string[];
  context: Record<string, unknown>;
}

interface Step {
  step: number;
  /** True when every action in the step may be tasked out at the same time. */
  concurrent: boolean;
  actions: Action[];
}

interface Plan {
  steps: Step[];
  /** The `manual` action the batch stops after, if the plan reaches one. */
  stopsAfter: string | null;
  /** Actions never reached: they sit behind the `manual` stop, or behind a dependency cycle. */
  deferred: string[];
  /** Ids in a `requires` cycle. A plan with one is a declaration bug, not something to work. */
  cycle: string[];
}

function plan(actions: Action[]): Plan {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const done = new Set<string>();
  const steps: Step[] = [];
  let remaining = [...actions];
  let stopsAfter: string | null = null;

  while (remaining.length > 0 && !stopsAfter) {
    const ready = remaining.filter((action) => action.requires.every((id) => done.has(id) || !byId.has(id)));
    if (ready.length === 0) break; // Every survivor waits on another survivor: a cycle.

    // A manual action ends the batch, so it is given its own final step rather than sharing one.
    const manual = ready.find((action) => action.type === "manual");
    const solo = manual ?? ready.find((action) => !action.parallel);
    const batch = solo ? [solo] : ready;

    steps.push({ step: steps.length + 1, concurrent: batch.length > 1, actions: batch });
    for (const action of batch) done.add(action.id);
    remaining = remaining.filter((action) => !done.has(action.id));
    if (manual) stopsAfter = manual.id;
  }

  const cycle = stopsAfter ? [] : remaining.map((action) => action.id);
  return { steps, stopsAfter, deferred: remaining.map((action) => action.id), cycle };
}

const raw = readFileSync(0, "utf8").trim();
if (!raw) {
  process.stderr.write("plan-actions reads `agent-config start` output on stdin.\n");
  process.exit(2);
}

const parsed = JSON.parse(raw) as Action[] | { actions?: Action[] };
const actions = Array.isArray(parsed) ? parsed : (parsed.actions ?? []);
process.stdout.write(`${JSON.stringify(plan(actions), null, 2)}\n`);
