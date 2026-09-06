# Node Room From Chat Timeline (Legacy) Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md`
Derived slug: `2026-09-06-node-room-from-chat-timeline-legacy`

## Overview

Story 5.4 replaces the legacy run Chat tab's full `ChatInterface` in `WorkflowExecution` with a user-turn plus node-status timeline that opens the same mounted per-type node room as Graph and Logs, without AskHuman chrome. The linked issue is [#84](https://github.com/anhle128/Archon/issues/84).

Architecture:
1. Keep `LegacyGraphLogsPane` as the single inspect shell for Graph, Logs, and Chat, hosting one right-hand `LegacyNodeRoom` instance mounted across all three tabs.
2. In the Chat left pane, render a new `ChatTimeline` component driven by a pure merger (`buildChatTimeline`) of parent-conversation user messages and run node-status events, followed by a dedicated text-only parent-conversation composer (`RunChatComposer`).
3. Clicking a node-status entry resolves to a `LogRow` via `resolveTimelineRoomRow` using the existing Graph/Logs selection path, while a separate `selectedTimelineEntryId` state marks the exact chronological status entry with `aria-current="true"`.
4. Keep the operator on the Chat tab when opening the node room (do not switch `activeView` to `graph`).

## Problem

In Story 5.3, `LegacyGraphLogsPane` unified the Graph and Logs tabs so both doors share a single mounted `LegacyNodeRoom` and synchronize selection state. However, the DAG Chat tab (`WorkflowExecution.tsx:235-246, 827-831`) still returns `'chat'` and mounts the standalone `ChatInterface` component. This causes several critical UX and architectural problems:
1. `ChatInterface` unmounts `LegacyGraphLogsPane`, destroying selection state, log rows, and room state whenever the user visits Chat.
2. It renders assistant responses, tool cards, worker-conversation transcripts, and full chat chrome instead of a run-centric timeline.
3. Node executions and status transitions are not interactive doors into the node rooms.
4. Switching between Graph/Logs and Chat disrupts inspection workflows.
5. In addition, `WorkflowRunQueryData` unnecessarily computes and retains `workingPath`, which is no longer needed once `ChatInterface` is removed from `WorkflowExecution`.

## Solution

1. **Pure Timeline Merger (`build-chat-timeline.ts`)**:
   - Merge parent-conversation messages where `role === 'user'` (with non-empty content) and qualifying run events into a unified chronological array of `ChatTimelineEntry`.
   - Map qualifying lifecycle events (`node_started`, `node_completed`, `node_failed`, `node_skipped`/`node_skipped_prior_success`, `approval_requested`, `loop_iteration_*`, `node_routed`) to `kind: 'node_status'` entries with appropriate status, detail string, and selection target.
   - Resolve node type via `resolveNodeType(nodeId)` for each node-status entry.
   - Exclude assistant messages, empty user turns, `tool_called`, `tool_completed`, `workflow_artifact`, `node_awaiting`, `interaction_resolved`, and all other non-whitelisted event types.
   - Sort ascending by `ensureUtc` timestamp, breaking ties with user turns before node status, then original encounter index.

2. **Timeline Room Resolution (`resolve-timeline-room-row.ts`)**:
   - Resolve a node-status timeline entry to a `LogRow` by reverse-scanning existing rows for an exact match on `nodeId` and `selection`.
   - If not found in existing rows (e.g. synthetic or early state), fall back to `resolveGraphRoomRow`.

3. **Presentational Chat Timeline (`ChatTimeline.tsx`)**:
   - Render user turns as styled plain-text bubbles (`bg-accent/20`, escaped text, no markdown).
   - Render node-status entries as interactive `<button>` elements showing the node-type glyph (Lucide icon), label, detail, status badge, formatted start time, and a right chevron.
   - Mark the clicked entry with `aria-current="true"` based on `selectedEntryId`.
   - Exclude all AskHuman and awaiting chrome.

4. **Regular Parent-Conversation Client & Composer (`api.ts` & `RunChatComposer.tsx`)**:
   - Add typed `getConversation(id)` helper to `@/lib/api`.
   - Render a controlled, non-HITL `<form>` with textarea and submit button.
   - Disable input and show explanatory copy when parent conversation is non-Web (`platform_type !== 'web'`).
   - Prevent any pending-interaction mutation or Ask controls.

5. **Shared Pane Extension (`LegacyGraphLogsPane.tsx`)**:
   - Accept `activeView: 'graph' | 'logs' | 'chat'`.
   - Query parent messages and conversation via TanStack Query when in Chat view.
   - Polling interval is 3000ms for active/paused runs, false for terminal runs (`runChatMessagesRefetchInterval`).
   - Wire node status click to `resolveTimelineRoomRow`, setting `selectedLogRowId` (or null if synthetic fallback), `selectedTimelineEntryId`, and calling `onSelectNode`.
   - Handle composer submission calling `sendParentMessage`, invalidating stale requests across run changes.

