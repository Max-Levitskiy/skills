---
name: herdr
description: >-
  Operate Herdr agents and terminal workspaces locally, in WSL, or on authorized
  remote machines. Use for Herdr delegation, fleet coordination, conversations,
  session discovery, interactive attach, terminal navigation, and runtime diagnosis.
---

# Operate Herdr by task

Select the intended machine and session, perform the task, then verify its result.
Prefer native CLI operations; optional helpers add preset/config and label resolution.

## Shared contract

- Carry execution environment, server/session, and returned IDs together. IDs and live
  names belong to one server. UI selection does not retarget CLI calls. Resolve “this”
  from that target. Distinguish named sessions from labeled workspaces by inventory.
- Check installed version, targeted server status, and relevant command help once.
  Use the installed schema for disputed shapes. Unsupported features or failed access
  end that operation; changing targets requires an explicit task decision.
- Work within current authorization. Preserve other work; messaging existing agents,
  authentication, installation, takeover, server changes and destructive cleanup need
  authorization for those actions. Invocation grants no standing permission.
- State is observation: done is unseen idle completion; unknown may persist. Verify
  the current task's artifact/output before success. Inspect blocking evidence before
  answering dialogs. A timeout after submission requires inspection before retrying.

## Choose the task

Read this file plus the matching reference for an ordinary task. Load another only when
the task crosses its boundary.

| I need to… | Read |
| --- | --- |
| Delegate, converse, read answers, respond to an agent | [agents](references/agents.md) |
| Coordinate many tasks with bounded concurrency | [orchestration](references/orchestration.md) |
| Find a local/WSL/remote server or named session | [targets](references/targets.md) |
| Attach interactively, detach, resume, recover | [sessions](references/sessions.md) |
| Isolate work in a workspace or Git worktree | [workspaces](references/workspaces.md) |
| Navigate/rearrange tabs/panes; run/read terminal commands | [tabs and panes](references/tabs-and-panes.md) |
| Diagnose detection/readiness or integrations | [diagnostics](references/diagnostics-and-integrations.md) |
| Subscribe to events, query layouts/metadata, build bridges | [API](references/advanced-api.md) |
| Configure UI/keys/notifications or native Herdr plugins | [configuration and plugins](references/configuration-and-plugins.md) |

Finish with target, returned IDs, evidence and unresolved state. Retain a compact record
across invocations instead of reloading transcripts or guessing the selected UI.
