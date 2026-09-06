# Node Room From Chat Timeline (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task.
> Track progress with the checkbox steps below.

**Goal:** Replace the legacy run Chat tab's full `ChatInterface` with a user-turn plus node-status timeline that opens the same mounted per-type node room as Graph and Logs, without AskHuman chrome.

**Architecture:** Keep `LegacyGraphLogsPane` as the single inspect shell for Graph, Logs, and Chat.
The right-hand `LegacyNodeRoom` stays mounted across those three tabs.
Only the left navigation child switches.
Chat left navigation is a new `ChatTimeline` fed by a pure merger of parent-conversation user messages and run node-status events.
A node-status click resolves to a `LogRow` and uses the existing Graph/Logs selection path.

**Tech stack:** Bun, strict TypeScript, React 19, TanStack Query, happy-dom, react-dom/server, and bun:test.

**Story authority:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 5.4, FR3 (timeline + status click, not Ask card), UX-DR7.

**Approved design authority:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` Direction A and `ChatTimeline`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js` `addChat`/`openPanel`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-3 and AD-4 isolation.

**Issue:** https://github.com/anhle128/Archon/issues/84

## Scope and Non-Goals

- Implement only Story 5.4 on the legacy `WorkflowExecution` Chat tab.
- Keep Graph and Logs behavior from Stories 5.1 through 5.3, including unmerged Logs rows and the shared `LegacyNodeRoom`.
- Replace the run Chat tab body so it shows the operator's parent-conversation user turns plus node-status entries in chronological order.
- Clicking a node-status entry must open the same per-type room as Logs or Graph for that node.
- Keep the operator on the Chat tab when they click a node-status entry.
- Do not switch `activeView` to `graph` as a substitute for opening the room.
- Keep one mounted `LegacyNodeRoom` across Graph, Logs, and Chat.
- Do not inline the agent transcript, tool cards, or worker-conversation stream in the Chat timeline.
- Do not add an Ask card, an empty Ask slot, awaiting chrome, or "waiting on you" copy.
- Do not render `node_awaiting` or `interaction_resolved` as timeline entries.
- Do not display the substring `awaiting` anywhere in the Chat timeline.
- The composer and Reply control are not an Ask channel.
- This story does not add a Chat-tab composer.
- Keep `/legacy/chat/:id` `ChatInterface` unchanged.
- Do not implement the console timeline.
- Do not import any legacy React component into `packages/web/src/experiments/console/`.
- Do not import `@archon/workflows` from `@archon/web`.
- Do not change the engine, database, API routes, workflow schemas, workflow YAML, provider behavior, CLI, chat orchestrator, or `manage_run`.
- Do not regenerate `packages/web/src/lib/api.generated.d.ts`.
- Sequential non-DAG runs continue to use the merged `WorkflowLogs` or `StepLogs` panel.
- Keep the Chat tab gated on `parentPlatformId` in `DagRunTabs`.
- Do not introduce the TypeScript `any` type.
- Use only existing design tokens and existing dependencies.
- Do not run `bun test` from the repository root.
- For every behavior change, write and run the failing test first, confirm that it fails for the missing behavior, implement the minimum production change, and refactor only while green.
- Do not update sprint tracking until all focused and repository validation succeeds.

## Verified Repository Baseline

- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:49-50` marks Story 5.3 done and Story 5.4 backlog.
- Issue 84 requires the Story 5.4 acceptance criteria, focused test evidence, and the sprint-status transition before close.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:6-30` already has a Chat tab that renders only when `parentPlatformId` is set.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:235-246` returns `'chat'` for DAG Chat with a parent and `'graph-logs-pane'` for Graph, Logs, and Chat without a parent.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:827-831` mounts full `ChatInterface` against `parentPlatformId` with `cwdOverride={workingPath}`.
- `packages/web/src/components/workflows/WorkflowExecution.test.tsx:136-153` currently asserts that DAG Chat with a parent returns `'chat'`.
- `packages/web/src/components/chat/ChatInterface.tsx` is the standalone conversation product used by `/legacy/chat/:id` and must remain.
- `packages/web/src/lib/api.ts:221-227` already exposes `getMessages(conversationId, limit = 200)` returning `MessageResponse[]`.
- `packages/web/src/lib/api.generated.d.ts:4209-4218` defines `Message` as `{ id, conversation_id, role: 'user' | 'assistant', content, metadata, user_id, created_at }`.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:22-43` accepts `activeView: 'graph' | 'logs'` and owns `selectedLogRowId` plus one `LegacyNodeRoom`.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:166-174` treats a graph click as a node-level selection and a Logs click as an exact `LogRow` selection.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:176-213` keeps Graph and Logs in one `ResizablePanelGroup` with the room on the right.
- `packages/web/src/components/workflows/resolve-graph-room-row.ts:11-42` maps a node id to an ordinary row, else the last matching iteration row, else a synthetic pending row.
- `packages/web/src/components/workflows/build-log-rows.ts:9-22` is the complete `LogRow` selection contract.
- `packages/web/src/components/workflows/build-log-rows.ts:38-88` already understands loop iterations and `node_routed` execution sequences.
- `packages/web/src/components/workflows/NodeRunList.tsx:20-55` renders Logs rows as buttons with `aria-current` and status badges.
- `packages/web/src/lib/format.ts:16-25` already formats timestamps via `formatStarted`.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:264-272` chooses Direction A: tabs stay and the right panel is the node room.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:302` maps the NodePanel as shared across Graph, Logs, and Chat.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md:462-466` specifies `ChatTimeline` as user turns plus `NodeStatusEntry` rows and says the full agent transcript is never inlined.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js:704-715` and `918-923` open the shared side panel from a chat node chip without switching tabs.
- `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/index.html:91-113` keeps a Chat stream plus a shared node panel for all tabs.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx:201-206` already forbids `AskHuman`, `awaiting`, and `waiting-on-you` copy.
- `packages/web/package.json:11` runs `bun test src/components/` as part of the package test script.

## Design Decisions

1. Keep the operator on the Chat tab.
The mockup `openPanel` call and Direction A share the right-hand room.
Switching to Graph would replace the Chat surface and violate UX-DR7's "panel meaning does not switch" for this door.

2. Fold Chat into `LegacyGraphLogsPane` instead of keeping a separate `'chat'` body.
Unmounting the pane on Chat currently drops `selectedLogRowId` and a second room instance.
Story 5.4 requires the three doors to select the same node and the same per-type chrome.

3. User turns come only from parent-conversation messages with `role === 'user'`.
Assistant rows, tool metadata, worker-conversation messages, and workflow-status prose stay out of this timeline.

4. Node-status entries come from run events, not from `remote_agent_messages`.
Each qualifying lifecycle event is its own chronological entry, matching the mockup's started-then-completed chips.

5. A node-status click is a `LogRow` selection.
Loop-iteration and route-iteration events preserve that selection, matching Logs.
Ordinary lifecycle events use `resolveGraphRoomRow`, matching Graph.

6. Do not add a Chat-tab composer in this story.
Story 5.4 is inspect-only.
Operators continue to message the parent conversation from `/legacy/chat/:id`.

7. Keep the Chat tab hidden when `parentPlatformId` is null.
CLI-created runs have no parent turns, and `DagRunTabs` already encodes that gate.

8. Poll parent messages with TanStack Query while the run is live, using the same 3000 ms interval as GET run.
Do not attach ChatInterface SSE to this tab.

9. Never emit or label `awaiting` on this timeline.
`expectNoAskHumanChrome` is the characterization contract for Epic 5 inspect chrome.

## Authoritative Interfaces

### Chat timeline model

Create `packages/web/src/components/workflows/build-chat-timeline.ts` with these exact contracts.

```ts
import type { MessageResponse, WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

import type { LogRowSelection } from './build-log-rows';

export type ChatTimelineNodeStatus = Exclude<WorkflowNodeStateResponse['status'], 'awaiting'>;

export type ChatTimelineEntry =
  | {
      kind: 'user';
      id: string;
      createdAt: string;
      content: string;
    }
  | {
      kind: 'node_status';
      id: string;
      createdAt: string;
      nodeId: string;
      label: string;
      status: ChatTimelineNodeStatus;
      detail: string;
      selection: LogRowSelection;
    };

export function buildChatTimeline(input: {
  messages: readonly MessageResponse[];
  events: readonly WorkflowEventResponse[];
  nodeStates: readonly WorkflowNodeStateResponse[];
}): ChatTimelineEntry[];
```

