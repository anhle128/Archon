# Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the experimental console run detail an inspect-first command center where the chronological Log and node-centric Graph open one persistent, type-aware node room, without adding Epic 6 human-input controls.

**Architecture:** Keep console production code isolated under `packages/web/src/experiments/console/**`, consume only generated API types plus the sanctioned `@/lib/run-graph` geometry library, and project the server's run detail into one inspect model shared by Log, Graph, and the room.
The page owns URL-backed node selection and the existing persisted Log filter, the inspect pane owns the workflow-definition query and persistent split layout, and the room owns agent-message polling only when an agent node is selected.

**Tech Stack:** Bun, TypeScript, React, React Router, Tailwind CSS, generated OpenAPI component types, `@/lib/run-graph`, Happy DOM, and `bun:test`.

**Spec:** GitHub issue `#85`; `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`; `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, especially Story 5.5 and UX-DR1 through UX-DR7; `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md`; and `_bmad-output/planning-artifacts/ux-design-workflow-run-view-hitl/README.md` plus `mockup.html`.

## Global Constraints

- Preserve `StreamToolbar` as the Log node filter with its `All nodes` option because the approved UX explicitly says the toolbar is unchanged.
- Keep the Log chronological and unmerged, with one selectable divider for every ordinary node run, loop iteration, and route decision.
- Treat the Graph as an additional view and never replace or merge the Log.
- Mount exactly one node-room component beside either Log or Graph so selection and transcript state survive a view switch.
- Keep Artifacts full width and outside the node-room split layout.
- Do not add an Ask card, input composer, pending-interaction slot, `node_awaiting` presentation, or “Waiting on you” chrome in this story.
- Preserve tool messages in an agent transcript, including an `AskHuman` tool invocation if the server returned one, because Epic 6 will later replace that transcript item with an interactive card.
- Render backend `awaiting` state as ordinary `running` inspect chrome until Epic 6 implements the interaction UI.
- Use `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` only for agent rooms and poll it every second only while the run is `running` or `paused`.
- Do not import legacy React components, stores, contexts, routes, hooks, React Query, or runtime functions from `@/lib/api` into console production code.
- The only allowed production-web runtime import for this feature is `@/lib/run-graph`; imports from `@/lib/api.generated` must remain type-only.
- Do not introduce shared React components between the legacy and console shells.
- Do not change server routes, generated API declarations, workflow YAML semantics, database schemas, or provider behavior.
- Use complete TypeScript annotations and do not introduce `any`.
- Do not use `mock.module()` in the new tests because its process-wide cache replacement is not restored by Bun.
- Run focused tests from `packages/web`, and run the repository-wide suite only through `bun run validate` from the repository root.
- Run every `git add` and `git commit` command from the repository root.
- Keep every task independently reviewable and commit only the files named by that task.

## Acceptance Criteria

- AC1: A live or completed console run can show both `Log` and `Graph`, and switching between them does not close or remount the selected node room.
- AC2: The Log remains chronological and unmerged, and every ordinary node run, loop iteration, and route decision has its own selectable row.
- AC3: Clicking a Log row, Graph node, or node-status timeline entry resolves the same node selection and opens the correct room type.
- AC4: Agent rooms show chronological text, tool entries with input and output, and status transitions from the node-messages endpoint.
- AC5: Bash and script rooms show captured stdout and exit status; declared approval rooms show approval context and the existing approve/reject controls; workflow rooms link to the child run; route-loop rooms show route and controller data; loop-group rooms summarize child progress; and completed data remains replayable.
- AC6: No Ask card, composer, pending-interaction slot, `awaiting` label, or waiting-on-you treatment is rendered by the console inspect implementation.
- AC7: Console production code obeys NFR4 isolation, with generated types and `@/lib/run-graph` as the only stated exceptions.
- AC8: Existing run lifecycle actions, SSE refresh, Log filtering, usage expansion, artifact browsing, approval actions, and environment display continue to work.
- AC9: A run-status entry in the console chat timeline deep-links to `/console/p/:projectId/r/:runId?node=:nodeId` when a current or approval node is known.
- AC10: Focused console tests and `bun run validate` pass before Story 5.5 and Epic 5 are marked done.

## Specification Traceability

| Requirement | Planned proof |
| --- | --- |
| FR1 and UX-DR1, unmerged Log plus Graph | Tasks 3, 6, 7, and 8 |
| FR2 and UX-DR4, type-aware rooms | Tasks 2, 4, and 5 |
| FR3 and UX-DR7, timeline status opens room | Tasks 4, 5, 10, and 11 |
| FR8 and UX-DR3, thin shell-specific renderers | Tasks 5 and 9 |
| FR11, messages and projected node states | Tasks 1, 3, and 5 |
| NFR4, console isolation | Task 11 |
| Story 5.5 replay and no premature HITL | Tasks 5, 10, and 11 |
| Regression safety and completion evidence | Task 12 |

## File Structure

### Create

- `packages/web/src/experiments/console/skills/runs.node-messages.test.ts` verifies the run-detail and node-message client contracts.
- `packages/web/src/experiments/console/skills/workflows.dag-nodes.test.ts` verifies the workflow-definition node client contract.
- `packages/web/src/experiments/console/components/inspect/read-approval-context.ts` performs the console-local, typed approval-context parse.
- `packages/web/src/experiments/console/components/inspect/read-approval-context.test.ts` locks the parser's accepted and rejected shapes.
- `packages/web/src/experiments/console/components/inspect/inspect-status.ts` contains the no-premature-HITL display policy.
- `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts` proves `awaiting` is presented as `running`.
- `packages/web/src/experiments/console/components/inspect/build-log-rows.ts` produces ordinary, loop-iteration, and route-decision rows from projected and raw events.
- `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts` characterizes row identity, order, status, and selection metadata.
- `packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.ts` adds only deterministic fallback states required for incomplete historical payloads.
- `packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.test.ts` characterizes fallback-state precedence.
- `packages/web/src/experiments/console/components/inspect/build-console-log-entries.ts` joins selectable rows to existing divider metadata without duplicating node usage.
- `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts` verifies timestamps, duration, and one-time usage placement.
- `packages/web/src/experiments/console/components/inspect/resolve-room-kind.ts` maps a DAG node body to an inspect room kind.
- `packages/web/src/experiments/console/components/inspect/resolve-room-kind.test.ts` covers every supported node body.
- `packages/web/src/experiments/console/components/inspect/select-room-data.ts` extracts stdout, gate, child-run, route, and loop-group data from typed event payloads.
- `packages/web/src/experiments/console/components/inspect/select-room-data.test.ts` proves deterministic selection and malformed-payload behavior.
- `packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts` orders node messages and slices a selected loop iteration without dropping generic tool history.
- `packages/web/src/experiments/console/components/inspect/select-node-room-messages.test.ts` characterizes ordinary, route, closed-iteration, and open-iteration transcript selection.
- `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts` parses deep links and resolves the initial and current inspect selection.
- `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts` verifies deep-link, live-node, approval-node, and replay selection precedence.
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` renders the console-owned room shell and all room variants.
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` verifies room dispatch, polling policy, transcript order, and absence of Epic 6 UI.
- `packages/web/src/experiments/console/components/graph/build-run-graph-input.ts` adapts generated DAG nodes and projected states to `@/lib/run-graph`.
- `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts` verifies status precedence and edge metadata.
- `packages/web/src/experiments/console/components/graph/graph-viewport.ts` computes diagram bounds and fit scale.
- `packages/web/src/experiments/console/components/graph/graph-viewport.test.ts` verifies empty, oversized, and undersized diagrams.
- `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` verifies selection, arrows, labels, and viewport controls.
- `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` owns the persistent Log-or-Graph plus room split layout.
- `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` verifies a single room remains mounted across view switches.
- `packages/web/src/experiments/console/components/console-run-href.ts` creates encoded run-detail deep links with optional node selection.
- `packages/web/src/experiments/console/components/console-run-href.test.ts` verifies links with and without node ids.
- `packages/web/src/experiments/console/test/install-happy-dom.ts` installs and restores a minimal DOM for the new mounted component suites.
- `packages/web/src/experiments/console/console-isolation.test.ts` enforces NFR4 and the Story 5.5 no-premature-HITL boundary.

### Modify

- `packages/web/src/experiments/console/store/keys.ts` adds collision-safe cache keys for node messages and workflow DAG nodes.
- `packages/web/src/experiments/console/skills/runs.ts` retains raw events, projected node states, and raw approval data and adds the node-message request.
- `packages/web/src/experiments/console/skills/workflows.ts` exposes generated DAG nodes without weakening the existing graph client.
- `packages/web/src/experiments/console/components/NodeDivider.tsx` makes the node identity/status region selectable without nesting its existing usage button.
- `packages/web/src/experiments/console/components/NodeDivider.test.tsx` verifies selection, `aria-current`, and usage expansion.
- `packages/web/src/experiments/console/components/RunStream.tsx` interleaves selectable log entries while preserving the existing node filter and message windows.
- `packages/web/src/experiments/console/components/RunStream.test.tsx` verifies unmerged row rendering and filter behavior.
- `packages/web/src/experiments/console/components/RunGraphPanel.tsx` becomes a shell-owned renderer over `@/lib/run-graph` with no internal API query or event projector.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx` separates Log filtering from inspect selection, owns the `?node=` state, and hosts the inspect pane.
- `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` keeps existing run-detail regressions and adds deep-link selection coverage.
- `packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx` deep-links a chat timeline result entry to its current node when present.
- `packages/web/src/experiments/console/components/WorkflowDock.tsx` deep-links running and paused status entries to the current or declared approval node.
- `packages/web/src/experiments/console/README.md` documents the inspect boundary, sanctioned geometry import, and Epic 6 exclusion.
- `eslint.config.mjs` updates the existing console-isolation comment to name `@/lib/run-graph` as the one runtime exception without weakening any rule.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` marks Story 5.5 and Epic 5 done only after all validation passes.

## Task 1: Extend the Typed Console Data Boundary

**Files:**

- Create: `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`
- Create: `packages/web/src/experiments/console/skills/workflows.dag-nodes.test.ts`
- Modify: `packages/web/src/experiments/console/store/keys.ts`
- Modify: `packages/web/src/experiments/console/skills/runs.ts`
- Modify: `packages/web/src/experiments/console/skills/workflows.ts`

**Consumes:** Generated `components['schemas']` declarations, the existing `requestJson` wrapper, and the current run and workflow endpoints.

**Produces:** `ConsoleRunDetail`, `WorkflowEvent`, `WorkflowNodeState`, `WorkflowNodeMessage`, `WorkflowNodeMessagesResponse`, `DagNode`, `listNodeMessages`, `getWorkflowDagNodes`, `K.nodeMessages`, and `K.workflowDagNodes`.

- [ ] Write `runs.node-messages.test.ts` with a local `spyOn(globalThis, 'fetch')`, a unique run/node id per test, and cleanup that restores the spy.
- [ ] Assert that `getRun('run/1')` requests `/api/workflows/runs/run%2F1`, returns `rawEvents`, `nodeStates`, and raw `approval`, while its existing `events`, `run`, and `usage` fields remain populated.
- [ ] Assert that `listNodeMessages('run/1', 'node a')` requests `/api/workflows/runs/run%2F1/nodes/node%20a/messages` and returns `text`, `tool`, and `status` entries without reshaping them.
- [ ] Assert that a non-2xx response from either request rejects through `requestJson` instead of returning an empty fallback.
- [ ] Run `bun test src/experiments/console/skills/runs.node-messages.test.ts` from `packages/web` and confirm the new exports fail to resolve.
- [ ] Add generated aliases and the expanded detail contract to `skills/runs.ts` with this exact shape.

```ts
export type WorkflowEvent = components['schemas']['WorkflowEvent'];
export type WorkflowNodeState = components['schemas']['WorkflowNodeState'];
export type WorkflowNodeMessage = components['schemas']['WorkflowNodeMessage'];
export type WorkflowNodeMessagesResponse = components['schemas']['WorkflowNodeMessagesResponse'];

