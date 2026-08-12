# Run Graph Orthogonal Routing — Design Spec

**Date:** 2026-08-13  
**Status:** Draft for review  
**Context:** Production run Graph tab (`WorkflowDagViewer`) — auto-generated `smoothstep` edges overlap nodes and each other, especially `route_loop` back-edges.

## Problem

The live Graph tab lays out the DAG once with dagre (TB, `ranksep: 80`, `nodesep: 40`) and draws every edge as React Flow `smoothstep`. Nodes are not draggable (`nodesDraggable={false}`). YAML stores no `x/y`.

That combination fails on the common `route_loop` shape (three labeled exits + a feedback edge):

- Forward edges share the same elbow and stack on top of each other.
- The back-edge (e.g. *negative* looping to a fixer) cuts through cards instead of going around the cluster.
- The three route targets sit too close for the three bottom handles to read as distinct lanes.

The Workflow Builder already lets authors drag nodes; this spec does **not** change the Builder.

## Goals

- Run Graph is readable at a glance: no edge through a card, no two edges sharing one polyline.
- Engine may **reposition nodes** and **reroute edges**. The user does not drag nodes or bend points.
- Layout is **deterministic** from the workflow definition. Status updates do not reshuffle the graph.
- Builder visual contract stays byte-for-byte: default dagre spacing and `smoothstep` edges.

## Non-goals

- Manual node drag or edge-waypoint editing on the run Graph.
- Persisting positions (YAML, DB, or localStorage).
- Changing `WorkflowCanvas`, Workflow Builder, or the console experiment.
- Adding ELK.js or any new layout dependency.
- Measuring live DOM node size for routing (variable-height error text may sit close to a line).
- Playwright / visual-regression tests in v1.

## Locked decisions

| # | Decision |
|---|----------|
| 1 | Surface = production run Graph only (`WorkflowDagViewer`) |
| 2 | No manual layout. Auto-reposition nodes + auto-route edges |
| 3 | Keep dagre for ranks; add an owned orthogonal router for paths |
| 4 | Shared `dagNodesToReactFlow` keeps `type: 'smoothstep'` and default `ranksep`/`nodesep` 80/40 |
| 5 | Viewer passes looser dagre spacing and overwrites edge type after the shared call |
| 6 | Custom React Flow edge type `'orthogonal'` draws polylines from precomputed waypoints |
| 7 | Route once per `dagNodes` change; status overlay only mutates stroke / `animated` |
| 8 | Collision boxes = dagre `180×80` plus padding — not live `measured` dimensions |
| 9 | Router failure is per-edge HVH fallback + `console.warn`, never a blank graph |

---

## User-visible behavior

### Node placement

- Still top-down by dependency rank.
- Viewer spacing is `ranksep: 120`, `nodesep: 72` (Builder stays `80` / `40`). Tune only those two viewer numbers if three route targets still collide.
- The three `route_loop` targets keep handle order: *negative* left, *positive* center, *exhausted* right (existing `ROUTE_LAYOUT_OUTCOMES` insertion order).

### Edges

- Segments are only horizontal or vertical.
- Same-column forward edge: one vertical segment.
- Different-column forward edge: down into the channel between ranks, across a **dedicated lane**, down into the target. Two edges in the same channel must not share the same lane `y`.
- Edges must not intersect node rectangles (layout box + padding), except at the source/target handles.
- Back-edge (`target.y <= source.y`): leave the cluster on the nearer left or right side, travel outside the cluster bounding box, re-enter at the target. Two back-edges on the same side get distinct side-lanes.
- `negative` / `positive` / `exhausted` labels sit on the first segment, near the source handle.

### Unchanged

- Nodes stay undraggable.
- Edge color follows target status; the running edge stays animated.
- Click node, MiniMap, zoom/pan, fit view.
- Re-opening a run recomputes the same layout from the same DAG.

---

## Architecture

Three units. The Builder does not import the router.

### 1. `packages/web/src/lib/dag-layout.ts`