User-turn rules:

- Include a message only when `role === 'user'`.
- Skip a user message whose trimmed `content` is empty.
- Copy `id`, `created_at`, and `content` verbatim.
- Do not parse `metadata`.
- Do not include assistant messages.

Node-status event types, and only these:

- `node_started` → status `running`, detail `started`, selection `{ kind: 'node' }`
- `node_completed` → status `completed`, detail `completed`, selection `{ kind: 'node' }`
- `node_failed` → status `failed`, detail `failed`, selection `{ kind: 'node' }`
- `node_skipped` and `node_skipped_prior_success` → status `skipped`, detail `skipped`, selection `{ kind: 'node' }`
- `approval_requested` → status `running`, detail `gate requested`, selection `{ kind: 'node' }`
- `loop_iteration_started` → status `running`, detail `iteration N started`, selection `{ kind: 'loop_iteration', iteration: N }`
- `loop_iteration_completed` → status `completed`, detail `iteration N completed`, selection `{ kind: 'loop_iteration', iteration: N }`
- `loop_iteration_failed` → status `failed`, detail `iteration N failed`, selection `{ kind: 'loop_iteration', iteration: N }`
- `node_routed` with a positive safe-integer `execution_seq` → status `completed`, detail `routed {outcome} → {to}`, selection `{ kind: 'route_iteration', executionSeq }`
- `node_routed` without a valid `execution_seq` → status `completed`, detail `routed {outcome} → {to}` using `'unknown'` for a missing field, selection `{ kind: 'node' }`

Skip an event when all of the following fail to yield a node id: non-empty `step_name`, then non-empty string `data.nodeId`.
Skip loop-iteration events whose `data.iteration` is not a safe integer `>= 1`.
Skip `tool_called`, `tool_completed`, `workflow_artifact`, `node_awaiting`, `interaction_resolved`, and every other event type.

Label rules:

- Prefer `nodeStates` `name` for that `nodeId`, otherwise the `nodeId`.
- For `loop_iteration`, append a space, `×`, and the iteration number, matching `build-log-rows.ts`.
- For `route_iteration`, append a space, `#`, and the execution sequence, matching `build-log-rows.ts`.

Sort rules:

- Convert `createdAt` with `ensureUtc` and `Date.parse`.
- Treat a non-finite timestamp as `0`.
- Sort ascending by timestamp, then `kind` with `user` before `node_status`, then original encounter index.
- Do not sort events by `event_order`.

### Timeline to LogRow

Create `packages/web/src/components/workflows/resolve-timeline-room-row.ts` with this exact contract.

```ts
import type { LogRow } from './build-log-rows';
import type { ChatTimelineEntry } from './build-chat-timeline';
import type { GraphRoomLiveStatus } from './resolve-graph-room-row';

export function resolveTimelineRoomRow(input: {
  rows: readonly LogRow[];
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow;
```

Resolution order:

1. Find the last `LogRow` whose `nodeId` equals `entry.nodeId` and whose `selection` deeply equals `entry.selection`.
2. If none, return `resolveGraphRoomRow({ rows, nodeId: entry.nodeId, liveStatus })`.
3. `resolveGraphRoomRow` never returns null for a non-null node id, so this function always returns a `LogRow`.

### Chat timeline view

Create `packages/web/src/components/workflows/ChatTimeline.tsx` with this exact public contract.

```ts
import type { ChatTimelineEntry } from './build-chat-timeline';

export interface ChatTimelineProps {
  entries: readonly ChatTimelineEntry[];
  selectedRowId: string | null;
  onSelectNodeStatus: (entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>) => void;
  loading: boolean;
  error: string | null;
}

export function ChatTimeline(props: ChatTimelineProps): React.ReactElement;
```

Render rules:

