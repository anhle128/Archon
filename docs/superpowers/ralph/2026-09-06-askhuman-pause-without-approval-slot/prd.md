# Pause a Run When the Agent Asks Without Stealing the Approval Slot Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md`  
Derived slug: `2026-09-06-askhuman-pause-without-approval-slot`

## Overview

Story 6.2 of the Workflow Run View HITL epic implements the pause-on-ask foundation: when an AI node calls the `AskHuman` tool, Archon persists a structured pending interaction row and a `node_awaiting` event in a single database transaction, pauses the workflow run without writing `metadata.approval`, projects the node's state as `awaiting`, and halts the DAG cleanly.

Additionally, this story adds provider-level AskHuman support to Claude and Pi (relying on the protocol spike from Story 6.1), adds the `askHuman` capability axis, rejects unsupported `allowed_tools: [AskHuman]` at workflow start (CAP-7), embeds pending interactions into `GET /api/workflows/runs/:runId`, and emits live/polled `node_awaiting` events as SSE refetch triggers without payload leakage.

Story 6.2 deliberately does NOT implement question answering, resume interaction execution, or UI Ask cards—those belong to Stories 6.3, 6.5, and 6.6 (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:25-26`).

## Problem

When an agent needs human input mid-run, it previously had no structured mechanism to pause and ask questions without either usurping the workflow-level gate approval slot (`metadata.approval`) or failing the run. 

1. Usurping `metadata.approval` destroys gate context and violates the separation between declared human-in-the-loop gates and dynamic agent questions (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:8-13`).
2. Without a dedicated pending interactions table (`remote_agent_pending_interactions`), structured questions and session ids cannot be persisted durably across provider reconnects (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:155-182`).
3. Without projecting `awaiting` from `node_awaiting` and pending rows, operators cannot tell that a node is waiting for answers rather than running or failed (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:236-257`).
4. If a workflow specifies `allowed_tools: [AskHuman]` on a provider that lacks AskHuman capability (Codex, Grok, OpenCode, etc.), failing during execution rather than preflight creates confusing runtime errors (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:377-386`).

## Solution

1. **Schema & Persistence**: Add `remote_agent_pending_interactions` table (application table 23) to PostgreSQL and SQLite with dialect parity, unique constraint on `(workflow_run_id, tool_use_id)`, and cascade delete (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:155-182`).
2. **Atomic Write**: In a single database transaction, insert the pending interaction row and insert the `node_awaiting` event via `insertWorkflowEvent` with `{ node_id, tool_use_id, kind }` only (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:211-221`).
3. **Approval-Free Pause**: Update `pauseWorkflowRun` to make `approvalContext` optional; when omitted, pause the run without touching `metadata.approval`, and treat already-paused runs idempotently (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:227-233`).
4. **State Projection**: Add `awaiting` to `nodeStateSchema` and `workflowStepStatusSchema` (while keeping `NodeOutput['state']` a strict executable subset), and update `projectLatestEffectiveNodeStates` to project `awaiting` from `node_awaiting` events and pending rows (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:236-257`).
5. **Provider Converters & Control Errors**: Update Claude and Pi native tool converters to accept nested `questions[]` and propagate `AskHumanAwaitingError` / `AskHumanNoStarterError` out of the agent loop without stringifying as tool output, aborting the in-flight SDK operation (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:310-362`).
6. **Capability Axis**: Add `askHuman: boolean` to `ProviderCapabilities` (`true` for Claude and Pi, `false` for others) and update the capability matrix (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:131-136`).
7. **DAG Executor**: Inject `createAskHumanTool` into Claude and Pi command/prompt/loop nodes; on `AskHumanAwaitingError`, pause the run without approval metadata, set lifecycle `awaiting`, emit live `node_awaiting`, and halt DAG execution without writing `node_completed` or `node_failed` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:364-375`).
8. **CAP-7 Preflight**: Validate at DAG startup that any node specifying `AskHuman` in `allowed_tools` runs on a provider supporting `askHuman`; reject immediately with a clean error before turn 1 (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:377-386`).
9. **API & SSE**: Embed pending interactions into `GET /api/workflows/runs/:runId`, project `awaiting` in `nodeStates`, map `node_awaiting` to SSE `workflow_status` (paused, no envelope), and keep node transcript messages Ask-free (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:388-394`).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Additive DB parity | Table 23 `remote_agent_pending_interactions` exists on SQLite & Postgres with 12 columns, constraints, trailing comments, and raised SQLite parity floor | `sqlite.test.ts`, `bundled-schema.test.ts`, `check:schema-upgrades` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:602-690`) |
| Atomic pending write | Pending interaction and `node_awaiting` event are committed in one transaction; rollback trigger leaves 0 rows; missing starter throws `AskHumanNoStarterError` | `workflow-pending-interactions.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:692-805`) |
| Untouched approval slot | Pausing on Ask sets `status = 'paused'`, leaves `metadata.approval` untouched, is idempotent if already paused | `db/workflows.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:507-600`) |
| Awaiting projection | `projectLatestEffectiveNodeStates` projects `awaiting` from `node_awaiting` and pending rows; `nodeOutputSchema` rejects `awaiting` | `schemas.test.ts`, `retry-state.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:417-505`) |
| SDK abort & error identity | Claude and Pi abort in-flight query on AskHuman and reject `sendQuery` with the exact same `AskHumanAwaitingError` instance; real SDK tool/session ids passed | `claude/provider.test.ts`, `pi/provider.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1049-1193`) |
| Clean DAG pause | Asking node returns `{ state: 'completed' }` to halt DAG, emits live `node_awaiting`, records lifecycle `awaiting`, writes no `node_completed`/`node_failed` events | `dag-executor.test.ts`, `ask-human.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1296-1473`) |
| CAP-7 preflight | Workflows with `allowed_tools: [AskHuman]` on unsupported providers throw before turn 1; chat does not inject `AskHuman` | `dag-executor.test.ts`, `orchestrator-agent.test.ts` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1475-1873`) |
| Full verification | All 23 package test shards pass, capability matrix generated/checked, bundled schema checked, schema upgrades checked, full validation passes | `bun run validate` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1877-2036`) |

## Non-Goals

- Implementing `resolvePendingInteraction`, answer POST endpoint, or `resumeInteractions` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:25-26`).
- Adding provider resume mappers or continuation injection (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:26`).
- Building UI Ask cards, answer forms, or awaiting chrome (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:26`).
- Writing `metadata.approval` on Ask pause (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:27`).
- Adding a run status enum value `awaiting` (run status remains `paused`) (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:28`).
- Writing `node_completed` or `node_failed` events for an asking node (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:29`).
- Classifying assistant prose as an ask (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:30`).
- Wrapping Claude's native `AskUserQuestion` tool (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:31`).
- Injecting `AskHuman` into the chat orchestrator (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:32`).
- Adding workflow YAML syntax or fields for AskHuman (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:33`).

