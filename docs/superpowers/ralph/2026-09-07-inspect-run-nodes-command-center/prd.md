# Inspect Run Nodes on Command Center — Ralph PRD

## Overview

Implement Workflow Run View HITL Story 5.5: make the experimental console run detail screen (`/console/p/:projectId/r/:runId`) an inspect-first command center where the chronological Log and node-centric Graph open one persistent, type-aware node room, without adding Epic 6 human-input controls. The implementation is deliberately isolated under `packages/web/src/experiments/console/**`, consumes only generated API types and the sanctioned `@/lib/run-graph` geometry library, and projects server run details into one inspect model shared across Log, Graph, and the node room.

## Problem

The current console run detail screen displays run events in a flattened log stream and cannot inspect individual node execution state, captured stdout, approval context, child workflow runs, route decisions, loop iterations, or agent transcripts. Operators cannot navigate from the graph or chat timeline to node rooms, nor can they switch between Log and Graph without losing selection context. In addition, backend `awaiting` states must be presented safely without prematurely pulling in Epic 6 interaction controls or violating NFR4 console isolation boundaries.

## Solution

Expose typed node messages and DAG nodes in console skills; define approval-context parsing and inspect status policies; build an unmerged Log projection representing ordinary nodes, loop iterations, and route decisions; implement deterministic room-kind resolution and room data extraction; render a console-owned multi-type `ConsoleNodeRoom` (with 1s polling for live agent rooms); adapt DAG nodes to `@/lib/run-graph` and replace the console graph renderer; make `NodeDivider` and `RunStream` rows individually selectable; compose a responsive split `ConsoleInspectPane` hosting a single persistent room instance; integrate URL query parameter (`?node=`) selection in `RunDetailPage` while preserving existing `StreamToolbar` Log filtering; deep-link chat timeline status cards; enforce NFR4 isolation; and validate repository gates before updating the sprint tracker.

## Goals and success metrics

- **Dual View & Single Room:** A live or completed console run displays both `Log` and `Graph` views. Switching between views never closes or remounts the selected node room.
- **Unmerged Chronological Log:** Every ordinary node run, loop iteration, and route decision renders as a distinct, selectable divider row in chronological order without double-counting node usage.
- **Unified Selection & Deep-Linking:** Clicking a Log row, Graph node, or timeline status card resolves the same node selection and synchronizes with `?node=` in the URL.
- **Type-Aware Node Rooms:** Node rooms correctly render agent transcripts (text, tool inputs/outputs, status transitions), stdout (bash/script with truncation metadata and exit codes), gate approvals (declared approval/plannotator context with existing approve/reject controls), child workflows (link to child run), route decisions, and loop group iterations.
- **Agent Polling Policy:** `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` is requested only for agent rooms and polled every 1,000 ms only while the run is live (`running` or `paused`).
- **No Premature HITL:** Backend `awaiting` state is presented as `running`. No Ask cards, input composers, pending-interaction slots, or "Waiting on you" chrome appear.
- **NFR4 Console Isolation:** Console production code imports only generated API types and `@/lib/run-graph`; no legacy components, stores, contexts, hooks, or `@tanstack/react-query` are imported.
- **Zero Regressions:** Existing run lifecycle actions, SSE updates, Log filtering (`All nodes`), usage expansion, artifact browsing, approval actions, and environment displays continue working.
- **Validated Tracker Transition:** All focused console tests and `bun run validate` pass before Story 5.5 and Epic 5 are marked `done` in `sprint-status.yaml`.

## Non-goals

- Epic 6 human-in-the-loop interactive controls: Ask cards, response composers, pending-interaction slots, `node_awaiting` presentation, or "Waiting on you" UI.
- Modifying backend server routes, OpenAPI specifications, database schemas, workflow execution engine YAML, or provider bindings.
- Sharing React components between legacy and console shells.
- Importing legacy components, stores, hooks, or React Query into console production code.
- Replacing or removing the existing `StreamToolbar` Log node filter.

## Locked technical context

The source plan is [2026-09-07-inspect-run-nodes-command-center.md](../../plans/2026-09-07-inspect-run-nodes-command-center.md).
- Goal & architecture: lines 6–14.
- Global constraints: lines 15–35.
- Acceptance criteria (AC1–AC10): lines 36–48.
- Specification traceability: lines 49–61.
- Complete file structure (Create & Modify lists): lines 62–117.
- Task 1 (Typed Console Data Boundary): lines 118–174.
- Task 2 (Approval and Inspect-Status Policy): lines 175–241.
- Task 3 (Unmerged Log Projection): lines 242–328.
- Task 4 (Room Types, Data, and Selection): lines 329–510.
- Task 5 (Console-Owned Node Room): lines 511–569.
- Task 6 (DAG to Shared Run-Graph Layout): lines 570–627.
- Task 7 (Console Graph Renderer): lines 628–667.
- Task 8 (Selectable Log Rows): lines 668–705.
- Task 9 (Persistent Inspect Pane Composition): lines 706–762.
- Task 10 (URL Selection & Log Filtering): lines 763–806.
- Task 11 (Deep-Link Timeline & Isolation Boundary): lines 807–849.
- Task 12 (Validation, Evidence, and Tracker Closure): lines 850–870.
- Final verification checklist: lines 871–884.