export interface ConsoleRunDetail {
  run: Run;
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  usage: RunDetailResponse['usage'];
}
```

- [ ] Change `getRun` to return `Promise<ConsoleRunDetail>` while preserving the current `toRun(response.run)`, `response.events.map(toRunEvent)`, and nullable usage behavior.
- [ ] Set `rawEvents` to the untouched `response.events`, set `nodeStates` to `response.nodeStates`, and set `approval` to `response.run.metadata.approval ?? null` before the existing presentation adapters run.
- [ ] Add `listNodeMessages` as an encoded `requestJson<WorkflowNodeMessagesResponse>` call to the exact node-messages endpoint.
- [ ] Add collision-safe keys whose segments are individually encoded.

```ts
nodeMessages: (runId: string, nodeId: string): string =>
  `run-node-messages:${encodeURIComponent(runId)}:${encodeURIComponent(nodeId)}`,
workflowDagNodes: (cwd: string | undefined, workflowName: string): string =>
  `workflow-dag-nodes:${encodeURIComponent(cwd ?? '')}:${encodeURIComponent(workflowName)}`,
```

- [ ] Write `workflows.dag-nodes.test.ts` and assert that `getWorkflowDagNodes('deploy/workflow', '/repo path')` requests `/api/workflows?cwd=%2Frepo%20path`, finds the exact workflow name in the list response, and returns its generated `nodes` array unchanged.
- [ ] Assert a missing exact workflow name rejects with `Workflow not found: deploy/workflow`, matching the existing graph-client behavior instead of returning an empty definition.
- [ ] Run `bun test src/experiments/console/skills/workflows.dag-nodes.test.ts` from `packages/web` and confirm `getWorkflowDagNodes` is missing.
- [ ] Import `components` type-only in `skills/workflows.ts`, export `type DagNode = components['schemas']['DagNode']`, type `RawWorkflow.nodes` as `DagNode[]`, and add `getWorkflowDagNodes(workflowName, cwd)` without changing `getWorkflowGraph`.
- [ ] Run `bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/workflows.dag-nodes.test.ts` from `packages/web` and confirm all boundary tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/store/keys.ts src/experiments/console/skills/runs.ts src/experiments/console/skills/workflows.ts src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/workflows.dag-nodes.test.ts` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/store/keys.ts packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/workflows.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/workflows.dag-nodes.test.ts && git commit -m "feat(web): expose console run inspect data"` from the repository root.

## Task 2: Establish Approval and Inspect-Status Policy

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/read-approval-context.ts`
- Create: `packages/web/src/experiments/console/components/inspect/read-approval-context.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/inspect-status.ts`
- Create: `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts`

