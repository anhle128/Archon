# Align Agent History and Responsive Run Room Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md`
Derived slug: `2026-09-08-align-agent-history-responsive-run-room`

## Overview

Story 5.6 delivers the approved run-detail experience in both Legacy and Console surfaces (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:6-12`):
- Execution-scoped agent history (assistant text, structured tool invocation cards, inline outcome and duration, truncation markers, and full detail retrieval).
- Open-on-demand percentage-sized run room that leaves the primary work area released by default.
- Responsive single-pane navigation on narrow containers (< 60rem), preserving main view state and scroll position behind a Back button.
- Inline human interaction (AskHuman cards and approval gates) placed at execution positions with shared controlled drafts across surfaces.
- Direct parent-conversation reply in Console when a web parent exists, with factual disabled states otherwise.
- Bounded multi-page cursor fixture (120 tool calls) and end-to-end evidence across desktop and mobile viewports.

Architecture:
1. Pure layout and sizing (`packages/web/src/lib/room-split-layout.ts`): percentage strings only for `react-resizable-panels` v4, clamped to 24%-60% (default 40%), persisted per surface.
2. Lossless node-message transport (`packages/server/src/routes/api.ts`, `packages/web/src/lib/api.ts`, `packages/web/src/experiments/console/skills/runs.ts`): metadata preserved, response truncation marked, AbortSignal forwarded on list and detail endpoints.
3. Pure cursor paging reducer (`packages/web/src/lib/node-message-pages.ts`): deduplication by `seq`, scoped high-watermark draining, stale scope discarding, failure retention, and retry.
4. Render-neutral transcript projection (`packages/web/src/lib/agent-history.ts`): projects text deltas/snapshots, tool call/result pairs, duration from matching events, and lifecycle entries into a discriminated union.
5. Exact execution identity and visit state (`packages/web/src/lib/execution-room-model.ts`, `packages/web/src/lib/room-scroll-follow.ts`, `packages/web/src/lib/use-container-split-mode.ts`): execution resolution precedence, stable opener IDs, controlled room open/close, deep-link once-per-entry handling, rem-aware container split mode, and scroll follow / restore.
6. Isolated surface implementations: Legacy (`LegacyGraphLogsPane`, `NodeRoomHeader`, `NodeTranscriptPane`, `NodeRoom`, `WorkflowExecution`, `AskCard`, `ChatTimeline`) and Console (`ConsoleInspectPane`, `ConsoleRoomHeader`, `ConsoleAgentHistoryList`, `ConsoleNodeRoom`, `ConsoleExecutionHistory`, `RunStream`, `ConsoleReplyComposer`, `RunDetailPage`), satisfying console isolation (`console-isolation.test.ts`).

Linked issue: [#147](https://github.com/anhle128/Archon/issues/147).

## Problem

1. The run room previously opened by default or took fixed pixel dimensions, compressing primary Log and Graph work areas and violating percentage sizing rules (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:23-26`).
2. Narrow mobile containers broke layout or dropped state when toggling between Log/Graph and room inspect views (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:28,82-83`).
3. Node message history truncated tool outputs without marking truncation in list responses, dropped row metadata, and lacked AbortSignal support on fetch calls (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:43-45,378-410`).
4. Client pagination lacked a unified cursor-page state machine, risking duplicated items, out-of-order deltas, stale responses on scope change, or dropped loaded rows on late failure (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:64,491-536`).
5. Tool cards lacked structured context, inline duration, honest outcome states, and detail links for full output (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:66,631-670`).
6. Console grouped logs by node ID rather than exact execution identity, causing repeated loop/attempt executions to collide or duplicate (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:69,1491-1520`).
7. Pending Ask cards had independent local drafts in different views (room vs chat/stream), risking lost input (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:68,1217-1240`).
8. Console Reply composer sent messages to arbitrary or non-existent conversations without validating web parent compatibility (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:70,1627-1650`).

## Solution

1. **Percentage Split Layout & Rem-Aware Mode**:
   - `room-split-layout.ts`: `roomPanelSizes` returning string percentages, clamping between 24% and 60% (default 40%, min view 30%), persisting per-surface to `localStorage`.
   - `resizable.tsx` and `console-resizable.tsx`: `PercentResizablePanel` and `ConsolePanel` enforcing `PanelPercent` size props.
   - `use-container-split-mode.ts`: measures container width against `minRem * rootFontPx` (default 60rem), adapting to root font size changes.
2. **Lossless Transport & Node Detail Route**:
   - Server preserves row metadata in no-query compatibility mode, and marks `truncated: true` and `output_state: 'truncated'` in cursor mode when tool output is shortened.
   - Client API functions `getWorkflowNodeMessages`, `getWorkflowNodeMessage`, and Console `getRunNodeMessages`, `getNodeMessage` forward `AbortSignal` without query pollution.
3. **Shared Cursor-Page State Machine**:
   - `node-message-pages.ts`: deduplicates by `seq`, tracks `highWatermark`, validates terminal completion (`hasMore: false` and `afterSeq >= highWatermark`), retains loaded rows on error, and discards responses from obsolete scope keys.
4. **Agent History Projection**:
   - `agent-history.ts`: transforms node messages and workflow events into discriminated items (`assistant`, `tool`, `lifecycle`), pairs tool calls and results, extracts allowlisted context (`cmd`, `path`, `file_path`, `query`, `url`), and joins single-match event duration.
5. **Execution Identity, Room Visit State, and Scroll Following**:
   - `execution-room-model.ts`: resolves execution preference (last explicit > awaiting > running > latest), builds `ExecutionHeaderModel`, formats stable opener IDs (`roomOpenerId`), and manages `RoomVisitState` (controlled open, close, deep link once-per-entry, and run-change reset).
   - `room-scroll-follow.ts`: initializes completed runs at top and active runs at bottom, tracks follow threshold (<= 24px from bottom), and handles jump to latest.
6. **Legacy Room Integration**:
   - `LegacyGraphLogsPane.tsx`: controlled split pane, absent room by default, hidden main view in single mode, Back button.
   - `WorkflowExecution.tsx`: parent visit state owner, opener focus restoration on close, deep link synchronization, draft lifting.
   - `NodeRoomHeader.tsx`, `NodeTranscriptPane.tsx`, `NodeRoom.tsx`: sticky header, live polling adapter, full output lookup, rendered cards.
   - `AskCard.tsx`, `ChatTimeline.tsx`, `RunChatComposer.tsx`: controlled Ask drafts, deterministic timeline placement, disabled composer when no web parent exists.
7. **Console Room Integration**:
   - `ConsoleInspectPane.tsx`: controlled percentage split, absent room by default, docked room when Artifacts is selected.
   - `ConsoleRoomHeader.tsx`, `ConsoleAgentHistoryList.tsx`, `ConsoleNodeRoom.tsx`: Console-owned header and history renderers.
   - `execution-interactions.ts`, `ConsoleExecutionHistory.tsx`, `RunStream.tsx`: one log section per execution entry, scoped Ask placement, controlled `ConsoleAskCard`.
   - `ConsoleReplyComposer.tsx`: verifies web parent platform type via `getConversation` and safely disables when no web parent exists.
8. **Alignment, Multi-Page Fixture & Acceptance Proof**:
   - Relative typography and presentation tokens (`--rv-*`) in `index.css` and `brand/index.md`.
   - Opener IDs on graph nodes and divider buttons; actionable Awaiting input header button.
   - `e2e-fake` provider with `repeatTool` option (1-200) and `e2e-hitl-long-history.yaml` fixture producing > 100 tool calls.
   - Focused Playwright spec `workflow-run-hitl-room.spec.ts` and repaired `workflow-run-hitl-visual.spec.ts`.
   - Acceptance report `acceptance-260908-story-5-6.md` recording viewport evidence (1440x1000, 1024x900, 768x900, 390x844).

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Default absent room & percentage split | Room absent on ordinary visit; opens to stored % (24%-60%); panel sizes use % strings | `room-split-layout.test.ts`, `console-resizable.test.tsx`, `LegacyGraphLogsPane.test.tsx`, `ConsoleInspectPane.test.tsx` |
| Lossless transport & abort support | Metadata preserved, truncation marked in response, detail endpoint fetches full output, AbortSignal forwarded | `api.workflow-runs.test.ts`, `get-workflow-node-messages.test.ts`, `runs.node-messages.test.ts` |
| Robust cursor pagination | Drains through high-watermark, deduplicates by seq, retains rows on failure, discards stale scope responses | `node-message-pages.test.ts`, `NodeTranscriptPane.test.tsx` |
| Structured agent history | Tool cards show context, expanded I/O, inline outcome/duration, honest states, full output link | `agent-history.test.ts`, `NodeRoom.test.tsx`, `ConsoleNodeRoom.test.tsx` |
| Responsive single-pane navigation | Container < 60rem keeps main view mounted & hidden; Back restores state; scroll and drafts preserved | `use-container-split-mode.test.tsx`, `LegacyGraphLogsPane.test.tsx`, `ConsoleInspectPane.test.tsx` |
| Exact execution grouping in Console | Each ConsoleLogEntry has its own section; repeated executions never collide or share bodies | `execution-interactions.test.ts`, `RunStream.test.tsx`, `ConsoleExecutionHistory.test.tsx` |
| Shared Ask drafts | Same pending Ask uses identical controlled draft across room and chat/log; answered/declined stay read-only | `AskCard.test.tsx`, `ConsoleAskCard.test.tsx`, `WorkflowExecution.test.tsx`, `RunDetailPage.test.tsx` |
| Safe Console Reply | Reply enabled only for parent conversation with platform_type === 'web'; disabled copy otherwise | `conversations.test.ts`, `ConsoleReplyComposer.test.tsx`, `RunDetailPage.test.tsx` |
| Multi-page E2E proof | UI requests multiple cursor pages (> 100 tools) and renders every distinct call without drop | `provider.test.ts`, `workflow-run-hitl-room.spec.ts` |
| Acceptance & validation | Full acceptance matrix across 4 viewports recorded in report; bun run validate passes | `acceptance-260908-story-5-6.md`, `bun run validate` |

## Non-Goals

- Do not alter the existing node-message schema in `packages/server` or regenerate OpenAPI schemas (response schema already supports required fields).
- Do not reconstruct historical prompts from current workflow YAML or prose definitions.
- Do not add fixed pixel widths to the run room; do not compare percentage widths against mockup pixel widths.
- Do not create fallback conversations when Console run has no parent web conversation.
- Do not share React UI components across Legacy and Console surfaces (keep Console isolated under `packages/web/src/experiments/console/**`).
- Do not mutate or drop existing run header, cancel, retry, review, gate, usage, or environment controls.

## Technical Context

- Sizing & Layout helper: `packages/web/src/lib/room-split-layout.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:217-328`)
- Legacy resizable wrapper: `packages/web/src/components/ui/resizable.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:329-340`)
- Console resizable wrapper: `packages/web/src/experiments/console/primitives/console-resizable.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:341-365`)
- Server routes: `packages/server/src/routes/api.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:412-438`)
- Web API client: `packages/web/src/lib/api.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:464-480`)
- Console runs skill: `packages/web/src/experiments/console/skills/runs.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:481-488`)
- Cursor-page state machine: `packages/web/src/lib/node-message-pages.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:522-628`)
- Agent history projection: `packages/web/src/lib/agent-history.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:652-727`)
- Execution room model: `packages/web/src/lib/execution-room-model.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:752-814`)
- Room scroll follow: `packages/web/src/lib/room-scroll-follow.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:884-914`)
- Container split mode hook: `packages/web/src/lib/use-container-split-mode.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:924-952`)
- Legacy room host: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:985-1014`)
- Legacy visit owner: `packages/web/src/components/workflows/WorkflowExecution.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1026-1046`)
- Legacy transcript driver: `packages/web/src/components/workflows/NodeTranscriptPane.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1123-1152`)
- Legacy history items: `packages/web/src/components/workflows/NodeRoom.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1153-1175`)
- Ask controlled cards & timeline: `packages/web/src/components/workflows/AskCard.tsx`, `packages/web/src/components/workflows/build-chat-timeline.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1247-1286`)
- Console room host: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1396-1422`)
- Console history items: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1430-1455`)
- Console execution sections: `packages/web/src/experiments/console/components/RunStream.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1545-1598`)
- Console reply composer: `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1700-1765`)
- Run detail header & tokens: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`, `packages/web/src/index.css` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1836-1885`)
- Multi-page fixture & provider: `packages/providers/src/e2e-fake/provider.ts`, `e2e/fixtures/workflows/e2e-hitl-long-history.yaml` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:1936-1994`)
- E2E acceptance spec: `e2e/ui/workflow-run-hitl-room.spec.ts` (`docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md:2080-2115`)

## Story Overview Table

| ID | Title | Priority | Dependencies | Plan Ref | Key Files |
| --- | --- | --- | --- | --- | --- |
| US-001 | Lock the percentage split contract | 1 | None | Task 1 | `lib/room-split-layout.ts`, `components/ui/resizable.tsx`, `console-resizable.tsx` |
| US-002 | Make node-message transport lossless and abortable | 2 | None | Task 2 | `routes/api.ts`, `lib/api.ts`, `skills/runs.ts` |
| US-003 | Build the shared cursor-page state machine | 3 | US-002 | Task 3 | `lib/node-message-pages.ts`, `lib/node-message-pages.test.ts` |
| US-004 | Project recorded rows into agent history | 4 | US-003 | Task 4 | `lib/agent-history.ts`, `lib/agent-history.test.ts` |
| US-005 | Model execution identity and header data | 5 | None | Task 5 | `lib/execution-room-model.ts`, `build-log-rows.ts` |
| US-006 | Model room visits, responsive mode, and scroll following | 6 | US-005 | Task 6 | `lib/execution-room-model.ts`, `lib/room-scroll-follow.ts`, `lib/use-container-split-mode.ts` |
| US-007 | Integrate the legacy room lifecycle | 7 | US-001, US-005, US-006 | Task 7 | `components/workflows/LegacyGraphLogsPane.tsx`, `WorkflowExecution.tsx`, `NodeRunList.tsx` |
| US-008 | Render complete legacy execution history | 8 | US-003, US-004, US-005, US-006, US-007 | Task 8 | `NodeRoomHeader.tsx`, `RoomIncompleteNotice.tsx`, `NodeTranscriptPane.tsx`, `NodeRoom.tsx` |
| US-009 | Share legacy Ask drafts across room and chat | 9 | US-007, US-008 | Task 9 | `AskCard.tsx`, `build-chat-timeline.ts`, `ChatTimeline.tsx`, `RunChatComposer.tsx` |
| US-010 | Integrate the console room and shared history renderer | 10 | US-001, US-003, US-004, US-005, US-006 | Task 10 | `ConsoleInspectPane.tsx`, `ConsoleRoomHeader.tsx`, `ConsoleAgentHistoryList.tsx`, `ConsoleNodeRoom.tsx` |
| US-011 | Render one console log section per exact execution | 11 | US-004, US-005, US-010 | Task 11 | `execution-interactions.ts`, `ConsoleExecutionHistory.tsx`, `RunStream.tsx`, `ConsoleAskCard.tsx` |
| US-012 | Add a safe console reply composer | 12 | US-010 | Task 12 | `skills/conversations.ts`, `ConsoleReplyComposer.tsx`, `RunDetailPage.tsx` |
| US-013 | Align header, tabs, graph, tokens, and focus openers | 13 | US-005, US-007, US-010 | Task 13 | `index.css`, `brand/index.md`, `ExecutionDagNode.tsx`, `RunGraphPanel.tsx`, `RunDetailHeader.tsx` |
| US-014 | Add a deterministic multi-page provider fixture | 14 | None | Task 14 | `e2e-fake/provider.ts`, `e2e-hitl-long-history.yaml`, `archon-runtime.ts` |
| US-015 | Prove the end-to-end room contract and close the story | 15 | US-008, US-009, US-010, US-011, US-012, US-013, US-014 | Task 15 | `run-detail.ts`, `workflow-run-hitl-room.spec.ts`, `workflow-run-hitl-visual.spec.ts`, `acceptance-260908-story-5-6.md` |