- The root is `<div aria-label="Run chat timeline" className="flex h-full min-h-0 flex-col overflow-auto p-3">`.
- When `loading` is true and `entries` is empty, show exactly `Loading conversation turns…`.
- When `error` is non-null, show that error string in `text-error` and still render any entries.
- When not loading, there is no error, and `entries` is empty, show exactly `No conversation turns or node-status entries yet.`
- Each `user` entry is a non-button `<div>` with classes `ml-auto max-w-[80%] rounded-lg bg-accent/20 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap`.
- Do not render user content as markdown.
- Each `node_status` entry is a `<button type="button">`.
- The selected node-status button is the one whose `id` equals `selectedRowId` and it has `aria-current="true"`.
- The button content, in order, is: node `label`, `detail`, a status badge using the same token classes as `NodeRunList` for `pending`/`running`/`completed`/`failed`/`skipped`, `formatStarted(createdAt)`, and a `ChevronRight` icon from `lucide-react` with `className="h-3 w-3 text-text-tertiary"`.
- Clicking a user bubble does nothing.
- There is no `<form>`, no text input, no Send button, and no Reply control.

### Pane extension

Update `LegacyGraphLogsPaneProps` in `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` to this exact added surface.

```ts
export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs' | 'chat';
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  parentPlatformId: string | null;
  loadParentMessages: (conversationId: string) => Promise<MessageResponse[]>;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}
```

Chat data loading inside the pane:

- Enable the parent-message query only when `activeView === 'chat'` and `parentPlatformId !== null`.
- Query key is `['runChatMessages', parentPlatformId]`.
- `queryFn` calls `loadParentMessages(parentPlatformId)`.
- `refetchInterval` is `3000` when `isLive` is true, otherwise `false`.
- `retry` is `false`.
- On query error, pass `error` as the Error message or `'Failed to load conversation turns.'` and treat messages as `[]`.
- Build entries with `buildChatTimeline({ messages: data ?? [], events, nodeStates: visibleNodeStates })`.

Left-pane switch:

- `graph` keeps `renderGraph`.
- `logs` keeps `NodeRunList`.
- `chat` renders `ChatTimeline`.

Node-status handler:

```ts
const handleNodeStatusSelect = (
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>
): void => {
  const row = resolveTimelineRoomRow({
    rows,
    entry,
    liveStatus: visibleNodeStates,
  });
  setSelectedLogRowId(row.id);
  onSelectNode(row.nodeId);
};
```

Pass `selectedRowId={selectedRow?.id ?? null}` into `ChatTimeline`.

### Execution body

Replace `resolveWorkflowExecutionBody` in `packages/web/src/components/workflows/WorkflowExecution.tsx` with:

```ts
export type WorkflowExecutionBody = 'graph-logs-pane' | 'source-control' | 'sequential';

export function resolveWorkflowExecutionBody(input: {
  isDag: boolean;
  activeView: WorkflowRunView;
}): WorkflowExecutionBody {
  if (!input.isDag) return 'sequential';
  if (input.activeView === 'source-control') return 'source-control';
  return 'graph-logs-pane';
}
```

DAG Chat therefore keeps `LegacyGraphLogsPane` mounted.
Pass `activeView={activeView === 'chat' ? 'chat' : activeView === 'graph' ? 'graph' : 'logs'}`.
Pass `parentPlatformId={parentPlatformId}` and `loadParentMessages={getMessages}`.
Remove the `ChatInterface` import and the `'chat'` render branch.
If `workingPath` becomes unused after that removal, delete the local binding and keep the field on `WorkflowRunQueryData` only if still required by the query mapper.

## File Map

