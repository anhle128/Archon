---
title: 'Phase 3: Legacy Run View and Shared Graph'
status: done
---

# Phase 3: Legacy Run View and Shared Graph

## Outcome

Priority: P1.
Estimate: 20-28h.
Dependency: Phase 2 typed execution history and transcript API.
Restore the full Legacy Graph, Logs, Chat and node-room experience from the canonical mockup.
This phase owns all shared `lib/run-graph` geometry changes.
Phase 4 consumes that contract and must not run in parallel against these files.

## Read First

Read [Phase 1's complete inventory](phase-01-start.md#complete-visual-contract) and [Phase 2's data contract](phase-02-transcript-and-execution-history.md).
Read the current files in the inventory before editing them.
Read `ux-mockup/index.html`, `app.js` and `styles.css` from `_bmad-output/specs/spec-workflow-run-view-hitl/`.
Use the provisional Ask/token decisions in the plan index.
The mockup governs visual output; production data and actions remain real.

## File Inventory

All paths below exist unless marked Create.
Tests in the next section are part of the same ownership.
No shared Console React module is introduced.

| Action | Full path                                                                                                                              | Change                                                               | Rough LOC |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/index.css`                                            | Scoped run-view semantic tokens and documented aliases               | 40-80     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/docs-web/src/content/docs/brand/index.md`                     | Document new run-view tokens and their scope                         | 20-40     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/WorkflowExecution.tsx`           | Header, history mapping, persistent selection and Ask/draft state    | 100-180   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/source-control/dag-run-tabs.tsx` | Tab treatment with Source Control retained                           | 15-30     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`         | Panel lifecycle, width, full Logs, Chat and data requests            | 120-220   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/NodeRunList.tsx`                 | Complete chronological execution rows                                | 60-100    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/build-log-rows.ts`               | Adapt server occurrences instead of reconstructing history           | 40-80     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/select-room-data.ts`             | Exact selected-execution deterministic-node content                  | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/LegacyNodeRoom.tsx`              | Unified room header, occurrence chips and typed bodies               | 60-100    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/NodeTranscriptPane.tsx`          | Cursor reads, stale-request protection and scroll preservation       | 60-110    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/NodeRoom.tsx`                    | Complete text, visible tool cards, lifecycle/answer records          | 100-180   |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/StdoutRoom.tsx`                  | Command/output/error grouping                                        | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/GateRoom.tsx`                    | Review document/link, annotations, gate actions and retained outcome | 40-80     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/RouteControllerRoom.tsx`         | Selected route outcome/details                                       | 20-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/ChildWorkflowRoom.tsx`           | Exact child links and factual state                                  | 15-35     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/LoopGroupRoom.tsx`               | Correct nested loop/pass detail                                      | 20-40     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/ChatTimeline.tsx`                | Actor labels, compact records, inline synchronized Ask               | 80-140    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/build-chat-timeline.ts`          | Typed system, route, decision and execution records                  | 60-100    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/AskCard.tsx`                     | Mockup form, controlled shared draft and unique DOM IDs              | 60-110    |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/ask-answer-controller.ts`        | Preserve one in-flight lock per request and run                      | 0-25      |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/WorkflowAskChrome.tsx`           | Accurate count and focusable request/gate targets                    | 20-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/RunChatComposer.tsx`             | Mockup layout, actual send, factual unavailable/error state          | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/WorkflowDagViewer.tsx`           | ReactFlow fit/selection/trace integration                            | 50-90     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/ExecutionDagNode.tsx`            | Compact type border, join/pass/loop display                          | 50-90     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/RunGraphRouteEdge.tsx`           | Arrow, condition, retry/route and trace treatment                    | 40-80     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/build-run-graph-input.ts`        | Scope-aware executed-path input                                      | 20-40     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/constants.ts`                           | 208x58 nominal nodes and 34/46 gaps                                  | 5-15      |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/layout.ts`                              | Compact collision-free layout                                        | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/positions.ts`                           | Distance-aware edge attachment                                       | 20-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/routes.ts`                              | Conditional, negative and loopback paths                             | 30-60     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/taken-path.ts`                          | Pass-specific actual execution evidence                              | 20-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/types.ts`                               | Add optional explicit execution evidence only when needed            | 10-25     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/run-graph/index.ts`                               | Re-export changed shared contracts only                              | 0-10      |

Additional required owners:

| Action | Full path                                                                                                                               | Change                                                                     | Rough LOC |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/lib/dag-layout.ts`                                     | Correct resolveNodeDisplay type labels for script, workflow and loop_group | 15-35     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/build-workflow-dag-view-model.ts` | Preserve node type through view-model conversion                           | 15-30     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/resolve-room-kind.ts`             | Classify cancel nodes with factual control-node content                    | 10-25     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/merge-agent-room-items.ts`        | Merge Ask by execution scope and authoritative pending source              | 25-50     |
| Modify | `/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/packages/web/src/components/workflows/ask-card-presentation.ts`         | Use request occurrence outcome, not latest node state                      | 20-40     |

Do not apply the run palette sitewide.
Keep definitions in the existing token source and scope use under both run-view roots.
Use current Lucide icons and existing panel primitives.
No new graph dependency is needed.

## Implementation Steps

1. Map `nodeExecutions` from GET run through `mapWorkflowRunDetail`.
   Keep current nodeStates, usage and action data.
   Use occurrence/attempt identity for row keys and selection.
   Do not use node ID plus iteration number as a unique execution key.
2. Restore header hierarchy and tab visuals.
   Retain existing usage, environment, provenance, IDE and lifecycle controls.
   The actual tab owner is `source-control/dag-run-tabs.tsx`, not a new `DagRunTabs.tsx`.
3. Lift selected execution, open/closed state, width, scroll and draft ownership to the stable run host.
   Open only from a real selection/deep link.
   Closing the room restores content space without losing the selected occurrence.
   Keep state across Graph/Logs/Chat/Source Control transitions; clear it on run change.
4. Replace the fixed 224px Logs list and 60/40 panel split.
   Render the mockup's complete execution rows.
   Use 460px initial room width, 320-720px desktop bounds, and the Phase 1 narrow fallback.
   Support pointer and keyboard resize with a labeled separator.
5. Rework the room header and every typed body.
   Show real node type, name, state, offset, duration, and loop/pass chips.
   Render Markdown text with role labels and visible tool input/output.
   Pair immutable call/result rows with exact scope and update cards at the call position.
   Show result-only and missing/truncated output truthfully.
   Never use a guessed prose summary.
   After a terminal run update, drain the cursor to the server's scoped high-watermark before disabling polling.
   Filter Ask records by execution_scope before merging them into a room.
   Do not use a loaded page's tail as proof of current history.
   Keep actionable pending Ask visible on transcript fetch failure without leaking it into a selected old occurrence.
   Use the selected request occurrence's status/error so a later resume failure cannot relabel an earlier successful answer.
6. Render bash/script command and output groups, exact gate document and review link, route details, child workflow links and nested-loop state.
   Use the server occurrence to bound events.
   Show cancel/skip states without fabricating terminal output.
7. Restore Chat actor labels and compact lifecycle/route/decision records.
   Inline Ask and the node-room Ask use one run-level request controller and controlled draft store.
   Key draft state by run and request; do not clear it on polling, room closure or view switches.
   Use unique input IDs for each mounted view so labels and focus never target the other copy.
   One submit disables both copies; accepted/late/error outcomes update both.
8. Preserve the existing composer destination contract.
   Read `run.parent_platform_id`, load the parent conversation, and require `platform_type === 'web'`.
   Use `sendMessage(parentPlatformId, text)`; never use a workflow-internal conversation ID.
   Clear text only after success, retain it after failure, and ignore late responses from an old run.
   Use factual disabled reasons for missing, loading, unavailable or non-web destinations.
   Do not say the message is queued to an agent.
   Keep approval, rejection, retry, resume and cancel as explicit actions outside the composer.
9. Preserve real gate action wiring.
   The current HTTP API has no standalone annotation action.
   Opening the real review link is supported; approve with comment still approves.
   The existing Plannotator supervisor consumes annotation decisions from its review result and can request rework while paused.
   Use the new typed review-feedback action specified in Phase 2's Inline Review Feedback section.
   Render accepted/pending, reworking, superseded and failed states from its receipt; annotation submission does not approve.
   Keep the same gate action state across inline and room copies.
   Keep declared-gate authorization unchanged; Ask starter-only rules do not apply automatically to gates.
10. Update shared graph dimensions, ports, arrowheads, branch labels, negative routes, retry curves and taken-pass evidence.
    Keep ReactFlow on Legacy.
    Fit on entry or explicit command without resetting the user's pan/zoom after each poll.
    Trace connected edges on hover and keyboard focus.
    Long IDs can wrap or use an accessible short display without moving handles.
11. Review both root token maps against the mockup before passing the shared graph contract to Phase 4.

## Protection Checklist and Consumers

- [x] `mapWorkflowRunDetail` retains all existing run fields and `parentPlatformId`.
- [x] `buildLogRows` is consumed by `LegacyGraphLogsPane`; its tests change with the server-adapter contract.
- [x] `selectNodeRoomMessages` is used by `NodeRoom` and `NodeTranscriptPane`; both require exact scope.
- [x] `buildChatTimeline` remains the timeline adapter used by `LegacyGraphLogsPane`.
- [x] `createAskAnswerController` remains owned by `WorkflowExecution`, not each rendered AskCard.
- [x] `RunChatComposer` stays a controlled presentational component; send authorization stays at the existing boundary.
- [x] Shared graph exports are consumed by Legacy `WorkflowDagViewer`, `ExecutionDagNode`, `RunGraphRouteEdge`, and Console `RunGraphPanel`/graph adapter.
- [x] No production component, hook, context or store is imported into Console.
- [x] Existing Source Control tab actions, gate states and usage summaries remain accessible.
- [x] Focus and drafts survive polling and panel/tab changes.
- [x] Long output wraps or scrolls within its own content region, never over adjacent controls.
- [x] Raw tool output remains escaped text; keep current safe Markdown/link handling and do not copy mockup innerHTML renderers.

## Test Inventory and Commands

Extend current tests for:
`WorkflowExecution`, `LegacyGraphLogsPane`, `NodeRunList`, `LegacyNodeRoom`,
`NodeRoom`, `NodeTranscriptPane`, `ChatTimeline`, `RunChatComposer`,
`AskCard`, `ask-answer-controller`, `WorkflowAskChrome`,
`build-log-rows`, `build-chat-timeline`, `select-room-data`,
`ExecutionDagNode`, `RunGraphRouteEdge`, `build-run-graph-input`,
and `source-control/dag-run-tabs` under `packages/web/src/components/workflows/`.
Use their existing `.test.ts` or `.test.tsx` files.
Also extend `packages/web/src/lib/dag-layout.test.ts` and the existing `build-workflow-dag-view-model.test.ts`, `resolve-room-kind.test.ts`, `merge-agent-room-items.test.ts`, and `ask-card-presentation.test.ts` beside their owners.
Extend `layout.test.ts`, `positions.test.ts`, `routes.test.ts` and `taken-path.test.ts` under `packages/web/src/lib/run-graph/`.
Expected test impact: 400-700 changed lines focused on selection, scope, mutation state and geometry.

From `packages/web`, run focused files first:

```sh
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx
NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx src/components/workflows/ask-answer-controller.test.ts
bun test src/lib/run-graph/
```

Then from the root:

```sh
bun run --cwd packages/web test
bun run --cwd packages/web type-check
bun run lint
bun run build:web
bun run --cwd e2e test:ui --grep "HITL.*Legacy"
```

Use package test scripts for broad runs to preserve Bun mock isolation.
Do not run an unscoped `bun test` from the root.

## Scenario Matrix

| Priority | Scenario                                         | Expected result                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------ |
| Critical | Two inline/room Ask views submit together        | One request, synchronized state, no duplicate mutation |
| Critical | Select old route/loop occurrence                 | Only exact text, tools, stdout and decisions appear    |
| Critical | Send composer text that resembles approval       | Only a conversation message; no gate mutation          |
| High     | Graph/Logs/Chat/Source Control switches          | Same selected occurrence, draft, scroll and room width |
| High     | Deep link versus plain run entry                 | Room opens only for explicit selection                 |
| High     | Tool result/error/large output                   | Visible card and truthful completeness                 |
| High     | Gate annotation, approve/reject, late Ask answer | Existing API and permission behavior retained          |
| High     | Graph at min/max width with long node IDs        | Stable handles, readable labels, no overlap            |
| Medium   | Keyboard resize/close/awaiting navigation        | Focus remains visible and returns to trigger           |
| Medium   | Poll while scrolled up or writing                | No scroll jump or lost draft                           |
| Medium   | Narrow viewport and reduced motion               | Stacked room usable, no unnecessary motion             |

## Acceptance and Rollback

- [x] Every Legacy item in Phase 1's inventory has a completed evidence row.
- [x] The red tool-card and history reproduction passes.
- [x] Side-by-side reference comparison covers all room kinds and Graph/Logs/Chat.
- [x] Shared graph tests pass before Phase 4 consumes the changes.
- [x] No new visual token lacks a documented owner.

Main risk: shared graph changes can affect Console before Phase 4.
Keep optional additions backward-compatible and run Console graph tests with the shared patch.
Rollback Legacy UI and shared geometry as focused code changes.
Keep additive transcript/history support and immutable data intact.