**Consumes:** `unknown` approval JSON, generated node-state strings, and the approved Epic 5 boundary.

**Produces:** `ApprovalContext`, `readApprovalContext`, `getPlannotatorReviewUrl`, `inspectStatus`, `inspectStatusLabel`, and `isInspectRunLive`.

- [ ] Write table-driven parser tests for `null`, arrays, missing `nodeId`, missing `message`, wrong scalar types, every accepted context type, child-run data, plannotator data, and resolved decisions.
- [ ] Run `bun test src/experiments/console/components/inspect/read-approval-context.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement an object guard and this exact public contract without casts to `any`.

```ts
export type ApprovalContextType =
  | 'approval'
  | 'plannotator_gate'
  | 'child_workflow'
  | 'interactive_loop'
  | 'writeback';

export interface ApprovalContext {
  nodeId: string;
  message: string;
  type?: ApprovalContextType;
  childRunId?: string;
  document?: string;
  reviewUrl?: string | null;
  resolved?: 'approved' | 'rejected' | null;
}

export function readApprovalContext(value: unknown): ApprovalContext | null;
export function getPlannotatorReviewUrl(input: { status: string; approval: unknown }): string | null;
```

- [ ] Require string `nodeId` and `message`, allow only the five declared context types, retain only correctly typed optional fields, and return `null` for an invalid type or resolved value.
- [ ] Accept plannotator review links only when the run is paused and the parsed URL uses `http:` or `https:`.
- [ ] Write status tests proving `pending`, `running`, `completed`, `failed`, and `skipped` pass through, typed `awaiting` maps to `running`, arbitrary transcript status strings pass through except `awaiting`, and only `running` and `paused` runs are live for polling.
- [ ] Run `bun test src/experiments/console/components/inspect/inspect-status.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement the exact status policy.

```ts
export type InspectStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export function inspectStatus(value: string): InspectStatus {
  if (value === 'awaiting') return 'running';
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'skipped') return value;
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'running' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}
```

- [ ] Run `bun test src/experiments/console/components/inspect/read-approval-context.test.ts src/experiments/console/components/inspect/inspect-status.test.ts` from `packages/web` and confirm all tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/inspect/read-approval-context.ts src/experiments/console/components/inspect/read-approval-context.test.ts src/experiments/console/components/inspect/inspect-status.ts src/experiments/console/components/inspect/inspect-status.test.ts` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/inspect/read-approval-context.ts packages/web/src/experiments/console/components/inspect/read-approval-context.test.ts packages/web/src/experiments/console/components/inspect/inspect-status.ts packages/web/src/experiments/console/components/inspect/inspect-status.test.ts && git commit -m "feat(web): define console inspect status policy"` from the repository root.

## Task 3: Build the Unmerged Log Projection

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/build-log-rows.ts`
- Create: `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.ts`
- Create: `packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/build-console-log-entries.ts`
- Create: `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts`

**Consumes:** Generated `WorkflowEvent` and `WorkflowNodeState`, console `RunEvent`, existing `foldNodeRuns`, parsed approval context, and the existing `NodeRun` divider data.

**Produces:** Stable `LogRow` identities, deterministic fallback states, and `ConsoleLogEntry` values that retain current duration and usage presentation.

- [ ] Define tests for an ordinary node, two iterations of one loop node, two route decisions from one route-loop node, event-array ordering, and events with missing optional data.
- [ ] Assert that iterations and route decisions remain separate rows and that their ids are the originating raw event ids.
- [ ] Assert that the ordinary row for a loop or route-loop node is suppressed when specific iteration or route rows exist, so the Log does not double-count one execution.
- [ ] Run `bun test src/experiments/console/components/inspect/build-log-rows.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement this exact row contract and sort by source event-array order, then projected-state index, because the API event array is the chronological audit order.

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

export function buildLogRows(nodeStates: readonly WorkflowNodeState[], events: readonly WorkflowEvent[]): LogRow[];
```

- [ ] Use explicit event-type branches for loop starts/completions/failures and `node_routed`; do not infer event intent from prose.
- [ ] Group loop rows by positive safe-integer `data.iteration` and route rows by positive safe-integer `data.execution_seq`, preserving the first matching event's id and order while later events update loop status.
- [ ] For an ordinary state, anchor to its last `node_started` event, otherwise its last node lifecycle or declared `approval_requested` event, otherwise use the fallback id `node:${state.nodeId}` after all event-backed rows.
- [ ] Write fallback-state tests for missing loop-group projection, a paused declared approval, a paused child workflow, existing projected-state precedence, ordinary raw lifecycle events, and interactive-loop approval data.
- [ ] Run `bun test src/experiments/console/components/inspect/synthesize-log-node-states.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement `synthesizeLogNodeStates(nodeStates, events, runStatus, approval)` so existing projected states always win and synthetic states are added only for missing node ids represented by loop-iteration metadata or a selectable declared pause.
- [ ] Treat only `loop_iteration_started`, `loop_iteration_completed`, `loop_iteration_failed`, and `approval_requested` with `gateType` equal to `approval` or `plannotator_gate` as selectable synthetic events.
- [ ] Resolve a synthetic event node id from non-empty `step_name` first and then a non-empty string `data.nodeId`, and ignore the event if neither exists.
- [ ] Treat only approval context with absent type, `approval`, `plannotator_gate`, or `child_workflow` as a selectable paused fallback, and explicitly exclude `interactive_loop` and `writeback` from this Epic 5 projector.
- [ ] Assert ordinary `node_started` or terminal raw events never create a second lifecycle projector because authoritative `nodeStates` owns ordinary status.
- [ ] Write console-log-entry tests with existing `foldNodeRuns` fixtures and assert row timestamp, duration, cost, turns, stop reason, skip metadata, and one-time usage placement.
- [ ] Run `bun test src/experiments/console/components/inspect/build-console-log-entries.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement this exact adapter contract.

```ts
export interface ConsoleLogEntry {
  row: LogRow;
  displayStatus: InspectStatus;
  startedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  stopReason: string | null;
  skipReason: string | null;
  skipExpr: string | null;
  showNodeUsage: boolean;
}

export interface BuildConsoleLogEntriesInput {
  rows: readonly LogRow[];
  rawEvents: readonly WorkflowEvent[];
  nodeRuns: readonly NodeRun[];
  runStartedAt: string;
}

