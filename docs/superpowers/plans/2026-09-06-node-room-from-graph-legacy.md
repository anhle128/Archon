# Node Room From Graph (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the legacy run view a node-centric graph that is a second door into the same per-type room as Logs, without replacing unmerged Logs or shipping Ask chrome.

**Architecture:** Add a dependency-free pure-TS module at `packages/web/src/lib/run-graph/` whose public API is `layout({ nodes: { id, nodeState }[], edges }) → { positions, routes }`.
Keep React Flow as the legacy shell only: it consumes those positions and routes, and a graph node click selects the matching Logs row and mounts the existing Story 5.2 `LegacyNodeRoom`.
Do not implement the console graph shell, do not add a frontend dependency, and do not change engine, database, API, or workflow YAML.

**Tech Stack:** Bun, strict TypeScript, React 19, `@xyflow/react` (legacy shell only), TanStack Query, react-dom/server, happy-dom, and bun:test.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.3.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-1, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-4.

**Issue:** https://github.com/anhle128/Archon/issues/83

## Global Constraints

- Implement only Story 5.3 on the legacy `WorkflowExecution` Graph surface.
- Keep Story 5.3 inspect-only for AskHuman.
- Do not add an Ask card, an empty Ask slot, awaiting or waiting-on-you chrome, an awaiting run status, `node_awaiting` or `interaction_resolved` events, or `remote_agent_pending_interactions`.
- Do not add `awaiting` to `WorkflowStepStatus` or to `workflowNodeStateSchema`.
- The run-graph module must accept `nodeState: 'awaiting'` in fixtures even though the live UI does not produce it yet.
- Taken-path must treat `awaiting` as on-path and must never classify it as skipped.
- Keep declared approval and Plannotator gates on the existing `ApprovalContext` slot.
- Do not change workflow YAML, the NativeTool handler contract, provider resume behavior, `pauseWorkflowRun`, CLI, chat, `manage_run`, or command-center behavior.
- Do not implement the console graph shell.
- Do not import `packages/web/src/experiments/console` from `packages/web/src/components/workflows`.
- Do not share a React room or panel component with the console.
- Console may later import only `@/lib/run-graph` (already allowed by `eslint.config.mjs` because it is not `@/lib/api` or `@/components/**`).
- Do not import `@archon/workflows` from `@archon/web`.
- Do not change an API route or regenerate `packages/web/src/lib/api.generated.d.ts`.
- Do not add a package dependency, including ELK or a second layout library.
- `packages/web/src/lib/run-graph/` must not import React, DOM, `@xyflow/react`, `@dagrejs/dagre`, or `@/lib/api`.
- Keep the Logs tab and its unmerged `LegacyNodeLogs` list.
- Replace only the Graph tab's merged `WorkflowLogs` panel with the same `LegacyNodeRoom` as Logs.
- Sequential non-DAG runs keep the merged logs panel.
- Keep `remote_agent_messages` as the merged chat path and do not add a node identifier to it.
- Keep `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` as the command, prompt, and loop room source only.
- Do not introduce the TypeScript `any` type.
- Use only existing design tokens and existing dependencies.
- Do not run `bun test` from the repository root.
- Run focused tests from `packages/web` and finish with `bun run validate` from the repository root.
- For every behavior change, write and run the failing test first, confirm that it fails for the missing behavior, implement only enough production code to pass, rerun the focused test, and refactor only while green.
- Do not mark the sprint story done until all validation succeeds.

---

## Verified Repository Baseline

- Issue 83 requests Story 5.3 and requires its epic acceptance criteria, focused evidence, and the sprint-status transition.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:48` marks Story 5.2 done and line 49 marks Story 5.3 backlog.
- `packages/web/src/lib/run-graph/` does not exist.
- `packages/web/src/lib/dag-layout.ts:6-7` defines `NODE_WIDTH = 180` and `NODE_HEIGHT = 80`.
- `packages/web/src/lib/dag-layout.ts:49-84` lays out the builder and the current run Graph with dagre at `ranksep: 80` and `nodesep: 40`.
- `packages/web/src/lib/dag-layout.ts:145-211` builds React Flow nodes and edges, including `route_loop` outcome edges using `ROUTE_LAYOUT_OUTCOMES = ['exhausted', 'negative', 'positive']`.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx:42-64` still calls `dagNodesToReactFlow` and ignores taken-path.
- `packages/web/src/components/workflows/WorkflowDagViewer.tsx:149-155` already forwards `onNodeClick(node.id)`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:261` stores `selectedDagNode`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:265` defaults `activeView` to `'graph'`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:492-498` auto-selects a running or first DAG node.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:616-619` `handleNodeClick` sets `selectedDagNode` and bumps a merged-log scroll trigger.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:687-774` renders Graph as `WorkflowDagViewer` plus merged `WorkflowLogs`.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:787-811` renders Logs as `LegacyNodeLogs` plus `LegacyNodeRoom`.
- `packages/web/src/components/workflows/LegacyNodeLogs.tsx:123-145` owns Logs-row selection internally and does not read `selectedDagNode`.
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx:24-36` is the one per-type room dispatcher.
- `packages/web/src/components/workflows/build-log-rows.ts:14-22` defines `LogRow`.
- `packages/web/src/components/workflows/build-log-rows.ts:100-141` emits either iteration rows or one ordinary `{ kind: 'node' }` row per node id.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:23-24` already shows Graph then Logs.
- `packages/web/src/lib/types.ts:13` `WorkflowStepStatus` is `pending | running | completed | failed | skipped` with no `awaiting`.
- `packages/web/src/lib/api.generated.d.ts:4845` GET run `nodeStates[].status` also has no `awaiting`.
- `packages/web/package.json:15` already depends on `@dagrejs/dagre`; Story 5.3 must not add another layout package and must not use dagre inside `run-graph`.
- `eslint.config.mjs:125-146` blocks console from `@/components/**` and `@/lib/api` functions; `@/lib/run-graph` is already a legal console import.

## Scope Decisions

These are resolved implementation decisions, not open product questions.

1. Keep React Flow as the legacy Graph shell.
Do not replace it with a custom SVG canvas in this story.
Console Story 5.5 owns its own SVG shell.

2. Implement layout, barycenter ordering, distance-aware ports, and taken-path inside `packages/web/src/lib/run-graph/` with zero runtime dependencies.
Do not call dagre from that module.

3. Do not share Graph and Logs selection in this story.
`LegacyNodeLogs` keeps its internal `selectedLogRowId`.
The Graph tab uses existing `selectedDagNode` plus `resolveGraphRoomRow`.
Story 5.4 lifts the three-door shared selection.

4. Graph nodes are authored top-level definition nodes from `GET /api/workflows/:name`.
Do not add include-expanded ids or `loop_group` body nodes to the graph.

