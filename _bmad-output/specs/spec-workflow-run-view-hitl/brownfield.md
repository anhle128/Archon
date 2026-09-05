# Brownfield seams (v1 must not ignore)

Today's engine, before this feature. Architecture ADs exist because of these. Do not "fix" them by riding the old slot.

## Pause is run-level and single-slot

- Run status: `pending` \| `running` \| `completed` \| `failed` \| `cancelled` \| `paused`. No `awaiting` run status.
- Node progress is event-sourced (`node_started` / `node_completed` / `tool_called`). No node status column.
- Human pause today is `metadata.approval` (`ApprovalContext`) — **one slot per run**. AskHuman must not write it (AD-1, AD-2).
- `pauseWorkflowRun` currently requires `ApprovalContext` and always merges `metadata.approval`. Ask pause must make that argument optional and leave the slot untouched.
- In-flight siblings keep streaming when the run is `paused` (`shouldContinueStreamingForStatus`). Next DAG layer does not start.

## Native tools are chat-only

- `SendQueryOptions.nativeTools` is injected by the chat orchestrator (`manage_run`), not by workflow nodes.
- `NativeTool.handler` returns `Promise<string>`. Claude/Pi wrappers treat the return as a tool-result string. A throw today becomes a tool error, not a `sendQuery` reject — AD-5 changes the wrappers for `AskHumanAwaitingError` only.
- Claude/Pi schema converters are flat string/enum/boolean unless extended for AskHuman `questions[]`.

## Pi is prompt → dispose

- `PiProvider.sendQuery` ends in `session.dispose()`. There is no `AgentSession.continue()`. Resume injection is `session.agent.continue()` on `pi-agent-core` (AD-6), unproven across dispose/reopen.

## SSE does not replay history

- Buffer is short (500 events / 60s). UIs already poll REST. Ask cards must survive refetch from `pending_interactions` on GET run, not from the stream.

## Surfaces

- Legacy: `WorkflowExecution.tsx` (React Flow graph, REST + chat SSE overlay). Rebuilds node status from events — must stop being a second projector (AD-7).
- Console: `experiments/console` log-first layout, isolation from production UI modules. HITL today is the free-text composer — not an ask channel (AD-9).