- `layoutWithDagre` and `dagNodesToReactFlow` accept optional `{ ranksep?, nodesep? }`.
- Omitted options keep `80` / `40`.
- Edge `type` in this module stays `'smoothstep'`.

### 2. `packages/web/src/lib/orthogonal-route.ts`

Pure function, no React / React Flow:

```
routeOrthogonalEdges(nodes, edges) → Map<edgeId, waypoints[]>
```

- Input: node id + position + box; edge id + source + target + optional `sourceHandle`.
- Output: polyline points in flow coordinates.
- Forward vs back-edge: compare layout `y` (top of the dagre box). An edge is a back-edge when `target.y <= source.y`. Missing either node → do not classify; use the missing-node fallback.
- Lane assignment is a local greedy pack in each inter-rank channel / each side gutter.

### 3. `packages/web/src/components/workflows/OrthogonalDagEdge.tsx` + viewer

- `OrthogonalDagEdge` renders `BaseEdge` from `edge.data.waypoints`.
- `WorkflowDagViewer` registers `edgeTypes` at module scope (`orthogonal` → that component).
- After `dagNodesToReactFlow(..., runSpacing)`, the viewer calls the router and sets `type: 'orthogonal'` plus `data.waypoints`.

---

## Data flow

```
dagNodes
  → dagNodesToReactFlow(runSpacing)
  → routeOrthogonalEdges(nodes, edges)
  → each edge: type 'orthogonal' + data.waypoints
  → status overlay (style, animated only)
  → <ReactFlow>
```

Memos stay split as they are today:

1. Topology + route — depends on `dagNodes` only.
2. Edge status overlay — depends on `liveStatus`; copies waypoints through.
3. Node status overlay — depends on `liveStatus` / selection; does not touch `position`.

No DB, no localStorage, no YAML writes. Click still only selects a node for the log panel.

---

## Error handling

The run Graph must not go blank.

| Situation | Behavior |
|-----------|----------|
| Dagre throws | Existing catch: keep pre-dagre positions, log error, still run the router |
| Router throws or waypoints missing for one edge | That edge gets a non-avoiding HVH elbow; `console.warn` with `edge.id`; other edges keep full routes |
| Source or target node missing | Omit that edge’s path (no invented coordinates) |
| Self-loop | Small HVH beside the node, not through the card |
| 0–1 nodes | No routing; existing `fitView` |
| `route_loop` missing a branch | Route only edges that have a target |

Every fallback `warn`s. No toast. Comment on the HVH path: intentional safe fallback.

---

## Testing

Unit tests only, in `@archon/web`.

**`packages/web/src/lib/orthogonal-route.test.ts`**

- Same-column forward → single vertical segment.
- Different-column forward → HVH; polyline does not intersect any padded node rect.
- Two edges in one inter-rank channel → distinct lane `y`.
- Back-edge → every segment lies outside the cluster bbox except the handle stubs.
- Two back-edges on the same side → distinct side-lanes.
- Missing node → no waypoints for that edge, no throw.
- Self-loop → HVH fallback, no throw.

**Builder contract (`dag-layout.test.ts`)**

- `dagNodesToReactFlow()` with no options keeps default spacing (assert positions or the options default).
- Shared edges remain `type: 'smoothstep'`.

**Viewer (small)**

- After the viewer mapping, run-graph edges are `type: 'orthogonal'` and `data.waypoints` is a point array.

No Playwright in v1. Manual check: the `speckit-converge` graph that motivated this spec.

---

## Implementation notes

- Viewer spacing is specified above (`120` / `72`). Do not change Builder defaults to fix collisions.
- Padding around each `180×80` box: 12px. Side gutter for back-edges: 24px beyond the cluster bbox, plus 12px per extra back-edge on that side.
- `waypoints` type: `{ x: number; y: number }[]`. Store on `edge.data` so the edge component stays dumb.
- File size: keep `orthogonal-route.ts` and `OrthogonalDagEdge.tsx` each under 200 lines; split lane-packing if the router grows.

## Rollback

Revert the spec’s code: delete the router + edge component, drop the optional spacing args, restore `smoothstep` in the viewer. Builder never depended on the new path.
