# Node Type Rooms (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator open any Logs row on the legacy run view and see a room that matches that node's type, so bash stdout, declared gates, child-run links, route-loop decisions, and loop-group containers are never rendered as a fake agent transcript.

**Architecture:** Story 5.1 already owns the unmerged Logs list, the agent-room GET messages path, and one Logs panel instance.
This story adds a legacy-only type dispatcher in that same panel: classify the selected node from the workflow definition (with event fallbacks), keep `command`/`prompt`/`loop` on `NodeTranscriptPane`/`NodeRoom`, and render dedicated inspect chrome for every other FR2 type from data already on GET run events and `run.metadata.approval`.
Do not add a transcript writer for bash/script, do not add `nodeStates.type`, do not add `packages/web/src/lib/run-graph`, and do not import console React components.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Query, react-dom/server, happy-dom, and bun:test.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.2.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` (CAP-2, FR2, FR8, UX-DR3, UX-DR4), `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` (NodePanel type bodies), `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` (node taxonomy convention, AD-3, AD-4 isolation, unified render is not a shared React NodePanel).

**Issue:** https://github.com/anhle128/Archon/issues/82

## Global Constraints

- Story 5.2 is inspect-only for AskHuman.
- Do not add an Ask card, an empty Ask slot, awaiting or waiting-on-you chrome, an awaiting node status, `node_awaiting` or `interaction_resolved` events, or `remote_agent_pending_interactions`.
- Do not change workflow YAML, NativeTool.handler, provider resume behavior, pauseWorkflowRun, CLI/chat/manage_run behavior, or the command-center surface.
- Do not add `packages/web/src/lib/run-graph` because the graph work belongs to Story 5.3.
- Keep the Graph tab and its existing merged WorkflowLogs panel unchanged.
- Keep `remote_agent_messages` as the merged chat path and do not add a node identifier to it.
- Keep GET `/api/workflows/runs/:runId/nodes/:nodeId/messages` as the agent-room source only.
- Do not append bash, script, workflow, approval, plannotator_gate, route_loop, or loop_group container output to `remote_agent_workflow_node_messages`.
- Do not add `type` or `node_output` to `workflowNodeStateSchema`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not import `packages/web/src/experiments/console/**` into `packages/web/src/components/workflows/**`.
- Do not share a React NodePanel with console.
- Keep one panel instance on the legacy Logs surface (UX-DR3): swap the room body, do not remount a second Logs shell.
- Declared gates keep `ApprovalContext` and must not share that slot with AskHuman.
- A `workflow:` room links the child run and must not inline the child's transcript.
- `command`/`prompt`/`loop` rooms stay the Story 5.1 agent timeline.
- Import Zod from `@hono/zod-openapi` only if a schema file is touched; this story should not need new engine Zod.
- Do not use `any`.
- Do not run `bun test` from the repository root.
- Run focused tests from `packages/web` and finish with `bun run validate` from the repository root.
- Keep each RED test in place, observe the expected failure, add only the minimal production behavior, observe GREEN, and refactor only while the tests remain green.

---

## Verified Repository Baseline

- Story 5.1 is `done` in `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
- Story 5.2 is `backlog`.
- `packages/web/src/components/workflows/LegacyNodeLogs.tsx` is the Logs-only list/room composition and always mounts `NodeTranscriptPane`.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` always GET-polls node messages while a row is selected.
- `packages/web/src/components/workflows/NodeRoom.tsx` renders only `text`/`tool`/`status` items and uses exact copy `Select a node` and `Node hasn't produced output`.
- `packages/web/src/lib/dag-layout.ts` `resolveNodeDisplay` collapses `script`, `loop_group`, `include`, and `workflow` to `prompt`.
- `packages/web/src/components/workflows/WorkflowCanvas.tsx` already documents that collapse and keys those types on the wire field instead.
- `GET /api/workflows/runs/:runId` `nodeStates` have no type and no stdout (`packages/server/src/routes/schemas/workflow.schemas.ts` `workflowNodeStateSchema`).
- Internal projector output exists in `packages/workflows/src/retry-state.ts` and is dropped by `projectApiWorkflowNodeStates`.
- Bash stdout is `node_completed.data.node_output` with `type: 'bash'` and optional truncation flags in `packages/workflows/src/dag-executor.ts`.
- Script stdout is `node_completed.data.node_output` with `type: 'script'` and is not byte-capped.
- Workflow child identity is `node_completed.data.child_run_id` plus `ApprovalContext.type === 'child_workflow'` and `childRunId`.
- Route decisions are `node_routed` events with `sources`, `outcome`, `to`, `condition`, `condition_result`, `negative_count`, `max_iterations`, `attempt`, and `execution_seq`.
- Loop-group containers emit `loop_iteration_*` on the group id and body lifecycle on `{groupId}.{bodyId}`.
- `WorkflowExecution` already fetches `getWorkflow` for the Graph tab but does not pass definition nodes into Logs.
- `WorkflowRunQueryData` drops `run.metadata.approval` and `parent_run_id`.
- Legacy pause approve/reject lives on `packages/web/src/components/dashboard/WorkflowRunCard.tsx` and `ConfirmRunActionDialog`, not on the run Logs room.
- Console `ApprovalContext.tsx` / `ApprovalPanel.tsx` are experiment-only and must not be imported.

## File Map

### Classification and room data

- Create `packages/web/src/components/workflows/resolve-room-kind.ts`.
- Create `packages/web/src/components/workflows/resolve-room-kind.test.ts`.
- Create `packages/web/src/components/workflows/select-room-data.ts`.
- Create `packages/web/src/components/workflows/select-room-data.test.ts`.
- Create `packages/web/src/lib/plannotator-review-url.ts`.
- Create `packages/web/src/lib/plannotator-review-url.test.ts`.
- Modify `packages/web/src/components/dashboard/WorkflowRunCard.tsx` to import the extracted helper.

### Type rooms

- Create `packages/web/src/components/workflows/StdoutRoom.tsx`.
- Create `packages/web/src/components/workflows/StdoutRoom.test.tsx`.
- Create `packages/web/src/components/workflows/GateRoom.tsx`.
- Create `packages/web/src/components/workflows/GateRoom.test.tsx`.
- Create `packages/web/src/components/workflows/ChildWorkflowRoom.tsx`.
- Create `packages/web/src/components/workflows/ChildWorkflowRoom.test.tsx`.
- Create `packages/web/src/components/workflows/RouteControllerRoom.tsx`.
- Create `packages/web/src/components/workflows/RouteControllerRoom.test.tsx`.
- Create `packages/web/src/components/workflows/LoopGroupRoom.tsx`.
- Create `packages/web/src/components/workflows/LoopGroupRoom.test.tsx`.
- Create `packages/web/src/components/workflows/InspectRoom.tsx`.
- Create `packages/web/src/components/workflows/InspectRoom.test.tsx`.

### One Logs panel

- Create `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
- Create `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`.
- Modify `packages/web/src/components/workflows/NodeRoom.tsx` to export the existing placeholder.
- Modify `packages/web/src/components/workflows/LegacyNodeLogs.tsx` to pass definition, events, approval, and run status into the dispatcher and mount `LegacyNodeRoom` instead of always mounting `NodeTranscriptPane`.
- Modify `packages/web/src/components/workflows/LegacyNodeLogs.test.tsx` for type switching and skipped message fetches.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx` to keep `run.metadata.approval` and pass `dagDefinitionNodes`.
- Modify `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` only if the agent query contract changes.
- Modify `packages/web/src/components/workflows/NodeRoom.test.tsx` only if the exported placeholder needs coverage.

### Completion tracking

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after all validation passes.

## Authoritative Contracts

### Room taxonomy

| Selected node | Room kind | Body |
| --- | --- | --- |
| `command`, `prompt`, `loop` | `agent` | Existing Story 5.1 `NodeTranscriptPane` + `NodeRoom` |
| `bash`, `script` | `stdout` | Mono `--surface-inset` terminal well of captured stdout plus exit status |
| `approval`, `plannotator_gate` | `gate` | Declared gate chrome from definition + current `ApprovalContext` when this node owns the slot |
| `workflow` | `workflow` | Child-run card with status and a link; never the child transcript |
| `route_loop` | `route_loop` | Routing-decision card for the selected `execution_seq` |
| `loop_group` | `loop_group` | Container chrome: body node list + per-iteration accordion |
| `cancel` or a definition-matched unknown mode | `inspect` | Type label + status; not an agent timeline |
| Unmatched node id with no non-agent event hint | `agent` | Preserve Story 5.1 for include-expanded command/prompt/loop nodes |

### Classifier

`resolveRoomKind(nodeId, definitionNodes, events)` is a pure function in the legacy workflows components tree.

Mode-field detection order for a matched `DagNode` is the engine exclusivity set, not `resolveNodeDisplay`:

1. `route_loop`
2. `loop_group`
3. `loop`
4. `plannotator_gate`
5. `approval`
6. `cancel`
7. `bash`
8. `script`
9. `workflow`
10. `include`
11. `command`
12. `prompt`

`include` on the authored include node itself is `inspect`.
Expanded include children are not in the parent definition; they fall through to event hints and then `agent`.

Definition match:

1. Exact `node.id === nodeId`.
2. Loop-group body: `nodeId === `${group.id}.${body.id}`` or a nested group prefix using the same `.` joiner as `dag-executor.ts`.
3. No `__` include expansion walk, because the included workflow nodes are not on the parent GET workflow payload.

Event fallback when no definition node matches:

1. Any `node_routed` with `step_name === nodeId` → `route_loop`.
2. Latest `node_started` or `node_completed` with `data.type === 'bash'` or `'script'` → `stdout`.
3. Latest `node_completed` with `data.type === 'workflow'` → `workflow`.
4. Else `agent`.

Do not use `loop_iteration_*` alone to distinguish `loop` from `loop_group`.

### Stdout

Read only GET run `events`.

`selectNodeStdout(events, nodeId)` returns the latest `node_completed` row for that `step_name` whose `data.node_output` is a string, plus:

- `truncated: data.node_output_truncated === true`
- `originalBytes` when `data.node_output_original_bytes` is a safe integer
- `failedDetail` from the latest `node_failed` `data.error` string when present

Render:

- Empty selection uses the shared placeholder `Select a node`.
- Missing stdout uses `Node hasn't produced output`.
- Present stdout uses a `<pre>` with `font-mono`, `bg-surface-inset`, and the exact captured string, including empty string after a successful node that printed nothing other than a trailing newline (executor already trims one trailing newline).
- Truncation note is `Output truncated from ${originalBytes} bytes` when `truncated` is true.
- Failed status text is the `node_failed` error when present, otherwise the LogRow status.

Do not fetch GET messages.
Do not live-stream bash while the node is running.

### Gate chrome

`selectGateChrome({ definitionNode, approval, runStatus, selectedNodeId })` uses a local web type guard, not an `@archon/workflows` import.

The guard accepts an object with string `nodeId` and string `message`.
Optional fields used by this story: `type`, `childRunId`, `document`, `phase`, `reviewUrl`, `resolved`.

When the selected node is `approval` or `plannotator_gate`:

- Always show the declared message from `definitionNode.approval.message` or `definitionNode.plannotator_gate.message` falling back to `approval.message` when this node owns the slot.
- Show `approval.document` or the declared `plannotator_gate.document` for a plannotator node.
- If `runStatus === 'paused'` and `approval.nodeId === selectedNodeId` and (`approval.type` is `approval`, `plannotator_gate`, or omitted) and `resolved` is not `'approved'` or `'rejected'`, show Approve and Reject using the existing dashboard verbs.
- Approve calls `approveWorkflowRun(runId)` with no comment.
- Reject uses `ConfirmRunActionDialog` from `packages/web/src/components/dashboard/ConfirmRunActionDialog.tsx` and `rejectWorkflowRun(runId, reason)`.
- Plannotator review URL uses the extracted helper: paused, `type === 'plannotator_gate'`, `http:` or `https:` only, label `Open Plannotator`.
- If this node does not own the current slot, show declared chrome plus factual `Gate is not the active pause` and no Approve/Reject.
- Completed gates may show `node_completed.data.approval_decision` when it is the string `approved` or `rejected`.

Do not render Approve/Reject for `type === 'child_workflow'`, `writeback`, or `interactive_loop` in GateRoom.
Interactive loop pauses stay on the agent room because the node type is `loop`.

Copy must not say `waiting on you`.
Paused banner text is the approval message or `Waiting for approval`, matching `WorkflowRunCard`.

### Child workflow

`selectChildRun({ events, approval, selectedNodeId })`:

- If `approval.type === 'child_workflow'` and `approval.nodeId === selectedNodeId` and `approval.childRunId` is a non-empty string, the card is paused on that child.
- Else use the latest `node_completed` with `step_name === selectedNodeId` and `data.type === 'workflow'`.
- If that event has `data.fan_out === true`, set `fanOut: true` and do not require a single child link.
- Otherwise `childRunId` is `data.child_run_id` when it is a non-empty string.

Render:

- Title `Child run`.
- If `fanOut`, copy `This node spawned multiple child runs` and optional `node_output` in a mono well; no invented children list.
- Else if `childRunId` is present, a button or link labelled `Open child run` that navigates to `/legacy/workflows/runs/${childRunId}`.
- Paused-on-child copy is the approval message when present, otherwise `Sub-run is paused awaiting review`.
- Missing child id uses `Node hasn't produced output`.
- Never fetch or render GET messages for this node.

### Route controller

`selectRouteDecision(events, nodeId, selection)`:

- Consider `event_type === 'node_routed'` and `step_name === nodeId`.
- If `selection.kind === 'route_iteration'`, use the event whose `data.execution_seq` equals `selection.executionSeq`.
- Else use the last matching event.

Card fields, all stringified only after type checks:

- `outcome`
- `to`
- `condition`
- `condition_result`
- `attempt`
- `execution_seq`
- `negative_count`
- `max_iterations`

Missing decision uses `Node hasn't produced output`.
Do not show an agent timeline.

### Loop-group container

`selectLoopGroupChrome({ definitionNode, events, nodeId })`:

- Body ids are `definitionNode.loop_group.nodes[].id` in authored order, or `[]` when definition is missing.
- Iterations are distinct `data.iteration` values from `loop_iteration_started|completed|failed` events with `step_name === nodeId`.
- Iteration status uses the same last-event-wins rule as `build-log-rows.ts`.

Render:

- Heading `Loop group`.
- Body list labelled `Body nodes` with each body id as plain text, not clickable into a nested graph.
- Accordion or `<details>` per iteration labelled `×${iteration}` and that iteration's status.
- Do not mount `NodeRoom`.
- Do not add a mini SVG DAG.

Body nodes that also appear as their own Logs rows keep their own rooms when selected.
This room is only for the container node id.

### One panel instance

`LegacyNodeLogs` remains the only Logs shell.

It still owns list selection.
The right side is:

1. Existing `roomHeader` (retry action).
2. `LegacyNodeRoom` dispatcher.
3. Existing `roomFooter`.

`LegacyNodeRoom` renders one `role="region"` with `aria-label={`${nodeId} room`}` for every type, including agent (move the region from `NodeRoom` onto the dispatcher, or keep it on `NodeRoom` for agent and put the same label on every other room; tests must see exactly one region labelled `{nodeId} room`).

Preferred: keep the region on each body so unselected state can stay a placeholder without a node id, matching Story 5.1.
Selected non-agent rooms must use the same `aria-label={`${nodeId} room`}`.

`NodeTranscriptPane` mounts only when `kind === 'agent'`.
A bash/script/gate/workflow/route_loop/loop_group selection must not call `loadMessages`.

### Exact empty copy

- `Select a node`
- `Node hasn't produced output`

Do not introduce `Select a node.` with a period.
Do not use `Node hasn't produced output yet` except as optional secondary stdout help; primary empty copy stays the Story 5.1 string.

## Open Questions With Binding Provisional Defaults

### Q1: How should a `fan_out` workflow node link children when GET run has no children array?

**Provisional default:** Do not add a list-children API.
Show `This node spawned multiple child runs` plus captured `node_output` when `data.fan_out === true`.
Single-child `workflow:` nodes still link `child_run_id` or paused `approval.childRunId`.

### Q2: Should bash/script rooms stream stdout before `node_completed`?

**Provisional default:** No.
The executor persists stdout only at completion (bash truncated at 32 KiB).
A running bash/script row uses `Node hasn't produced output` until that event exists.
Do not add a new executor stream or transcript writer.

### Q3: What room should an unmatched node id use?

**Provisional default:** Event hints first, then `agent`.
That preserves Story 5.1 for include-expanded `command`/`prompt`/`loop` ids that are absent from the authored parent definition.
A definition-matched `script`/`workflow`/`loop_group` must never fall through to `agent`.

### Q4: Should GateRoom include Approve/Reject or stay read-only?

**Provisional default:** Include the existing dashboard Approve/Reject verbs when this node owns the unresolved `approval` or `plannotator_gate` slot.
That is declared-gate UX already shipped on `WorkflowRunCard`, moved into the node room.
Do not add Ask Submit/Decline.
Do not approve a parent that is blocked on a child from the parent workflow node room.

### Q5: Does loop-group container chrome require a mini DAG?

**Provisional default:** No graph module in this story.
List body node ids and iteration accordion only.
Story 5.3 owns `run-graph`.

---

### Task 1: Add `resolveRoomKind`

**Files:**

- Create `packages/web/src/components/workflows/resolve-room-kind.ts`.
- Create `packages/web/src/components/workflows/resolve-room-kind.test.ts`.

**Interfaces:**

- Consumes `DagNode` from `@/lib/api` and `WorkflowEventResponse`.
- Produces `RoomKind` and `RoomResolution`.

- [ ] **Step 1: Write the failing classifier tests.**

```ts
import { describe, expect, test } from 'bun:test';
import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { resolveRoomKind } from './resolve-room-kind';

function node(partial: Partial<DagNode> & { id: string }): DagNode {
  return partial as DagNode;
}

function event(
  partial: Pick<WorkflowEventResponse, 'event_type' | 'step_name'> & {
    data?: Record<string, unknown>;
  }
): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: partial.event_type,
    step_index: null,
    step_name: partial.step_name,
    data: partial.data ?? {},
    created_at: '2026-09-06T00:00:00.000Z',
  };
}

describe('resolveRoomKind', () => {
  const nodes = [
    node({ id: 'ask', command: 'review' }),
    node({ id: 'draft', prompt: 'Write' }),
    node({ id: 'ralph', loop: { max_iterations: 3, fresh_context: false } }),
    node({ id: 'setup', bash: 'echo hi' }),
    node({ id: 'code', script: 'console.log(1)', runtime: 'bun' }),
    node({ id: 'gate', approval: { message: 'Ship?' } }),
    node({
      id: 'review-doc',
      plannotator_gate: { rework: { prompt: 'Fix' }, document: 'review.html' },
    }),
    node({ id: 'child', workflow: 'other' }),
    node({
      id: 'router',
      route_loop: {
        condition: '$x',
        max_iterations: 2,
        routes: { positive: 'ok', negative: 'fix', exhausted: 'stop' },
      },
    }),
    node({
      id: 'group',
      loop_group: {
        max_iterations: 2,
        fresh_context: false,
        nodes: [node({ id: 'body', prompt: 'work' }), node({ id: 'sh', bash: 'echo 1' })],
      },
    }),
    node({ id: 'abort', cancel: 'Stop' }),
    node({ id: 'block', include: 'pack' }),
  ];

  test('maps each FR2 type and does not call script or loop_group a prompt', () => {
    expect(resolveRoomKind('ask', nodes, []).kind).toBe('agent');
    expect(resolveRoomKind('draft', nodes, []).kind).toBe('agent');
    expect(resolveRoomKind('ralph', nodes, []).kind).toBe('agent');
    expect(resolveRoomKind('setup', nodes, []).kind).toBe('stdout');
    expect(resolveRoomKind('code', nodes, []).kind).toBe('stdout');
    expect(resolveRoomKind('gate', nodes, []).kind).toBe('gate');
    expect(resolveRoomKind('review-doc', nodes, []).gateType).toBe('plannotator_gate');
    expect(resolveRoomKind('child', nodes, []).kind).toBe('workflow');
    expect(resolveRoomKind('router', nodes, []).kind).toBe('route_loop');
    expect(resolveRoomKind('group', nodes, []).kind).toBe('loop_group');
    expect(resolveRoomKind('abort', nodes, []).kind).toBe('inspect');
    expect(resolveRoomKind('block', nodes, []).kind).toBe('inspect');
  });

  test('classifies loop-group body nodes from the prefixed run id', () => {
    expect(resolveRoomKind('group.body', nodes, []).kind).toBe('agent');
    expect(resolveRoomKind('group.sh', nodes, []).kind).toBe('stdout');
  });

  test('uses event type when the definition has no matching node', () => {
    expect(
      resolveRoomKind('ghost-bash', [], [
        event({ event_type: 'node_completed', step_name: 'ghost-bash', data: { type: 'bash' } }),
      ]).kind
    ).toBe('stdout');
    expect(
      resolveRoomKind('ghost-child', [], [
        event({
          event_type: 'node_completed',
          step_name: 'ghost-child',
          data: { type: 'workflow', child_run_id: 'child-1' },
        }),
      ]).kind
    ).toBe('workflow');
    expect(
      resolveRoomKind('ghost-router', [], [
        event({ event_type: 'node_routed', step_name: 'ghost-router', data: { execution_seq: 1 } }),
      ]).kind
    ).toBe('route_loop');
    expect(resolveRoomKind('block__prompt', nodes, []).kind).toBe('agent');
  });
});
```

- [ ] **Step 2: Run the classifier test and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts )
```

Expected: file not found or `resolveRoomKind` is not exported.

- [ ] **Step 3: Write the minimal classifier.**

Implement `findDefinitionNode` then `classifyDagNode` then event fallback as specified in Authoritative Contracts.
Do not call `resolveNodeDisplay`.
Do not import console `detectVariant`.

- [ ] **Step 4: Run the classifier test and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts )
```

- [ ] **Step 5: Refactor only if tests stay green.**

Keep the function pure and free of React.

### Task 2: Add room data selectors

**Files:**

- Create `packages/web/src/components/workflows/select-room-data.ts`.
- Create `packages/web/src/components/workflows/select-room-data.test.ts`.

**Interfaces:**

```ts
export interface NodeStdout {
  text: string;
  truncated: boolean;
  originalBytes: number | null;
  failedDetail: string | null;
}

export interface ChildRunRef {
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
}

export interface RouteDecisionView {
  outcome: string;
  to: string;
  condition: string;
  conditionResult: string;
  attempt: string;
  executionSeq: string;
  negativeCount: string;
  maxIterations: string;
}

export interface LoopGroupChrome {
  bodyNodeIds: string[];
  iterations: Array<{ iteration: number; status: 'running' | 'completed' | 'failed' }>;
}
```

- [ ] **Step 1: Write the failing selector tests.**

Cover:

- Latest bash `node_output` wins over an earlier completion.
- Truncation flags.
- `node_failed` error pairing.
- Missing output returns `null`.
- Route selection by `execution_seq`.
- Child paused via `approval.childRunId`.
- Child completed via `child_run_id`.
- Fan-out sets `fanOut: true`.
- Loop-group body ids and iteration status last-wins.

Use the same event factory style as Task 1.

- [ ] **Step 2: Run selector tests and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/select-room-data.test.ts )
```

- [ ] **Step 3: Write the minimal selectors.**

Do not reconstruct node lifecycle.
Do not read GET messages.
Do not treat `pending_interactions` as data.

`readApprovalContext(value: unknown)` lives here: `{ nodeId: string, message: string }` plus optional string/boolean fields listed in Gate chrome.
Never import `isApprovalContext` from `@archon/workflows`.

- [ ] **Step 4: Run selector tests and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/select-room-data.test.ts )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 3: Extract the Plannotator URL helper

**Files:**

- Create `packages/web/src/lib/plannotator-review-url.ts`.
- Create `packages/web/src/lib/plannotator-review-url.test.ts`.
- Modify `packages/web/src/components/dashboard/WorkflowRunCard.tsx`.
- Modify `packages/web/src/components/dashboard/WorkflowRunCard.test.tsx` only if imports break.

- [ ] **Step 1: Write failing helper tests.**

Port the three dashboard cases: HTTPS paused plannotator URL, standard approval has no link, `javascript:` is rejected.

The helper signature is:

```ts
export function getPlannotatorReviewUrl(input: {
  status: string;
  approval: unknown;
}): string | null;
```

- [ ] **Step 2: Run helper tests and verify RED.**

```bash
( cd packages/web && bun test src/lib/plannotator-review-url.test.ts )
```

- [ ] **Step 3: Move the dashboard implementation into the helper and switch `WorkflowRunCard` to import it.**

Keep behavior byte-identical.

- [ ] **Step 4: Run helper and dashboard tests and verify GREEN.**

```bash
( cd packages/web && bun test src/lib/plannotator-review-url.test.ts src/components/dashboard/WorkflowRunCard.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 4: Add `StdoutRoom`

**Files:**

- Create `packages/web/src/components/workflows/StdoutRoom.tsx`.
- Create `packages/web/src/components/workflows/StdoutRoom.test.tsx`.
- Modify `packages/web/src/components/workflows/NodeRoom.tsx` to export `RoomPlaceholder` if that avoids duplicating the empty markup.

- [ ] **Step 1: Write failing static-markup tests.**

```ts
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StdoutRoom } from './StdoutRoom';

describe('StdoutRoom', () => {
  test('renders captured stdout in a mono well and not markdown chat', () => {
    const markup = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{ text: 'hello\nworld', truncated: false, originalBytes: null, failedDetail: null }}
      />
    );
    expect(markup).toContain('hello\nworld');
    expect(markup).toContain('font-mono');
    expect(markup).toContain('setup room');
    expect(markup).not.toContain('chat-markdown');
  });

  test('uses Story 5.1 empty copy when stdout is missing', () => {
    const markup = renderToStaticMarkup(<StdoutRoom nodeId="setup" stdout={null} />);
    expect(markup).toContain("Node hasn't produced output");
  });

  test('notes truncated output', () => {
    const markup = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{ text: 'cut', truncated: true, originalBytes: 40000, failedDetail: null }}
      />
    );
    expect(markup).toContain('Output truncated from 40000 bytes');
  });
});
```

- [ ] **Step 2: Run StdoutRoom tests and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/StdoutRoom.test.tsx )
```

- [ ] **Step 3: Write the minimal terminal well.**

Use brand tokens only (`bg-surface-inset`, `text-text-primary`, `font-mono`).
No Ask chrome.

- [ ] **Step 4: Run StdoutRoom tests and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/StdoutRoom.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 5: Add `GateRoom`

**Files:**

- Create `packages/web/src/components/workflows/GateRoom.tsx`.
- Create `packages/web/src/components/workflows/GateRoom.test.tsx`.

- [ ] **Step 1: Write failing tests.**

Static markup for:

- Declared approval message is visible.
- Plannotator document and `Open Plannotator` appear only for a safe HTTPS `reviewUrl`.
- Approve/Reject appear only when this node owns an unresolved paused gate.
- Copy `waiting on you` is absent.
- `Gate is not the active pause` when another node owns the slot.

Use `renderToStaticMarkup` for inspect states.
If Approve click needs DOM, follow `LegacyNodeLogs.test.tsx` happy-dom + `NODE_ENV=development`.

- [ ] **Step 2: Run GateRoom tests and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/GateRoom.test.tsx )
```

- [ ] **Step 3: Write the minimal gate chrome.**

Import `ConfirmRunActionDialog` from `@/components/dashboard/ConfirmRunActionDialog`.
Import `getPlannotatorReviewUrl` from `@/lib/plannotator-review-url`.
Do not import console components.
Paused banner uses `bg-warning/5 border-warning/20` like `WorkflowRunCard`, never `--error`.

- [ ] **Step 4: Run GateRoom tests and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/GateRoom.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 6: Add `ChildWorkflowRoom`

**Files:**

- Create `packages/web/src/components/workflows/ChildWorkflowRoom.tsx`.
- Create `packages/web/src/components/workflows/ChildWorkflowRoom.test.tsx`.

- [ ] **Step 1: Write failing tests.**

- `Open child run` is present for `childRunId: 'child-1'` and the href or click target contains `/legacy/workflows/runs/child-1`.
- Fan-out copy `This node spawned multiple child runs` is present and `Open child run` is absent when `childRunId` is null.
- Empty copy when no child and not fan-out.
- No transcript tool cards.

Prefer a real `<a href="/legacy/workflows/runs/child-1">` so static markup can assert the link without a router.

- [ ] **Step 2: Run ChildWorkflowRoom tests and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/ChildWorkflowRoom.test.tsx )
```

- [ ] **Step 3: Write the minimal child card.**

- [ ] **Step 4: Run ChildWorkflowRoom tests and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/ChildWorkflowRoom.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 7: Add `RouteControllerRoom` and `LoopGroupRoom`

**Files:**

- Create `packages/web/src/components/workflows/RouteControllerRoom.tsx`.
- Create `packages/web/src/components/workflows/RouteControllerRoom.test.tsx`.
- Create `packages/web/src/components/workflows/LoopGroupRoom.tsx`.
- Create `packages/web/src/components/workflows/LoopGroupRoom.test.tsx`.
- Create `packages/web/src/components/workflows/InspectRoom.tsx`.
- Create `packages/web/src/components/workflows/InspectRoom.test.tsx`.

- [ ] **Step 1: Write failing tests.**

Route card shows `positive`, target node id, and condition text for a fixture decision.
Missing decision uses `Node hasn't produced output`.
Loop-group room lists body ids `body` and `sh` and iteration `×1`.
It does not render `chat-markdown`.
Inspect room shows `Cancel` or `inspect` type label and not an agent timeline.

- [ ] **Step 2: Run the three test files and verify RED.**

```bash
( cd packages/web && bun test src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx src/components/workflows/InspectRoom.test.tsx )
```

- [ ] **Step 3: Write the minimal controller, container, and inspect bodies.**

No SVG.
No `run-graph`.
No Ask chrome.

- [ ] **Step 4: Run the three test files and verify GREEN.**

```bash
( cd packages/web && bun test src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx src/components/workflows/InspectRoom.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 8: Add `LegacyNodeRoom` dispatcher

**Files:**

- Create `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
- Create `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`.

**Interfaces:**

```ts
export interface LegacyNodeRoomProps {
  runId: string;
  row: LogRow | null;
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  definitionNodes: readonly DagNode[];
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => void;
  onReject: (reason: string) => void;
}
```

- [ ] **Step 1: Write failing dispatcher tests using the happy-dom pattern from `NodeTranscriptPane.test.tsx`.**

Cases:

- `row === null` shows `Select a node` and does not call `loadMessages`.
- Agent command row mounts the transcript query and eventually the agent room region.
- Bash row renders stdout from events and never calls `loadMessages`.
- Approval row renders declared message and never calls `loadMessages`.
- Workflow row renders `Open child run` for `child_run_id` and never calls `loadMessages`.
- Route row renders the matching `execution_seq` decision and never calls `loadMessages`.
- Loop-group row renders `Body nodes` and never calls `loadMessages`.
- Switching from bash to command in the same mounted dispatcher calls `loadMessages` only after the agent selection.

Set `process.env.NODE_ENV = 'development'` before imports, matching `LegacyNodeLogs.test.tsx`.

- [ ] **Step 2: Run dispatcher tests and verify RED.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx )
```

- [ ] **Step 3: Write the dispatcher as a single switch on `resolveRoomKind`.**

Mount `NodeTranscriptPane` only for `agent`.
Pass stdout/gate/child/route/loop-group/inspect props from the selectors.
Do not put the switch inside `NodeRoom.tsx`.

- [ ] **Step 4: Run dispatcher tests and verify GREEN.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

### Task 9: Wire `LegacyNodeLogs` and `WorkflowExecution`

**Files:**

- Modify `packages/web/src/components/workflows/LegacyNodeLogs.tsx`.
- Modify `packages/web/src/components/workflows/LegacyNodeLogs.test.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.

**Details:**

Extend `LegacyNodeLogsProps` with `definitionNodes`, `runStatus`, `approval`, `onApprove`, and `onReject`.
Replace the direct `NodeTranscriptPane` with `LegacyNodeRoom`.
Keep selection ownership, run-change reset, `roomHeader`, and `roomFooter`.

In `WorkflowExecution`:

- Add `approval: data.run.metadata.approval ?? null` and keep `status` on `WorkflowRunQueryData` (status is already on `workflowState`).
- Pass `definitionNodes={dagDefinitionNodes ?? []}` into Logs.
- Pass `runStatus={workflow.status}`.
- Pass `approval` from query data, not the SSE-thinned `WorkflowState.approval`.
- Wire `onApprove` to `approveWorkflowRun(runId)` then invalidate `['workflowRun', runId]`.
- Wire `onReject` to `rejectWorkflowRun(runId, reason)` then invalidate the same query.
- Do not change the Graph branch.

- [ ] **Step 1: Extend `LegacyNodeLogs.test.tsx` with failing cases.**

Existing agent click-to-load must still pass.
Add:

- Clicking a bash Logs row shows stdout from the provided events and does not call `loadMessages`.
- Clicking an approval row shows the declared message from `definitionNodes`.
- Changing selection from bash to command keeps one list and then calls `loadMessages`.
- `waiting on you` is absent.

Provide `definitionNodes` in every render helper.

- [ ] **Step 2: Run LegacyNodeLogs tests and verify RED.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx )
```

- [ ] **Step 3: Apply the wiring.**

Do not mount a second panel.
Do not touch `activeView === 'graph'`.

- [ ] **Step 4: Run Logs and agent regression tests and verify GREEN.**

```bash
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/build-log-rows.test.ts src/components/workflows/WorkflowExecution.test.tsx )
```

- [ ] **Step 5: Refactor only if tests stay green.**

Delete any now-unused import in `LegacyNodeLogs`.
Do not extract a shared NodePanel for console.

### Task 10: Mark the sprint story done after validation

**Files:**

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

- [ ] **Step 1: Run focused web tests.**

```bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts src/components/workflows/select-room-data.test.ts src/lib/plannotator-review-url.test.ts )
( cd packages/web && bun test src/components/workflows/StdoutRoom.test.tsx src/components/workflows/GateRoom.test.tsx src/components/workflows/ChildWorkflowRoom.test.tsx src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx src/components/workflows/InspectRoom.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx )
```

- [ ] **Step 2: Run package and repo validation.**

```bash
( cd packages/web && bun run type-check )
bun run lint
bun run validate
```

- [ ] **Step 3: Set `5-2-see-the-right-room-for-each-node-type-legacy` to `done` only after every command above passes.**

Do not set it to `done` if validation failed.

---

## Testing Strategy

### Tests to write

| Test file | Cases | Validates |
| --- | --- | --- |
| `resolve-room-kind.test.ts` | FR2 types, prefixed body ids, event fallback, include-expanded default agent | Classifier |
| `select-room-data.test.ts` | stdout, truncation, route seq, child pause/complete/fan-out, loop-group iterations | Data |
| `plannotator-review-url.test.ts` | https / non-plannotator / javascript | URL safety |
| `StdoutRoom.test.tsx` | mono well, empty copy, truncation | bash/script chrome |
| `GateRoom.test.tsx` | declared message, review link, approve visibility, no awaiting copy | gate chrome |
| `ChildWorkflowRoom.test.tsx` | link, fan-out, empty | child link |
| `RouteControllerRoom.test.tsx` | decision fields, empty | controller |
| `LoopGroupRoom.test.tsx` | body list, iteration accordion, not agent | container |
| `InspectRoom.test.tsx` | cancel/include not agent | inspect |
| `LegacyNodeRoom.test.tsx` | switch, skipped fetches | dispatcher |
| `LegacyNodeLogs.test.tsx` | one panel, type switch, agent regression | UX-DR3 |

### Edge cases checklist

- [ ] Script nodes are stdout, not prompt.
- [ ] Loop-group container is not an agent room.
- [ ] Loop-group body prompt is still an agent room.
- [ ] Route Logs row `#N` shows that execution's decision, not only the last graph overlay.
- [ ] Parent blocked on child does not expose parent Approve in the workflow room.
- [ ] GET messages is not called for non-agent selections.
- [ ] Graph tab still uses merged WorkflowLogs.
- [ ] No `waiting on you` string.
- [ ] Brand tokens only; no ad-hoc hex.

## Validation Commands

Focused:

```bash
( cd packages/web && bun test src/components/workflows/resolve-room-kind.test.ts src/components/workflows/select-room-data.test.ts src/lib/plannotator-review-url.test.ts )
( cd packages/web && bun test src/components/workflows/StdoutRoom.test.tsx src/components/workflows/GateRoom.test.tsx src/components/workflows/ChildWorkflowRoom.test.tsx src/components/workflows/RouteControllerRoom.test.tsx src/components/workflows/LoopGroupRoom.test.tsx src/components/workflows/InspectRoom.test.tsx )
( cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyNodeLogs.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx )
( cd packages/web && bun run type-check )
```

Full:

```bash
bun run lint
bun run validate
```

There is no schema migration in this story, so `bun run check:schema-upgrades` is not required.
Do not regenerate `api.generated.d.ts` unless a route schema changes, which this plan forbids.

## Acceptance Criteria

- [ ] Opening a `bash` or `script` Logs row shows that node's captured stdout and not an agent timeline.
- [ ] Opening an `approval` or `plannotator_gate` Logs row shows declared gate chrome and does not occupy that slot with AskHuman.
- [ ] Opening a `workflow` Logs row shows a child-run link (or fan-out copy) and does not inline the child transcript.
- [ ] Opening a `route_loop` Logs row shows controller decision chrome and not an agent room.
- [ ] Opening a `loop_group` Logs row shows container chrome and not an agent room.
- [ ] `command`/`prompt`/`loop` rows still show the Story 5.1 GET messages timeline.
- [ ] Switching types via Logs keeps one panel instance on this surface.
- [ ] No shared React NodePanel is added for console.
- [ ] The graph is still not required and the Graph tab is unchanged.
- [ ] No Ask card, empty Ask slot, or awaiting / waiting-on-you chrome.
- [ ] Focused tests above pass.
- [ ] `bun run validate` passes.
- [ ] `5-2-see-the-right-room-for-each-node-type-legacy` is `done` only after the rest pass.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `resolveNodeDisplay` is reused and script/loop_group/workflow become prompt | High | High | New classifier keyed on wire fields; tests forbid prompt collapse |
| Agent GET is still fired for bash rows | Medium | Medium | Dispatcher mounts `NodeTranscriptPane` only for `agent`; assert `loadMessages` not called |
| Include-expanded agent nodes lose transcripts | Medium | Medium | Unmatched ids default to `agent` after event hints |
| Gate Approve on a child-blocked parent 400s | Low | Medium | Workflow room never renders parent Approve; GateRoom ignores `child_workflow` |
| Loop-group mini DAG scope creep | Medium | Medium | Body list + accordion only; no `run-graph` |
| Console import leaks | Low | High | File map stays under `components/workflows` plus dashboard dialog and lib helper |