5. A graph click maps to the latest ordinary `{ kind: 'node' }` Logs row for that `nodeId`.
If that node has only loop-iteration or route-iteration rows, use the last matching row in `buildLogRows` order.
If no Logs row exists, synthesize `{ id: 'node:<nodeId>', selection: { kind: 'node' } }` from live status or the node id so a pending graph node still opens a room.

6. Existing Graph auto-select remains.
After load, the Graph tab shows that node's room instead of merged logs.
Logs still starts at `Select a node` until the operator clicks a row.

7. Remove merged `WorkflowLogs` from the DAG Graph tab only.
Sequential non-DAG layout keeps merged logs.

8. Edge routing is port selection plus simple polylines, not the August orthogonal-router spec.
Short/vertical forward edges use bottom → top.
Long-offset forward edges use right → left or left → right.
Back-edges (`target.y <= source.y`) use left → left around `min(x) - 24`.

9. Positions depend only on node ids and edges.
Changing `nodeState` must not move nodes.

10. Live UI never maps a status to `awaiting` in this story.
The module still classifies an `awaiting` fixture as on-path.

## File Map and Responsibilities

### Pure run-graph module

- Create `packages/web/src/lib/run-graph/types.ts` for `NodeState`, `LayoutNode`, `LayoutEdge`, `Point`, `PortSide`, `LayoutRoute`, and `LayoutResult`.
- Create `packages/web/src/lib/run-graph/constants.ts` for `NODE_WIDTH`, `NODE_HEIGHT`, `RANK_SEP`, `NODE_SEP`, `VERTICAL_DX`, and `SIDE_GUTTER`.
- Create `packages/web/src/lib/run-graph/taken-path.ts` and `packages/web/src/lib/run-graph/taken-path.test.ts`.
- Create `packages/web/src/lib/run-graph/positions.ts` and `packages/web/src/lib/run-graph/positions.test.ts`.
- Create `packages/web/src/lib/run-graph/routes.ts` and `packages/web/src/lib/run-graph/routes.test.ts`.
- Create `packages/web/src/lib/run-graph/layout.ts` for the public `layout()` orchestrator.
- Create `packages/web/src/lib/run-graph/layout.test.ts` for the AD-4 public contract, awaiting fixture, and position stability.
- Create `packages/web/src/lib/run-graph/index.ts` re-exporting only the public API.

### Legacy shell input and room mapping

- Create `packages/web/src/components/workflows/build-run-graph-input.ts` and `packages/web/src/components/workflows/build-run-graph-input.test.ts`.
- Create `packages/web/src/components/workflows/synthesize-legacy-log-node-states.ts`.
- Create `packages/web/src/components/workflows/resolve-graph-room-row.ts` and `packages/web/src/components/workflows/resolve-graph-room-row.test.ts`.
- Create `packages/web/src/components/workflows/GraphRoomPane.tsx` and `packages/web/src/components/workflows/GraphRoomPane.test.tsx`.
- Create `packages/web/src/components/workflows/RunGraphRouteEdge.tsx` and `packages/web/src/components/workflows/RunGraphRouteEdge.test.ts`.

### Viewer and Graph tab wiring

