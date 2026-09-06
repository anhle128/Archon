# Node Type Rooms (Legacy) Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-node-type-rooms-legacy.md`
Derived slug: `2026-09-06-node-type-rooms-legacy`

## Overview

Story 5.2 enables an operator to select any row in the legacy run Logs view and see one accessible room whose header and body match the node type, without representing deterministic or control-flow nodes as agent chat. The source plan is `docs/superpowers/plans/2026-09-06-node-type-rooms-legacy.md` and the linked issue is #82.

Architecture: Keep `LegacyNodeLogs` as the single Logs list-and-room shell introduced by Story 5.1 (`packages/web/src/components/workflows/LegacyNodeLogs.tsx:16-75`). Resolve the selected row from the current workflow definition first, then from persisted run events and the current `ApprovalContext`, and mount `NodeTranscriptPane` only for command, prompt, loop, or unmatched agent-compatible nodes. Read non-agent room data from the already-fetched run events and metadata; this story changes no engine, database, API, workflow language, console, or full-run graph contract.

## Problem

In Story 5.1, `LegacyNodeLogs` was wired to always mount `NodeTranscriptPane` regardless of node type (`packages/web/src/components/workflows/LegacyNodeLogs.tsx:65-70`). For non-agent nodes such as bash commands, scripts, approvals, plannotator gates, child workflows, route controllers, and loop groups, this resulted in attempting to fetch agent transcripts from `GET /api/workflows/runs/:runId/nodes/:nodeId/messages`, which are neither produced nor meaningful for deterministic or control-flow steps. Furthermore, selected loading, error, and empty agent states currently lack an accessible labelled region (`packages/web/src/components/workflows/NodeRoom.tsx:186-235`). Operators need dedicated, type-appropriate inspection surfaces for each node type while preserving single-list selection and transcript isolation.

## Solution

1. Extract and normalize `ApprovalContext` parsing and safe HTTP(S) Plannotator review URL validation into `packages/web/src/lib/approval-context.ts`.
2. Implement pure node-room classification in `packages/web/src/components/workflows/resolve-room-kind.ts` to map definition nodes, fallback events, and approval contexts to room kinds (`agent`, `stdout`, `gate`, `workflow`, `route_loop`, `loop_group`).
3. Implement attempt-scoped room data selectors in `packages/web/src/components/workflows/select-room-data.ts` to isolate latest execution attempts and extract view models without timestamp sorting.
4. Export shared accessibility primitives (`RoomRegion`, `RoomPlaceholder`) from `packages/web/src/components/workflows/NodeRoom.tsx` so every selected room has exactly one labelled region (`aria-label="<nodeId> room"`).
5. Build dedicated room body components:
   - `StdoutRoom`: displays captured stdout, status, truncation notices, and exit status for bash/script nodes without chat markdown.
   - `GateRoom`: displays approval/plannotator prompt messages, documents, safe Plannotator links, decision status, and interactive Approve/Reject actions when active on a paused run.
   - `ChildWorkflowRoom`: displays child run link, paused message, or fan-out summary without inlining child transcripts.
   - `RouteControllerRoom`: displays execution decisions, evaluated conditions, and targets for route loops.
   - `LoopGroupRoom`: displays authored body topology and per-iteration status accordions without graph dependencies.
6. Create the `LegacyNodeRoom` dispatcher component containing the shared header and the type switch, mounting `NodeTranscriptPane` only for agent rooms and suppressing transcript requests for non-agent rooms.
7. Wire `LegacyNodeRoom` into `LegacyNodeLogs`, retaining approval metadata in `WorkflowExecution.tsx` and passing mutation callbacks only to the Logs branch.
8. Validate all test suites, linting, type-checking, and mark Story 5.2 done in sprint status.

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Accessible Room Shell | Every selected room state (loading, error, empty, loaded) has exactly one labelled region (`aria-label="<nodeId> room"`); unselected has none | `packages/web/src/components/workflows/NodeRoom.test.tsx:70-203`, `LegacyNodeRoom.test.tsx` |
| Accurate Node Classification | Authed body kinds map cleanly without `resolveNodeDisplay` collapse; fallbacks resolve via events/metadata | `packages/web/src/components/workflows/resolve-room-kind.test.ts` |
| Attempt-Scoped Isolation | Re-runs do not leak stale stdout, child IDs, or decisions from earlier attempts | `packages/web/src/components/workflows/select-room-data.test.ts` |
| Dedicated Non-Agent Rooms | Bash/script, gates, child runs, routers, and loop groups render purpose-built UIs without agent chat chrome | `StdoutRoom.test.tsx`, `GateRoom.test.tsx`, `ChildWorkflowRoom.test.tsx`, `RouteControllerRoom.test.tsx`, `LoopGroupRoom.test.tsx` |
| Transcript Request Suppression | Non-agent rooms never call `getWorkflowNodeMessages` | `LegacyNodeRoom.test.tsx`, `LegacyNodeLogs.test.tsx` |
| Declared Gate Mutation Control | Active paused gate displays Approve/Reject and surfaces errors; inactive or incompatible gates hide controls | `GateRoom.test.tsx`, `LegacyNodeLogs.test.tsx` |
| Full Suite & Lint Validation | Zero lint warnings, clean type-check, clean validate | `bun run lint --max-warnings 0`, `bun run validate` |