## Technical Context

- Engine status schemas: `workflowStepStatusSchema` and `nodeStateSchema` in `packages/workflows/src/schemas/workflow-run.ts` add `'awaiting'`; `nodeOutputSchema` remains unchanged; `AssertNodeOutputStateIsNodeState` replaces two-way assertion (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:88-90, 447-463`).
- Projector: `packages/workflows/src/retry-state.ts` accepts optional `pending` rows; maps `node_awaiting` event to `state: 'awaiting'`; does not complete on `interaction_resolved`; overlays `awaiting` on running nodes when pending rows have `status: 'pending'` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:93-94, 241-257`).
- Pause behavior: `IWorkflowStore.pauseWorkflowRun` in `packages/workflows/src/store.ts` and `packages/core/src/db/workflows.ts` makes `approvalContext` optional; when omitted, sets `status = 'paused'`, omits `metadata.approval`, succeeds if already `paused`, throws if not running (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:59-61, 204-209, 227-233, 538-562`).
- Persistence: Table 23 `remote_agent_pending_interactions` in `migrations/000_combined.sql` and `packages/core/src/db/adapters/sqlite.ts`; unique constraint `(workflow_run_id, tool_use_id)`; trailing comments in Postgres; SQLite parity floor 181 (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:79-80, 155-182, 602-690`).
- Core DB operations: `packages/core/src/db/workflow-pending-interactions.ts` executes `insertPendingInteraction` within `withTransaction`, checks `user_id` on run (throws `AskHumanNoStarterError` if null), inserts pending row, calls `insertWorkflowEvent` for `node_awaiting` with `{ node_id, tool_use_id, kind }`, returns parsed row; `listPendingInteractions` orders by `created_at ASC, id ASC` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:211-225, 692-805`).
- Store ports: `IWorkflowPendingInteractionStore` added to `packages/workflows/src/store.ts`, composed into `IWorkflowStore`, implemented in `packages/core/src/workflows/store-adapter.ts` and test doubles (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:185-203, 807-882`).
- Server & API: `GET /api/workflows/runs/:runId` in `packages/server/src/routes/api.ts` embeds `pending_interactions` from DB, passes pending rows into projector, uses `nodeStateSchema` for `workflowNodeStateSchema.status`, regenerates web types (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:57-58, 884-972`).
- SSE Bridge: `WORKFLOW_EVENT_TYPES` adds `node_awaiting` and `interaction_resolved`; `packages/server/src/adapters/web/workflow-bridge.ts` maps `node_awaiting` to `workflow_status` with `status: 'paused'` and no approval/envelope payloads (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:63, 974-1047`).
- Native tool converters: `packages/providers/src/claude/native-tools.ts` and `packages/providers/src/community/pi/native-tools.ts` support nested `questions[]` arrays of objects, receive `NativeToolHandlerContext` (`toolUseId`, `sessionId`), report branded `AskHumanControlError` via runtime callbacks (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1049-1117`).
- Provider wrappers: `packages/providers/src/claude/provider.ts` captures `PreToolUse` tool id and message `session_id`, stores branded control error, aborts attempt, rethrows same instance before retry/classification; `packages/providers/src/community/pi/provider.ts` captures `_toolCallId` and `session.sessionId`, aborts, rethrows same instance after session bridge (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1119-1234`).
- Capabilities: `askHuman: boolean` added to `ProviderCapabilities` in `packages/providers/src/types.ts`; set to `true` for Claude and Pi, `false` for Codex, Grok, Copilot, OMP, OpenCode, QoderCLI, e2e-fake; capability matrix generated and checked (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:75-77, 1236-1294`).
- DAG Executor & Tool: `createAskHumanTool` in `packages/workflows/src/ask-human.ts` validates input schema, calls `insertPendingInteraction`, logs `workflow.ask_pending` (ids only), throws `AskHumanAwaitingError`; `packages/workflows/src/dag-executor.ts` injects tool into command/prompt/loop nodes when `capabilities.askHuman` is true; catches `AskHumanAwaitingError`, calls `pauseWorkflowRun(runId)`, records lifecycle `awaiting`, emits live `node_awaiting`, returns `{ state: 'completed', output }` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1296-1473`).
- CAP-7 Preflight: `collectAskHumanUnsupportedProviders` in `packages/workflows/src/dag-executor.ts` inspects nodes and nested loop groups using `WorkflowModelScope`; if `allowed_tools` contains `AskHuman` or `mcp__archon__AskHuman` on a provider with `askHuman: false`, throws before turn 1 (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1475-1873`).
- Validation & Gates: Run all 23 focused test suites, generate bundled schema and capability matrix, run Postgres schema upgrades check, run full `bun run validate`, update sprint status to `done` (`docs/superpowers/plans/2026-09-06-askhuman-pause-without-approval-slot.md:1877-2036`).

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Add `awaiting` to node status enums and the projector | - | 88-90, 93-94, 236-257, 417-505 |
| 2 | US-002 | Make Ask pause optional-approval and idempotent | US-001 | 59-61, 204-209, 227-233, 507-600 |
| 3 | US-003 | Add `remote_agent_pending_interactions` additively | - | 79-80, 104-108, 155-182, 602-690 |
| 4 | US-004 | Insert and list pending rows in the same transaction as `node_awaiting` | US-002, US-003 | 109-114, 186-225, 307-327, 692-805 |
| 5 | US-005 | Expose pending ports on `IWorkflowStore` | US-004 | 92, 116-117, 199-203, 807-882 |
| 6 | US-006 | Embed pending rows on GET run and keep messages Ask-free | US-001, US-004, US-005 | 57-58, 139-141, 147, 884-972 |
| 7 | US-007 | Make `node_awaiting` an SSE refetch trigger | US-001, US-005 | 63, 142-145, 388-394, 974-1047 |
| 8 | US-008 | Convert `questions[]` and preserve branded tool errors at the converter boundary | US-004 | 122-124, 127-128, 263-286, 310-353, 1049-1117 |
| 9 | US-009 | Make Claude abort and reject with the same Ask control error | US-008 | 70, 125-126, 336-353, 1119-1176 |
| 10 | US-010 | Make Pi abort and reject with the same Ask control error | US-008 | 71, 129-130, 354-362, 1178-1234 |
| 11 | US-011 | Add the `askHuman` capability axis | US-009, US-010 | 75-77, 131-136, 1236-1294 |
| 12 | US-012 | Inject AskHuman, persist, throw, and pause without completing the node | US-002, US-005, US-007, US-011 | 95-100, 258-306, 364-375, 1296-1473 |
| 13 | US-013 | Reject AskHuman on unsupported providers at run start and keep chat clean | US-011, US-012 | 74, 78, 146, 377-386, 1475-1873 |
| 14 | US-014 | Validate Story 6.2 and mark sprint status done | US-006, US-007, US-012, US-013 | 151, 1877-2036 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration.
- Do not start a story until every `dependsOn` story has `passes: true`.
- Run focused package tests from the package directory (e.g., `cd packages/workflows && bun test <file>`). Never run unscoped `bun test` from repository root.
- All schema changes must be validated against PostgreSQL upgrades (`bun run check:schema-upgrades`).
- Maintain Red -> Green -> Refactor -> Commit flow for each story.