- Modify `packages/web/src/components/workflows/WorkflowDagViewer.tsx:1-176` to consume `layoutRunGraph` and `RunGraphRouteEdge`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx:9-10` and `687-774` to mount `GraphRoomPane` instead of merged logs on the DAG Graph tab.
- Modify `packages/web/src/components/workflows/LegacyNodeLogs.tsx:36-100` only to import the extracted synthesizer.
- Leave `packages/web/src/components/workflows/LegacyNodeRoom.tsx` unchanged.
- Leave `packages/web/src/lib/dag-layout.ts` unchanged so the Workflow Builder keeps dagre.
- Leave `packages/web/src/experiments/console/**` unchanged.

### Completion tracking

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:2`, `37`, and `49` only after validation passes.

## Authoritative Interfaces

### Run-graph public API

The module's only public runtime export is `layout`.
Types and box constants may also be exported from `index.ts`.

~~~ts
export type NodeState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';

export interface LayoutNode {
  id: string;
  nodeState: NodeState;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface Point {
  x: number;
  y: number;
}

export type PortSide = 'top' | 'bottom' | 'left' | 'right';

export interface LayoutRoute {
  edgeId: string;
  source: string;
  target: string;
  sourcePort: PortSide;
  targetPort: PortSide;
  points: Point[];
  taken: boolean;
}

export interface LayoutResult {
  positions: Record<string, Point>;
  routes: LayoutRoute[];
}

export function layout(input: {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
}): LayoutResult;
~~~

`positions[id]` is the top-left of an `NODE_WIDTH` by `NODE_HEIGHT` box.

Constants:

~~~ts
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 80;
export const RANK_SEP = 80;
export const NODE_SEP = 40;
export const VERTICAL_DX = 90;
export const SIDE_GUTTER = 24;
~~~

### Taken-path

~~~ts
export function isOnPath(state: NodeState): boolean;
export function isEdgeTaken(sourceState: NodeState, targetState: NodeState): boolean;
~~~

`isOnPath` is true only for `running`, `completed`, `failed`, and `awaiting`.
`pending` and `skipped` are never on-path.
`isEdgeTaken` is true only when both endpoints are on-path.
A missing endpoint is not taken.

### Positions

~~~ts
export function computePositions(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[]
): Record<string, Point>;
~~~

Use Kahn layering with `layer = max(parent layers) + 1` and sources at layer 0.
Nodes that remain because of a cycle go into `maxAssignedLayer + 1`, or layer 0 when no layer was assigned.
Drop edges whose source or target is absent from `nodeIds`.
Preserve first-seen node id order when ids repeat.
Inside each layer, start with input order, then apply three barycenter passes: a node's barycenter is the average parent index in the previous layer, or its current index when it has no in-layer-resolvable parent.
Sort by barycenter, then original input index.
`x = index * (NODE_WIDTH + NODE_SEP)`.
`y = layer * (NODE_HEIGHT + RANK_SEP)`.

### Ports and polylines

Anchor points:

- top: `{ x: x + NODE_WIDTH / 2, y }`
- bottom: `{ x: x + NODE_WIDTH / 2, y: y + NODE_HEIGHT }`
- left: `{ x, y: y + NODE_HEIGHT / 2 }`
- right: `{ x: x + NODE_WIDTH, y: y + NODE_HEIGHT / 2 }`

Let `dx = target.x - source.x` and `dy = target.y - source.y`.

- If `dy > 0` and `Math.abs(dx) <= VERTICAL_DX`: `sourcePort = 'bottom'`, `targetPort = 'top'`, `points = [sourceBottom, targetTop]`.
- Else if `dy <= 0`: `sourcePort = 'left'`, `targetPort = 'left'`, `outerX = Math.min(source.x, target.x) - SIDE_GUTTER`, `points = [sourceLeft, { x: outerX, y: sourceLeft.y }, { x: outerX, y: targetLeft.y }, targetLeft]`.
- Else if `dx > 0`: `sourcePort = 'right'`, `targetPort = 'left'`, `midX = (sourceRight.x + targetLeft.x) / 2`, `points = [sourceRight, { x: midX, y: sourceRight.y }, { x: midX, y: targetLeft.y }, targetLeft]`.
- Else: `sourcePort = 'left'`, `targetPort = 'right'`, `midX = (sourceLeft.x + targetRight.x) / 2`, `points = [sourceLeft, { x: midX, y: sourceLeft.y }, { x: midX, y: targetRight.y }, targetRight]`.

Omit a route when either endpoint has no position.
Self-loops use the back-edge rule.

### Shell graph input

~~~ts
export interface RunGraphShellInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  labels: Record<string, string>;
}

export function buildRunGraphInput(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): RunGraphShellInput;

export function layoutRunGraph(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): LayoutResult & { labels: Record<string, string> };
~~~

`buildRunGraphInput` copies each `dagNodes` id in order.
It sets `nodeState` from the last matching `liveStatus` entry, or `'pending'` when absent.
It never emits `'awaiting'`.
It builds ordinary edges from `depends_on` unless the dependency is a `route_loop` controller and this node is one of that controller's route targets.
It then adds one edge per configured `positive` / `negative` / `exhausted` target using insertion order `exhausted`, `negative`, `positive`.
Edge ids match `dag-layout.ts`: `${source}->${target}`, or `${source}->${target}:${outcome}` when that base id is already used.
Labels are the outcome string for route edges and are omitted for ordinary edges.

`layoutRunGraph` calls `layout({ nodes, edges })` and returns `{ ...result, labels }`.

### Graph room row

~~~ts
export function resolveGraphRoomRow(input: {
  rows: readonly LogRow[];
  nodeId: string | null;
  liveStatus: readonly { nodeId: string; name: string; status: WorkflowNodeStateResponse['status'] }[];
}): LogRow | null;
~~~

If `nodeId` is null, return null.
If any `rows` have that `nodeId`, return the last `{ selection.kind === 'node' }` match, else the last match in array order.
Otherwise synthesize:

~~~ts
{
  id: `node:${nodeId}`,
  nodeId,
  label: live?.name ?? nodeId,
  status: live?.status ?? 'pending',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'node' },
}
~~~

### Graph room pane

~~~ts
export interface GraphRoomPaneProps {
  runId: string;
  selectedNodeId: string | null;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  liveStatus: readonly { nodeId: string; name: string; status: WorkflowNodeStateResponse['status'] }[];
}
~~~

`GraphRoomPane` builds rows with the same `synthesizeLegacyLogNodeStates` contract as Logs.
Do not duplicate that synthesizer.
Import nothing from `LegacyNodeLogs.tsx` if that would create a cycle.
Copy the existing synthesizer into `packages/web/src/components/workflows/synthesize-legacy-log-node-states.ts` only if Task 5 cannot import it without a cycle.
The default is: move `synthesizeLegacyLogNodeStates` and its local helpers from `LegacyNodeLogs.tsx` into `synthesize-legacy-log-node-states.ts` and import it from both `LegacyNodeLogs` and `GraphRoomPane`.
That move is a behavior-preserving extract and still needs a failing-then-passing import test in Task 5.

`GraphRoomPane` then calls `resolveGraphRoomRow` and renders one `LegacyNodeRoom`.
It must not render `NodeRunList`.

### Polyline helper

~~~ts
export function polylinePath(points: readonly Point[]): string;
~~~

Empty points return `''`.
Otherwise `M ${x} ${y}` plus ` L ${x} ${y}` for each following point, using the raw numbers from layout.

### Exact visible copy

- `Select a node` when the Graph tab has no `selectedNodeId`.
- Existing Story 5.2 room copy for every type.
- Graph tab label remains `Graph`.
- Logs tab label remains `Logs`.
- Do not add `awaiting`, `waiting on you`, or `AskHuman` copy.

---

### Task 1: Classify taken-path including awaiting

**Files:**

- Create `packages/web/src/lib/run-graph/types.ts`.
- Create `packages/web/src/lib/run-graph/taken-path.ts`.
- Create `packages/web/src/lib/run-graph/taken-path.test.ts`.

**Interfaces:**

- Produces `NodeState`, `isOnPath`, and `isEdgeTaken`.
- Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing taken-path tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { isEdgeTaken, isOnPath } from './taken-path';
import type { NodeState } from './types';

const ON_PATH: readonly NodeState[] = ['running', 'completed', 'failed', 'awaiting'];
const OFF_PATH: readonly NodeState[] = ['pending', 'skipped'];

describe('isOnPath', () => {
  test('treats awaiting as on-path and skipped as off-path', () => {
    for (const state of ON_PATH) {
      expect(isOnPath(state)).toBe(true);
    }
    for (const state of OFF_PATH) {
      expect(isOnPath(state)).toBe(false);
    }
  });
});

describe('isEdgeTaken', () => {
  test('marks completed to awaiting as taken', () => {
    expect(isEdgeTaken('completed', 'awaiting')).toBe(true);
  });

  test('never marks a skipped target as taken', () => {
    expect(isEdgeTaken('completed', 'skipped')).toBe(false);
    expect(isEdgeTaken('awaiting', 'skipped')).toBe(false);
  });

  test('does not mark pending endpoints as taken', () => {
    expect(isEdgeTaken('completed', 'pending')).toBe(false);
    expect(isEdgeTaken('pending', 'running')).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts )
~~~

Expected: FAIL because `./taken-path` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation.**

`types.ts` exports `NodeState` exactly as specified.
`taken-path.ts` implements `isOnPath` with an explicit union check and `isEdgeTaken` as `isOnPath(source) && isOnPath(target)`.

- [ ] **Step 4: Run the test to verify it passes.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Refactor only while green.**

Keep the helpers free of layout math.

- [ ] **Step 6: Commit Task 1.**

~~~bash
git add packages/web/src/lib/run-graph/types.ts packages/web/src/lib/run-graph/taken-path.ts packages/web/src/lib/run-graph/taken-path.test.ts
git commit -m "feat(web): classify run-graph taken-path including awaiting"
~~~

### Task 2: Compute stable layered positions

**Files:**

- Create `packages/web/src/lib/run-graph/constants.ts`.
- Create `packages/web/src/lib/run-graph/positions.ts`.
- Create `packages/web/src/lib/run-graph/positions.test.ts`.

**Interfaces:**

- Consumes `LayoutEdge` from Task 1 types.
- Produces `computePositions` and the box constants.

- [ ] **Step 1: Write the failing position tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { NODE_HEIGHT, NODE_SEP, NODE_WIDTH, RANK_SEP } from './constants';
import { computePositions } from './positions';

describe('computePositions', () => {
  test('places a one-node graph at the origin', () => {
    expect(computePositions(['a'], [])).toEqual({ a: { x: 0, y: 0 } });
  });

  test('layers a fork and orders the children by input id when barycenters tie', () => {
    const positions = computePositions(
      ['a', 'c', 'b'],
      [
        { id: 'a->b', source: 'a', target: 'b' },
        { id: 'a->c', source: 'a', target: 'c' },
      ]
    );
    expect(positions.a).toEqual({ x: 0, y: 0 });
    expect(positions.b).toEqual({ x: 0, y: NODE_HEIGHT + RANK_SEP });
    expect(positions.c).toEqual({
      x: NODE_WIDTH + NODE_SEP,
      y: NODE_HEIGHT + RANK_SEP,
    });
  });

  test('places a two-node cycle on one overflow layer in input order', () => {
    const positions = computePositions(
      ['a', 'b'],
      [
        { id: 'a->b', source: 'a', target: 'b' },
        { id: 'b->a', source: 'b', target: 'a' },
      ]
    );
    expect(positions.a).toEqual({ x: 0, y: 0 });
    expect(positions.b).toEqual({ x: NODE_WIDTH + NODE_SEP, y: 0 });
  });

  test('ignores edges whose endpoints are missing', () => {
    expect(
      computePositions(['a'], [{ id: 'a->missing', source: 'a', target: 'missing' }])
    ).toEqual({ a: { x: 0, y: 0 } });
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/positions.test.ts )
~~~

Expected: FAIL because `./positions` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation.**

Export the six constants from `constants.ts`.
Implement Kahn layering and three barycenter passes as specified.
Do not read `nodeState`.

- [ ] **Step 4: Run the test to verify it passes.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/positions.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Refactor only while green.**

Keep the function under one module.

- [ ] **Step 6: Commit Task 2.**

~~~bash
git add packages/web/src/lib/run-graph/constants.ts packages/web/src/lib/run-graph/positions.ts packages/web/src/lib/run-graph/positions.test.ts
git commit -m "feat(web): add run-graph layered positions"
~~~

### Task 3: Route distance-aware ports and export layout()

**Files:**

- Create `packages/web/src/lib/run-graph/routes.ts`.
- Create `packages/web/src/lib/run-graph/routes.test.ts`.
- Create `packages/web/src/lib/run-graph/layout.ts`.
- Create `packages/web/src/lib/run-graph/layout.test.ts`.
- Create `packages/web/src/lib/run-graph/index.ts`.

**Interfaces:**

- Consumes Tasks 1 and 2.
- Produces public `layout()`.

- [ ] **Step 1: Write the failing route and layout tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { NODE_HEIGHT, NODE_SEP, NODE_WIDTH, RANK_SEP, SIDE_GUTTER } from './constants';
import { buildRoutes } from './routes';
import type { Point } from './types';

describe('buildRoutes', () => {
  test('uses bottom and top ports for a short vertical forward edge', () => {
    const positions: Record<string, Point> = {
      a: { x: 0, y: 0 },
      b: { x: 0, y: NODE_HEIGHT + RANK_SEP },
    };
    const routes = buildRoutes(
      positions,
      [{ id: 'a->b', source: 'a', target: 'b' }],
      { a: 'completed', b: 'completed' }
    );
    expect(routes).toEqual([
      {
        edgeId: 'a->b',
        source: 'a',
        target: 'b',
        sourcePort: 'bottom',
        targetPort: 'top',
        points: [
          { x: NODE_WIDTH / 2, y: NODE_HEIGHT },
          { x: NODE_WIDTH / 2, y: NODE_HEIGHT + RANK_SEP },
        ],
        taken: true,
      },
    ]);
  });

  test('uses side ports for a long offset forward edge', () => {
    const positions: Record<string, Point> = {
      a: { x: 0, y: 0 },
      c: { x: NODE_WIDTH + NODE_SEP, y: NODE_HEIGHT + RANK_SEP },
    };
    const routes = buildRoutes(
      positions,
      [{ id: 'a->c', source: 'a', target: 'c' }],
      { a: 'completed', c: 'running' }
    );
    expect(routes[0]?.sourcePort).toBe('right');
    expect(routes[0]?.targetPort).toBe('left');
    expect(routes[0]?.points).toHaveLength(4);
    expect(routes[0]?.taken).toBe(true);
  });

  test('routes a back-edge on the left gutter', () => {
    const positions: Record<string, Point> = {
      a: { x: 0, y: 0 },
      b: { x: 0, y: NODE_HEIGHT + RANK_SEP },
    };
    const routes = buildRoutes(
      positions,
      [{ id: 'b->a', source: 'b', target: 'a' }],
      { a: 'completed', b: 'completed' }
    );
    expect(routes[0]?.sourcePort).toBe('left');
    expect(routes[0]?.targetPort).toBe('left');
    expect(routes[0]?.points[1]?.x).toBe(-SIDE_GUTTER);
  });

  test('omits a route when a node is missing', () => {
    expect(
      buildRoutes({ a: { x: 0, y: 0 } }, [{ id: 'a->z', source: 'a', target: 'z' }], {
        a: 'completed',
      })
    ).toEqual([]);
  });
});
~~~

And `layout.test.ts`:

~~~ts
import { describe, expect, test } from 'bun:test';
import { layout } from './layout';

describe('layout', () => {
  test('returns empty collections for an empty graph', () => {
    expect(layout({ nodes: [], edges: [] })).toEqual({ positions: {}, routes: [] });
  });

  test('keeps positions stable when only nodeState changes', () => {
    const edges = [
      { id: 'start->ask', source: 'start', target: 'ask' },
      { id: 'start->skip', source: 'start', target: 'skip' },
    ];
    const first = layout({
      nodes: [
        { id: 'start', nodeState: 'running' },
        { id: 'ask', nodeState: 'pending' },
        { id: 'skip', nodeState: 'pending' },
      ],
      edges,
    });
    const second = layout({
      nodes: [
        { id: 'start', nodeState: 'completed' },
        { id: 'ask', nodeState: 'awaiting' },
        { id: 'skip', nodeState: 'skipped' },
      ],
      edges,
    });
    expect(second.positions).toEqual(first.positions);
  });

  test('treats awaiting as on-path and skipped as not taken', () => {
    const result = layout({
      nodes: [
        { id: 'start', nodeState: 'completed' },
        { id: 'ask', nodeState: 'awaiting' },
        { id: 'skip', nodeState: 'skipped' },
      ],
      edges: [
        { id: 'start->ask', source: 'start', target: 'ask' },
        { id: 'start->skip', source: 'start', target: 'skip' },
      ],
    });
    expect(result.routes.find(route => route.edgeId === 'start->ask')?.taken).toBe(true);
    expect(result.routes.find(route => route.edgeId === 'start->skip')?.taken).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the tests to verify they fail.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
~~~

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Write the minimal implementation.**

Implement `buildRoutes(positions, edges, states: Record<string, NodeState>)`.
Missing state is treated as `pending`.
Implement `layout` as `computePositions` plus `buildRoutes`.
Duplicate node ids: last `nodeState` wins, first id keeps its first-seen place in the position input list.
`index.ts` re-exports `layout`, the types, and the six constants.

- [ ] **Step 4: Run the tests to verify they pass.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts src/lib/run-graph/positions.test.ts src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Refactor only while green.**

Do not add React or API imports.

- [ ] **Step 6: Commit Task 3.**

~~~bash
git add packages/web/src/lib/run-graph
git commit -m "feat(web): add pure run-graph layout module"
~~~

### Task 4: Map definition nodes into layout input

**Files:**

- Create `packages/web/src/components/workflows/build-run-graph-input.ts`.
- Create `packages/web/src/components/workflows/build-run-graph-input.test.ts`.

**Interfaces:**

- Consumes public `layout()`.
- Produces `buildRunGraphInput` and `layoutRunGraph`.

- [ ] **Step 1: Write the failing input tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import type { DagNode } from '@/lib/api';
import { buildRunGraphInput, layoutRunGraph } from './build-run-graph-input';

function routeLoopNode(): DagNode {
  return {
    id: 'router',
    route_loop: {
      condition: 'ok',
      max_iterations: 3,
      routes: {
        positive: 'done',
        negative: 'fix',
        exhausted: 'fail',
      },
    },
    depends_on: ['start'],
  } as DagNode;
}

describe('buildRunGraphInput', () => {
  test('maps missing live status to pending and ordinary depends_on to unlabeled edges', () => {
    const input = buildRunGraphInput(
      [
        { id: 'start', prompt: 'go' },
        { id: 'end', prompt: 'stop', depends_on: ['start'] },
      ],
      [{ nodeId: 'start', status: 'completed' }]
    );
    expect(input.nodes).toEqual([
      { id: 'start', nodeState: 'completed' },
      { id: 'end', nodeState: 'pending' },
    ]);
    expect(input.edges).toEqual([{ id: 'start->end', source: 'start', target: 'end' }]);
    expect(input.labels).toEqual({});
  });

  test('emits labeled route_loop edges and suppresses the duplicate depends_on route-target edge', () => {
    const input = buildRunGraphInput(
      [
        { id: 'start', prompt: 'go' },
        routeLoopNode(),
        { id: 'fix', prompt: 'fix', depends_on: ['router'] },
        { id: 'done', prompt: 'done', depends_on: ['router'] },
        { id: 'fail', prompt: 'fail', depends_on: ['router'] },
      ],
      []
    );
    expect(input.edges.filter(edge => edge.source === 'router').map(edge => edge.id)).toEqual([
      'router->fail',
      'router->fix',
      'router->done',
    ]);
    expect(input.labels).toEqual({
      'router->fail': 'exhausted',
      'router->fix': 'negative',
      'router->done': 'positive',
    });
    expect(input.edges.some(edge => edge.id === 'router->fix' && input.labels[edge.id] === undefined)).toBe(
      false
    );
  });

  test('never emits awaiting from live WorkflowStepStatus', () => {
    const input = buildRunGraphInput([{ id: 'ask', prompt: 'ask' }], [
      { nodeId: 'ask', status: 'running' },
    ]);
    expect(input.nodes[0]?.nodeState).toBe('running');
  });
});

describe('layoutRunGraph', () => {
  test('returns layout positions for every definition node', () => {
    const result = layoutRunGraph(
      [
        { id: 'start', prompt: 'go' },
        { id: 'end', prompt: 'stop', depends_on: ['start'] },
      ],
      [
        { nodeId: 'start', status: 'completed' },
        { nodeId: 'end', status: 'skipped' },
      ]
    );
    expect(Object.keys(result.positions).sort()).toEqual(['end', 'start']);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.taken).toBe(false);
  });
});
~~~

The first test in Step 1 is the complete contract.
Do not add a second copy of that test.

- [ ] **Step 2: Run the test to verify it fails.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts )
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write the minimal implementation.**

Copy the private `getRouteLoopConfig` logic from `dag-layout.ts:30-47` into this file.
Do not import `@xyflow/react` or dagre.
Call `layout` from `@/lib/run-graph`.

- [ ] **Step 4: Run the test to verify it passes.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Refactor only while green.**

Keep route-target suppression identical to `dagNodesToReactFlow`.

- [ ] **Step 6: Commit Task 4.**

~~~bash
git add packages/web/src/components/workflows/build-run-graph-input.ts packages/web/src/components/workflows/build-run-graph-input.test.ts
git commit -m "feat(web): map workflow definition into run-graph input"
~~~

### Task 5: Resolve a graph node to the same room row

**Files:**

- Create `packages/web/src/components/workflows/synthesize-legacy-log-node-states.ts`.
- Modify `packages/web/src/components/workflows/LegacyNodeLogs.tsx:36-100` to import the extracted synthesizer.
- Create `packages/web/src/components/workflows/resolve-graph-room-row.ts`.
- Create `packages/web/src/components/workflows/resolve-graph-room-row.test.ts`.
- Create `packages/web/src/components/workflows/GraphRoomPane.tsx`.
- Create `packages/web/src/components/workflows/GraphRoomPane.test.tsx`.

**Interfaces:**

- Consumes `buildLogRows`, `LegacyNodeRoom`, and Task 4 is not required here.
- Produces `resolveGraphRoomRow` and `GraphRoomPane`.

- [ ] **Step 1: Write the failing row-resolver tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { buildLogRows, type LogRow } from './build-log-rows';
import { resolveGraphRoomRow } from './resolve-graph-room-row';
import type { WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

const CREATED_AT = '2026-09-06T00:00:00.000Z';

function event(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'e1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: 'setup',
    data: {},
    created_at: CREATED_AT,
    ...overrides,
  };
}

describe('resolveGraphRoomRow', () => {
  test('returns null when no graph node is selected', () => {
    expect(
      resolveGraphRoomRow({ rows: [], nodeId: null, liveStatus: [] })
    ).toBeNull();
  });

  test('prefers the ordinary node row over iteration rows', () => {
    const rows: LogRow[] = [
      {
        id: 'iter-1',
        nodeId: 'loop',
        label: 'Loop ×1',
        status: 'completed',
        order: 0,
        sourceIndex: 0,
        selection: { kind: 'loop_iteration', iteration: 1 },
      },
      {
        id: 'node:loop',
        nodeId: 'loop',
        label: 'Loop',
        status: 'completed',
        order: 1,
        sourceIndex: 0,
        selection: { kind: 'node' },
      },
    ];
    expect(resolveGraphRoomRow({ rows, nodeId: 'loop', liveStatus: [] })?.id).toBe('node:loop');
  });

  test('falls back to the last iteration row when no ordinary row exists', () => {
    const nodeStates: WorkflowNodeStateResponse[] = [
      { nodeId: 'loop', name: 'Loop', status: 'completed', retryEpoch: 0 },
    ];
    const events: WorkflowEventResponse[] = [
      event({
        id: 'i1',
        step_name: 'loop',
        event_type: 'loop_iteration_started',
        data: { iteration: 1 },
      }),
      event({
        id: 'i2',
        step_name: 'loop',
        event_type: 'loop_iteration_started',
        data: { iteration: 2 },
      }),
    ];
    const rows = buildLogRows(nodeStates, events);
    const resolved = resolveGraphRoomRow({ rows, nodeId: 'loop', liveStatus: nodeStates });
    expect(resolved?.selection).toEqual({ kind: 'loop_iteration', iteration: 2 });
  });

  test('synthesizes a pending node row when the graph node has no logs row', () => {
    expect(
      resolveGraphRoomRow({
        rows: [],
        nodeId: 'setup',
        liveStatus: [{ nodeId: 'setup', name: 'Setup', status: 'pending' }],
      })
    ).toEqual({
      id: 'node:setup',
      nodeId: 'setup',
      label: 'Setup',
      status: 'pending',
      order: 0,
      sourceIndex: 0,
      selection: { kind: 'node' },
    });
  });
});
~~~

- [ ] **Step 2: Run the resolver test to verify it fails.**

~~~bash
( cd packages/web && bun test src/components/workflows/resolve-graph-room-row.test.ts )
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `resolveGraphRoomRow`.**

Follow the Authoritative Interfaces section.

- [ ] **Step 4: Run the resolver test to verify it passes.**

~~~bash
( cd packages/web && bun test src/components/workflows/resolve-graph-room-row.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Extract `synthesizeLegacyLogNodeStates` without changing Logs behavior.**

Move the helper and its local functions from `LegacyNodeLogs.tsx` into `synthesize-legacy-log-node-states.ts`.
Re-import them in `LegacyNodeLogs.tsx`.
Run:

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx )
~~~

Expected: PASS with the same Logs behavior.

- [ ] **Step 6: Write the failing GraphRoomPane tests.**

Create `GraphRoomPane.test.tsx` with `process.env.NODE_ENV = 'development'` as the first statement.
Copy the happy-dom bootstrap, `INSTALLED_GLOBAL_KEYS`, `installHappyDom`, `restoreGlobals`, `flush`, `flushUntil`, and `deferred` helpers verbatim from `packages/web/src/components/workflows/LegacyNodeLogs.test.tsx:65-186`.
Then add:

~~~ts
describe('GraphRoomPane', () => {
  test('renders Select a node when nothing is selected and never asks for messages', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderPane({ selectedNodeId: null, loadMessages: async (runId, nodeId) => {
        calls.push([runId, nodeId]);
        return { messages: [] };
      } });
    });
    await flush();
    expect(host.textContent).toContain('Select a node');
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(host.textContent).not.toContain('Node runs');
    expect(calls).toEqual([]);
    expectNoAskHumanChrome(host);
  });

  test('opens the bash stdout room for a graph node without requesting messages', async () => {
    const calls: [string, string][] = [];
    await act(async () => {
      renderPane({
        selectedNodeId: 'setup',
        definitionNodes: [{ id: 'setup', bash: 'echo ready' }],
        nodeStates: [{ nodeId: 'setup', name: 'Setup', status: 'completed', retryEpoch: 0 }],
        events: [
          workflowEvent({ id: 'start-setup', event_type: 'node_started', step_name: 'setup', data: { type: 'bash' } }),
          workflowEvent({
            id: 'done-setup',
            event_type: 'node_completed',
            step_name: 'setup',
            data: { type: 'bash', node_output: 'ready' },
          }),
        ],
        loadMessages: async (runId, nodeId) => {
          calls.push([runId, nodeId]);
          return { messages: [] };
        },
      });
    });
    await flushUntil(host, 'stdout', () => (host.textContent ?? '').includes('ready'));
    expect(host.querySelector('[aria-label="setup room"]')).not.toBeNull();
    expect(host.textContent).toContain('Bash');
    expect(calls).toEqual([]);
    expectNoAskHumanChrome(host);
  });

  test('opens the command transcript room for a graph node', async () => {
    const pending = deferred<WorkflowNodeMessagesResponse>();
    await act(async () => {
      renderPane({
        selectedNodeId: 'review',
        definitionNodes: [{ id: 'review', command: 'review' }],
        nodeStates: [{ nodeId: 'review', name: 'Review', status: 'completed', retryEpoch: 0 }],
        events: [
          workflowEvent({ id: 'start-review', event_type: 'node_started', step_name: 'review' }),
        ],
        loadMessages: async () => pending.promise,
      });
    });
    await flush();
    await act(async () => {
      pending.resolve({
        messages: [
          {
            id: 'm1',
            seq: 1,
            kind: 'text',
            payload: { text: 'hello from review' },
            created_at: CREATED_AT,
          },
        ],
      });
    });
    await flushUntil(host, 'transcript', () =>
      (host.textContent ?? '').includes('hello from review')
    );
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expectNoAskHumanChrome(host);
  });

  test('opens the route_loop controller room without a node-run list', async () => {
    await act(async () => {
      renderPane({
        selectedNodeId: 'router',
        definitionNodes: [
          {
            id: 'router',
            route_loop: {
              condition: 'ok',
              max_iterations: 3,
              routes: { positive: 'done', negative: 'fix', exhausted: 'fail' },
            },
          } as DagNode,
        ],
        nodeStates: [{ nodeId: 'router', name: 'Router', status: 'completed', retryEpoch: 0 }],
        events: [
          workflowEvent({
            id: 'routed-1',
            event_type: 'node_routed',
            step_name: 'router',
            data: { execution_seq: 1, outcome: 'positive', to: 'done' },
          }),
        ],
        loadMessages: async () => ({ messages: [] }),
      });
    });
    await flushUntil(host, 'route room', () => (host.textContent ?? '').includes('Route loop'));
    expect(host.textContent).toContain('Routing decision');
    expect(host.querySelector('[aria-label="router room"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Node runs');
    expectNoAskHumanChrome(host);
  });
});

`renderPane` mounts `QueryClientProvider` plus `GraphRoomPane` with `runId: 'run-1'`, `isLive: false`, `definitionPending: false`, `runStatus: 'completed'`, `approval: null`, no-op approve/reject, and `liveStatus` defaulting to `nodeStates`.
`expectNoAskHumanChrome` is the same three assertions as Logs.

- [ ] **Step 7: Run the pane test to verify it fails.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx )
~~~

Expected: FAIL because `GraphRoomPane` does not exist.

- [ ] **Step 8: Implement `GraphRoomPane`.**

Call `synthesizeLegacyLogNodeStates`, `buildLogRows`, `resolveGraphRoomRow`, then `LegacyNodeRoom`.
Do not render a list.

- [ ] **Step 9: Run the pane and Logs tests.**

~~~bash
( cd packages/web && bun test src/components/workflows/resolve-graph-room-row.test.ts )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 10: Commit Task 5.**

~~~bash
git add packages/web/src/components/workflows/synthesize-legacy-log-node-states.ts packages/web/src/components/workflows/LegacyNodeLogs.tsx packages/web/src/components/workflows/resolve-graph-room-row.ts packages/web/src/components/workflows/resolve-graph-room-row.test.ts packages/web/src/components/workflows/GraphRoomPane.tsx packages/web/src/components/workflows/GraphRoomPane.test.tsx
git commit -m "feat(web): open typed rooms from a selected graph node"
~~~

### Task 6: Draw layout routes in the legacy Graph viewer

**Files:**

- Create `packages/web/src/components/workflows/RunGraphRouteEdge.tsx`.
- Create `packages/web/src/components/workflows/RunGraphRouteEdge.test.ts`.
- Modify `packages/web/src/components/workflows/WorkflowDagViewer.tsx:1-176`.

**Interfaces:**

- Consumes `layoutRunGraph` and `polylinePath`.
- Produces React Flow nodes at layout positions and custom edges from `routes`.

- [ ] **Step 1: Write the failing polyline tests.**

~~~ts
import { describe, expect, test } from 'bun:test';
import { polylinePath } from './RunGraphRouteEdge';

describe('polylinePath', () => {
  test('returns an empty string for no points', () => {
    expect(polylinePath([])).toBe('');
  });

  test('builds an SVG path from layout points', () => {
    expect(
      polylinePath([
        { x: 90, y: 80 },
        { x: 90, y: 160 },
      ])
    ).toBe('M 90 80 L 90 160');
  });
});
~~~

- [ ] **Step 2: Run the test to verify it fails.**

~~~bash
( cd packages/web && bun test src/components/workflows/RunGraphRouteEdge.test.ts )
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `polylinePath` and `RunGraphRouteEdge`.**

`RunGraphRouteEdge` reads `data.points` as `Point[]` and `data.taken` as boolean.
It renders `@xyflow/react` `BaseEdge` with `path={polylinePath(points)}`.
Stroke is `var(--accent-bright)` when taken and `var(--text-tertiary)` when not taken.
Do not use awaiting or error tokens.
If `points` is empty, render nothing.

- [ ] **Step 4: Run the polyline test to verify it passes.**

~~~bash
( cd packages/web && bun test src/components/workflows/RunGraphRouteEdge.test.ts )
~~~

Expected: PASS.

- [ ] **Step 5: Switch `WorkflowDagViewer` to `layoutRunGraph`.**

Replace the `dagNodesToReactFlow` memo.
Call `layoutRunGraph(dagNodes, liveStatus)`.
Set each flow node `position` from `positions[id]` defaulting to `{ x: 0, y: 0 }`.
Keep the existing status overlay, selection ring, executing chip, MiniMap, Controls, and `onNodeClick`.
Register `edgeTypes` at module scope: `{ runGraphRoute: RunGraphRouteEdge }`.
Map each `LayoutRoute` to a React Flow edge `{ id: edgeId, source, target, type: 'runGraphRoute', label: labels[edgeId], data: { points, taken }, animated: target live status === 'running' }`.
Do not color edges by a skipped target as if they were taken.
Do not import dagre.

- [ ] **Step 6: Run neighboring layout tests.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/layout.test.ts src/components/workflows/build-run-graph-input.test.ts src/lib/dag-layout.test.ts src/components/workflows/RunGraphRouteEdge.test.ts )
~~~

Expected: PASS.
Builder `dag-layout` tests must still pass because that module is unchanged.

- [ ] **Step 7: Commit Task 6.**

~~~bash
git add packages/web/src/components/workflows/RunGraphRouteEdge.tsx packages/web/src/components/workflows/RunGraphRouteEdge.test.ts packages/web/src/components/workflows/WorkflowDagViewer.tsx
git commit -m "feat(web): render run-graph layout in the legacy viewer"
~~~

### Task 7: Replace Graph-tab merged logs with the node room

**Files:**

- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx:9-10` and `687-774`.

**Interfaces:**

- Consumes `GraphRoomPane` and existing `selectedDagNode`.
- Produces Graph click → same `LegacyNodeRoom` as Logs for that node.

- [ ] **Step 1: Re-run the Graph room contract before wiring.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx )
~~~

Expected: PASS from Task 5, including bash, command, and route_loop rooms and the absence of a Node runs list.
That suite is the Graph-tab room contract.
Task 7 only replaces the Graph tab's merged logs panel with that pane.

- [ ] **Step 2: Wire `WorkflowExecution` Graph branch.**

Import `GraphRoomPane`.
In the `isDag && activeView === 'graph'` right `ResizablePanel`, stop rendering `mergedLogsPanel`.
Render `retryActionPanel`, then:

~~~tsx
<GraphRoomPane
  runId={runId}
  selectedNodeId={selectedDagNode}
  nodeStates={queryData?.nodeStates ?? []}
  events={queryData?.events ?? []}
  isLive={isRunning}
  loadMessages={getWorkflowNodeMessages}
  definitionNodes={dagDefinitionNodes ?? []}
  definitionPending={workflowDefPending}
  runStatus={queryData?.workflowState.status ?? workflow.status}
  approval={queryData?.approval ?? null}
  onApprove={handleGateApprove}
  onReject={handleGateReject}
  liveStatus={workflow.dagNodes}
/>
~~~

Keep the artifacts footer on that panel, matching Logs.
Keep `mergedLogsPanel` for the sequential non-DAG branch.
Keep `DagRunTabs` Graph and Logs triggers.
Keep `handleNodeClick` as the viewer's `onNodeClick`.
Do not pass graph selection into `LegacyNodeLogs`.

- [ ] **Step 3: Run focused tests.**

~~~bash
( cd packages/web && bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/build-log-rows.test.ts )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx )
( cd packages/web && bun run type-check )
~~~

Expected: PASS with no `any`.
Logs still has unmerged rows.
Graph tabs still include Logs.

- [ ] **Step 4: Commit Task 7.**

~~~bash
git add packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): open the node room from the legacy graph"
~~~

### Task 8: Validate the story and update sprint tracking last

**Files:**

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:2`, `37`, and `49`.

**Interfaces:**

- Produces no runtime interface.
- This task is permitted only after Tasks 1 through 7 are green.

- [ ] **Step 1: Run run-graph unit tests.**

~~~bash
( cd packages/web && bun test src/lib/run-graph/taken-path.test.ts src/lib/run-graph/positions.test.ts src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts )
~~~

Expected: PASS.

- [ ] **Step 2: Run shell mapping tests.**

~~~bash
( cd packages/web && bun test src/components/workflows/build-run-graph-input.test.ts src/components/workflows/resolve-graph-room-row.test.ts src/components/workflows/RunGraphRouteEdge.test.ts src/lib/dag-layout.test.ts )
~~~

Expected: PASS.

- [ ] **Step 3: Run DOM room tests in isolated invocations.**

~~~bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx )
~~~

Expected: PASS.

- [ ] **Step 4: Run neighboring regression tests and the web type checker.**

~~~bash
( cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/build-log-rows.test.ts )
( cd packages/web && bun run type-check )
~~~

Expected: PASS.

- [ ] **Step 5: Run repository lint and full validation from the repository root.**

~~~bash
bun run lint --max-warnings 0
bun run validate
~~~

Expected: both commands exit zero with no warnings.
Do not run `bun test` directly from the root.

- [ ] **Step 6: Update sprint status only after Step 5 succeeds.**

Change `5-3-open-the-same-node-room-from-the-graph-legacy` from `backlog` to `done`.
Set both `last_updated` fields to the implementation completion time in the file's existing timestamp format.
Do not change `generated`, any other story, or either epic status.

- [ ] **Step 7: Check the final diff and rerun formatting validation for the tracking edit.**

~~~bash
git diff --check
bun run format:check
bun run validate
~~~

Expected: all three commands exit zero after the tracking edit.

- [ ] **Step 8: Commit the validated tracking update.**

~~~bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark legacy graph node room done"
~~~

---

## Test Coverage Matrix

| Behavior | Primary test | Regression boundary |
| --- | --- | --- |
| `awaiting` is on-path | `packages/web/src/lib/run-graph/taken-path.test.ts` | `layout.test.ts` |
| Skipped branch is not taken | `layout.test.ts` | `build-run-graph-input.test.ts` |
| Short vertical uses top ports | `routes.test.ts` | `layout.test.ts` |
| Long offset uses side ports | `routes.test.ts` | `layout.test.ts` |
| Back-edge uses left gutter | `routes.test.ts` | `layout.test.ts` |
| Positions ignore nodeState | `layout.test.ts` | `positions.test.ts` |
| Route_loop edge ids and labels | `build-run-graph-input.test.ts` | `dag-layout.test.ts` |
| Graph node → ordinary Logs row | `resolve-graph-room-row.test.ts` | `GraphRoomPane.test.tsx` |
| Graph node → last iteration row | `resolve-graph-room-row.test.ts` | `build-log-rows.test.ts` |
| Pending graph node synthesizes a row | `resolve-graph-room-row.test.ts` | `GraphRoomPane.test.tsx` |
| Graph bash room matches Logs stdout | `GraphRoomPane.test.tsx` | `LegacyNodeLogs.test.tsx` |
| Graph command room uses GET messages | `GraphRoomPane.test.tsx` | `LegacyNodeRoom.test.tsx` |
| Graph has no Node runs list | `GraphRoomPane.test.tsx` | `dag-run-tabs.test.tsx` |
| Logs tab still unmerged | `LegacyNodeLogs.test.tsx` | `dag-run-tabs.test.tsx` |
| Builder dagre layout unchanged | `dag-layout.test.ts` | WorkflowCanvas tests |
| No Ask / awaiting chrome | `GraphRoomPane.test.tsx` | `LegacyNodeLogs.test.tsx` |

## Acceptance Criteria

- [ ] `packages/web/src/lib/run-graph/` exists and exports `layout({ nodes: { id, nodeState }[], edges }) → { positions, routes }`.
- [ ] The module has no React, DOM, `@xyflow/react`, dagre, or `@/lib/api` imports.
- [ ] No new frontend dependency is added.
- [ ] Taken-path treats `awaiting` as on-path and never skipped, proven with a fixture.
- [ ] Short/vertical edges use top ports and long-offset edges use side ports.
- [ ] The legacy run view still has unmerged Logs.
- [ ] The DAG Graph tab shows the graph in addition to that Logs tab, not instead of it.
- [ ] Clicking a graph node opens the same per-type `LegacyNodeRoom` chrome as clicking that node's Logs row.
- [ ] Graph click does not render a second Node runs list.
- [ ] There is still no Ask card, empty Ask slot, or awaiting / waiting-on-you chrome.
- [ ] Console graph shell is unchanged.
- [ ] Engine, database, routes, generated API types, and workflow language are unchanged.
- [ ] All focused tests and `bun run validate` pass.
- [ ] The Story 5.3 sprint-status entry changes to `done` only after validation.

## Validation Commands

Run from `packages/web`:

~~~bash
bun test src/lib/run-graph/taken-path.test.ts src/lib/run-graph/positions.test.ts src/lib/run-graph/routes.test.ts src/lib/run-graph/layout.test.ts
bun test src/components/workflows/build-run-graph-input.test.ts src/components/workflows/resolve-graph-room-row.test.ts src/components/workflows/RunGraphRouteEdge.test.ts src/lib/dag-layout.test.ts
NODE_ENV=development bun test src/components/workflows/GraphRoomPane.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/build-log-rows.test.ts
bun run type-check
~~~

Run from the repository root:

~~~bash
bun run lint --max-warnings 0
bun run validate
git diff --check
~~~

There is no schema migration, so `bun run check:schema-upgrades` is not required.
There is no route-schema change, so `packages/web/src/lib/api.generated.d.ts` must remain unchanged.

## Implementation Order

1. Classify taken-path, including the awaiting fixture.
2. Compute dependency-free layered positions.
3. Add distance-aware routes and the public `layout()` export.
4. Map the current workflow definition into that layout input.
5. Resolve a graph node id to the Story 5.2 room row and pane.
6. Feed layout positions and routes into the existing React Flow viewer.
7. Replace Graph-tab merged logs with that pane and keep Logs.
8. Run focused and full validation.
9. Mark sprint tracking done and commit the tracking change last.

## Risks and Guardrails

| Risk | Guardrail |
| --- | --- |
| Two layout implementations drift | Run Graph stops calling `dagNodesToReactFlow`; builder keeps dag-layout |
| Console imports the React shell | Console isolation still blocks `@/components/**`; only `@/lib/run-graph` is legal |
| Graph click opens a different room than Logs | Both paths use `LegacyNodeRoom` and `resolveGraphRoomRow` prefers the ordinary Logs row |
| Iteration rows lose a graph target | Fallback to the last matching Logs row, then a synthesized pending row |
| Status updates reshuffle the DAG | `computePositions` ignores `nodeState`; layout test freezes coordinates |
| Awaiting chrome leaks into Epic 5 | Live mapper never emits `awaiting`; pane tests forbid that copy |
| Merged logs disappear from sequential runs | `mergedLogsPanel` remains the non-DAG body |
| TDD becomes test-after | Each task names the expected RED failure and runs it before its production step |

## Open Questions

1. Should Graph and Logs share one selected row in this story?
Provisional default: no.
Keep Logs selection internal and let Story 5.4 lift the three-door selection.

2. Should the legacy Graph drop React Flow for a custom SVG shell?
Provisional default: no.
AD-4 lets each surface own its shell; React Flow already pans, zooms, and clicks.

3. Should `loop_group` body nodes appear on the run graph?
Provisional default: no.
The graph shows the same top-level `GET /api/workflows/:name` nodes as today's viewer.
