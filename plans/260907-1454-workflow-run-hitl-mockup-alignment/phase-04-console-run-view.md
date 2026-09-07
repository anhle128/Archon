---
title: 'Phase 4: Console Run View'
status: done
---

# Phase 4: Console Run View

## Outcome

Priority: P1.
Estimate: 20-28h.
Dependency: Phase 3 completed shared graph contract and Phase 2 data APIs.
Restore the full Command Center run view from `ux-mockup/console.html` and `console-app.js`.
Use the same typed history and interaction behavior as Legacy inside Console's independent UI architecture.
Use provisional product choices from [the index](plan.md#proposed-decisions).

## Read First

- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/README.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-01-start.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-02-transcript-and-execution-history.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/plans/260907-1454-workflow-run-hitl-mockup-alignment/phase-03-legacy-run-view.md`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console-app.js`
- `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/styles.css`

## File Inventory

Create is a proposed file.
Other paths exist.
Phase 4 may consume shared graph exports but must return any needed shared change to Phase 3 ownership.

| Action | Full path                                                                                                                                             | Change                                                                                | Rough LOC |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/routes/RunDetailPage.tsx`                        | Stable execution selection, shared local Ask/draft state, composer and room lifecycle | 140-220   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/RunDetailHeader.tsx`                  | Exact compact header and metadata arrangement                                         | 50-90     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/StreamToolbar.tsx`                    | View controls and filters with mockup density                                         | 20-40     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/RunStream.tsx`                        | One scoped section per occurrence, inline Ask and retained records                    | 100-170   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/NodeDivider.tsx`                      | Sticky per-occurrence title/type/status/duration                                      | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`               | Close/resize/stack behavior and stable panel state                                    | 70-110    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                  | Header and every typed room body, cursor transcript cards                             | 130-230   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/build-log-rows.ts`            | Thin adapter for server nodeExecutions                                                | 35-70     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/select-room-data.ts`          | Exact occurrence-bound body data                                                      | 25-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts` | Exact typed scope, explicit old-history unknown state                                 | 25-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts` | Selected occurrence/attempt with compatible node deep links                           | 25-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`               | Complete mockup card with controlled local shared draft                               | 60-110    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ask/ask-answer-controller.ts`         | Preserve single request lock and action outcome                                       | 0-25      |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx`             | Accurate awaiting pointers and focus                                                  | 20-40     |
| Create | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/run-conversation-composer.tsx`        | Controlled run-page message composer with factual destination state                   | 70-110    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/skills/runs.ts`                                  | Consume opt-in history/transcript contract from Phase 2                               | 10-30     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/skills/conversations.ts`                         | Reuse sendMessage; add read verb only if current exported reads lack it               | 0-25      |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/RunGraphPanel.tsx`                    | Mockup graph cards/edges and pointer/focus viewport behavior                          | 100-170   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/graph/build-run-graph-input.ts`       | Feed selected execution evidence to shared graph                                      | 20-40     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/graph/graph-viewport.ts`              | Cursor-centered zoom, pan and fit helpers                                             | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ArtifactPanel.tsx`                    | Compact real list/preview treatment, stable open room                                 | 20-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/README.md`                                       | Update room/history/cursor/composer behavior and preferences                          | 20-40     |

Additional required owner: Modify `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/build-console-log-entries.ts` and `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts` (30-60 source lines plus focused tests).
Replace node-only and node-plus-iteration metadata merging with exact occurrence identity so duration, stop reason and usage labels cannot come from another execution.
Keep node-level aggregate usage explicitly labeled aggregate; do not invent per-occurrence cost when the source does not provide it.

Additional required owner: Modify `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ask/ask-card-presentation.ts` (20-40 lines) and its existing test to use the request occurrence's status/error.
Modify `packages/web/src/experiments/console/components/inspect/resolve-room-kind.ts` and its test so cancel nodes use a factual control-node body instead of the unknown-to-agent fallback.
Modify `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/experiments/console/components/ask/select-visible-node-ask-interactions.ts` and its existing test (25-50 lines) to select exact scope and use server tail evidence.

Read `ChatPage.tsx`, `ChatComposer.tsx`, `skills/conversations.ts` and `skills/messages.ts` as reuse context.
The existing send owner is `skills/conversations.ts`; `skills/messages.ts` only lists.
Do not make the project-chat composer an Ask path.
Do not introduce shared React across the Console boundary.

## Implementation Steps

1. Map optional `nodeExecutions` in the Console skill.
   Render server history through a thin local adapter.
   Remove local reconstruction that collapses ordinary reruns or identifies nested loops only by iteration number.
   Keep explicitly unknown history visible when the server cannot prove a boundary.
2. Restore header and view controls to the canonical density.
   Retain usage/ledger views, environment/provenance, IDE links and real lifecycle controls.
   Keep Log filtering independent from inspect selection.
3. Give each execution a stable stream section and sticky divider.
   Show its real text, tool cards, lifecycle notes and retained Ask/gate answers.
   A divider click selects that occurrence, not the node's latest occurrence.
   Replace RunStream's fuzzy conversation timestamp windows, inlineToolCount source switching and FIFO tool pairing by node.
   Execution section bodies must use Phase 2 scoped transcript pages and explicitly owned events.
   Keep unscoped conversation messages as separate run-level records; never assign them to an occurrence by approximate time.
   RunDetailPage owns one Console-local transcript cache/read coordinator shared by stream and room.
   Hydrate only visible or active scopes with bounded pages and one cursor request/poll per scope.
   Historical terminal scopes become static only after their final high-watermark drain.
   Use the existing Console state/read pattern; do not add another cache library or framework.
   Tool/system visibility filters must not hide a required pending Ask.
4. Keep room open/closed state, occurrence selection, width, drafts and per-room scroll at the run-page host.
   Plain run entry starts closed; `?node=` deep links open the selected node.
   When a deep link has no occurrence, choose a documented current/latest occurrence from server order.
   For an explicit historical selection, retain that exact occurrence.
   Close restores content width and focus to the trigger.
   Log/Graph/Artifacts switches do not discard room selection or drafts.
5. Replace fixed 380px width with default 460px and desktop bounds 320-720px.
   Clamp against the content region after project rail/navigation.
   Use the Phase 1 stacked fallback at narrow widths.
   Provide a keyboard-operable separator and visible focus.
6. Restore complete room header and agent/tool/status/answer bodies.
   Render input and output visibly with bounded previews.
   Keep missing, interrupted, errored and provider-truncated results factual.
   Use cursor reads with stable run/node/scope keys; discard stale responses on selection change.
   Preserve scroll when updates arrive or a user is reading old content.
   Drain the final cursor through the server high-watermark on completed/failed/cancelled before stopping polling.
   Filter pending Ask by execution scope before merging it with transcript pages.
   Use server tail evidence, not the last loaded row; provide a separate actionable fetch-error fallback.
   A later occurrence's resume error must not change an earlier answered Ask.
7. Restore bash/script terminal grouping, gate document/review/annotation/decision cards, route details, child links and loop-group detail.
   Use the server's occurrence-bound event ownership.
   Keep declared-gate authorization unchanged.
   No standalone annotation HTTP action exists today.
   Keep review-open and approve/reject distinct.
   Add a Console-local skill verb for Phase 2's typed review-feedback endpoint and render its authoritative receipt states.
   Do not send annotation text through approveRun or treat accepted feedback as completed rework.
   Share gate action state across stream and room copies within the Console run page.
8. Show the same pending Ask in stream and room under the provisional decision.
   Use one page-owned controller and shared controlled draft by request ID.
   Give each mounted copy unique DOM input IDs.
   Submit, decline, sending, accepted, late and error states must synchronize immediately.
   Awaiting pointers reveal a filtered/hidden target and then focus it without losing another draft.
9. Add the run-conversation composer using Console skill verbs.
   Resolve the run's `parent_platform_id` from generated API data and verify that the parent conversation is a web conversation.
   Use `skills/conversations.sendMessage` with that platform ID.
   Do not send to a workflow conversation UUID or to an unrelated active project chat.
   Show truthful disabled reasons when the destination is absent, loading, invalid, non-web or unauthorized.
   Keep text on failure; clear only after success.
   Do not claim queued agent delivery or interpret prose as approve/answer.
   Keep lifecycle actions separate.
10. Consume Phase 3 shared graph geometry.
    Restore type borders, join/pass/loop labels, ports, arrowheads, conditions, negative routes and retry curves.
    Implement pointer pan, cursor-centered wheel zoom, fit on entry and connected-edge hover/focus trace.
    Pointer capture must release on cancel/unmount.
    Do not refit after every run poll or steal focus when status changes.
11. Align actual artifacts and preserve preview access.
    Keep simulation Replay/view-as only in tests.
    Update the Console README for the final behavior without changing its isolation contract.

## Protected Contracts

- [x] Every mutation uses one Console skill verb.
- [x] Runtime imports from production components/stores/contexts/routes/hooks, React Query and `@/lib/api` stay forbidden.
- [x] Generated API types and existing `@/lib/run-graph` runtime exception are the only relevant shared imports.
- [x] `getRun` preserves run, events, rawEvents, nodeStates, approval, usage, pendingInteractions and viewer fields.
- [x] `listNodeMessages` remains compatible for current callers while opt-in cursor reads are added.
- [x] `RunDetailPage` owns `buildLogRows` and the message-loader prop for `ConsoleNodeRoom`.
- [x] `selectNodeRoomMessages` and `selectRoomData` use exact scope; no broad fallback slice.
- [x] `createAskAnswerController` is one stable instance per run, not per Ask copy.
- [x] Existing `archon.console.runNodeFilter` continues to mean Log filtering, not selected room.
- [x] Current localStorage reads stay guarded; stored panel widths are clamped before use.
- [x] Existing node links and `consoleRunHref` remain valid.
- [x] Raw output stays escaped and Markdown links retain existing safety rules; no mockup innerHTML rendering is copied.

## Test Inventory and Commands

Extend current tests:
`routes/RunDetailPage.test.tsx`,
`skills/runs.node-messages.test.ts`, `skills/runs.ask.test.ts`,
`components/RunDetailHeader.test.tsx`, `RunStream.test.tsx`, `NodeDivider.test.tsx`,
`ConsoleInspectPane.test.tsx`, `ConsoleNodeRoom.test.tsx`, `RunGraphPanel.test.tsx`,
`components/inspect/build-log-rows.test.ts`, `select-room-data.test.ts`,
`select-node-room-messages.test.ts`, `console-inspect-selection.test.ts`,
`components/ask/ConsoleAskCard.test.tsx`, `ask-answer-controller.test.ts`,
`ConsoleAskChrome.test.tsx`, `components/graph/graph-viewport.test.ts`,
and `build-run-graph-input.test.ts` under `packages/web/src/experiments/console/`.
Create `packages/web/src/experiments/console/components/run-conversation-composer.test.tsx`.
Expected test impact: 350-600 changed lines for scope, shared drafts, send destination and viewport behavior.

From `packages/web`:

```sh
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/RunStream.test.tsx
NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx
bun test src/experiments/console/components/graph/graph-viewport.test.ts
bun test src/experiments/console/console-isolation.test.ts
```

Then from the root:

```sh
bun run --cwd packages/web test
bun run --cwd packages/web type-check
bun run lint
bun run build:web
bun run --cwd e2e test:ui --grep "HITL.*Console"
```

## Scenario Matrix

| Priority | Scenario                                      | Expected result                                   |
| -------- | --------------------------------------------- | ------------------------------------------------- |
| Critical | Stream and room submit same Ask               | One mutation and synchronized answers/errors      |
| Critical | Same node ID across passes/attempts           | Divider, room and result all select exact history |
| Critical | Missing/non-web parent conversation           | Composer disabled; no wrong-destination send      |
| High     | Log filter hides awaiting node                | Awaiting pointer reveals and focuses request      |
| High     | Log/Graph/Artifacts switch                    | Room, draft, width and scroll survive             |
| High     | Tool output absent/truncated/error            | Factual visible card; no invented full output     |
| High     | Pointer pan interrupted or component unmounts | Pointer released, viewport usable                 |
| High     | Shared graph with long labels and many routes | No clipping or edge/card collisions               |
| Medium   | Narrow width after project rail               | Controls fit and Ask remains usable               |
| Medium   | Poll while editing or reading                 | No draft reset, focus theft or forced refit       |
| Medium   | Existing cost/environment controls            | Still reachable and unchanged in meaning          |

## Acceptance and Rollback

- [x] Every Console inventory item has a reference comparison and behavior check.
- [x] Console isolation passes without new runtime exceptions.
- [x] Real Ask/answer/resume and parent-web-conversation send pass.
- [x] Shared graph geometry remains identical across renderers.
- [x] Artifacts and existing operational controls remain available.

Main risk: a local Console history engine could drift from Legacy again.
Use the server's execution projection and keep adapters presentational.
Rollback Console rendering and local skill changes as one focused patch.
Keep server optional fields and additive data intact.