| File | Action | Justification |
| --- | --- | --- |
| `packages/web/src/components/workflows/build-chat-timeline.ts` | CREATE | Pure user-turn plus node-status merger |
| `packages/web/src/components/workflows/build-chat-timeline.test.ts` | CREATE | RED/GREEN contract for the merger |
| `packages/web/src/components/workflows/resolve-timeline-room-row.ts` | CREATE | Map a node-status entry onto a `LogRow` |
| `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` | CREATE | RED/GREEN contract for that mapping |
| `packages/web/src/components/workflows/ChatTimeline.tsx` | CREATE | Presentational Chat tab left pane |
| `packages/web/src/components/workflows/ChatTimeline.test.tsx` | CREATE | Markup contract, no composer, no Ask chrome |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` | UPDATE | Third left view plus parent-message query |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | UPDATE | Three-door same-room characterization |
| `packages/web/src/components/workflows/WorkflowExecution.tsx` | UPDATE | Keep the pane mounted for Chat; drop `ChatInterface` |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | UPDATE | Chat with a parent returns `graph-logs-pane` |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | UPDATE | Mark Story 5.4 done after validation |

Do not modify `packages/web/src/components/chat/ChatInterface.tsx`.
Do not modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
Do not modify `packages/web/src/lib/run-graph/`.
Do not modify `packages/web/src/experiments/console/`.

## Step-by-Step Tasks

### Task 1: CREATE `build-chat-timeline.ts`

**Action:** CREATE
**Details:** Pure merger of parent user messages and node-status events.
**Mirror:** `packages/web/src/components/workflows/build-log-rows.ts` and `packages/web/src/components/workflows/resolve-graph-room-row.test.ts`
**Validate:** `bun test src/components/workflows/build-chat-timeline.test.ts` from `packages/web`

- [ ] **Step 1: Write the failing tests.**

Create `packages/web/src/components/workflows/build-chat-timeline.test.ts` with literal fixtures and these cases.

1. Empty messages and events yield `[]`.
2. Only `role: 'user'` messages become `kind: 'user'` entries, in input order when timestamps match.
3. Assistant messages are omitted even when they sit between user messages.
4. A user message whose content is `'   '` is omitted.
5. `node_started`, `node_completed`, `node_failed`, `node_skipped`, and `approval_requested` become node-status entries with the mapped status, detail, and `{ kind: 'node' }`.
6. A loop-iteration triple with `iteration: 2` becomes three entries labelled `{name} ×2` with the three details `iteration 2 started`, `iteration 2 completed`, and `iteration 2 failed`.
7. A `node_routed` event with `execution_seq: 4`, `outcome: 'negative'`, and `to: 'fix'` becomes detail `routed negative → fix` and selection `{ kind: 'route_iteration', executionSeq: 4 }`.
8. A `node_routed` event missing `execution_seq` uses selection `{ kind: 'node' }` and substitutes `'unknown'` for missing outcome or target.
9. `tool_called`, `node_awaiting`, and `interaction_resolved` are omitted.
10. An event with empty `step_name` and `data.nodeId: 'review'` still emits a node-status entry for `review`.
11. An event with neither `step_name` nor `data.nodeId` is omitted.
12. A loop-iteration event with `iteration: 0` is omitted.
13. Node labels prefer `nodeStates[].name` over the raw id.
14. A user message at `T` sorts before a node-status event at the same `T`.
15. A later timestamp sorts after an earlier timestamp regardless of array order.
16. No entry has `status: 'awaiting'` and no `detail` contains `awaiting`.

Do not create the production module yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/build-chat-timeline.test.ts
```

Expected: fail because `./build-chat-timeline` cannot be resolved.

- [ ] **Step 3: Implement the minimum production module.**

Create `packages/web/src/components/workflows/build-chat-timeline.ts` to the Authoritative Interfaces contract.
Import `ensureUtc` from `@/lib/format`.
Do not import React.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.
Expected: all cases pass.

- [ ] **Step 5: Refactor only while green.**

Do not add composer data, assistant rows, or `awaiting` mapping.
Re-run the same command.

### Task 2: CREATE `resolve-timeline-room-row.ts`

**Action:** CREATE
**Details:** Map a node-status entry onto the existing `LogRow` selection contract.
**Mirror:** `packages/web/src/components/workflows/resolve-graph-room-row.ts`
**Validate:** `bun test src/components/workflows/resolve-timeline-room-row.test.ts` from `packages/web`

- [ ] **Step 1: Write the failing tests.**

Create `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` with these cases.

1. An ordinary `{ kind: 'node' }` entry returns the last ordinary `LogRow` for that node, not an earlier iteration row.
2. A `{ kind: 'loop_iteration', iteration: 2 }` entry returns the matching iteration row even when an ordinary row for the same node exists.
3. A `{ kind: 'route_iteration', executionSeq: 4 }` entry returns the matching route row.
4. A loop-iteration entry with no matching row falls through to `resolveGraphRoomRow` and therefore the last matching row or a synthetic pending row.
5. Rows for other nodes are ignored.
6. The returned row's `nodeId` always equals `entry.nodeId`.