## Non-Goals

- Inspect-only for AskHuman: do not add an Ask card, an empty Ask slot, awaiting or waiting-on-you chrome, an awaiting run status, `node_awaiting` or `interaction_resolved` events, or `remote_agent_pending_interactions`.
- Do not change workflow YAML, NativeTool handlers, provider resume behavior, `pauseWorkflowRun`, CLI, chat, manage_run, or command-center behavior.
- Do not add `packages/web/src/lib/run-graph` (Story 5.3 owns the full run graph).
- Keep the Graph tab and its existing merged `WorkflowLogs` panel unchanged.
- Keep `remote_agent_messages` as the merged chat path; do not add a node identifier to it.
- Do not write bash, script, workflow, approval, plannotator_gate, route_loop, or loop_group output to `remote_agent_workflow_node_messages`.
- Do not add `type` or `node_output` to `workflowNodeStateSchema`.
- Do not change an API route or regenerate `packages/web/src/lib/api.generated.d.ts`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not import `packages/web/src/experiments/console` into `packages/web/src/components/workflows` or share React room/panel components with the console.
- Do not inline child transcripts into a child workflow room.

## Technical Context

- `packages/web/src/components/workflows/LegacyNodeLogs.tsx:16-75`: owns Logs list selection and currently always mounts `NodeTranscriptPane`.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx:14-48`: owns TanStack Query boundary for agent transcripts.
- `packages/web/src/components/workflows/NodeRoom.tsx:118-124`: shared empty-state markup; lines 186-235 need refactoring to export `RoomPlaceholder` and `RoomRegion`.
- `packages/web/src/components/workflows/build-log-rows.ts:6-23`: defines `LogRow` and selections (`node`, `loop_iteration`, `route_iteration`).
- `packages/web/src/components/workflows/WorkflowExecution.tsx:69-78, 279-319, 770-788`: maps GET run response and renders `LegacyNodeLogs`.
- `packages/web/src/components/dashboard/WorkflowRunCard.tsx:118-133, 333-376`: HTTP(S)-only Plannotator review URL validation and approval affordances.
- `packages/web/src/components/dashboard/ConfirmRunActionDialog.tsx:24-43`: modal dialog for run rejection with optional reason.
- `packages/web/src/lib/api.ts:381-402, 421-449`: exposes `approveWorkflowRun`, `rejectWorkflowRun`, `getWorkflowRun`, and `getWorkflowNodeMessages`.
- `packages/workflows/src/dag-executor.ts`: persists bash/script stdout, loop iteration events, approval requests, child run IDs, fan-out flags, and route decisions.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:47-48`: marks Story 5.1 done and Story 5.2 backlog.

## Story Overview

| Priority | Story | Title | Depends on | Plan anchors |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Extract web ApprovalContext and Plannotator URL boundary | - | Task 1: 392-611 |
| 2 | US-002 | Add pure node-room classification | US-001 | Task 2: 613-846 |
| 3 | US-003 | Add attempt-scoped room data selectors | US-001 | Task 3: 848-1062 |
| 4 | US-004 | Make selected-room shell accessible and add StdoutRoom | US-003 | Task 4: 1064-1286 |
| 5 | US-005 | Add declared GateRoom behavior | US-004 | Task 5: 1288-1495 |
| 6 | US-006 | Add ChildWorkflowRoom | US-004 | Task 6: 1497-1663 |
| 7 | US-007 | Add RouteControllerRoom | US-004 | Task 7: 1665-1803 |
| 8 | US-008 | Add LoopGroupRoom | US-004 | Task 8: 1805-1975 |
| 9 | US-009 | Add LegacyNodeRoom dispatcher and shared header | US-002, US-003, US-004, US-005, US-006, US-007, US-008 | Task 9: 1977-2277 |
| 10 | US-010 | Wire dispatcher into LegacyNodeLogs and WorkflowExecution | US-009 | Task 10: 2279-2489 |
| 11 | US-011 | Validate story and update sprint tracking | US-010 | Task 11: 2491-2570 |

## Ralph Execution Notes

- Implement exactly one story per fresh-context Ralph iteration.
- Follow strict TDD: verify RED test failure before writing production code, make GREEN with minimal code, and refactor while green.
- Do not start a story until every `dependsOn` story has `passes: true`.
- Never run `bun test` from the repository root; run focused tests from `packages/web` and full checks via `bun run validate` from root.
