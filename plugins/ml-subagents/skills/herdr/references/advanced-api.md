# Advanced control and scalable observation

Prefer CLI wrappers normally. Installed api schema --json supplies exact request/response/
event shapes; api snapshot reads the selected live session. 0.9.3 inspection found
protocol 22/schema 1; future compatible builds should be discovered, not version-pinned.

Unix uses newline-delimited JSON on domain sockets; Windows uses named pipes.
String request IDs correlate success/error responses. Parse result/error, ignore unknown
fields, handle unsupported methods without retargeting. Subscriptions keep connections
open. Use HERDR_BIN_PATH/CLI for portable plugins.

## Observe efficiently and recover lost events

Subscribe to lifecycle/status instead of repeatedly reading all screens.
Families include workspace/tab/pane/worktree/layout. Pane output/status/scroll entries
need explicit IDs. One invalid entry rejects the entire subscription.
Lifecycle events start at acceptance and do not replay historical events.

History is bounded and non-durable. On events_lost/disconnect, invalidate cached state:
1. Resubscribe and wait for subscription_started.
2. Drain events while requesting session.snapshot on another connection.
3. Replace state with that authoritative read; events during the read request another
   serialized refresh. Do not replay buffered payloads on the snapshot.
4. Bound refresh count/deadline; repeat on another loss or report unresolved churn.

There is no shared snapshot/event sequence boundary; ordering within one subscription
entry is not global ordering. Events are invalidation signals. Maintain per-machine
streams/caches. Read timeout does not justify retrying a mutation.
The optional reconcileSnapshot helper supplies bounded refresh logic; the driver owns
stream draining, resubscription, deadlines and target identity.

## Views and metadata

Agent view set/clear installs transient UI filters/sorts. It does not filter agent.list,
change notifications/detection or schedule tasks. Source ownership controls replacement;
plugin-owned projections follow plugin lifetime.
Pane/workspace metadata tokens, labels, titles, TTLs and state labels are presentation.
Actual lifecycle reports belong to the integration/agent owner; task outcomes belong
to the orchestrator ledger.

## Find all other features

| Need | Installed schema/API family; CLI where available |
| --- | --- |
| Runtime snapshot | session.snapshot; api snapshot |
| Workspace groups/order/move | workspace.move, move_block, report_metadata |
| Tab order/move | tab.move; tab CLI for ordinary operations |
| Layout import/export/geometry | layout.export, apply, set_split_ratio |
| Pane topology/process/input/copy/scroll/search/selection | pane.*; pane help |
| Links/graphics/popups/client surfaces | pane.link.*, graphics docs, popup.close, client_shell.surface.set |
| Outer terminal title | terminal title; client.window_title.set/clear |
| Read-only frames/interactive bridge | terminal session observe/control |
| Agent projection/detection/session authority | agent.view.*, agent.explain, pane.report_* |
| Plugin actions/panes/logs | plugin.*; plugin CLI |
| One-shot event/state/output waits | events.wait, agent.wait, pane.wait_for_output |
| Server health/manifests/compatibility | ping, status, server.agent_manifests |

Layout apply, input/control streams, views/titles and reports change runtime state.
Inspect ownership/authorization. Observers do not acquire input/resize/scroll ownership;
control streams do. Takeover replaces an owner. Never manufacture lifecycle for another
agent to make a wait pass.
https://herdr.dev/docs/socket-api/ and installed schema supply framing, graphics and
bridge details; read only the section needed.