Do not create the production module yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/resolve-timeline-room-row.test.ts
```

Expected: fail because `./resolve-timeline-room-row` cannot be resolved.

- [ ] **Step 3: Implement the minimum production module.**

Create `packages/web/src/components/workflows/resolve-timeline-room-row.ts` to the Authoritative Interfaces contract.
Reuse `resolveGraphRoomRow`.
Do not duplicate synthetic-row construction.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Keep selection equality explicit for the three `LogRowSelection` variants.
Re-run the same command.

### Task 3: CREATE `ChatTimeline.tsx`

**Action:** CREATE
**Details:** Presentational timeline with user bubbles and node-status buttons.
**Mirror:** `packages/web/src/components/workflows/NodeRunList.tsx` and `NodeRunList.test.tsx`
**Validate:** `bun test src/components/workflows/ChatTimeline.test.tsx` from `packages/web`

- [ ] **Step 1: Write the failing markup tests.**

Create `packages/web/src/components/workflows/ChatTimeline.test.tsx` using `renderToStaticMarkup`.

Cover:

1. The root has `aria-label="Run chat timeline"`.
2. Empty non-loading markup contains exactly the empty copy `No conversation turns or node-status entries yet.`
3. `loading: true` with empty entries contains `Loading conversation turns…` and no node-status button.
4. A non-null `error` is visible even when entries exist.
5. A user entry renders its content and does not render a `<button>`.
6. A node-status entry renders a `<button type="button">` containing `label`, `detail`, `status`, and a formatted `formatStarted` timestamp.
7. The selected node-status button has `aria-current="true"` and there is only one such attribute.
8. Markup does not contain `AskHuman`, `awaiting`, `waiting-on-you`, `<form`, `placeholder="Message`, or `Send`.
9. Markup does not contain assistant content supplied only as a negative fixture in the test file comments; the component simply never receives assistant entries.

Do not create the production component yet.

- [ ] **Step 2: Run the tests and confirm they fail for the missing module.**

Run:

```bash
cd packages/web && bun test src/components/workflows/ChatTimeline.test.tsx
```

Expected: fail because `./ChatTimeline` cannot be resolved.

- [ ] **Step 3: Implement the minimum production component.**

Create `packages/web/src/components/workflows/ChatTimeline.tsx` to the Authoritative Interfaces contract.
Reuse `cn` from `@/lib/utils` if class joining is needed.
Copy the non-awaiting status badge classes from `NodeRunList.tsx` locally.
Do not import `ChatInterface`, `MessageList`, or `MessageInput`.

- [ ] **Step 4: Re-run the tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Do not extract a shared badge module unless the same object would otherwise be copied a third time after this story.
Re-run the same command.

### Task 4: UPDATE `LegacyGraphLogsPane` for the Chat door

**Action:** UPDATE
**Details:** Add `activeView: 'chat'`, parent-message loading, and node-status selection that shares the mounted room.
**Mirror:** `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` Graph/Logs same-room tests
**Validate:** `NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`

- [ ] **Step 1: Write the failing pane tests.**

