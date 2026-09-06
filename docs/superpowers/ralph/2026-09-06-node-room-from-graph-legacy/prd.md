# Node Room From Graph (Legacy) Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md`
Derived slug: `2026-09-06-node-room-from-graph-legacy`

## Overview

Story 5.3 gives the legacy run view (`WorkflowExecution`) a node-centric graph as a second door into the same mounted per-type node room as Logs, while retaining the unmerged Logs view and excluding AskHuman chrome. The linked issue is [#83](https://github.com/anhle128/Archon/issues/83).

Architecture:
1. Add the adopted dependency-free `packages/web/src/lib/run-graph/` module for deterministic cycle-safe layout, cubic edge routing, and taken-path classification.
2. Keep `@xyflow/react` as the legacy pan-and-zoom shell, but feed it only positions and routes from the pure module.
3. Evolve the current Logs-only composition (`LegacyNodeLogs`) into one `LegacyGraphLogsPane` that stays mounted while its left navigation switches between Graph and Logs, so both doors share selection and exactly one `LegacyNodeRoom` instance.

## Problem

In Story 5.2, `LegacyNodeRoom` was wired into `LegacyNodeLogs` to provide per-type node rooms (agent transcript, stdout, gate, child workflow, route controller, loop group) for rows selected in the Logs tab. However, the Graph tab still renders beside a legacy merged `WorkflowLogs` panel (`WorkflowExecution.tsx:687-774`), and uses an older dagre layout (`packages/web/src/lib/dag-layout.ts`) which does not handle cycle lanes or taken-path styling. Operators navigating via the Graph cannot access the per-type rooms or share selection state with Logs, while switching tabs unmounts and re-mounts room state.

## Solution

1. Create a pure, zero-dependency layout engine in `packages/web/src/lib/run-graph/`:
   - `types.ts` & `constants.ts`: strict types and layout dimensions (`NODE_WIDTH = 180`, `NODE_HEIGHT = 80`).
   - `taken-path.ts`: pure classifier where `isOnPath` is true for `running`, `completed`, `failed`, `awaiting`, and false for `pending`, `skipped`.
   - `positions.ts`: cycle-safe layering via DFS back-edge detection, longest-path layering, two-direction barycenter sweeps, and centered layer coordinates.
   - `routes.ts`: cubic SVG path routing (`M x y C ...`) with distance-aware ports (bottom-to-top, bottom-to-side, left-flank back-edge lanes, self-edges).
   - `layout.ts` & `index.ts`: public `layout(input: LayoutInput): LayoutResult` entry point.
2. Adapt workflow definitions to layout input in `packages/web/src/components/workflows/build-run-graph-input.ts`.
3. Build React Flow view model and custom route edge:
   - `build-workflow-dag-view-model.ts`: converts pure layout positions and routes into React Flow nodes and edges (`type: 'runGraphRoute'`).
   - `RunGraphRouteEdge.tsx`: renders SVG cubic path with token colors (`var(--border)`, `var(--accent-bright)`, `var(--success)`, `var(--accent)`, `var(--error)`).
   - `WorkflowDagViewer.tsx`: updates to use the shared view model and custom route edge.
4. Unify Graph and Logs under one mounted pane:
   - `resolve-graph-room-row.ts`: resolves clicked graph node ID to a canonical `LogRow` (preferring ordinary node row, falling back to last iteration, or synthesizing a pending row).
   - `LegacyGraphLogsPane.tsx` (renamed from `LegacyNodeLogs.tsx`): manages shared row selection and renders left navigation (Graph or Logs list) beside a single, stable `LegacyNodeRoom`.
   - `WorkflowExecution.tsx`: unifies DAG Graph and Logs branches using `resolveWorkflowExecutionBody`.
5. Verify all tests, lint, format, type-check, and transition sprint status for Story 5.3 to done.

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Pure layout engine | Zero runtime dependencies (no React, DOM, API, React Flow, or dagre imports) in `packages/web/src/lib/run-graph/` | `packages/web/src/lib/run-graph/*.test.ts` |
| Cycle-safe & deterministic layout | Back edges detected without flattening DAG; positions identical when only node states change | `positions.test.ts`, `layout.test.ts` |
| Distance-aware cubic routing | Short edges enter top; long horizontal offsets enter side; back edges route around left flank | `routes.test.ts` |
| Taken-path classification | Target-started rule: `running`, `completed`, `failed`, `awaiting` are on-path; `skipped`, `pending` are off-path | `taken-path.test.ts`, `build-run-graph-input.test.ts` |
| Shared React Flow rendering | Legacy viewer renders nodes and routes from pure layout without local geometry math | `build-workflow-dag-view-model.test.ts`, `RunGraphRouteEdge.test.tsx` |
| Unified room pane | Exactly one `LegacyNodeRoom` mounted; switching between Graph and Logs preserves selection and DOM state | `LegacyGraphLogsPane.test.tsx`, `WorkflowExecution.test.tsx` |
| Canonical row resolution | Graph click clears iteration-specific selection and resolves canonical node row; Logs preserves iterations | `resolve-graph-room-row.test.ts`, `LegacyGraphLogsPane.test.tsx` |
| Inspect-only safety | No AskHuman cards/slots, awaiting run status, or waiting-on-you chrome introduced | `LegacyGraphLogsPane.test.tsx`, grep audits |
| Zero regressions | Builder layout, sequential runs, Source Control, and Chat tabs remain unaffected | `dag-layout.test.ts`, `WorkflowExecution.test.tsx` |

## Non-Goals

- Do not implement AskHuman interactive cards, empty Ask slots, awaiting chrome, waiting-on-you copy, or a new status badge in the Graph shell.
- Do not add `awaiting` to `WorkflowStepStatus`, `workflowNodeStateSchema`, the generated API types, or live UI mappers in Story 5.3 (pure run-graph layout module supports `awaiting` fixtures in tests only).
- Do not change engine, database, API routes, workflow schemas, workflow YAML, provider behavior, CLI, chat, `manage_run`, or command-center behavior.
- Do not implement console graph shell or import legacy components into `packages/web/src/experiments/console/`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not add new dependencies to `package.json` or call dagre from `packages/web/src/lib/run-graph/`.
- Do not modify `packages/web/src/lib/dag-layout.ts` (Workflow Builder continues using dagre).
- Sequential non-DAG runs continue to use the merged `WorkflowLogs` / `StepLogs` panel.
- Do not introduce TypeScript `any`.

## Technical Context and File References

- `docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md`: authoritative plan.
- `packages/web/src/lib/run-graph/types.ts`: public contracts (`NodeState`, `RouteOutcome`, `LayoutEdgeKind`, `LayoutNode`, `LayoutEdge`, `Point`, `PortSide`, `LayoutRoute`, `LayoutResult`, `LayoutInput`).
- `packages/web/src/lib/run-graph/constants.ts`: `NODE_WIDTH = 180`, `NODE_HEIGHT = 80`, `NODE_SEP = 40`, `RANK_SEP = 80`, `SIDE_PORT_THRESHOLD = 135`, `BACK_EDGE_GUTTER = 46`.
- `packages/web/src/lib/run-graph/taken-path.ts`: `isOnPath(state)` and `isEdgeTaken(targetState)`.
- `packages/web/src/lib/run-graph/positions.ts`: `computePositions(nodeIds, edges): PositionResult`.
- `packages/web/src/lib/run-graph/routes.ts`: `buildRoutes(...)`: formats cubic SVG path `M x y C ...`.
- `packages/web/src/lib/run-graph/layout.ts` & `index.ts`: `layout(input: LayoutInput): LayoutResult`.
- `packages/web/src/components/workflows/build-run-graph-input.ts`: transforms `DagNode[]` and live statuses into `LayoutInput`.
- `packages/web/src/components/workflows/build-workflow-dag-view-model.ts`: maps pure layout to React Flow `nodes` and `edges`.
- `packages/web/src/components/workflows/RunGraphRouteEdge.tsx`: React Flow edge component rendering `BaseEdge` from route path and tokens.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx:59-155`: legacy viewer migrated to use `buildWorkflowDagViewModel` and `RunGraphRouteEdge`.
- `packages/web/src/components/workflows/resolve-graph-room-row.ts`: maps node ID to canonical `LogRow` or synthetic pending row.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`: evolution of `LegacyNodeLogs.tsx` hosting Graph/Logs switcher and single `LegacyNodeRoom`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:687-811`: wires DAG Graph and Logs through `LegacyGraphLogsPane`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:48-49`: tracks Story 5.3 completion.

## Story Overview Table

| Priority | ID | Title | Depends On | Plan Task Reference |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Add pure run-graph types and taken-path classifier | - | Task 1 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:107-205, 303-338`) |
| 2 | US-002 | Implement cycle-safe layered positions | US-001 | Task 2 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:207-240, 340-388`) |
| 3 | US-003 | Implement cubic routes and public layout function | US-001, US-002 | Task 3 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:242-281, 390-449`) |
| 4 | US-004 | Adapt workflow definitions to shared run-graph input | US-003 | Task 4 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:283-317, 451-496`) |
| 5 | US-005 | Render shared routes in legacy React Flow viewer | US-004 | Task 5 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:319-366, 498-558`) |
| 6 | US-006 | Share one room between Graph and Logs with unified selection | US-005 | Task 6 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:368-450, 560-690`) |
| 7 | US-007 | Run full validation and update sprint status | US-006 | Task 7 (`docs/superpowers/plans/2026-09-06-node-room-from-graph-legacy.md:692-749`) |