export function buildConsoleLogEntries(input: BuildConsoleLogEntriesInput): ConsoleLogEntry[];
```

- [ ] For ordinary rows, use the matching folded node run for metadata and use the raw event timestamp before the folded start timestamp.
- [ ] For loop rows, use the matching iteration start event and terminal event, and accept only finite non-negative numeric terminal duration.
- [ ] For route rows, match `row.selection.executionSeq`, use the route event timestamp, and leave unavailable duration metadata null.
- [ ] Set `showNodeUsage` only on the final chronological row for a node id so cumulative ledger data appears once even when a node has multiple rows.
- [ ] Use `runStartedAt` only as the final timestamp fallback so every divider has a stable timeline anchor.
- [ ] Run `bun test src/experiments/console/components/inspect/build-log-rows.test.ts src/experiments/console/components/inspect/synthesize-log-node-states.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts` from `packages/web` and confirm all projection tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/inspect/build-log-rows.ts src/experiments/console/components/inspect/build-log-rows.test.ts src/experiments/console/components/inspect/synthesize-log-node-states.ts src/experiments/console/components/inspect/synthesize-log-node-states.test.ts src/experiments/console/components/inspect/build-console-log-entries.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/inspect/build-log-rows.ts packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.ts packages/web/src/experiments/console/components/inspect/synthesize-log-node-states.test.ts packages/web/src/experiments/console/components/inspect/build-console-log-entries.ts packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts && git commit -m "feat(web): project unmerged console run rows"` from the repository root.

## Task 4: Resolve Room Types, Data, and Selection

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/resolve-room-kind.ts`
- Create: `packages/web/src/experiments/console/components/inspect/resolve-room-kind.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/select-room-data.ts`
- Create: `packages/web/src/experiments/console/components/inspect/select-room-data.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts`
- Create: `packages/web/src/experiments/console/components/inspect/select-node-room-messages.test.ts`
- Create: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts`
- Create: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts`

**Consumes:** Generated `DagNode`, `WorkflowEvent`, and `WorkflowNodeState`, `LogRow`, parsed approval context, and `URLSearchParams`.

**Produces:** Exhaustive room dispatch, deterministic per-room selectors, and URL/live/replay selection precedence.

- [ ] Write one room-kind test for each prompt or command agent body, bash, script, approval, plannotator, workflow, route-loop, loop-group, recursively qualified loop-group child, and unknown body.
- [ ] Add definition-missing tests for approval metadata, child-workflow metadata, `node_routed`, bash/script lifecycle metadata, workflow lifecycle metadata, declared-gate events, and the safe agent fallback.
- [ ] Run `bun test src/experiments/console/components/inspect/resolve-room-kind.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement the exact union and resolver.

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

export function nodeBodyKind(node: DagNode): NodeBodyKind;
export function resolveRoomKind(
  nodeId: string,
  definitionNodes: readonly DagNode[],
  events: readonly WorkflowEvent[],
  approval: unknown
): RoomResolution;
```

- [ ] Identify node bodies by their schema keys rather than by parsing labels or prompts, recursively qualify loop-group children with dot-separated ids, and let definition data outrank metadata fallback.
- [ ] Return an agent room with `nodeType: 'unknown'` only after approval and event fallbacks fail, so historical agent transcripts remain inspectable when a definition is unavailable.
- [ ] Write selector tests for interleaved events from two nodes, two iterations of one loop, two route decisions, a workflow child run, a declared approval, and malformed payload objects.
- [ ] Run `bun test src/experiments/console/components/inspect/select-room-data.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement explicit typed readers and these exports, returning `null` or an empty array when a required typed field is absent.

```ts
export interface StdoutView {
  text: string | null;
  status: LogRow['status'];
  exitCode: 0 | null;
  truncated: boolean;
  originalBytes: number | null;
  failedDetail: string | null;
}

export interface GateChrome {
  gateType: 'approval' | 'plannotator_gate';
  message: string;
  document: string | null;
  decision: 'approved' | 'rejected' | null;
  canDecide: boolean;
  showInactiveNotice: boolean;
  reviewUrl: string | null;
}

export interface ChildRunRef {
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
  status: LogRow['status'];
}

export interface RouteDecisionView {
  outcome: string | null;
  to: string | null;
  condition: string | null;
  conditionResult: string | null;
  attempt: string | null;
  executionSeq: string | null;
  negativeCount: string | null;
  maxIterations: string | null;
}

export interface LoopGroupBodyNode {
  id: string;
  qualifiedId: string;
  dependsOn: string[];
}

export interface LoopGroupBodyState extends LoopGroupBodyNode {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export interface LoopGroupIterationView {
  iteration: number;
  status: 'running' | 'completed' | 'failed';
  body: LoopGroupBodyState[];
}

export interface LoopGroupChrome {
  body: LoopGroupBodyNode[];
  iterations: LoopGroupIterationView[];
  selectedIteration: number | null;
}

export interface GateChromeInput {
  definitionNode: DagNode | null;
  events: readonly WorkflowEvent[];
  row: LogRow;
  approval: unknown;
  runStatus: RunStatus;
  gateType: 'approval' | 'plannotator_gate';
}

export interface ChildRunInput {
  events: readonly WorkflowEvent[];
  approval: unknown;
  row: LogRow;
  runStatus: RunStatus;
}

export interface LoopGroupChromeInput {
  definitionNode: DagNode | null;
  events: readonly WorkflowEvent[];
  row: LogRow;
}

export function selectNodeStdout(events: readonly WorkflowEvent[], row: LogRow): StdoutView;
export function selectGateChrome(input: GateChromeInput): GateChrome;
export function selectChildRun(input: ChildRunInput): ChildRunRef;
export function selectRouteDecision(events: readonly WorkflowEvent[], row: LogRow): RouteDecisionView | null;
export function selectLoopGroupChrome(input: LoopGroupChromeInput): LoopGroupChrome;
```

- [ ] Import the existing console `RunStatus` type into the selector module and do not redeclare its status union.
- [ ] Anchor terminal-event selection at `row.id`, validate finite or safe-integer scalar fields, expose stdout truncation metadata, and never throw on malformed event data.
- [ ] Match route data by `row.selection.executionSeq`, match loop-group data by selected iteration, and keep fan-out child workflows summarized rather than linking one arbitrary child.
- [ ] Write `select-node-room-messages.test.ts` with reversed sequence input, ordinary and route selections, a closed loop iteration, an open loop iteration ending at the next start, and a missing iteration marker.
- [ ] Run `bun test src/experiments/console/components/inspect/select-node-room-messages.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement `selectNodeRoomMessages(messages: readonly WorkflowNodeMessage[], selection: LogRowSelection): WorkflowNodeMessage[]` by sorting a shallow array on `seq`, returning all messages for non-loop rows, and slicing loop rows from matching `iteration_started` through the matching terminal marker or the next iteration start.
- [ ] Return the complete ordered transcript when the selected iteration marker is absent so incomplete historical data remains replayable.
- [ ] Write selection tests proving valid `?node=` wins, an invalid query falls back to the first inspect-running node, a declared approval is next, the first log row is last, and an empty run selects nothing.
- [ ] Assert that `selectedLogRowId` is retained only when it belongs to the selected node and that graph selection clears the row-specific selection.
- [ ] Run `bun test src/experiments/console/components/inspect/console-inspect-selection.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement these pure helpers without reading browser globals.

```ts
export interface InspectSelection {
  nodeId: string | null;
  logRowId: string | null;
}

export function readNodeSearchParam(search: string): string | null;
export function resolveInitialInspectSelection(input: {
  requestedNodeId: string | null;
  nodeStates: readonly WorkflowNodeState[];
  rows: readonly LogRow[];
  approvalNodeId: string | null;
}): InspectSelection;
export function selectInspectNode(nodeId: string, rowId: string | null): InspectSelection;
```

