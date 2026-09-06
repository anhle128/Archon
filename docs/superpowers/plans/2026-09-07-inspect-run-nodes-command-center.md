# Inspect a Run as Nodes on Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task.
> Track progress with the checkbox steps below.

**Goal:** Give `/console` the same inspect contract as legacy Stories 5.1–5.4: unmerged node-run Logs, a graph that calls `packages/web/src/lib/run-graph` `layout()`, per-type rooms, and a node-status click that opens that room, all in console's own shell and without AskHuman chrome.

**Architecture:** Keep Command Center log-first.
StreamToolbar stays `Log | Graph | Artifacts`.
Log and Graph share one right-hand console-owned room.
Do not add a Chat tab.
Do not import legacy React or `@/lib/api` functions.
Duplicate the inspect kernel under `packages/web/src/experiments/console/inspect/`.
The only production-web runtime import is `layout` plus types from `@/lib/run-graph`.
Type-only imports from `@/lib/api.generated` remain allowed.

**Tech Stack:** Bun, strict TypeScript, React 19, console `useEntity` cache, happy-dom, react-dom/client, react-dom/server, and bun:test.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.5, together with `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md`.

## Global Constraints

- Story 5.5 implements FR1, FR2, FR3 timeline-and-status-click, FR8 console inspect, UX-DR1–UX-DR4, UX-DR7, and NFR4 only.
- Ask cards, empty Ask slots, `awaiting` copy, and "waiting on you" remain Epic 6.
- Console must not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api` functions.
- Console must not import any file under `packages/web/src/components/`.
- The only sanctioned production-web runtime import is `@/lib/run-graph`.
- Type-only `import type { components } from '@/lib/api.generated'` is allowed.
- Unified render means the same envelope, states, validity, and copy, not a shared React NodePanel.
- GET run `pending_interactions` must not be rendered.
- Surfaces must not rebuild node lifecycle from raw events.
- Use GET run `nodeStates` from `projectLatestEffectiveNodeStates`.
- Agent rooms read `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` only.
- Bash and script rooms must not fetch node messages.
- Existing design tokens and dependencies are sufficient.
- Do not add a package.
- All new and modified TypeScript remains strict, fully annotated, and free of `any`.
- Every production behavior follows RED, GREEN, refactor, then a focused commit.
- Run focused tests from `packages/web`.
- Never run `bun test` from the repository root.
- Console tests must not use `mock.module()`.

---

**Story authority:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.5, FR1, FR2, FR3 (timeline), FR8, UX-DR1–UX-DR4, UX-DR7, NFR4.

**Approved design authority:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-1, CAP-2, and CAP-3 inspect slices, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` Direction A plus Command Center surface fit, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console-app.js`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-4, and AD-7 reads, and `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md` console isolation.

**Issue:** https://github.com/anhle128/Archon/issues/85

## Scope and Non-Goals

- Implement only Story 5.5 on Command Center `/console/p/:projectId/r/:runId`.
- Keep legacy `WorkflowExecution` inspect from Stories 5.1–5.4 unchanged.
- Show unmerged Logs where each loop or `route_loop` iteration is its own row.
- Show a graph that calls `layout()` from `@/lib/run-graph`.
- Keep Logs.
- Treat the graph as additional, not a replacement.
- Clicking a Logs divider, a graph node, or a `?node=` deep-link opens the same per-type room.
- `command` / `prompt` / `loop` rooms render the GET messages timeline.
- Other types match Story 5.2 chrome: stdout, declared gate, child-run link, route controller, loop-group container.
- A completed agent node replays the same transcript.
- Keep StreamToolbar as `Log | Graph | Artifacts`.
- Do not add a Chat view to run detail.
- Do not import `LegacyNodeRoom` or any other legacy React inspect component.
- Do not extract a second shared `@/lib/*` inspect module.
- Do not render Ask cards, empty Ask slots, or awaiting chrome.
- Do not render `pending_interactions`.
- Do not change the engine, database, API routes, workflow schemas, workflow YAML, provider behavior, CLI, chat orchestrator, or `manage_run`.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts`.
- Do not add a frontend dependency.
- Do not import dagre from the inspect graph path.
- Artifacts tab behavior stays as today except it must not gain Ask chrome.
- Keep the existing paused declared-gate `ApprovalPanel` on the Log column.
- Also render declared-gate chrome inside the gate room.
- Do not wire Reply or `ChatComposer` as an Ask path.
- Sequential non-DAG runs are out of scope for this story.
- Do not introduce the TypeScript `any` type.
- Do not update sprint tracking until all focused and repository validation succeeds.

## Verified Repository Baseline

- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:50-51` marks Story 5.4 done and Story 5.5 backlog.
- Issue 85 requires the Story 5.5 acceptance criteria, focused test evidence, and the sprint-status transition before close.
- `packages/web/src/experiments/console/ConsoleApp.tsx` mounts run detail at `p/:projectId/r/:runId`.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx:132-133` uses exclusive `DetailView = 'log' | 'graph' | 'artifacts'`.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx:401-481` renders merged `RunStream` on Log, dagre `RunGraphPanel` on Graph, and `ArtifactPanel` on Artifacts.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx:463-470` currently switches to Log and scrolls `#node-transition-${nodeId}` on a graph click.
- `packages/web/src/experiments/console/components/StreamToolbar.tsx:3` has no Chat tab.
- `packages/web/src/experiments/console/components/RunStream.tsx:231` folds one divider per `nodeId` through `foldNodeRuns`.
- `packages/web/src/experiments/console/primitives/event.ts:427-477` collapses iterations, which contradicts FR1.
- `packages/web/src/experiments/console/components/RunGraphPanel.tsx:2-12,48-106` layouts with `@dagrejs/dagre` and does not import `@/lib/run-graph`.
- `packages/web/src/experiments/console/skills/runs.ts:66-76` maps GET run through `toRun` and `toRunEvent` and drops `nodeStates` and raw events.
- `packages/web/src/lib/api.generated.d.ts:4858-4867` already has `events`, `nodeStates`, and `pending_interactions` on `WorkflowRunDetail`.
- Console has no `listNodeMessages` skill.
- `packages/web/src/lib/api.ts:659-669` is the banned legacy client for the same messages route.
- `packages/web/src/lib/run-graph/index.ts:1-13` exports `layout` and the layout types.
- `packages/web/src/lib/run-graph/constants.ts:1-2` uses `NODE_WIDTH = 180` and `NODE_HEIGHT = 80`.
- `eslint.config.mjs:116-154` bans console imports from production UI modules, `@/lib/api`, and `@tanstack/react-query`, and does not ban `@/lib/run-graph`.
- `packages/web/src/experiments/console/README.md:38-40` restates isolation and omits the run-graph exception.
- `packages/web/package.json:11` runs `NODE_ENV=development bun test src/experiments/console/` as part of the package test script.

## Design Decisions

1. Keep Command Center log-first.
Approved UX Surface Fit forbids a Chat tab on `/console`.
The in-page node-status timeline is the unmerged Log divider list.
The chat-surface analog is `?node=` on the run URL.

2. Duplicate the inspect kernel under `experiments/console/inspect/`.
NFR4 allows only `run-graph` plus generated types.
A second shared `@/lib` module would amend the constitution.

3. Use GET run `nodeStates` as lifecycle.
Do not call `deriveNodeStatuses` or `foldNodeRuns` for inspect rows.

4. Keep raw `WorkflowEvent` rows beside the existing `RunEvent[]` stream.
`toRunEvent` loses loop-iteration and route-iteration metadata that `buildLogRows` needs.

5. Graph clicks stay on Graph and open the room.
Switching to Log would change the panel's meaning.

6. The toolbar node control becomes a room selector, not a stream filter.
All unmerged rows stay visible.
The selected divider has `aria-current="true"`.

7. Pass `awaiting` through to `layout()` so taken-path stays on-path.
Map `awaiting` to the visible label `running` in inspect chrome so `expectNoAskHumanChrome` cannot see the word `awaiting`.

8. Keep the existing Log-column declared-gate `ApprovalPanel`.
Also render declared-gate chrome in the gate room.
That preserves today's paused approve path while matching Story 5.2.

9. Auto-select the running node, else the paused approval node, else the first log row.
Honor `?node=` over auto-select.

10. Size console graph cards at 180 by 80 so `layout()` routes align.
Do not keep the 168 by 46 dagre box.

## Authoritative Interfaces

Use these generated aliases in every inspect module.

```ts
import type { components } from '@/lib/api.generated';

export type DagNode = components['schemas']['DagNode'];
export type WorkflowEvent = components['schemas']['WorkflowEvent'];
export type WorkflowNodeState = components['schemas']['WorkflowNodeState'];
export type WorkflowNodeMessage = components['schemas']['WorkflowNodeMessage'];
export type WorkflowNodeMessagesResponse = components['schemas']['WorkflowNodeMessagesResponse'];
```

### Inspect status label

Create `packages/web/src/experiments/console/inspect/inspect-status.ts`.

```ts
export type InspectChromeStatus = Exclude<WorkflowNodeState['status'], 'awaiting'>;

export function inspectStatusLabel(status: WorkflowNodeState['status']): InspectChromeStatus {
  return status === 'awaiting' ? 'running' : status;
}
```

Never render the strings `AskHuman`, `awaiting`, or `waiting-on-you` in inspect chrome.

### Log rows

Create `packages/web/src/experiments/console/inspect/build-log-rows.ts` with this exact contract, copied from `packages/web/src/components/workflows/build-log-rows.ts:9-143`.

```ts
export type LogRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number };

export interface LogRow {
  id: string;
  nodeId: string;
  label: string;
  status: WorkflowNodeState['status'];
  order: number;
  sourceIndex: number;
  selection: LogRowSelection;
}

export function buildLogRows(
  nodeStates: readonly WorkflowNodeState[],
  events: readonly WorkflowEvent[]
): LogRow[];
```

Rules:

- Server `nodeStates` remain the lifecycle source.
- Loop-iteration events with a safe integer `iteration >= 1` emit one row per iteration labelled `{name} ×{n}`.
- `node_routed` events with a safe integer `execution_seq >= 1` emit one row per sequence labelled `{name} #{seq}`.
- Otherwise emit one ordinary `{ kind: 'node' }` row whose id is the latest `node_started` event id, else the latest lifecycle event id, else `node:{nodeId}`.
- Lifecycle event types are `node_started`, `node_completed`, `node_failed`, `node_skipped`, `node_skipped_prior_success`, and `approval_requested`.
- Sort by `order` then `sourceIndex`.

### Synthetic node states

Create `packages/web/src/experiments/console/inspect/synthesize-log-node-states.ts` from `LegacyGraphLogsPane.tsx:107-137`.

```ts
export function synthesizeLogNodeStates(input: {
  nodeStates: readonly WorkflowNodeState[];
  events: readonly WorkflowEvent[];
  runStatus: 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
  approval: unknown;
}): readonly WorkflowNodeState[];
```

Add a synthetic `{ nodeId, name: nodeId, status, retryEpoch: 0 }` when the projector has no row for:

- `loop_iteration_*` events, using `running` / `completed` / `failed`
- `approval_requested`, using `running`
- a paused selectable approval context `nodeId`, using `running`

Use the console copy of `readApprovalContext` described below.
Do not synthesize from `node_awaiting`.

### Approval context

Create `packages/web/src/experiments/console/inspect/read-approval-context.ts` as a local copy of `packages/web/src/lib/approval-context.ts`.
Do not import `@/lib/approval-context`.

Export `readApprovalContext` and `getPlannotatorReviewUrl` with the same shapes and URL protocol guard.

### Room kind

Create `packages/web/src/experiments/console/inspect/resolve-room-kind.ts` from `packages/web/src/components/workflows/resolve-room-kind.ts`.

```ts
export type NodeBodyKind =
  | 'command'
  | 'prompt'
  | 'loop'
  | 'bash'
  | 'script'
  | 'approval'
  | 'plannotator_gate'
  | 'workflow'
  | 'route_loop'
  | 'loop_group'
  | 'unknown';

export type RoomKind = 'agent' | 'stdout' | 'gate' | 'workflow' | 'route_loop' | 'loop_group';

export interface RoomResolution {
  kind: RoomKind;
  nodeType: NodeBodyKind;
  definitionNode: DagNode | null;
}

export function resolveRoomKind(
  nodeId: string,
  definitionNodes: readonly DagNode[],
  events: readonly WorkflowEvent[],
  approval: unknown
): RoomResolution;
```

Definition-first `nodeBodyKind` order: `route_loop`, `loop_group`, `loop`, `plannotator_gate`, `approval`, `bash`, `script`, `workflow`, `command`, `prompt`, else `unknown`.
Walk nested `loop_group.nodes` with qualified ids `prefix.id`.
Fallback order when no definition node exists: matching approval `child_workflow` → workflow room; matching approval or plannotator gate → gate room; any `node_routed` for that id → route_loop; latest start/complete/fail with `data.type` bash or script → stdout; latest complete/fail with `data.type` workflow → workflow; latest `approval_requested` with `gateType` → gate; else agent / unknown.

### Graph row

Create `packages/web/src/experiments/console/inspect/resolve-graph-room-row.ts` from `packages/web/src/components/workflows/resolve-graph-room-row.ts:5-43`.

```ts
export interface GraphRoomLiveStatus {
  nodeId: string;
  name: string;
  status: WorkflowNodeState['status'];
}

export function resolveGraphRoomRow(input: {
  rows: readonly LogRow[];
  nodeId: string | null;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow | null;
```

Prefer the last ordinary `{ kind: 'node' }` row for that id, else the last matching row, else a synthetic `node:{nodeId}` row.

### Room data

Create `packages/web/src/experiments/console/inspect/select-room-data.ts` from `packages/web/src/components/workflows/select-room-data.ts` with the same exported view types and functions: `StdoutView`, `GateChrome`, `ChildRunRef`, `RouteDecisionView`, `LoopGroupChrome`, `selectNodeStdout`, `selectGateChrome`, `selectChildRun`, `selectRouteDecision`, and `selectLoopGroupChrome`.
Replace `@/lib/api` imports with the generated aliases above.
Replace `@/lib/approval-context` with the local inspect copy.

### Transcript slice

Create `packages/web/src/experiments/console/inspect/select-node-room-messages.ts` from `packages/web/src/components/workflows/NodeRoom.tsx:86-116`.

```ts
export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessage[],
  selection: LogRowSelection
): WorkflowNodeMessage[];
```

Sort by `seq`.
For `loop_iteration`, slice from `status.payload.state === 'iteration_started'` with `detail === String(n)` through the matching completed or failed status, else the next `iteration_started`, else the remainder.
Other selections return the full ordered list.

### Graph input

Create `packages/web/src/experiments/console/inspect/build-run-graph-input.ts` from `packages/web/src/components/workflows/build-run-graph-input.ts`.

```ts
import { layout, type LayoutEdge, type LayoutNode, type LayoutResult } from '@/lib/run-graph';

export const ROUTE_LOOP_OUTCOMES = ['positive', 'negative', 'exhausted'] as const;

export interface RunGraphInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export function buildRunGraphInput(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowNodeState['status'] }[]
): RunGraphInput;

export function layoutRunGraph(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowNodeState['status'] }[]
): LayoutResult {
  return layout(buildRunGraphInput(dagNodes, liveStatus));
}
```

Missing live status is `pending`.
Pass `awaiting` through to `layout()` unchanged.
Skip `depends_on` edges whose source already lists the target as a route-loop target.
Conditional `when` edges are `kind: 'conditional'` with the `when` string as `label`.
Route edges use reversed `ROUTE_LOOP_OUTCOMES` and unique ids when a base id already exists.

Do not import `@/lib/api` `ROUTE_LOOP_OUTCOMES`.

### Skills

Update `packages/web/src/experiments/console/skills/runs.ts`.

```ts
export function nodeMessagesPath(runId: string, nodeId: string): string {
  return (
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages'
  );
}

export async function listNodeMessages(
  runId: string,
  nodeId: string
): Promise<WorkflowNodeMessagesResponse> {
  return requestJson(nodeMessagesPath(runId, nodeId));
}
```

Change `getRun` to also return:

```ts
{
  run: Run;
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  usage: RunDetailResponse['usage'];
}
```

`events` remains `res.events.map(toRunEvent)` for `RunStream`.
`rawEvents` is `res.events`.
`nodeStates` is `res.nodeStates`.
`approval` is `res.run.metadata?.approval ?? null`.
If the generated `WorkflowRun` type does not expose `metadata`, read it from the same local raw run shape `toRun` already uses.
Do not return or render `pending_interactions`.

Add `getWorkflowDagNodes` to `packages/web/src/experiments/console/skills/workflows.ts`.
Use `GET /api/workflows?cwd=` and filter by workflow name, matching `getWorkflowGraph`.
Return `match.workflow.nodes ?? []` typed as `DagNode[]`.
Do not use `GET /api/workflows/:name` for this, because that route does not recurse into subfoldered workflows.

### Cache keys

Add to `packages/web/src/experiments/console/store/keys.ts`:

```ts
nodeMessages: (runId: string, nodeId: string): string =>
  `nodeMessages:${encodeURIComponent(runId)}:${encodeURIComponent(nodeId)}`,
workflowDagNodes: (cwd: string, name: string): string =>
  `workflowDagNodes:${encodeURIComponent(cwd)}:${encodeURIComponent(name)}`,
```

### Room chrome

Create `packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.tsx`.

```ts
export interface ConsoleNodeRoomProps {
  runId: string;
  projectId: string;
  row: LogRow | null;
  isLive: boolean;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  events: readonly WorkflowEvent[];
  runStatus: Run['status'];
  approval: unknown;
  run: Run;
}

export function ConsoleNodeRoom(props: ConsoleNodeRoomProps): React.ReactElement;
```

Placeholder copy is exactly `Select a node`.
Loading copy is exactly `Loading node room` when `definitionPending && definitionNode === null && kind === 'agent' && nodeType === 'unknown'`.
The region is `<section role="region" aria-label={nodeId + ' room'}>`.
Header shows `row.label`, the type label below, and `inspectStatusLabel(row.status)`.

Type labels:

```ts
const TYPE_LABELS: Record<NodeBodyKind, string> = {
  command: 'Command',
  prompt: 'Prompt',
  loop: 'Loop',
  bash: 'Bash',
  script: 'Script',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  workflow: 'Workflow',
  route_loop: 'Route loop',
  loop_group: 'Loop group',
  unknown: 'Agent',
};
```

Dispatch:

- `agent` → transcript from `skill.listNodeMessages` via `useEntity(K.nodeMessages(runId, row.nodeId))`, poll every 1000 ms while `isLive`, slice with `selectNodeRoomMessages`.
- `stdout` → `selectNodeStdout`; do not fetch messages.
- `gate` → `selectGateChrome`; if `canDecide`, render existing `ApprovalPanel` with `run`; otherwise show message, optional document, decision, inactive notice, and review URL.
- `workflow` → `selectChildRun`; link to `/console/p/${projectId}/r/${childRunId}` when `childRunId` is non-null; fan-out shows `Fan-out child runs` and does not inline child transcripts.
- `route_loop` → `selectRouteDecision` fields.
- `loop_group` → body node ids and iteration accordion from `selectLoopGroupChrome`.

Transcript item kinds:

- `text` → `{payload.text}` in `whitespace-pre-wrap`
- `tool` → name chip plus optional input/output
- `status` → `{payload.state}` plus optional detail, never treated as an Ask card

Empty transcript copy is exactly `No transcript yet.`
Error copy is the error message plus a `Retry` button that calls `refetch`.
Loading copy is exactly `Loading transcript…`.

`isLive` is `run.status === 'running' || run.status === 'paused'`.

### Log dividers

Keep `NodeDivider` usage and cost expansion.
Add these props:

```ts
selected?: boolean;
onSelect?: () => void;
rowId: string;
```

When `onSelect` is provided, the heading is `<button type="button">` with `aria-current={selected ? 'true' : undefined}`.
`id` remains `node-transition-${rowId}` so iteration rows do not collide.
Extend visible status to `'pending' | 'running' | 'completed' | 'failed' | 'skipped'`.
Pass `inspectStatusLabel(row.status)` into that prop.

Replace `foldNodeRuns` inside `RunStream` inspect usage with `buildLogRows(synthesizedNodeStates, rawEvents)`.
Keep conversation messages, tool pairing, and system rows as log-first content under those dividers.
Do not hide rows when a node is selected.
Stop using `selectedNodeId === 'all'` as a filter.

### Graph panel

Replace dagre `layout()` in `RunGraphPanel.tsx`.
New props:

```ts
export interface RunGraphPanelProps {
  dagNodes: readonly DagNode[];
  liveStatus: readonly { nodeId: string; status: WorkflowNodeState['status'] }[];
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string) => void;
}
```

Call `layoutRunGraph(dagNodes, liveStatus)`.
Render each `LayoutRoute.path` as an SVG path.
Taken routes use `var(--running)` stroke.
Untaken routes use `var(--border)`.
Draw a filled triangle marker at the target port.
Render node cards at `positions[id]` with width 180 and height 80.
Selected node gets a 2px `var(--accent)` ring.
Click calls `onNodeSelect(node.id)` and does not change `DetailView`.
SVG overflow scrolls.
Include a Fit control that resets scroll to origin.
Do not import `@dagrejs/dagre` from this file after the change.

### Inspect pane

Create `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`.

```ts
export interface ConsoleInspectPaneProps {
  view: 'log' | 'graph';
  run: Run;
  projectId: string;
  projectCwd: string;
  rawEvents: readonly WorkflowEvent[];
  nodeStates: readonly WorkflowNodeState[];
  approval: unknown;
  messages: Message[];
  showToolCalls: boolean;
  showSystem: boolean;
  usage: UsageReport | null;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSelectLogRowId: (rowId: string | null) => void;
  toolbar: React.ReactNode;
  logHeader: React.ReactNode;
}
```

Layout for Log and Graph:

```text
flex min-h-0 flex-1
  left: min-w-0 flex-1  (Log stream or Graph)
  aside: w-[380px] shrink-0 border-l border-border  (ConsoleNodeRoom)
```

Selection rules, matching `LegacyGraphLogsPane`:

- If `selectedLogRowId` matches a row whose `nodeId === selectedNodeId`, that row is selected.
- Else `resolveGraphRoomRow({ rows, nodeId: selectedNodeId, liveStatus })`.
- Graph click clears `selectedLogRowId` and sets `selectedNodeId`.
- Divider click sets both ids.
- Run id change clears both.

Always mount one `ConsoleNodeRoom`.

### Run detail

`RunDetailPage` loads `getRun`, `getWorkflowDagNodes`, messages, artifacts, and SSE as today.
Pass `rawEvents`, `nodeStates`, and `approval` into `ConsoleInspectPane`.
Read `useSearchParams().get('node')` once the run is loaded.
If that node id is non-empty, select it.
Else auto-select: first `nodeStates` entry with `inspectStatusLabel(status) === 'running'`, else paused `run.approval?.nodeId`, else first `buildLogRows` row, else null.

`isLive` uses running or paused.

Do not switch view to `log` on graph click.

Keep Artifacts full width with no room dock.

Keep Log-column `ApprovalPanel` when `run.status === 'paused'` and `run.approval` is set.

Keep `RunActionBar`.

Change StreamToolbar node `<select>` `aria-label` to `Select node`.
Remove the `All nodes` option.
The value is `selectedNodeId ?? ''`.
Choosing a node calls `onSelectNode` and clears `selectedLogRowId`.
Show the selector on both Log and Graph.

### Deep link

`ActiveRunCard` navigates to `/console/p/${projectId}/r/${runId}` and appends `?node=${encodeURIComponent(run.currentNode)}` when `currentNode` is a non-empty string.

`ConsoleWorkflowResultCard` "Open run →" does the same from `data.run.currentNode`.

Do not invent node chips from `pending_interactions`.

## File Map

| File | Action | Justification |
| --- | --- | --- |
| `packages/web/src/experiments/console/skills/runs.ts` | UPDATE | Return nodeStates, rawEvents, approval; add listNodeMessages |
| `packages/web/src/experiments/console/skills/runs.node-messages.test.ts` | CREATE | Encoded messages path and getRun extras |
| `packages/web/src/experiments/console/skills/workflows.ts` | UPDATE | getWorkflowDagNodes via list endpoint |
| `packages/web/src/experiments/console/skills/workflows.test.ts` | UPDATE | Encoded list filter contract |
| `packages/web/src/experiments/console/store/keys.ts` | UPDATE | nodeMessages and workflowDagNodes keys |
| `packages/web/src/experiments/console/inspect/inspect-status.ts` | CREATE | Chrome label mapping |
| `packages/web/src/experiments/console/inspect/inspect-status.test.ts` | CREATE | awaiting → running |
| `packages/web/src/experiments/console/inspect/build-log-rows.ts` | CREATE | Unmerged rows |
| `packages/web/src/experiments/console/inspect/build-log-rows.test.ts` | CREATE | Iteration and route rows |
| `packages/web/src/experiments/console/inspect/synthesize-log-node-states.ts` | CREATE | Pause/gate synthetic states |
| `packages/web/src/experiments/console/inspect/synthesize-log-node-states.test.ts` | CREATE | Synthetic coverage |
| `packages/web/src/experiments/console/inspect/read-approval-context.ts` | CREATE | Local approval parser |
| `packages/web/src/experiments/console/inspect/read-approval-context.test.ts` | CREATE | Parser and review URL |
| `packages/web/src/experiments/console/inspect/resolve-room-kind.ts` | CREATE | Per-type dispatch |
| `packages/web/src/experiments/console/inspect/resolve-room-kind.test.ts` | CREATE | Definition and fallback |
| `packages/web/src/experiments/console/inspect/resolve-graph-room-row.ts` | CREATE | Graph click → row |
| `packages/web/src/experiments/console/inspect/resolve-graph-room-row.test.ts` | CREATE | Ordinary vs iteration vs synthetic |
| `packages/web/src/experiments/console/inspect/select-room-data.ts` | CREATE | Stdout/gate/child/route/group views |
| `packages/web/src/experiments/console/inspect/select-room-data.test.ts` | CREATE | Selector contracts |
| `packages/web/src/experiments/console/inspect/select-node-room-messages.ts` | CREATE | Loop transcript slice |
| `packages/web/src/experiments/console/inspect/select-node-room-messages.test.ts` | CREATE | Seq sort and slice |
| `packages/web/src/experiments/console/inspect/build-run-graph-input.ts` | CREATE | DagNode → layout() |
| `packages/web/src/experiments/console/inspect/build-run-graph-input.test.ts` | CREATE | Edges and awaiting taken-path |
| `packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.tsx` | CREATE | Per-type dispatcher |
| `packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx` | CREATE | Chrome, GET messages, no Ask |
| `packages/web/src/experiments/console/components/NodeDivider.tsx` | UPDATE | Button + aria-current |
| `packages/web/src/experiments/console/components/RunStream.tsx` | UPDATE | Unmerged buildLogRows |
| `packages/web/src/experiments/console/components/RunStream.test.tsx` | UPDATE | Iteration rows stay unmerged |
| `packages/web/src/experiments/console/components/RunGraphPanel.tsx` | UPDATE | layout() SVG shell |
| `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` | CREATE | Click stays on graph, taken path |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` | CREATE | Shared room dock |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` | CREATE | Three-door same room |
| `packages/web/src/experiments/console/components/StreamToolbar.tsx` | UPDATE | Selector, no All-nodes filter |
| `packages/web/src/experiments/console/routes/RunDetailPage.tsx` | UPDATE | Host pane, ?node=, auto-select |
| `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` | UPDATE | Query param and isolation smoke |
| `packages/web/src/experiments/console/components/ActiveRunCard.tsx` | UPDATE | ?node= deep-link |
| `packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx` | UPDATE | ?node= deep-link |
| `packages/web/src/experiments/console/inspect/isolation.test.ts` | CREATE | Import-ban characterization |
| `packages/web/src/experiments/console/README.md` | UPDATE | Document run-graph exception |
| `eslint.config.mjs` | UPDATE | Comment the sanctioned exception |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | UPDATE | Mark 5.5 done after validation |

Do not modify `packages/web/src/components/workflows/*`.
Do not modify `packages/web/src/lib/run-graph/` internals.
Do not modify engine or API packages.

## Step-by-Step Tasks

### Task 1: UPDATE console run and workflow skills

**Files:**

- Update `packages/web/src/experiments/console/skills/runs.ts`.
- Create `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`.
- Update `packages/web/src/experiments/console/skills/workflows.ts`.
- Update `packages/web/src/experiments/console/skills/workflows.test.ts`.
- Update `packages/web/src/experiments/console/store/keys.ts`.

- [ ] **Step 1: Write the failing tests.**

In `runs.node-messages.test.ts`:

1. `nodeMessagesPath('run/1', 'node a')` equals `/api/workflows/runs/run%2F1/nodes/node%20a/messages`.
2. `listNodeMessages` GETs that path with `credentials: 'same-origin'` and returns `{ messages }`.
3. `getRun` stubbed with a `WorkflowRunDetail` body returns `nodeStates`, `rawEvents` with original `event_type`s, `events` mapped through `toRunEvent`, `approval` from `metadata.approval`, and does not expose `pending_interactions` on the result object.

In `workflows.test.ts`:

4. `getWorkflowDagNodes('my flow', '/repo')` GETs `/api/workflows?cwd=%2Frepo` and returns the matching workflow's `nodes` array.
5. Missing name throws `Workflow not found: my flow`.

Stub `globalThis.fetch` like `workflows.test.ts`.
Do not implement production yet.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/workflows.test.ts
```

Expected: fail because `nodeMessagesPath`, `listNodeMessages`, and `getWorkflowDagNodes` do not exist, and `getRun` does not return the new fields.

- [ ] **Step 3: Implement the minimum production change.**

Add the functions and `getRun` extras described in Authoritative Interfaces.
Add the two cache key helpers.
Do not fetch node messages from `getRun`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Re-run the same command.

- [ ] **Step 6: Commit Task 1.**

```bash
git add packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/workflows.ts packages/web/src/experiments/console/skills/workflows.test.ts packages/web/src/experiments/console/store/keys.ts
git commit -m "feat(web): expose console inspect run and node-message skills"
```

### Task 2: CREATE log-row kernel

**Files:**

- Create `packages/web/src/experiments/console/inspect/inspect-status.ts`.
- Create `packages/web/src/experiments/console/inspect/inspect-status.test.ts`.
- Create `packages/web/src/experiments/console/inspect/build-log-rows.ts`.
- Create `packages/web/src/experiments/console/inspect/build-log-rows.test.ts`.
- Create `packages/web/src/experiments/console/inspect/synthesize-log-node-states.ts`.
- Create `packages/web/src/experiments/console/inspect/synthesize-log-node-states.test.ts`.

- [ ] **Step 1: Write the failing tests.**

`inspect-status.test.ts`:

1. `pending`, `running`, `completed`, `failed`, and `skipped` round-trip.
2. `awaiting` becomes `running`.

`build-log-rows.test.ts` uses generated-shaped fixtures:

1. Empty states and events yield `[]`.
2. One ordinary node uses `node_started` id and projector status.
3. Loop iterations 1 and 2 become two rows labelled `Review ×1` and `Review ×2`.
4. `node_routed` with `execution_seq: 4` becomes `Review #4` with `{ kind: 'route_iteration', executionSeq: 4 }`.
5. Invalid `iteration: 0` does not emit a loop row.
6. Sort is chronological by first qualifying event.

`synthesize-log-node-states.test.ts`:

7. Existing projector rows are unchanged.
8. `approval_requested` for a missing node adds `{ status: 'running', retryEpoch: 0 }`.
9. Paused approval `{ nodeId: 'gate', message: 'Go?' }` adds `gate`.
10. `node_awaiting` does not add a row.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/inspect-status.test.ts src/experiments/console/inspect/build-log-rows.test.ts src/experiments/console/inspect/synthesize-log-node-states.test.ts
```

Expected: fail because the modules cannot be resolved.

- [ ] **Step 3: Implement the minimum production modules.**

Copy the `buildLogRows` algorithm from `packages/web/src/components/workflows/build-log-rows.ts:24-143`.
Access event payload fields through a local `eventData(event)` that returns `Record<string, unknown>` after an `isRecord` check.
Do not import `@/lib/api`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Re-run the same command.

- [ ] **Step 6: Commit Task 2.**

```bash
git add packages/web/src/experiments/console/inspect/inspect-status.ts packages/web/src/experiments/console/inspect/inspect-status.test.ts packages/web/src/experiments/console/inspect/build-log-rows.ts packages/web/src/experiments/console/inspect/build-log-rows.test.ts packages/web/src/experiments/console/inspect/synthesize-log-node-states.ts packages/web/src/experiments/console/inspect/synthesize-log-node-states.test.ts
git commit -m "feat(web): build unmerged console inspect log rows"
```

### Task 3: CREATE room-kind resolver

**Files:**

- Create `packages/web/src/experiments/console/inspect/read-approval-context.ts`.
- Create `packages/web/src/experiments/console/inspect/read-approval-context.test.ts`.
- Create `packages/web/src/experiments/console/inspect/resolve-room-kind.ts`.
- Create `packages/web/src/experiments/console/inspect/resolve-room-kind.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Approval context:

1. `{ nodeId, message }` parses.
2. Invalid `type` returns null.
3. `getPlannotatorReviewUrl` accepts `https://` and rejects `javascript:`.

Room kind:

4. Definition `bash` → stdout / bash.
5. Definition nested `loop_group.nodes` resolves `group.child`.
6. No definition plus `child_workflow` approval → workflow.
7. No definition plus `node_routed` → route_loop.
8. No definition plus `data.type: 'script'` on `node_completed` → stdout / script.
9. No definition plus `approval_requested` `gateType: 'plannotator_gate'` → gate.
10. Else agent / unknown.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/read-approval-context.test.ts src/experiments/console/inspect/resolve-room-kind.test.ts
```

- [ ] **Step 3: Implement the minimum production modules.**

Copy `packages/web/src/lib/approval-context.ts` and `packages/web/src/components/workflows/resolve-room-kind.ts`.
Change imports only as specified.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 3.**

```bash
git add packages/web/src/experiments/console/inspect/read-approval-context.ts packages/web/src/experiments/console/inspect/read-approval-context.test.ts packages/web/src/experiments/console/inspect/resolve-room-kind.ts packages/web/src/experiments/console/inspect/resolve-room-kind.test.ts
git commit -m "feat(web): resolve console node room kinds"
```

### Task 4: CREATE graph-row resolver

**Files:**

- Create `packages/web/src/experiments/console/inspect/resolve-graph-room-row.ts`.
- Create `packages/web/src/experiments/console/inspect/resolve-graph-room-row.test.ts`.

- [ ] **Step 1: Write the failing tests.**

1. Null nodeId returns null.
2. Prefer last ordinary row over an earlier iteration row.
3. If only iteration rows exist, return the last matching iteration row.
4. If no rows exist, return synthetic `node:{id}` with live name/status or `pending`.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/resolve-graph-room-row.test.ts
```

- [ ] **Step 3: Implement the minimum production module.**

Copy `packages/web/src/components/workflows/resolve-graph-room-row.ts:11-43`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 4.**

```bash
git add packages/web/src/experiments/console/inspect/resolve-graph-room-row.ts packages/web/src/experiments/console/inspect/resolve-graph-room-row.test.ts
git commit -m "feat(web): map console graph clicks onto log rows"
```

### Task 5: CREATE room data selectors

**Files:**

- Create `packages/web/src/experiments/console/inspect/select-room-data.ts`.
- Create `packages/web/src/experiments/console/inspect/select-room-data.test.ts`.

- [ ] **Step 1: Write the failing tests.**

1. Stdout uses `node_output` from the row-scoped `node_completed` event and `exitCode: 0`.
2. Failed stdout sets `text: null` and `failedDetail` from `data.error`.
3. Truncation copies `node_output_truncated` and `node_output_original_bytes`.
4. Gate `canDecide` is true only when paused, matching `nodeId`, compatible type, and unresolved.
5. Child pause with `type: 'child_workflow'` returns `paused: true` and `childRunId`.
6. Completed workflow node returns `data.child_run_id`.
7. Fan-out `data.fan_out === true` returns `fanOut: true` and `childRunId: null`.
8. Route iteration 4 returns outcome/to/condition from that `node_routed` event.
9. Loop group builds qualified body ids and per-iteration body statuses.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/select-room-data.test.ts
```

- [ ] **Step 3: Implement the minimum production module.**

Copy `packages/web/src/components/workflows/select-room-data.ts` with local inspect imports.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 5.**

```bash
git add packages/web/src/experiments/console/inspect/select-room-data.ts packages/web/src/experiments/console/inspect/select-room-data.test.ts
git commit -m "feat(web): select console per-type room data"
```

### Task 6: CREATE transcript slicer

**Files:**

- Create `packages/web/src/experiments/console/inspect/select-node-room-messages.ts`.
- Create `packages/web/src/experiments/console/inspect/select-node-room-messages.test.ts`.

- [ ] **Step 1: Write the failing tests.**

1. Ordinary selection returns messages sorted by `seq` even if input is unsorted.
2. Loop iteration 2 slices from `iteration_started` detail `"2"` through `iteration_completed` detail `"2"`.
3. Missing start marker returns the full ordered list.
4. Unsupported kinds are not present in fixtures; do not add a fourth kind.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/select-node-room-messages.test.ts
```

- [ ] **Step 3: Implement the minimum production module.**

Copy `packages/web/src/components/workflows/NodeRoom.tsx:86-116`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 6.**

```bash
git add packages/web/src/experiments/console/inspect/select-node-room-messages.ts packages/web/src/experiments/console/inspect/select-node-room-messages.test.ts
git commit -m "feat(web): slice console node transcripts by iteration"
```

### Task 7: CREATE run-graph adapter

**Files:**

- Create `packages/web/src/experiments/console/inspect/build-run-graph-input.ts`.
- Create `packages/web/src/experiments/console/inspect/build-run-graph-input.test.ts`.

- [ ] **Step 1: Write the failing tests.**

1. Isolated node with no status is `pending`.
2. `depends_on` becomes a `dependency` edge.
3. Non-empty `when` becomes a `conditional` edge labelled with that string.
4. `route_loop.routes` emit `route` edges with outcomes and skip duplicate depends_on to those targets.
5. `layoutRunGraph` with target status `awaiting` marks that inbound route `taken: true`.
6. Target `pending` or `skipped` is not taken.
7. The module imports `layout` from `@/lib/run-graph`.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/build-run-graph-input.test.ts
```

- [ ] **Step 3: Implement the minimum production module.**

Copy `packages/web/src/components/workflows/build-run-graph-input.ts` with local `ROUTE_LOOP_OUTCOMES` and generated `DagNode`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 7.**

```bash
git add packages/web/src/experiments/console/inspect/build-run-graph-input.ts packages/web/src/experiments/console/inspect/build-run-graph-input.test.ts
git commit -m "feat(web): adapt console DAGs onto run-graph layout"
```

### Task 8: CREATE ConsoleNodeRoom

**Files:**

- Create `packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.tsx`.
- Create `packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx`.

**Gotcha:** Set `process.env.NODE_ENV = 'development'` before importing React, then install happy-dom before `createRoot`, copying `installHappyDom` from `packages/web/src/experiments/console/components/DraftRunCard.test.tsx:26-69`.
Do not use `mock.module()`.
Stub `skill.listNodeMessages` with `spyOn`.

- [ ] **Step 1: Write the failing tests.**

1. `row === null` renders `Select a node` and no region.
2. Command row with messages renders `aria-label="review room"`, text, a tool chip, and a status note in seq order.
3. Completed command replay shows the same items while `isLive` is false.
4. Bash row shows stdout and does not call `listNodeMessages`.
5. Approval row shows declared message and, when `canDecide`, the existing approve control.
6. Workflow row with `child_run_id` links to `/console/p/proj-1/r/child-1`.
7. Route iteration row shows `positive` and the target id.
8. Loop-group row lists qualified body ids.
9. Host text does not contain `AskHuman`, `awaiting`, or `waiting-on-you`, including when projector status is `awaiting`.
10. Visible status text for an awaiting row is `running`.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx
```

- [ ] **Step 3: Implement the minimum production component.**

Follow Authoritative Interfaces.
Poll with `useEffect` + `setInterval(1000)` calling `refetch` only when `isLive` and `row` is an agent row.
Clear the interval on unmount.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 8.**

```bash
git add packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx
git commit -m "feat(web): render console per-type node rooms"
```

### Task 9: UPDATE unmerged Log dividers

**Files:**

- Update `packages/web/src/experiments/console/components/NodeDivider.tsx`.
- Update `packages/web/src/experiments/console/components/RunStream.tsx`.
- Update `packages/web/src/experiments/console/components/RunStream.test.tsx`.

Change `RunStream` props to:

```ts
export interface RunStreamProps {
  messages: Message[];
  events: RunEvent[];
  rawEvents: readonly WorkflowEvent[];
  nodeStates: readonly WorkflowNodeState[];
  approval: unknown;
  runStatus: Run['status'];
  showToolCalls: boolean;
  showSystem: boolean;
  selectedRowId: string | null;
  onSelectRow: (row: LogRow) => void;
  usage: UsageReport | null;
}
```

- [ ] **Step 1: Write the failing tests.**

1. Two loop-iteration events render two dividers `plan ×1` and `plan ×2`.
2. Clicking `plan ×2` calls `onSelectRow` with `{ selection: { kind: 'loop_iteration', iteration: 2 } }`.
3. Selected divider has `aria-current="true"`.
4. A `route_loop` `#2` row is not merged into `#1`.
5. Markup contains neither `AskHuman` nor `awaiting`.

Keep existing `pairToolEvents` tests passing by updating `RunStream` call sites in that file.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx
```

- [ ] **Step 3: Implement the minimum production change.**

Build rows from `synthesizeLogNodeStates` + `buildLogRows`.
Render a `NodeDivider` per row.
Keep message and tool entries.
Do not filter entries by selected node.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 9.**

```bash
git add packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/RunStream.tsx packages/web/src/experiments/console/components/RunStream.test.tsx
git commit -m "feat(web): show unmerged console log node-run rows"
```

### Task 10: UPDATE RunGraphPanel to layout()

**Files:**

- Update `packages/web/src/experiments/console/components/RunGraphPanel.tsx`.
- Create `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`.

- [ ] **Step 1: Write the failing tests.**

1. The module source contains `@/lib/run-graph` and does not contain `@dagrejs/dagre`.
2. Rendering two nodes and a taken edge produces an SVG `path` whose `d` matches `layoutRunGraph(...).routes[0].path`.
3. Clicking a node button calls `onNodeSelect` with that id.
4. Selected node has `aria-current="true"`.
5. Markup contains neither `AskHuman` nor `awaiting` even when live status is `awaiting`.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/RunGraphPanel.test.tsx
```

- [ ] **Step 3: Implement the minimum production change.**

Remove dagre.
Use 180 by 80 cards at `layout()` positions.
Keep console SVG, not React Flow.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 10.**

```bash
git add packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx
git commit -m "feat(web): render console run graph from run-graph layout"
```

### Task 11: CREATE inspect pane and wire RunDetailPage

**Files:**

- Create `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`.
- Create `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`.
- Update `packages/web/src/experiments/console/components/StreamToolbar.tsx`.
- Update `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.
- Update `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`.

- [ ] **Step 1: Write the failing tests.**

`ConsoleInspectPane.test.tsx` with happy-dom:

1. Log divider click and graph click for `review` leave one `aria-label="review room"` and do not unmount it when switching `view` from `log` to `graph`.
2. Graph click does not render a Log tab as the left pane.
3. Loop divider `×2` keeps that iteration row selected after switching to Graph and back to Log.
4. `?node=` is not this component's job; pass `selectedNodeId` in.
5. Host text contains neither `AskHuman` nor `awaiting` nor `waiting-on-you`.
6. Bash divider does not trigger `listNodeMessages`.
7. Command divider does.

`RunDetailPage.test.tsx`:

8. Export `resolveConsoleInspectSelection({ nodeStates, approval, searchNode, rows })` and test: searchNode wins; else running; else paused approval nodeId; else first row; else null.
9. `parseConsoleInspectSearch(search: string)` reads `node` and ignores unknown keys.

Add `resolveConsoleInspectSelection` and `parseConsoleInspectSearch` in `RunDetailPage.tsx` so the page can be tested without mounting every hook.

StreamToolbar:

10. There is no `All nodes` option.
11. `aria-label` is `Select node`.
12. There is still no Chat tab.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx
```

- [ ] **Step 3: Implement the minimum production change.**

Host `ConsoleInspectPane` for `view === 'log' || view === 'graph'`.
Load definition through `useEntity(K.workflowDagNodes(project.path, run.workflow), () => skill.getWorkflowDagNodes(run.workflow, project.path))`.
If that loader throws, treat definition as `[]` and `definitionPending` false after error.
Artifacts stays full width.
Keep Log-column `ApprovalPanel` for declared gates.
Read `useSearchParams` for `node`.

```ts
export function parseConsoleInspectSearch(search: string): string | null {
  const node = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('node');
  if (node === null) return null;
  const trimmed = node.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveConsoleInspectSelection(input: {
  searchNode: string | null;
  nodeStates: readonly WorkflowNodeState[];
  approvalNodeId: string | null;
  rows: readonly LogRow[];
}): string | null {
  if (input.searchNode !== null && input.nodeStates.some(state => state.nodeId === input.searchNode)) {
    return input.searchNode;
  }
  if (input.searchNode !== null && input.rows.some(row => row.nodeId === input.searchNode)) {
    return input.searchNode;
  }
  const running = input.nodeStates.find(state => inspectStatusLabel(state.status) === 'running');
  if (running !== undefined) return running.nodeId;
  if (input.approvalNodeId !== null) return input.approvalNodeId;
  return input.rows[0]?.nodeId ?? null;
}
```

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Also run:

```bash
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx
```

- [ ] **Step 5: Refactor only while green.**

- [ ] **Step 6: Commit Task 11.**

```bash
git add packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx packages/web/src/experiments/console/components/StreamToolbar.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx
git commit -m "feat(web): dock console inspect rooms on log and graph"
```

### Task 12: Deep-link, isolation, validate, and tracker

**Files:**

- Update `packages/web/src/experiments/console/components/ActiveRunCard.tsx`.
- Update `packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx`.
- Create `packages/web/src/experiments/console/inspect/isolation.test.ts`.
- Update `packages/web/src/experiments/console/README.md`.
- Update `eslint.config.mjs`.
- Update `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after validation.

- [ ] **Step 1: Write the failing tests.**

Export `consoleRunHref(projectId: string, runId: string, nodeId: string | null | undefined): string` from a tiny helper `packages/web/src/experiments/console/inspect/console-run-href.ts`.

1. Without node: `/console/p/p1/r/r1`.
2. With `review`: `/console/p/p1/r/r1?node=review`.
3. Encodes spaces in node ids.

`isolation.test.ts` reads these production files as text and asserts:

- none contain `@/components`
- none contain `@tanstack/react-query`
- none contain `from '@/lib/api'`
- `build-run-graph-input.ts` and `RunGraphPanel.tsx` contain `@/lib/run-graph`
- none contain `AskHuman`

File list: every new or updated `.ts`/`.tsx` under `inspect/`, `components/rooms/`, `ConsoleInspectPane.tsx`, `RunGraphPanel.tsx`, `RunStream.tsx`, `RunDetailPage.tsx`.

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd packages/web && bun test src/experiments/console/inspect/isolation.test.ts src/experiments/console/inspect/console-run-href.test.ts
```

- [ ] **Step 3: Implement the minimum production change.**

Add the helper and use it from `ActiveRunCard` and `ConsoleWorkflowResultCard`.
Document the run-graph exception in README and in an eslint comment above the console `no-restricted-imports` block.
Do not broaden or tighten the eslint patterns in a way that breaks existing `@/lib/api.generated` type imports.

- [ ] **Step 4: Re-run focused tests.**

```bash
cd packages/web && bun test src/experiments/console/inspect/
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/components/RunStream.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx
```

- [ ] **Step 5: Run repository validation.**

From the repository root:

```bash
bun run type-check
bun run lint --max-warnings 0
bun run validate
```

Do not run `bun test` from the repository root.

- [ ] **Step 6: Mark the story done and commit Task 12.**

In `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` set `5-5-inspect-a-run-as-nodes-on-command-center` to `done`.
Set `epic-5` to `done` because 5.1–5.5 are then all done.
Update both `last_updated` comments/values to the implementer's current local timestamp in the existing `+0700` format if that is still the file's zone, otherwise use the actual local offset.
Do not touch Epic 6 keys.

```bash
git add packages/web/src/experiments/console/inspect/console-run-href.ts packages/web/src/experiments/console/inspect/console-run-href.test.ts packages/web/src/experiments/console/inspect/isolation.test.ts packages/web/src/experiments/console/components/ActiveRunCard.tsx packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx packages/web/src/experiments/console/README.md eslint.config.mjs _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "feat(web): deep-link console inspect rooms and mark story 5.5 done"
```

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `skills/runs.node-messages.test.ts` | Encoded GET path, getRun extras | FR11 messages GET + projector states |
| `skills/workflows.test.ts` | List-endpoint DAG nodes | Definition for rooms/graph |
| `inspect/build-log-rows.test.ts` | Ordinary, loop, route rows | FR1 unmerged Logs |
| `inspect/synthesize-log-node-states.test.ts` | Gate/loop synthetics, no node_awaiting | Selectable pauses |
| `inspect/resolve-room-kind.test.ts` | Taxonomy and fallbacks | FR2 / UX-DR4 |
| `inspect/resolve-graph-room-row.test.ts` | Ordinary vs iteration vs synthetic | Graph door |
| `inspect/select-room-data.test.ts` | Stdout, gate, child, route, group | Story 5.2 chrome |
| `inspect/select-node-room-messages.test.ts` | Seq order and iteration slice | FR2 replay |
| `inspect/build-run-graph-input.test.ts` | Edges and awaiting taken-path | UX-DR2 / AD-4 |
| `rooms/ConsoleNodeRoom.test.tsx` | Per-type chrome, GET messages, no Ask | FR2, FR8, A+ |
| `RunStream.test.tsx` | Unmerged clickable dividers | FR1, UX-DR7 log timeline |
| `RunGraphPanel.test.tsx` | layout() paths, click, no dagre | FR1 graph door |
| `ConsoleInspectPane.test.tsx` | One room, three doors, no tab switch | FR8, UX-DR3, UX-DR7 |
| `RunDetailPage.test.tsx` | `?node=` and auto-select | Chat deep-link |
| `inspect/isolation.test.ts` | NFR4 import bans | NFR4 |

### Edge Cases Checklist

- [ ] Definition fetch fails; event fallback still opens stdout/gate/workflow rooms.
- [ ] Historical completed agent node replays GET messages without polling.
- [ ] Paused declared gate remains approvable from the Log-column panel and from the gate room.
- [ ] Graph click does not change `DetailView` to `log`.
- [ ] Switching Log ↔ Graph preserves the selected room instance.
- [ ] Loop iteration selected from Logs survives a Graph visit.
- [ ] `?node=` for an unknown id falls through to auto-select.
- [ ] CLI runs without parent chat still inspect from Logs and Graph.
- [ ] `pending_interactions: [{ anything }]` is ignored.
- [ ] Projector `awaiting` does not print `awaiting`.
- [ ] Fan-out workflow node does not inline child transcripts.
- [ ] Artifacts tab has no room dock and no Ask chrome.

## Validation Commands

From `packages/web`:

```bash
bun test src/experiments/console/skills/runs.node-messages.test.ts
bun test src/experiments/console/inspect/
NODE_ENV=development bun test src/experiments/console/components/rooms/ConsoleNodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx
NODE_ENV=development bun test src/experiments/console/components/RunGraphPanel.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx
NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx
```

From the repository root:

```bash
bun run type-check
bun run lint --max-warnings 0
bun run validate
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- [ ] Opening a live or historical DAG run on `/console` shows unmerged Logs where a loop or `route_loop` iteration is its own row.
- [ ] The same run shows a graph whose positions and routes come from `packages/web/src/lib/run-graph` `layout()`.
- [ ] Logs remain as a first-class Log tab; the graph is additional.
- [ ] Clicking a Logs divider opens the per-type room for that node-run.
- [ ] Clicking a graph node opens the same room without switching the left pane to Log.
- [ ] Opening `/console/p/:projectId/r/:runId?node=:nodeId` opens that node's room.
- [ ] `command` / `prompt` / `loop` rooms render GET `/api/workflows/runs/:runId/nodes/:nodeId/messages` as text, tool, and status items in `seq` order.
- [ ] A completed agent node shows that same transcript as replay.
- [ ] Bash/script rooms show stdout and do not fetch node messages.
- [ ] Approval/plannotator rooms show declared-gate chrome, not AskHuman.
- [ ] Workflow rooms link the child run and do not inline the child transcript.
- [ ] Route-loop rooms show controller chrome.
- [ ] Loop-group rooms show container chrome.
- [ ] There is exactly one room instance on Log/Graph.
- [ ] There is no Chat tab on run detail.
- [ ] There is no Ask card, empty Ask slot, or awaiting chrome.
- [ ] Console inspect files do not import `@/components`, `@/lib/api` functions, or `@tanstack/react-query`.
- [ ] The only production-web runtime import is `@/lib/run-graph`.
- [ ] Focused tests above pass.
- [ ] `bun run validate` passes.
- [ ] `5-5-inspect-a-run-as-nodes-on-command-center` is `done` in `sprint-status.yaml`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Duplicated inspect kernel drifts from legacy | Med | Med | Copy algorithms verbatim and keep characterization tests aligned with Stories 5.1–5.4 |
| `expectNoAskHumanChrome` fails on projector `awaiting` | High | High | Map chrome labels through `inspectStatusLabel`; never print `awaiting` |
| Graph click regression back to Log scroll | Med | High | Pane test asserts Graph remains the left view |
| `getRun` shape change breaks existing `Awaited<ReturnType<typeof getRun>>` callers | Med | Low | Only add fields; keep `run`, `events`, and `usage` |
| List-endpoint DAG nodes miss `route_loop` / `loop_group` | Med | High | Type nodes as generated `DagNode` and test those kinds in `resolve-room-kind` |
| Polling node messages without react-query double-fetches | Low | Low | One `useEntity` key per run/node plus a 1000 ms interval only while live |
| Removing stream node-filter surprises operators | Low | Low | All rows stay visible; selector only opens the room |

## Open Questions

1. Does Command Center need a Chat tab of user turns plus node-status chips?
Provisional default: no.
Approved UX Surface Fit keeps `Log | Graph | Artifacts`.
The Log divider list is the in-page node-status timeline.
`?node=` is the chat-surface door.

2. Should inspect helpers move into a second sanctioned `@/lib` module?
Provisional default: no.
NFR4 names only `run-graph`.
Duplicate under `experiments/console/inspect/`.

3. Should the Log-column declared-gate `ApprovalPanel` be removed once the gate room exists?
Provisional default: keep both.
RunActionBar is empty while paused, so removing the column panel would hide approve on Artifacts.

4. Should the toolbar node dropdown keep filtering the stream?
Provisional default: no.
It selects the room.
All unmerged rows stay visible.
