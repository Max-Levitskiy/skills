# Coordinate 10–100 agents

Herdr supplies terminal/lifecycle primitives, not a durable task scheduler.
Fleet size is a workload goal, not a tested capacity claim. Choose concurrency from
CPU/RAM, model/API limits, startup latency and user budget; 100 queued tasks do not
require 100 simultaneously active processes.

## Own tasks and state

The orchestrator owns shared task state. Workers own distinct output files or isolated
worktrees. Respect the project's existing tracker. The sibling orchestrate skill can
supply decomposition conventions; Herdr use does not require its onboarding or imply
permission for external tracker writes.

Keep one compact task record:

```json
{"task":"review-api","target":{"environment":"wsl:<distro>","session":"agents"},
 "workspace_id":"returned-id","pane_id":"returned-id","agent":"review-api",
 "terminal_id":"returned-id","baseline_revision":42,"state_change_seq":7,
 "completion_seq":null,"output":"/srv/run/review-api.md","attempt":1,
 "deadline":"ISO timestamp","status":"queued","verified":false}
```

Populate IDs from that server. Agent name/pane/completion alone is insufficient task
correlation; the current occupant and attempt matter. Record target/version/capabilities
once per server. Keep personal aliases in machine config or the run record.

## Dispatch, observe, verify

1. Queue independent tasks with acceptance criteria/output and bounded deadlines.
   Admit at most the chosen global and per-machine limits.
2. Resolve targets and create/reuse isolated shell locations. Record creation results
   immediately; later startup failure does not mean the pane disappeared.
3. Start the requested agent, establish readiness, record a baseline and submit once.
   Use agents.md when that native workflow is not known.
4. Observe compact inventories/state changes. Read changed, blocked, uncertain or
   apparently finished targets; bound rows/characters and collect artifacts directly.
5. Verify current output and required checks. Ledger outcomes can be verified success,
   failure, needs-input or unresolved; keep native state separate.
6. Release a slot after reconciliation. Preserve occupied panes unless cleanup is
   authorized; other people's existing agents are not spare workers.

Dispatch ready workers before waiting serially for each response. Multiplex bounded
waits or maintain a long-lived observer. Resume by inventorying each ledger target and
checking occupant/artifact. Follow-ups on working agents need deliberate coordination.

## Recovery and budgets

Timeout/disconnection after dispatch leaves delivery uncertain. Reconcile before another
attempt. Historical output can satisfy a marker wait: use attempt-specific markers and
artifact verification. Idle/done is not task success; Codex unknown needs evidence.

Events are non-durable and bounded in history. On loss, invalidate cache and resubscribe
before requesting an authoritative snapshot. Treat events during a read as refresh
signals. Across machines, keep independent streams/caches and scoped IDs; one snapshot
is not a combined fleet list. See advanced-api.md when implementing an observer.

The optional scripts/lib/herdr-client.mjs exports mapLimit for bounded work and
reconcileSnapshot for invalidation refreshes. Neither automatically launches/retries.
Drivers still own authorization, task correlation, deadlines and per-machine limits.

Begin with a small measured wave, then increase within budget. Summaries use counts
and exceptions, not every transcript. No test here demonstrates 100 live agents.
Read output artifacts on the machine where they live or through an authorized transfer;
a remote artifact path is not automatically readable on the orchestrator.

Clean up only run-owned targets recorded in the ledger, after saving outputs and
revalidating ownership. Pane close kills its occupant; session stop kills all panes.