- [ ] Run `bun test src/experiments/console/components/inspect/resolve-room-kind.test.ts src/experiments/console/components/inspect/select-room-data.test.ts src/experiments/console/components/inspect/select-node-room-messages.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts` from `packages/web` and confirm all resolver tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/inspect/resolve-room-kind.ts src/experiments/console/components/inspect/resolve-room-kind.test.ts src/experiments/console/components/inspect/select-room-data.ts src/experiments/console/components/inspect/select-room-data.test.ts src/experiments/console/components/inspect/select-node-room-messages.ts src/experiments/console/components/inspect/select-node-room-messages.test.ts src/experiments/console/components/inspect/console-inspect-selection.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/inspect/resolve-room-kind.ts packages/web/src/experiments/console/components/inspect/resolve-room-kind.test.ts packages/web/src/experiments/console/components/inspect/select-room-data.ts packages/web/src/experiments/console/components/inspect/select-room-data.test.ts packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts packages/web/src/experiments/console/components/inspect/select-node-room-messages.test.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts && git commit -m "feat(web): resolve console node rooms"` from the repository root.

## Task 5: Render the Console-Owned Node Room

**Files:**

- Create: `packages/web/src/experiments/console/test/install-happy-dom.ts`
- Create: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Create: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`

**Consumes:** `LogRow`, generated DAG nodes and node messages, projected node state, room selectors, `ApprovalPanel`, `useEntity`, and an injected typed message loader.

**Produces:** A single console-owned `ConsoleNodeRoom` that renders every Story 5.5 room without Epic 6 interaction UI.

- [ ] Add `installHappyDom()` and `restoreHappyDom()` test helpers that capture prior global property descriptors, create a `Window` at `https://localhost/`, and restore or delete every installed key in `afterEach`.
- [ ] Install `window`, `document`, `self`, DOM element constructors including `SVGElement`, `navigator`, `location`, storage, `getComputedStyle`, animation-frame functions, `MutationObserver`, DOM event constructors, and `IS_REACT_ACT_ENVIRONMENT`, matching the needs of React 19 and the graph renderer.
- [ ] Write component tests using an injected `loadMessages` function rather than `mock.module()`.
- [ ] Verify an agent room renders text, tool input and output, and status entries in server sequence order, and verify selected loop rows show only that iteration when markers exist.
- [ ] Verify switching the selected agent node rekeys the request and that selecting bash, approval, workflow, route-loop, or loop-group nodes does not call `loadMessages`.
- [ ] Verify an unknown node body uses the agent fallback and loads its replayable transcript after definition loading finishes.
- [ ] Verify a live agent room schedules a 1,000 ms refresh and a completed room does not schedule refresh by spying on and restoring `globalThis.setInterval` and `globalThis.clearInterval`, without waiting on wall-clock time.
- [ ] Verify backend `awaiting` status displays as `running` and that no composer, Ask card, pending-interaction slot, or waiting-on-you label is present.
- [ ] Verify bash/script output and truncation metadata, declared-gate controls and decision state, encoded child-run link, fan-out summary, route decision, and loop-group progress.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx` from `packages/web` and confirm the component is missing.
- [ ] Implement this exact public interface.

```ts
export interface ConsoleNodeRoomProps {
  run: Run;
  projectId: string;
  nodeId: string | null;
  selectedRow: LogRow | null;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  nodeStates: readonly WorkflowNodeState[];
  events: readonly WorkflowEvent[];
  approval: unknown;
  isLive: boolean;
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
  onClose: () => void;
}
```

- [ ] Call `resolveRoomKind(nodeId, definitionNodes, events, approval)` so recursively qualified definitions win and event metadata provides deterministic historical fallback.
- [ ] While the definition query is pending and resolution is the unknown agent fallback, render a loading room instead of prematurely requesting messages.
- [ ] Keep the room header stable across all kinds with node label, node id, inspect status, selected iteration or route label, and a close button wired to `onClose`.
- [ ] Key the `useEntity` query with `K.nodeMessages(run.id, nodeId)` only for agent rooms and use a stable no-op key plus `Promise.resolve({ messages: [] })` for every inactive branch.
- [ ] Use an effect that calls `refetch()` every 1,000 ms only when `isLive` and the resolved room kind is `agent`, and clear the interval on every dependency change and unmount.
- [ ] Render agent messages with exhaustive branches for `text`, `tool`, and `status`; render text with the package's installed Markdown plugins, and use `JSON.stringify(value, null, 2)` for structured tool input and output.
- [ ] Pass messages through `selectNodeRoomMessages` and map only the visible status label `awaiting` to `running`, preserving iteration marker strings and details.
- [ ] Surface node-message loading errors with a Retry button that calls the query's `refetch()`.
- [ ] Render stdout in a `<pre>` with explicit empty and failure messages, truncation/original-byte metadata, and the selector's success exit code.
- [ ] Render gate message, document, decision, safe plannotator review link, inactive notice, and the existing console `ApprovalPanel` only when `GateChrome.canDecide` is true.
- [ ] Render workflow child links as `/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(childRunId)}`, show fan-out and output summaries, and show an explicit not-started message when no child run exists.
- [ ] Render the selected route decision fields and loop-group iterations in chronological order and mark only the `selectedRow.selection` item as selected.
- [ ] Render a definition-loading message while pending and use the agent fallback for an unknown body after loading settles.
- [ ] Do not read or render `pending_interactions`, and do not add state or callbacks for user input.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx` from `packages/web` and confirm all room tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/test/install-happy-dom.ts src/experiments/console/components/ConsoleNodeRoom.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/test/install-happy-dom.ts packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx && git commit -m "feat(web): render console node inspect rooms"` from the repository root.

## Task 6: Adapt the DAG to the Shared Run-Graph Layout

**Files:**

- Create: `packages/web/src/experiments/console/components/graph/build-run-graph-input.ts`
- Create: `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts`
- Create: `packages/web/src/experiments/console/components/graph/graph-viewport.ts`
- Create: `packages/web/src/experiments/console/components/graph/graph-viewport.test.ts`

**Consumes:** Generated `DagNode` and `WorkflowNodeState`, local inspect-status policy, and the public `@/lib/run-graph` types and functions.

**Produces:** One typed graph input projection and deterministic fit calculations with no second event-state projector.

- [ ] Write graph-input tests for simple dependencies, conditional edges, route labels, loop back-edges, duplicate projected states, and awaiting-state normalization.
- [ ] Run `bun test src/experiments/console/components/graph/build-run-graph-input.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement this exact contract and call the public `layout` function from `@/lib/run-graph`.

```ts
export interface ConsoleGraphNode {
  definition: DagNode;
  nodeState: NodeState;
}

export interface ConsoleGraphModel {
  nodes: ConsoleGraphNode[];
  edges: LayoutEdge[];
  positions: Record<string, Point>;
  routes: LayoutRoute[];
}

export function buildRunGraphInput(nodes: readonly DagNode[], nodeStates: readonly WorkflowNodeState[]): ConsoleGraphModel;
```