Key codebase locations:
- Console root: `packages/web/src/experiments/console/`
- Keys & Store: `packages/web/src/experiments/console/store/keys.ts`
- Skills: `packages/web/src/experiments/console/skills/runs.ts`, `packages/web/src/experiments/console/skills/workflows.ts`
- Inspect components: `packages/web/src/experiments/console/components/inspect/`
- Room component: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Graph components: `packages/web/src/experiments/console/components/graph/`, `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Log components: `packages/web/src/experiments/console/components/NodeDivider.tsx`, `packages/web/src/experiments/console/components/RunStream.tsx`
- Pane container: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Page route: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Shared geometry library: `@/lib/run-graph` (`packages/web/src/lib/run-graph/`)
- Sprint status tracker: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

## Cross-story invariants

- **NFR4 Isolation:** No runtime imports from legacy paths or `@/lib/api`. The only permitted runtime import from `@/lib` is `@/lib/run-graph`. Imports from `@/lib/api.generated` must remain type-only.
- **No Premature HITL:** Backend `awaiting` state is normalized to `running` for inspect status display. No Ask card, input composer, or waiting-on-you chrome is introduced before Epic 6.
- **Single Room Mount:** Exactly one `ConsoleNodeRoom` component remains mounted beside either Log or Graph so transcript and selection state survive view toggling.
- **Log Filter vs. Selection:** `StreamToolbar` controls the Log node filter (`streamNodeFilter`) with its `All nodes` option; node room inspection (`selectedNodeId`) is separate and backed by the URL query parameter `?node=`.
- **Chronological Audit Order:** Source event arrays define the chronological audit order. Log rows and room messages sort deterministically by source order / sequence numbers.
- **Replayability:** Historical runs without live connections or with missing definition nodes remain replayable through fallback event metadata and generic transcript rendering.
- **Test Isolation:** No use of `mock.module()` in new tests due to Bun cache pollution. Tests use explicit dependency injection or scoped local spy restoration with `installHappyDom`.

## Story overview

| Priority | ID | Story | Depends on | Outcome |
| ---: | --- | --- | --- | --- |
| 1 | US-001 | Extend the Typed Console Data Boundary | — | Typed contracts for node messages, DAG nodes, and expanded run detail are available. |
| 2 | US-002 | Establish Approval and Inspect-Status Policy | US-001 | Approval-context parsing and awaiting-to-running inspect status policies are locked. |
| 3 | US-003 | Build the Unmerged Log Projection | US-001, US-002 | Unmerged log rows, synthetic fallback states, and console log entries with single-ledger usage are projected. |
| 4 | US-004 | Resolve Room Types, Data, and Selection | US-001, US-002, US-003 | Type-aware room resolution, deterministic data selectors, message slicer, and URL/live selection precedence are ready. |
| 5 | US-005 | Render the Console-Owned Node Room | US-001, US-002, US-004 | Multi-kind `ConsoleNodeRoom` renders agent, stdout, gate, child run, route, and loop-group rooms with 1s live agent polling. |
| 6 | US-006 | Adapt the DAG to the Shared Run-Graph Layout | US-001, US-002 | Typed DAG adapter to `@/lib/run-graph` and deterministic viewport bounds/fit calculations are established. |
| 7 | US-007 | Replace the Console Graph Renderer | US-006 | Console-owned SVG/HTML graph panel renders shared geometry with zoom, pan, fit, labels, arrows, and node selection. |
| 8 | US-008 | Make Every Log Row Selectable | US-003 | `NodeDivider` and `RunStream` support selectable rows for ordinary runs, loop iterations, and route decisions while keeping filter behavior. |
| 9 | US-009 | Compose One Persistent Inspect Pane | US-005, US-007, US-008 | Responsive split layout hosts Log or Graph alongside a single persistent node room instance. |
| 10 | US-010 | Integrate URL Selection Without Breaking Log Filtering | US-004, US-009 | `RunDetailPage` synchronizes `?node=` URL selection, coordinates inspect pane, and preserves `StreamToolbar` filter. |
| 11 | US-011 | Deep-Link Timeline Status and Lock the Isolation Boundary | US-010 | Chat timeline and dock status cards deep-link to current/approval nodes; NFR4 isolation and no-premature-HITL tests pass. |
| 12 | US-012 | Validate, Record Evidence, and Close the Epic | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009, US-010, US-011 | Repository validation passes, diff is verified, and Story 5.5 and Epic 5 are marked done in `sprint-status.yaml`. |

## Ralph execution notes

Complete stories in ascending priority order (1 through 12). A story must add its failing tests first, run the focused RED command, implement the smallest compliant change, run the focused GREEN commands, and leave `passes: false` until its acceptance criteria are completely satisfied. Each story produces focused commits and touches only planned files. US-012 is the sole story authorized to update `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