6. **Execution Body Unification (`WorkflowExecution.tsx`)**:
   - Narrow `WorkflowExecutionBody` to `'graph-logs-pane' | 'source-control' | 'sequential'` (remove `'chat'`).
   - Keep `LegacyGraphLogsPane` mounted for DAG Chat, passing parent conversation props and delegating Chat rendering to the pane.
   - Remove `ChatInterface` import and clean up unused `workingPath`.

## Goals and Success Metrics

- **Single Inspect Shell**: DAG Chat, Graph, and Logs share a single mounted `LegacyGraphLogsPane` and `LegacyNodeRoom` instance.
- **Accurate Chronological Timeline**: Parent user turns and node status events interleave cleanly by timestamp without assistant or worker-conversation noise.
- **Three-Door Room Access**: Clicking a node status in Chat opens the identical per-type room as Logs and Graph, while preserving tab location (`activeView` remains `'chat'`).
- **Exact Selection Feedback**: The clicked timeline status entry maintains `aria-current="true"` even when its resolved `LogRow` uses a different ID (e.g. started vs completed events).
- **Non-HITL Composer**: Parent-conversation composer allows normal messaging on Web conversations, disables cleanly on non-Web conversations, and has zero HITL / AskHuman coupling.
- **Strict Quality Gates**: Zero `any` types, zero ESLint warnings, all unit and integration tests passing, and clean `bun run validate`.

## Non-Goals

- Do not implement Ask cards, empty Ask slots, awaiting chrome, or "waiting on you" labels (Epic 6 scope).
- Do not inline agent transcripts, tool cards, or worker-conversation streams into the Chat timeline.
- Do not change `activeView` to `'graph'` upon clicking a node status entry.
- Do not implement console timeline (`packages/web/src/experiments/console/`).
- Do not modify standalone `/legacy/chat/:id` (`ChatInterface.tsx` remains untouched for legacy chat route).
- Do not import `@archon/workflows` into `@archon/web`.
- Do not modify server routes, database schemas, or workflow engines.
- Do not introduce file attachments or SSE streaming to the run Chat composer.

## Technical Context and File References

- `docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md`: authoritative implementation plan.
- `packages/web/src/components/workflows/build-chat-timeline.ts`: pure merger of user turns and node-status events.
- `packages/web/src/components/workflows/build-chat-timeline.test.ts`: 18 unit test cases covering merger, filtering, mapping, and sorting.
- `packages/web/src/components/workflows/resolve-timeline-room-row.ts`: maps a node-status entry to a `LogRow` with graph-room fallback.
- `packages/web/src/components/workflows/resolve-timeline-room-row.test.ts`: test suite covering ordinary, loop, route, and fallback mappings.
- `packages/web/src/components/workflows/ChatTimeline.tsx`: presentational timeline component with accessible status buttons and user bubbles.
- `packages/web/src/components/workflows/ChatTimeline.test.tsx`: static markup tests for timeline accessibility, glyphs, and absence of Ask chrome.
- `packages/web/src/components/workflows/RunChatComposer.tsx`: controlled text-only composer for regular parent-conversation messaging.
- `packages/web/src/components/workflows/RunChatComposer.test.tsx`: markup tests for enabled, disabled (non-Web), sending, and error states.
- `packages/web/src/lib/api.ts:159-193`: added `getConversation` typed client wrapper for `GET /api/conversations/:id`.
- `packages/web/src/lib/api.conversations.test.ts:1-62`: tests URL-encoded single-conversation GET endpoint.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:22-43, 166-213`: extended to accept `activeView: 'chat'`, manage parent queries, and host Chat left pane.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx:1-1340`: characterization and integration tests for three-door room sharing, polling, and composer.
- `packages/web/src/components/workflows/WorkflowExecution.tsx:235-246, 827-831`: updated `resolveWorkflowExecutionBody` removing `'chat'`, keeping pane mounted for Chat.
- `packages/web/src/components/workflows/WorkflowExecution.test.tsx:106-174`: unit tests verifying DAG Chat resolves to `'graph-logs-pane'`.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx:6-30`: preserves Chat tab gating based on `parentPlatformId`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:49-50`: tracks Story 5.4 progress and completion.

## Story Overview Table

| Priority | ID | Title | Depends On | Plan Task Reference |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Pure chat timeline merger | - | Task 1 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:145-222, 459-684`) |
| 2 | US-002 | Timeline node status to LogRow room resolution | US-001 | Task 2 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:223-244, 685-825`) |
| 3 | US-003 | Chat timeline presentational component | US-001 | Task 3 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:245-278, 826-969`) |
| 4 | US-004 | Regular parent-conversation API client and composer | - | Task 4 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:279-314, 970-1131`) |
| 5 | US-005 | Wire Chat door into LegacyGraphLogsPane with parent queries and send | US-001, US-002, US-003, US-004 | Task 5 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:315-407, 1132-1439`) |
| 6 | US-006 | Mount LegacyGraphLogsPane for DAG Chat in WorkflowExecution | US-005 | Task 6 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:408-431, 1440-1565`) |
| 7 | US-007 | Validate story and update sprint tracking | US-001, US-002, US-003, US-004, US-005, US-006 | Task 7 (`docs/superpowers/plans/2026-09-06-node-room-from-chat-timeline-legacy.md:1566-1611`) |