- [ ] Use projected `nodeStates` as the only live status authority, with the final state for a duplicated node id winning deterministically.
- [ ] Normalize `awaiting` to `running` before passing status to the layout library.
- [ ] Declare a console-local `['positive', 'negative', 'exhausted'] as const` because generated OpenAPI declarations are type-only and cannot supply the legacy runtime constant.
- [ ] Emit dependency, conditional, and three route edges from typed DAG fields without interpreting prompt text, suppress a duplicate dependency edge to a route target, and let `layout` identify back-edges.
- [ ] Give each edge the base id `${source}->${target}` and append `:${outcome}` only when a route target would otherwise collide, so repeated route targets remain distinct and deterministic.
- [ ] Return `layout({ nodes: layoutNodes, edges })` positions and routes so the renderer receives the library-computed labels and taken state.
- [ ] Write viewport tests for no positions, one node, a diagram larger than its viewport, and a diagram smaller than its viewport.
- [ ] Run `bun test src/experiments/console/components/graph/graph-viewport.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement diagram bounds using the shared layout's current 180 by 80 node footprint plus 64 pixels of canvas padding on every side so the current 46-pixel back-edge gutter and route labels do not clip.

```ts
export interface GraphBounds {
  width: number;
  height: number;
}

export function graphBounds(positions: Readonly<Record<string, Point>>): GraphBounds;
export function fitGraphScale(viewportWidth: number, viewportHeight: number, bounds: GraphBounds, padding?: number): number;
```

- [ ] Clamp fit scale to `0.25 <= scale <= 1.0`, return `1` for empty or non-positive dimensions, and include 24 pixels of default padding on every side.
- [ ] Run `bun test src/experiments/console/components/graph/build-run-graph-input.test.ts src/experiments/console/components/graph/graph-viewport.test.ts` from `packages/web` and confirm all graph-model tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/graph/build-run-graph-input.ts src/experiments/console/components/graph/build-run-graph-input.test.ts src/experiments/console/components/graph/graph-viewport.ts src/experiments/console/components/graph/graph-viewport.test.ts` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/graph/build-run-graph-input.ts packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts packages/web/src/experiments/console/components/graph/graph-viewport.ts packages/web/src/experiments/console/components/graph/graph-viewport.test.ts && git commit -m "feat(web): adapt console DAG to run graph"` from the repository root.

## Task 7: Replace the Console Graph Renderer

**Files:**

- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Create: `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`

**Consumes:** `ConsoleGraphModel`, generated DAG nodes and projected states, graph viewport helpers, and a node-selection callback.

**Produces:** A console-owned SVG/HTML graph renderer with pan, zoom, fit, labels, arrows, live status, and selection.

- [ ] Write component tests that pass data directly and never mock the workflow skill.
- [ ] Assert that all nodes and route labels render, taken and untaken edges have distinct styling, back-edges are dashed, arrow markers exist, and the selected node has `aria-current="true"`.
- [ ] Assert that a node click calls `onSelectNode(nodeId)` without changing the active view.
- [ ] Assert that zoom-in, zoom-out, and fit controls update the transform and that the scroll container remains the panning surface, with explicit non-zero `clientWidth` and `clientHeight` stubs for Happy DOM.
- [ ] Assert that a definition error and an empty definition have distinct visible messages.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/RunGraphPanel.test.tsx` from `packages/web` and confirm the old props fail the new assertions.
- [ ] Replace the internal `useEntity`, workflow query, Dagre layout, and raw-event state derivation with this exact interface.

```ts
export interface RunGraphPanelProps {
  nodes: readonly DagNode[];
  nodeStates: readonly WorkflowNodeState[];
  selectedNodeId: string | null;
  definitionPending: boolean;
  definitionError: string | null;
  onSelectNode: (nodeId: string) => void;
}
```

- [ ] Memoize `buildRunGraphInput(nodes, nodeStates)` and use the returned positions and routes as the sole geometry authority.
- [ ] Render routes in SVG with `markerEnd`, dashed conditional or back-edge styling, route labels at `labelPosition`, and a muted stroke for untaken routes.
- [ ] Render SVG routes and node cards inside the same canvas transform with a 64-pixel origin translation, then render nodes at the exact shared positions with local 180 by 80 dimensions, `nodeBodyKind` for the visible type glyph, label, id, inspect status, and selection ring.
- [ ] Clamp manual zoom to `0.25 <= scale <= 1.5` in 0.1 increments.
- [ ] Implement panning with the native overflow scroll container and implement Fit by applying `fitGraphScale`, sizing the transformed canvas, and centering it after the next animation frame.
- [ ] Keep the renderer free of workflow fetching, event folding, and imports from legacy components or Dagre.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/RunGraphPanel.test.tsx` from `packages/web` and confirm all renderer tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/RunGraphPanel.tsx src/experiments/console/components/RunGraphPanel.test.tsx` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx && git commit -m "feat(web): render inspectable console run graph"` from the repository root.

## Task 8: Make Every Log Row Selectable

**Files:**

- Modify: `packages/web/src/experiments/console/components/NodeDivider.tsx`
- Modify: `packages/web/src/experiments/console/components/NodeDivider.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunStream.tsx`
- Modify: `packages/web/src/experiments/console/components/RunStream.test.tsx`

**Consumes:** `ConsoleLogEntry`, existing `NodeRun` message-window folding, current node filter, usage ledger, and a row-selection callback.

**Produces:** Chronological selectable dividers without changing the existing `All nodes` filter semantics or usage expansion.

- [ ] Extend `NodeDivider.test.tsx` to assert that clicking the node identity/status control calls `onSelect(rowId, nodeId)`, selected rows expose `aria-current="true"`, and the existing usage-expansion control remains separately operable.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/NodeDivider.test.tsx` from `packages/web` and confirm the new props are missing.
- [ ] Add `rowId`, `selected`, and `onSelect` props to `NodeDivider`, allow the normalized `pending` display status, and give its root `id={`node-transition-${rowId}`}`.
- [ ] Turn the timestamp, row label, leader, and status into one full-width selection button with `aria-current={selected ? 'true' : undefined}`.
- [ ] Move usage expansion to an adjacent chevron-only button with an explicit accessible label so no interactive element is nested and both actions remain keyboard-operable.
- [ ] Preserve current duration, cost, turns, stop reason, skip reason, skip expression, ledger report, and run-wide coverage behavior.
- [ ] Extend `RunStream.test.tsx` with ordinary, two-iteration, and two-route fixtures and assert five distinct dividers appear in chronological order.
- [ ] Assert that choosing a row reports its row id and node id while filtering to one node still hides other node rows and messages and `All nodes` restores them.
- [ ] Assert cumulative node usage is rendered only for the row whose `showNodeUsage` is true.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx` from `packages/web` and confirm the new fixtures fail.
- [ ] Replace only the divider source in `RunStream` with this extended prop contract.

```ts
logEntries: readonly ConsoleLogEntry[];
selectedLogRowId: string | null;
onSelectLogRow: (rowId: string, nodeId: string) => void;
```

- [ ] Keep `selectedNodeId: string` as the existing persisted Log filter and retain the existing message windows built by `foldNodeRuns(events)`.
- [ ] Filter `logEntries` by `row.nodeId` when the Log filter is not `all`, merge their divider items into the existing timestamped timeline, and preserve stable source-order tie breaking.
- [ ] Pass `entry.displayStatus`, pass node usage only when `entry.showNodeUsage` is true, and pass the adapter's other metadata directly to `NodeDivider`.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunStream.test.tsx` from `packages/web` and confirm both suites pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/NodeDivider.tsx src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunStream.tsx src/experiments/console/components/RunStream.test.tsx` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/NodeDivider.test.tsx packages/web/src/experiments/console/components/RunStream.tsx packages/web/src/experiments/console/components/RunStream.test.tsx && git commit -m "feat(web): select unmerged console log rows"` from the repository root.