Extend `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.

Update `PaneHarness` and `renderLogs` so `activeView` accepts `'chat'` and so the harness passes `parentPlatformId` plus `loadParentMessages`.
Default `parentPlatformId` to `'parent-1'` and default `loadParentMessages` to `async () => []` in existing tests so current Graph/Logs cases stay green after the prop is required.

Add these new tests:

1. `activeView: 'chat'` does not render `aria-label="Node runs"` and does not render `data-testid="injected-graph"`.
2. `activeView: 'chat'` renders `aria-label="Run chat timeline"`.
3. Injected parent user message content appears in the timeline and is not a button.
4. A `node_started` event for `setup` appears as a node-status button.
5. Clicking that setup node-status button opens `[aria-label="setup room"]` and does not call `loadMessages`.
6. Clicking a command node-status button for `review` opens `[aria-label="review room"]` and calls `loadMessages` once with `['run-1', 'review']`.
7. Clicking a loop-iteration node-status button preserves that iteration the same way the existing Logs iteration test does.
8. Click graph setup, switch to Chat, then switch to Logs: the setup room region is still present and `loadMessages` is not called for bash.
9. Click a Chat review node-status, then switch to Graph: the review room region is still present and `loadMessages` is not recalled.
10. Clicking the user bubble does not change the selected room and does not call `loadMessages`.
11. When `loadParentMessages` rejects, the error copy is visible and node-status buttons still render.
12. Chat view passes `expectNoAskHumanChrome`.
13. Chat view markup contains neither `<form` nor `ChatInterface` conversation chrome such as a Send control.

These tests must fail before production wiring because `activeView: 'chat'` currently falls through to Logs.

- [ ] **Step 2: Run the pane tests and confirm the new cases fail.**

Run:

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

Expected: existing Graph/Logs tests still compile only after the harness accepts the new required props; the new Chat cases fail because chat still renders `NodeRunList` or does not load parent messages.

If the file cannot typecheck until props exist, add the props to the component in Step 3 immediately after observing the Chat-view behavioral failures, but do not implement Chat rendering before the failing assertions exist.

- [ ] **Step 3: Implement the minimum pane production change.**

Update `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` to the Authoritative Interfaces pane contract.
Import `useQuery` from `@tanstack/react-query`.
Import `getMessages` type-only via `MessageResponse` and the injected `loadParentMessages`.
Do not import `ChatInterface`.

- [ ] **Step 4: Re-run the pane tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Keep Graph click clearing `selectedLogRowId`.
Keep Logs click setting `selectedLogRowId` to `row.id`.
Keep Chat node-status click setting `selectedLogRowId` from `resolveTimelineRoomRow`.
Re-run the same command.

### Task 5: UPDATE `WorkflowExecution` composition

**Action:** UPDATE
**Details:** Keep `LegacyGraphLogsPane` mounted for Chat and stop mounting `ChatInterface` on the run view.
**Mirror:** `packages/web/src/components/workflows/WorkflowExecution.test.tsx` `resolveWorkflowExecutionBody` block
**Validate:** `bun test src/components/workflows/WorkflowExecution.test.tsx` from `packages/web`

- [ ] **Step 1: Write the failing composition tests.**

In `packages/web/src/components/workflows/WorkflowExecution.test.tsx`:

1. Change `DAG Chat with a parent returns chat` so the same inputs return `'graph-logs-pane'`.
2. Keep `DAG Chat without a parent falls back to the graph-logs pane` returning `'graph-logs-pane'`.
3. Stop passing `parentPlatformId` into `resolveWorkflowExecutionBody`.
4. Add an assertion that `'chat'` is not a `WorkflowExecutionBody` by expecting the function never to return the string `'chat'` for any `WorkflowRunView`.

These tests fail until the resolver drops the `'chat'` branch.

- [ ] **Step 2: Run the composition tests and confirm they fail.**

Run:

```bash
cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx
```

Expected: the parent-chat case still returns `'chat'`.

- [ ] **Step 3: Implement the minimum production wiring.**

Update `packages/web/src/components/workflows/WorkflowExecution.tsx`:

- Replace `resolveWorkflowExecutionBody` with the Authoritative Interfaces version.
- Pass `activeView` `'chat' | 'graph' | 'logs'` through to `LegacyGraphLogsPane`.
- Pass `parentPlatformId` and `loadParentMessages={getMessages}`.
- Delete the `body === 'chat'` branch.
- Delete the `ChatInterface` import.
- Remove unused `workingPath` locals if ESLint reports them unused.
- Leave `DagRunTabs` Chat visibility unchanged.

- [ ] **Step 4: Re-run the composition tests and confirm they pass.**

Run the same command as Step 2.

- [ ] **Step 5: Refactor only while green.**

Confirm `ChatInterface` still exists for `/legacy/chat`.
Run:

```bash
cd packages/web && bun test src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/source-control/dag-run-tabs.test.tsx
```

Expected: Chat tab still renders in `DagRunTabs` when `parentPlatformId` is set and is absent when it is null.

### Task 6: Validate and mark the story done

**Action:** UPDATE sprint status only after the commands below pass.
**Details:** Characterization evidence plus repository validation.
**Validate:** the commands in Validation Commands

- [ ] **Step 1: Run the focused Story 5.4 tests together.**

```bash
cd packages/web && bun test src/components/workflows/build-chat-timeline.test.ts src/components/workflows/resolve-timeline-room-row.test.ts src/components/workflows/ChatTimeline.test.tsx src/components/workflows/WorkflowExecution.test.tsx && NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run repository validation from the repo root.**