## Task 9: Compose One Persistent Inspect Pane

**Files:**

- Create: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Create: `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`

**Consumes:** `RunStream`, `RunGraphPanel`, `ConsoleNodeRoom`, workflow DAG-node skill, `useEntity`, projected inspect rows, and injected header/footer content.

**Produces:** One responsive split layout where Log and Graph share one mounted room instance.

- [ ] Write a component harness whose parent can switch `view` from `log` to `graph` while preserving the same selected node.
- [ ] Capture the room region element, switch the harness view, and assert the post-switch region is the same DOM node and the transcript loader call count did not reset.
- [ ] Assert clicking either a divider or graph node invokes the same `onSelectNode` callback.
- [ ] Assert the Log receives the existing filter separately from inspect selection and Artifacts is not accepted as a pane view.
- [ ] Assert workflow-definition loading and error states reach both graph and room without returning an empty silent fallback.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx` from `packages/web` and confirm the component is missing.
- [ ] Implement this exact interface.

```ts
export interface ConsoleInspectPaneProps {
  view: 'log' | 'graph';
  run: Run;
  projectId: string;
  projectCwd: string;
  messages: Message[];
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  logEntries: ConsoleLogEntry[];
  usage: UsageReport | null;
  streamNodeFilter: string;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  showToolCalls: boolean;
  showSystem: boolean;
  logHeader: ReactNode;
  logFooter: ReactNode;
  logScrollRef: RefObject<HTMLDivElement | null>;
  onSelectNode: (nodeId: string, rowId?: string) => void;
  onCloseRoom: () => void;
  loadDefinition: (workflowName: string, cwd: string) => Promise<DagNode[]>;
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
}
```

- [ ] Load definition nodes through `useEntity(K.workflowDagNodes(projectCwd, run.workflow), () => loadDefinition(run.workflow, projectCwd))`.
- [ ] Surface the query error as text in the graph while allowing the room to use deterministic event metadata fallback.
- [ ] Resolve `selectedRow` by exact `selectedLogRowId` and selected node id, falling back to the most recent row for the selected node.
- [ ] Render the Log or Graph in one left column and render exactly one `ConsoleNodeRoom` as the stable right sibling.
- [ ] Pass `onCloseRoom` to `ConsoleNodeRoom.onClose` and do not conditionally replace the room component when `view` changes.
- [ ] Use `flex-col lg:flex-row`; give the room a top border and bounded mobile height below the content, then a 380-pixel right column with a left border at large widths.
- [ ] Keep the Log scroll ref on the Log content and let the Graph own its own scroll viewport.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx` from `packages/web` and confirm all composition tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/components/ConsoleInspectPane.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx && git commit -m "feat(web): compose persistent console inspect pane"` from the repository root.

## Task 10: Integrate URL Selection Without Breaking Log Filtering

**Files:**

- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`

**Consumes:** Expanded `ConsoleRunDetail`, log projection helpers, selection helpers, `ConsoleInspectPane`, existing `StreamToolbar`, existing artifacts view, SSE invalidation, and local-storage filter behavior.

**Produces:** URL-backed inspect selection, unchanged Log filtering, one shared room, and completed-run replay.

- [ ] Extend `RunDetailPage.test.tsx` with a memory-router entry containing `?node=review` and assert the review room is selected after the detail and definition promises resolve.
- [ ] Mount the page with `installHappyDom`, use unique cache ids, stub `globalThis.fetch` by the exact project, run-detail, artifact-list, and workflow-list URLs, and return `conversation_platform_id: null` so the test does not construct an `EventSource`.
- [ ] Restore fetch and invalidate every unique cache key in `afterEach` so this integration coverage does not leak state into another console test.
- [ ] Assert an invalid query falls back according to `resolveInitialInspectSelection`, switching Log to Graph retains the room, selecting a graph node updates `?node=`, and closing the room removes only the `node` parameter.
- [ ] Assert the `All nodes` option still controls Log filtering and does not close or change the selected room.
- [ ] Assert Artifacts remains full width, and returning to Log restores the selected room.
- [ ] Keep the existing environment, lifecycle action, and error-state assertions in the suite.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx` from `packages/web` and confirm the new behavior fails.
- [ ] Replace the page-local narrow `RunDetailView` with the exported `ConsoleRunDetail` type so raw events, projected states, approval metadata, and nullable usage stay type-checked at the query boundary.
- [ ] Rename the current filter state and storage helpers from `selectedNodeId` to `streamNodeFilter` without changing its storage key, `all` default, or option-reset behavior.
- [ ] Add separate `InspectSelection` state, read `location.search` with `readNodeSearchParam`, and keep a ref containing the run id whose initial selection has already been applied.
- [ ] Derive `inspectNodeStates`, `logRows`, and `logEntries` once with `useMemo` in this order.

```ts
const inspectNodeStates = synthesizeLogNodeStates(detail.nodeStates, detail.rawEvents, detail.run.status, detail.approval);
const logRows = buildLogRows(inspectNodeStates, detail.rawEvents);
const logEntries = buildConsoleLogEntries({ rows: logRows, rawEvents: detail.rawEvents, nodeRuns, runStartedAt: detail.run.startedAt });
```

- [ ] Initialize selection once after each new run id loads with `resolveInitialInspectSelection`, using `readApprovalContext(detail.approval)?.nodeId ?? null`, so SSE detail refreshes cannot reopen a room the user closed.
- [ ] Add a separate effect that honors a later non-null valid `?node=` value without treating removal of the parameter as a request to auto-select again.
- [ ] On a Log-row click, store both node id and row id; on a Graph-node click, store the node id and clear row id; on room close, clear both.
- [ ] Update `?node=` with `navigate({ search }, { replace: true })` while preserving unrelated search parameters and encoding through `URLSearchParams`.
- [ ] Keep the existing Log autoscroll effect tied to `logScrollRef` and do not autoscroll the Graph or room.
- [ ] Render `StreamToolbar` once with `streamNodeFilter` and its unchanged callback, render Artifacts through the existing full-width branch, and render `ConsoleInspectPane` only for Log and Graph.
- [ ] Preserve the current `Loading project…` branch and do not mount the pane or issue a definition query until `project.path` is available.
- [ ] Pass `skill.getWorkflowDagNodes` and `skill.listNodeMessages` explicitly to the pane so component tests do not need module replacement.
- [ ] Preserve the current run-start, environment, run-finish, usage, and declared-approval blocks as `logHeader` and `logFooter` content.
- [ ] Preserve SSE invalidation and lifecycle actions exactly; node-message freshness remains the room's live polling responsibility.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx` from `packages/web` and confirm all run-detail tests pass.
- [ ] Run `bun x prettier --write src/experiments/console/routes/RunDetailPage.tsx src/experiments/console/routes/RunDetailPage.test.tsx` from `packages/web`.
- [ ] Run `git add packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx && git commit -m "feat(web): integrate console run node inspection"` from the repository root.

## Task 11: Deep-Link Timeline Status and Lock the Isolation Boundary

**Files:**

- Create: `packages/web/src/experiments/console/components/console-run-href.ts`
- Create: `packages/web/src/experiments/console/components/console-run-href.test.ts`
- Create: `packages/web/src/experiments/console/console-isolation.test.ts`
- Modify: `packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx`
- Modify: `packages/web/src/experiments/console/components/WorkflowDock.tsx`
- Modify: `packages/web/src/experiments/console/README.md`
- Modify: `eslint.config.mjs`

**Consumes:** Console run ids, project ids, current-node ids, source-file imports, and the accepted NFR4 exception.

**Produces:** Encoded node deep links from chat status entries and executable isolation/no-premature-HITL checks.

- [ ] Write link-helper tests for reserved characters in project, run, and node ids, plus a null node id.
- [ ] Run `bun test src/experiments/console/components/console-run-href.test.ts` from `packages/web` and confirm the module is missing.
- [ ] Implement the exact helper.

```ts
export function consoleRunHref(projectId: string, runId: string, nodeId: string | null): string {
  const base = `/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(runId)}`;
  return nodeId === null ? base : `${base}?${new URLSearchParams({ node: nodeId }).toString()}`;
}
```

- [ ] Replace the run-detail href in `ConsoleWorkflowResultCard` with `consoleRunHref(run.projectId, run.id, run.currentNode ?? null)` while preserving its existing content and completed replay behavior.
- [ ] Replace running-run and paused-approval hrefs in `WorkflowDock` with the helper, using `run.currentNode ?? null` for running status and `run.approval?.nodeId ?? run.currentNode ?? null` for paused status.
- [ ] Write `console-isolation.test.ts` to recursively inspect production `.ts` and `.tsx` files under `src/experiments/console`, excluding tests.
- [ ] Assert no production file imports `@/components`, legacy stores, contexts, routes, hooks, `@tanstack/react-query`, or runtime values from `@/lib/api` or `@/lib/api.generated`.
- [ ] Allow type-only imports from `@/lib/api.generated` and runtime imports from exactly `@/lib/run-graph`.
- [ ] Normalize source whitespace, then assert `ConsoleWorkflowResultCard.tsx` and both `WorkflowDock.tsx` status-card branches import and call `consoleRunHref` with the planned current-node or approval-node expression so the pure link test also has wiring proof.
- [ ] Assert the new inspect and room production files contain none of the production identifiers `pending_interactions`, `AskCard`, or `ChatComposer`, and none of the user-facing strings `Waiting on you` or `awaiting` outside `inspect-status.ts`.
- [ ] Do not reject the literal `AskHuman` inside generic transcript data because tool history must remain replayable.
- [ ] Run `bun test src/experiments/console/console-isolation.test.ts src/experiments/console/components/console-run-href.test.ts` from `packages/web` and confirm the checks pass.
- [ ] Update the console README with the Log-filter versus inspect-selection distinction, the shared geometry exception, node-message polling rule, and explicit handoff of interactive Ask UI to Epic 6.
- [ ] Update only the explanatory comment beside the existing ESLint console-isolation rules; do not broaden an import pattern or disable a rule.
- [ ] Run `bun x prettier --write src/experiments/console/components/console-run-href.ts src/experiments/console/components/console-run-href.test.ts src/experiments/console/console-isolation.test.ts src/experiments/console/components/ConsoleWorkflowResultCard.tsx src/experiments/console/components/WorkflowDock.tsx src/experiments/console/README.md` from `packages/web`.
- [ ] Run `bun x prettier --write eslint.config.mjs` from the repository root.
- [ ] Run `NODE_ENV=development bun test src/experiments/console/` from `packages/web` and confirm the complete console suite passes.
- [ ] Run `git add packages/web/src/experiments/console/components/console-run-href.ts packages/web/src/experiments/console/components/console-run-href.test.ts packages/web/src/experiments/console/console-isolation.test.ts packages/web/src/experiments/console/components/ConsoleWorkflowResultCard.tsx packages/web/src/experiments/console/components/WorkflowDock.tsx packages/web/src/experiments/console/README.md eslint.config.mjs && git commit -m "feat(web): deep-link console run status entries"` from the repository root.

## Task 12: Validate, Record Evidence, and Close the Epic

**Files:**

- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Consumes:** The completed implementation, focused console test output, repository validation output, issue `#85`, and the sprint tracker.

**Produces:** Reproducible completion evidence and tracker state that changes only after green validation.

- [ ] Run `NODE_ENV=development bun test src/experiments/console/` from `packages/web` and retain the passing test count and command for the PR Validation section.
- [ ] Run `bun run validate` from the repository root and fix failures in the task that introduced them rather than weakening validation.
- [ ] Record the focused command, `bun run validate`, test counts, and outcomes in the pull request's `Validation` section before closing issue `#85`.
- [ ] Change `5-5-inspect-a-run-as-nodes-on-command-center` from `backlog` to `done` in `sprint-status.yaml`.
- [ ] Change `epic-5` from `backlog` to `done` only after confirming Stories 5.1 through 5.5 are all `done`.
- [ ] Preserve every Epic 6 status exactly as found because interactive Ask UI is outside this story.
- [ ] Run `bun run format:check` from the repository root after the tracker edit.
- [ ] Run `git diff --check` from the repository root and confirm it reports no whitespace errors.
- [ ] Inspect `git diff --stat` and `git status --short` and confirm no generated API file, server route, schema, workflow YAML engine file, or unrelated user file changed.
- [ ] Commit the tracker-only change with `git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml && git commit -m "docs: complete workflow run inspect epic"`.

## Final Verification Checklist

- [ ] `StreamToolbar` still presents `All nodes` and remains a Log filter rather than a room selector.
- [ ] The Log displays distinct ordinary, loop-iteration, and route-decision rows in chronological order.
- [ ] Log-row, Graph-node, and status-entry selection converge on one URL-backed node id.
- [ ] One room instance stays mounted when switching between Log and Graph.
- [ ] Agent message loading occurs only for an agent room and stops polling when the run becomes terminal.
- [ ] Completed transcripts and non-agent room data remain replayable without a live server stream.
- [ ] `awaiting` is presented as `running`, and no Ask card, composer, pending-interaction slot, or waiting-on-you treatment exists.
- [ ] Usage appears once per node even when the node produces multiple Log rows.
- [ ] Artifacts remain full width, and existing approval, lifecycle, environment, filtering, and SSE behavior remains intact.
- [ ] Console production imports pass both ESLint isolation and the dedicated source-boundary test.
- [ ] The PR uses `.github/pull_request_template.md`, includes `Closes #85`, and records focused and full validation evidence.

## Implementation Handoff

Use `superpowers:subagent-driven-development` when separate task commits can be reviewed between tasks, or use `superpowers:executing-plans` for one sequential implementation session.
Do not start Task 12 tracker changes until Tasks 1 through 11 are implemented and all validation is green.