```bash
bun run validate
```

Expected: every validate step passes.
Do not run `bun test` from the repository root as a substitute.

- [ ] **Step 3: Update sprint tracking.**

In `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`, set `5-4-open-the-node-room-from-the-chat-timeline-legacy` to `done`.
Set `last_updated` to the local completion timestamp.
Do not mark `epic-5` done.
Story 5.5 remains `backlog`.

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `packages/web/src/components/workflows/build-chat-timeline.test.ts` | User-only turns, omitted assistant/tool/awaiting events, iteration labels, chronological merge | FR3 timeline content |
| `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts` | Ordinary, loop, route, and fallback mapping | Same room as Logs/Graph |
| `packages/web/src/components/workflows/ChatTimeline.test.tsx` | Accessible buttons, no composer, no Ask chrome | UX-DR7 inspect chrome |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | Chat door, three-door persistence, user-bubble non-selection, parent-message error | Story 5.4 AC |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | Chat uses `graph-logs-pane` | Shared pane mount |

### Edge Cases Checklist

- [ ] Parent conversation has assistant and user rows; only user rows appear.
- [ ] Parent message fetch fails; node-status entries still open rooms.
- [ ] Chat tab hidden without `parentPlatformId`; resolver still returns `graph-logs-pane`.
- [ ] Loop iteration clicked from Chat survives a switch to Logs.
- [ ] Graph click after a Chat iteration click resets to the canonical node row, matching existing Graph behavior that clears `selectedLogRowId`.
- [ ] No Ask card, empty Ask slot, or awaiting copy.
- [ ] `/legacy/chat/:id` is untouched.

## Validation Commands

From `packages/web`:

```bash
bun test src/components/workflows/build-chat-timeline.test.ts
bun test src/components/workflows/resolve-timeline-room-row.test.ts
bun test src/components/workflows/ChatTimeline.test.tsx
bun test src/components/workflows/WorkflowExecution.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
```

From the repository root:

```bash
bun run type-check
bun run lint --max-warnings 0
bun run validate
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- [ ] On a live or historical DAG run with `parentPlatformId`, the Chat tab shows user turns and node-status entries in chronological order.
- [ ] The Chat tab does not inline the agent transcript or the worker conversation.
- [ ] Clicking a node-status entry opens the same `LegacyNodeRoom` chrome as Logs or Graph for that node.
- [ ] Clicking Logs, Graph, and a timeline status for the same node in any order keeps the same node and the same per-type chrome.
- [ ] The Chat tab does not switch to Graph in order to show the room.
- [ ] Composer/Reply is not an Ask channel, and this story adds no Chat-tab composer.
- [ ] There is no Ask card, empty Ask slot, or awaiting chrome.
- [ ] Console timeline is not implemented.
- [ ] Focused tests above pass.
- [ ] `bun run validate` passes.
- [ ] `5-4-open-the-node-room-from-the-chat-timeline-legacy` is `done` in `sprint-status.yaml`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Operators lose the run-view composer they had via `ChatInterface` | Med | Low | Provisional default is inspect-only; `/legacy/chat/:id` remains; Open Questions records the default |
| Parent messages and run events use clocks that do not interleave as humans expect | Low | Med | Sort by `ensureUtc` timestamps with user-before-status tie-break; do not invent a second clock |
| `expectNoAskHumanChrome` fails if any status text says `awaiting` | Med | High | Timeline status union excludes `awaiting`; skip `node_awaiting` events |
| Required new pane props break existing Graph/Logs tests | High | Low | Default the new harness fields in the same test file before asserting Chat behavior |

## Open Questions

1. Should the Chat tab keep a non-HITL composer that posts to the parent conversation?
Provisional default: no composer in this story.
The mockup includes a composer, but Story 5.4 is inspect-only and Epic 5 forbids Ask chrome.
Operators continue to send parent-conversation turns from `/legacy/chat/:id`.
Revisit only if a later story explicitly restores run-view messaging without making Reply an Ask channel.
