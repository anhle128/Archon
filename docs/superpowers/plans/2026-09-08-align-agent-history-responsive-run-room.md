# Align Agent History and Responsive Run Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Story 5.6 run-detail experience in both Legacy and Console, with execution-scoped agent history, an open-on-demand percentage run room, responsive single-pane navigation, inline human interaction, and honest end-to-end evidence.

**Architecture:** Keep each surface's React components isolated while sharing only pure, framework-neutral state and transcript projections from `packages/web/src/lib/`.
Use the existing node-message API and generated OpenAPI types as the source of truth, extending the response only where metadata is currently lost or transport truncation is currently invisible.
Make selection, paging, stale-request handling, scroll following, draft retention, and focus restoration explicit state transitions with observable tests before wiring them into either surface.

**Tech Stack:** Bun, TypeScript, React, Hono OpenAPI, Zod v4, Tailwind CSS, react-resizable-panels v4, happy-dom, and Playwright.

**Spec:** `plans/reports/brainstorm-260908-1653-workflow-run-hitl-ui-gap.md`.

**Issue:** `https://github.com/anhle128/Archon/issues/147`.

**Canonical UI references:** `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/README.md`, `index.html`, `app.js`, `console.html`, `console-app.js`, and `styles.css`.

## Global Constraints

- Implement all five delivery boundaries from the approved brainstorm, with Tasks 2 through 4 completing history foundations before Tasks 7 through 12 integrate room and main-view behavior.
- Treat the mockup's fixed dimensions as visual reference data only.
- Size the room as a percentage of the available run-detail work area, never as a fixed pixel width.
- Use string percentages for every `react-resizable-panels` size prop because v4 interprets numeric sizes as pixels.
- Open no room on an ordinary run-detail visit.
- Open a room for a valid `?node=<nodeId>` deep link.
- Preserve the active Log, Graph, Chat, Source Control, Terminal, or Artifacts view, its scroll position, the selected execution, and unsent drafts when entering and leaving the phone-sized room.
- Preserve the room transcript's reading position when the same execution is reopened during the current mounted visit.
- Keep the current run header, Log, Graph, Chat, Source Control, Terminal, Artifacts, IDE, overflow, cancel, retry, review, gate, usage, environment, and provenance controls unless this plan explicitly relocates one.
- Keep Legacy Chat visible when no parent conversation exists, retain the workflow timeline, and render a factual disabled composer.
- Keep Console imports within `packages/web/src/experiments/console/` plus type-only or approved `@/lib` imports, and keep `console-isolation.test.ts` green.
- Derive API row types from `components` in `api.generated.d.ts` or existing `@/lib/api` aliases, and do not create parallel hand-written API interfaces.
- Do not add a generated-file edit to `packages/web/src/lib/api.generated.d.ts` because the response schema already contains the required metadata and paging fields.
- Import `z` from `@hono/zod-openapi` for server schemas.
- Do not add source-text grep tests, change-detector tests, snapshot-only assertions, or tests that merely verify a mock was called.
- Every production behavior change follows RED, verified RED, GREEN, verified GREEN, then commit.
- DOM tests must install happy-dom, unmount every React root, close the happy-dom window, and restore globals in `afterEach`.
- Pure model tests must remain DOM-free.
- Use complete TypeScript annotations and no `any`.
- Use relative typography and spacing units for the touched run-detail presentation.
- Permit horizontal scrolling only inside code or preformatted output blocks, never at the page or room level.
- Keep the existing node-message compatibility response without cursor query parameters.
- Mark response-only tool-output truncation in message metadata and keep the detail endpoint's stored output full.
- Preserve live transcript polling at the existing one-second cadence, allow only one cursor drain at a time per scope, and stop polling after a terminal run reaches its scoped high-water mark.
- Never infer an execution prompt from current workflow YAML or prose.
- Use `rg` for repository searches.
- Run `bun run validate` from the repository root before marking the story done.
- Do not run `bun test` from the repository root.
- Do not run `git clean -fd`.
- Keep every full Markdown sentence on its own physical line.

## Acceptance Criteria

1. Both Legacy and Console open with the room absent and the primary work area using the released width.
2. Clicking a Log execution or graph node opens the room and gives it the stored percentage of the available work area.
3. Closing the room removes its panel and divider, returns the width to the main view, and restores focus to the opener when that opener still exists.
4. On a single-pane container, opening the room keeps the main view mounted but hidden, and Back restores the exact Log or Graph state.
5. A valid `?node=` deep link opens the required node exactly once per query-value entry and does not reopen after a manual close until the query leaves and re-enters that value.
6. Changing the run id resets room selection, explicit-execution memory, saved room scroll positions, Ask drafts, and the deep-link application marker.
7. A graph-node click restores the last explicit execution for that node, then prefers awaiting, then running, then the latest execution.
8. The room header identifies the selected execution with node label, iteration or attempt context, status, run-relative start time, duration when recorded, and provider/model only from the matching selected execution event.
9. Completed executions open at the top, active executions open at the bottom in follow mode, scrolling up disables follow mode, and Jump to latest re-enables it.
10. Node-message paging drains all pages through the scoped high-water mark, polls a live scope without overlapping requests, deduplicates by `seq`, ignores late responses from an obsolete scope, aborts obsolete requests, and retains already loaded rows if a later page fails.
11. Assistant text is projected in sequence order without duplicated deltas or snapshots.
12. Every tool invocation is one structured card with tool name, full allowlisted context, initially expanded Input and Output, inline outcome and duration, honest pending, missing, failed, interrupted, and truncated states, and a detail link only when the list response marks the output truncated.
13. Ask cards and approval gates appear at their actual execution position when execution scope is recorded, and an explicit limitation appears for legacy unscoped data.
14. The same pending Ask request uses one controlled draft whether rendered in the room or in the main execution section, and answered or declined requests remain as compact read-only records.
15. Console Log renders one section per `ConsoleLogEntry` and never assigns repeated executions by node id alone.
16. Console Reply sends only to an existing parent conversation whose recorded `platform_type` is `web`, and it never creates a fallback conversation.
17. The Awaiting-input action opens the matching execution and focuses its Ask card, while run tabs, graph selection, graph pan and zoom, and existing operational controls remain usable.
18. A 120-tool-call fixture proves that the UI itself requests more than one cursor page and renders every distinct recorded call.
19. The acceptance report records actual behavior at 1440 by 1000, 1024 by 900, 768 by 900, and 390 by 844 for both surfaces, and labels every mismatch as a concrete deviation.
20. Legacy Chat, Source Control, and Terminal remain available, including timeline-only Chat with a disabled composer when no parent conversation exists.
21. Console Artifacts remains in the main pane while the selected room stays docked.
22. `bun run validate` and the focused Playwright HITL suite pass.

## Resolved Design Decisions

- Use `40%` as the default room ratio, `24%` as the minimum, and `60%` as the maximum.
- Persist the ratio in localStorage per surface under `archon.run-room.ratio.legacy` and `archon.run-room.ratio.console`.
- Switch to single-pane mode when the measured container is narrower than `60rem`, calculated against the current root font size rather than a hard-coded pixel conversion.
- Keep the primary pane mounted with the HTML `hidden` attribute in single-pane room mode so its scroll and form state survive.
- Store room transcript `scrollTop` by run id plus execution selection key in parent state for the mounted visit.
- Attach a scoped Ask only to a matching occurrence and attempt.
- Attach an unscoped Ask or approval gate only to the latest execution section for that node and show `Execution scope was not recorded for this interaction.`.
- Treat Console conversation `platform_type === 'web'` as the only valid Reply destination.
- Retain the existing Console Awaiting-input chrome and also make the header's Awaiting-input status actionable.
- Render full allowlisted tool context and let CSS wrap it rather than truncating it.
- Render normal tool Input and Output `details` elements with the `open` attribute.
- Keep system and lifecycle entries secondary to assistant and tool history.
- Do not compare the product's responsive percentage ratio with the mockup's fixed-pixel ratio.

## Open Questions

### Prompt and instruction capture

The existing node-message schema records generated text, tool traffic, and status, but it does not record the exact prompt or instruction sent into an execution.
The safe provisional default is to render only recorded rows and never reconstruct a historical prompt from the current workflow definition.
A future prompt-capture change must add a new execution-time persisted row or field before adding a UI renderer.

## File Structure

### Create

- `packages/web/src/lib/room-split-layout.ts` owns percent sizing, clamping, and per-surface persistence.
- `packages/web/src/lib/room-split-layout.test.ts` covers observable size and storage behavior.
- `packages/web/src/lib/node-message-pages.ts` owns the pure cursor-page reducer and scope key.
- `packages/web/src/lib/node-message-pages.test.ts` covers paging, deduplication, terminal draining, stale scopes, and retained failures.
- `packages/web/src/lib/agent-history.ts` projects generated node-message rows into render-neutral history items.
- `packages/web/src/lib/agent-history.test.ts` covers text, tool, status, context, truncation, ordering, and outcomes.
- `packages/web/src/lib/execution-room-model.ts` owns default execution choice, selected-execution header data, deep-link application, visit memory, and opener ids.
- `packages/web/src/lib/execution-room-model.test.ts` covers each deterministic room transition.
- `packages/web/src/lib/room-scroll-follow.ts` owns initial positioning and follow-mode transitions.
- `packages/web/src/lib/room-scroll-follow.test.ts` covers completed, active, manual-scroll, and jump transitions.
- `packages/web/src/lib/use-container-split-mode.ts` measures the work-area container in rem-aware units.
- `packages/web/src/lib/use-container-split-mode.test.tsx` covers threshold, zoom-equivalent root font changes, and observer cleanup.
- `packages/web/src/components/workflows/NodeRoomHeader.tsx` renders the Legacy selected-execution header.
- `packages/web/src/components/workflows/NodeRoomHeader.test.tsx` covers the visible header and selector contract.
- `packages/web/src/components/workflows/RoomIncompleteNotice.tsx` renders retained-history failure and Retry.
- `packages/web/src/experiments/console/primitives/console-resizable.tsx` keeps the Console wrapper ownership local.
- `packages/web/src/experiments/console/primitives/console-resizable.test.tsx` verifies string-percent rendering and separator semantics.
- `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx` renders the Console selected-execution header.
- `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx` covers the visible header and selector contract.
- `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` renders Console-owned agent-history items.
- `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` loads and renders one exact Console execution section.
- `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` covers scoped messages, Ask placement, filtering, and the legacy limitation.
- `packages/web/src/experiments/console/components/inspect/execution-interactions.ts` assigns interactions by execution identity.
- `packages/web/src/experiments/console/components/inspect/execution-interactions.test.ts` covers repeated-node assignment and unscoped fallback.
- `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx` renders the parent-conversation Reply control.
- `packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx` covers each destination state.
- `packages/web/src/experiments/console/skills/conversations.test.ts` covers parent-conversation lookup normalization, encoding, abort forwarding, and errors.
- `e2e/fixtures/workflows/e2e-hitl-long-history.yaml` creates more than one cursor page of tool history.
- `e2e/ui/workflow-run-hitl-room.spec.ts` proves the accepted room and history behavior.
- `plans/reports/acceptance-260908-story-5-6.md` records viewport evidence and limitations.

### Modify

- `packages/web/src/components/ui/resizable.tsx` adds a run-room-specific percent-only panel while leaving the generic wrapper compatible with Source Control.
- `packages/web/src/index.css` adds run-view typography and tool-card tokens without duplicating ratio policy.
- `packages/docs-web/src/content/docs/brand/index.md` documents the new presentation tokens.
- `packages/server/src/routes/api.ts` preserves metadata in compatibility mode and marks response truncation in cursor mode.
- `packages/server/src/routes/api.workflow-runs.test.ts` updates the compatibility-shape assertion and covers truncation metadata.
- `packages/web/src/lib/api.ts` forwards AbortSignal for node-message requests.
- `packages/web/src/lib/get-workflow-node-messages.test.ts` covers list paging, the forwarded signal, and full-message detail lookup.
- `packages/web/src/components/workflows/build-log-rows.ts` derives run-relative timing and unknown-scope state from existing generated `NodeExecution`.
- `packages/web/src/components/workflows/build-log-rows.test.ts` covers those derived fields.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` becomes a controlled, percentage, responsive room host.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` covers absence, split, single-pane, retained main view, selection, and Back.
- `packages/web/src/components/workflows/WorkflowExecution.tsx` owns Legacy room visit state and removes unconditional initial selection.
- `packages/web/src/components/workflows/WorkflowExecution.test.tsx` covers visit, deep-link, run-change, focus, and control preservation.
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx` receives exact execution selection and saved scroll position.
- `packages/web/src/components/workflows/NodeRoom.tsx` renders Legacy agent-history items.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` drives cursor paging and scroll following.
- `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` covers paging, retry, stale request, and scroll behavior.
- `packages/web/src/components/workflows/AskCard.tsx` becomes a controlled draft component.
- `packages/web/src/components/workflows/AskCard.test.tsx` covers controlled draft updates.
- `packages/web/src/components/workflows/build-chat-timeline.ts` inserts Ask and gate entries at execution positions.
- `packages/web/src/components/workflows/build-chat-timeline.test.ts` covers scoped and unscoped placement.
- `packages/web/src/components/workflows/ChatTimeline.tsx` renders inline Ask and gate items.
- `packages/web/src/components/workflows/ChatTimeline.test.tsx` covers shared draft rendering and action preservation.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx` keeps Chat visible without a parent conversation.
- `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx` covers the always-visible Legacy navigation.
- `packages/web/src/components/workflows/RunChatComposer.tsx` renders factual disabled copy when delivery is impossible.
- `packages/web/src/components/workflows/RunChatComposer.test.tsx` covers the missing-parent disabled state.
- `packages/web/src/components/workflows/NodeRunList.tsx` gives each execution button a stable opener id.
- `packages/web/src/components/workflows/ExecutionDagNode.tsx` uses relative tokens and a focusable opener id.
- `packages/web/src/components/workflows/ExecutionDagNode.test.tsx` covers the opener and token classes.
- `packages/web/src/components/workflows/build-workflow-dag-view-model.ts` supplies the Legacy graph opener id.
- `packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts` covers that id.
- `packages/web/src/experiments/console/skills/runs.ts` retains `parent_platform_id` and forwards AbortSignal.
- `packages/web/src/experiments/console/skills/runs.node-messages.test.ts` covers list paging, full-message detail lookup, parent identity, and AbortSignal forwarding.
- `packages/web/src/experiments/console/skills/conversations.ts` adds parent-conversation lookup.
- `packages/web/src/experiments/console/store/keys.ts` adds an encoded nullable parent-conversation cache key.
- `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` becomes a percentage, responsive room host.
- `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` covers absence, split, single-pane, retained Log state, and docked Artifacts.
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` renders the selected header and shared agent-history list.
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` covers selected execution, paging, scroll, Ask, and gate behavior.
- `packages/web/src/experiments/console/components/RunStream.tsx` renders one execution body per exact log row.
- `packages/web/src/experiments/console/components/RunStream.test.tsx` proves repeated rows do not share a body.
- `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx` becomes a controlled draft component.
- `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx` covers controlled draft updates.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx` owns Console visit state, Ask drafts, deep links, and Reply eligibility.
- `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` covers room lifecycle, execution sections, shared drafts, actionable status, and Reply.
- `packages/web/src/experiments/console/components/RunDetailHeader.tsx` makes Awaiting input actionable and adopts relative presentation.
- `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx` covers its click behavior.
- `packages/web/src/experiments/console/components/RunGraphPanel.tsx` adds opener ids and relative graph typography.
- `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` covers the opener id while retaining existing selection and scrolling tests.
- `packages/web/src/experiments/console/components/NodeDivider.tsx` puts the row opener id on its focusable button.
- `packages/web/src/experiments/console/components/NodeDivider.test.tsx` covers the id.
- `packages/web/src/experiments/console/components/StreamToolbar.tsx` adopts relative tab typography without changing tab semantics.
- `packages/web/src/experiments/console/console-isolation.test.ts` allows only the new approved `@/lib` type and pure-helper imports.
- `packages/providers/src/e2e-fake/provider.ts` adds bounded repeat-tool output while preserving the old default trace.
- `packages/providers/src/e2e-fake/provider.test.ts` covers bounds, unique ids, and default compatibility.
- `e2e/lib/playwright/archon-runtime.ts` installs and runs the long-history fixture.
- `e2e/lib/playwright/run-detail.ts` adds cursor-page observation helpers without replacing the compatibility helper.
- `e2e/ui/workflow-run-hitl-visual.spec.ts` replaces its vacuous capture assertion with comparable-state evidence.
- `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` records Story 5.6 and its exact acceptance criteria.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` moves Story 5.6 from in-progress to done only after validation.

### Delete

- `packages/web/src/lib/select-initial-node.ts` removes the unconditional first-node behavior.
- `packages/web/src/lib/select-initial-node.test.ts` removes the obsolete expectation.

## Implementation Order

Task 1 locks the percentage type guard without integrating the room, Tasks 2 through 4 complete history transport and projection, Tasks 5 and 6 complete pure room state, Tasks 7 through 12 integrate Legacy and Console, Task 13 aligns surrounding presentation, and Tasks 14 and 15 supply acceptance evidence.
Do not begin a dependent task until the preceding task is green and committed.

---

### Task 1: Lock the Percentage Split Contract

**Files:**

- Create: `packages/web/src/lib/room-split-layout.ts`.
- Test: `packages/web/src/lib/room-split-layout.test.ts`.
- Modify: `packages/web/src/components/ui/resizable.tsx`.
- Create: `packages/web/src/experiments/console/primitives/console-resizable.tsx`.
- Test: `packages/web/src/experiments/console/primitives/console-resizable.test.tsx`.

**Interfaces:**

- Produces ``PanelPercent = `${number}%` ``.
- Produces `roomPanelSizes(roomRatio: number): { view: { defaultSize: PanelPercent; minSize: PanelPercent }; room: { defaultSize: PanelPercent; minSize: PanelPercent; maxSize: PanelPercent } }`.
- Produces `readRoomRatio(surface: RoomSurface, storage: Pick<Storage, 'getItem'>): number`.
- Produces `writeRoomRatio(surface: RoomSurface, value: number, storage: Pick<Storage, 'setItem'>): void`.
- Produces Legacy `PercentResizablePanel` and Console `ConsolePanel` with percent-only size props.
- Leaves the existing generic `ResizablePanel` signature unchanged for non-room consumers.

- [ ] **Step 1: Write the failing pure tests.**

Add these cases to `room-split-layout.test.ts`.

```ts
const storage = new Map<string, string>();
const memoryStorage = {
  getItem(key: string): string | null {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
};

test('uses percentage strings for every panel boundary', () => {
  expect(roomPanelSizes(40)).toEqual({
    view: { defaultSize: '60%', minSize: '30%' },
    room: { defaultSize: '40%', minSize: '24%', maxSize: '60%' },
  });
});

test('clamps persisted ratios and isolates surfaces', () => {
  writeRoomRatio('legacy', 90, memoryStorage);
  expect(readRoomRatio('legacy', memoryStorage)).toBe(60);
  expect(readRoomRatio('console', memoryStorage)).toBe(40);
  storage.set('archon.run-room.ratio.console', 'broken');
  expect(readRoomRatio('console', memoryStorage)).toBe(40);
});
```

- [ ] **Step 2: Run the pure tests and verify RED.**

Run `bun test src/lib/room-split-layout.test.ts` from `packages/web`.
Expected: FAIL because `room-split-layout.ts` does not exist.

- [ ] **Step 3: Implement the pure contract.**

Use this exact policy in `room-split-layout.ts`.

```ts
export type PanelPercent = `${number}%`;
export type RoomSurface = 'legacy' | 'console';

export const ROOM_SPLIT = {
  defaultRoomRatio: 40,
  minRoomRatio: 24,
  maxRoomRatio: 60,
  minViewRatio: 30,
} as const;

function percent(value: number): PanelPercent {
  return `${String(value)}%`;
}

export function clampRoomRatio(value: number): number {
  if (!Number.isFinite(value)) return ROOM_SPLIT.defaultRoomRatio;
  return Math.min(ROOM_SPLIT.maxRoomRatio, Math.max(ROOM_SPLIT.minRoomRatio, value));
}

export function roomPanelSizes(roomRatio: number) {
  const room = clampRoomRatio(roomRatio);
  return {
    view: {
      defaultSize: percent(100 - room),
      minSize: percent(ROOM_SPLIT.minViewRatio),
    },
    room: {
      defaultSize: percent(room),
      minSize: percent(ROOM_SPLIT.minRoomRatio),
      maxSize: percent(ROOM_SPLIT.maxRoomRatio),
    },
  };
}

function storageKey(surface: RoomSurface): string {
  return 'archon.run-room.ratio.' + surface;
}

export function readRoomRatio(
  surface: RoomSurface,
  storage: Pick<Storage, 'getItem'>
): number {
  const raw = storage.getItem(storageKey(surface));
  if (raw === null) return ROOM_SPLIT.defaultRoomRatio;
  const value = Number(raw);
  return Number.isFinite(value) ? clampRoomRatio(value) : ROOM_SPLIT.defaultRoomRatio;
}

export function writeRoomRatio(
  surface: RoomSurface,
  value: number,
  storage: Pick<Storage, 'setItem'>
): void {
  storage.setItem(storageKey(surface), String(clampRoomRatio(value)));
}
```

Add `PercentResizablePanel` beside `ResizablePanel` and give it public props whose `defaultSize`, `minSize`, and `maxSize` are `PanelPercent | undefined`.
Give the new Console `ConsolePanel` the same percent-only size props.
Give both groups an `onLayoutChanged?: (layout: Record<string, number>) => void` prop and stable child ids later in Tasks 7 and 10.
Do not add CSS ratio variables because `ROOM_SPLIT` is the only ratio policy consumed at runtime.

```ts
type PercentPanelProps = Omit<
  ResizablePrimitive.PanelProps,
  'defaultSize' | 'minSize' | 'maxSize'
> & {
  defaultSize?: PanelPercent;
  minSize?: PanelPercent;
  maxSize?: PanelPercent;
};

function PercentResizablePanel(props: PercentPanelProps): React.ReactElement {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}
```

- [ ] **Step 4: Write the failing wrapper behavior test.**

Render the Console wrapper with `defaultSize="60%"` and `defaultSize="40%"` in happy-dom.
Assert that both panels and a separator with `role="separator"` exist.
Name the exact production defect before running: using a number with either run-room-specific panel must make type-check fail, while removing the separator must make this DOM test fail.

- [ ] **Step 5: Run the wrapper test and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/primitives/console-resizable.test.tsx` from `packages/web`.
Expected: FAIL because `console-resizable.tsx` does not exist.

- [ ] **Step 6: Implement the wrappers and verify GREEN.**

The Console wrapper may import `Group`, `Panel`, and `Separator` directly from `react-resizable-panels`.
It must not import the Legacy `@/components/ui/resizable` module.
Do not narrow generic `ResizablePanel` because `source-control-split.tsx` remains a separate existing consumer.
Run `bun test src/lib/room-split-layout.test.ts`, `NODE_ENV=development bun test src/experiments/console/primitives/console-resizable.test.tsx`, and `bun --filter @archon/web type-check` from the repository root.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/web/src/lib/room-split-layout.ts packages/web/src/lib/room-split-layout.test.ts packages/web/src/components/ui/resizable.tsx packages/web/src/experiments/console/primitives/console-resizable.tsx packages/web/src/experiments/console/primitives/console-resizable.test.tsx
git commit -m "fix(web): enforce percentage run-room panels"
```

---

### Task 2: Make Node-Message Transport Lossless and Abortable

**Files:**

- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify: `packages/server/src/routes/api.ts`.
- Modify: `packages/web/src/lib/get-workflow-node-messages.test.ts`.
- Modify: `packages/web/src/lib/api.ts`.
- Modify: `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`.
- Modify: `packages/web/src/experiments/console/skills/runs.ts`.

**Interfaces:**

- Extends both node-message client option objects with `signal?: AbortSignal`.
- Adds Legacy `getWorkflowNodeMessage(runId: string, nodeId: string, messageId: string, options?: { signal?: AbortSignal }): Promise<WorkflowNodeMessageResponse>`.
- Adds Console `getNodeMessage(runId: string, nodeId: string, messageId: string, options?: { signal?: AbortSignal }): Promise<WorkflowNodeMessage>`.
- Keeps `WorkflowNodeMessage` and `WorkflowNodeMessagesResponse` derived from generated `components`.
- Keeps the no-query response shape `{ messages }` and adds each row's existing optional `metadata`.
- Marks only a cursor-list response's truncated tool output with `metadata.truncated = true` and `metadata.output_state = 'truncated'`.
- Keeps `GET /messages/:messageId` full and unchanged.

- [ ] **Step 1: Update the server tests first.**

Rename the existing test `no-query response is exactly { messages } with no metadata or paging keys` to `no-query response is exactly { messages } with row metadata and no paging keys`.
Give its DB row `metadata: { stream_id: 'stream-1' }`.
Assert `Object.keys(body)` equals `['messages']` and `body.messages[0]?.metadata` equals `{ stream_id: 'stream-1' }`.
Add a cursor test whose stored tool output is longer than the existing `truncateToolOutput` limit.
Assert the list row has a shorter output plus `truncated: true` and `output_state: 'truncated'`, then call the detail route and assert its output equals the full stored string.

- [ ] **Step 2: Run the server tests and verify RED.**

Run `bun test src/routes/api.workflow-runs.test.ts` from `packages/server`.
Expected: the compatibility test fails because metadata is absent, and the truncation test fails because the response does not mark truncation.

- [ ] **Step 3: Implement one response mapper.**

Add a local typed mapper next to the route.
For a tool row with string output, compute `const output = truncateToolOutput(row.payload.output)` and compare it with the original string.
When they differ, merge response-only metadata as shown below.

```ts
const metadata =
  output !== row.payload.output
    ? {
        ...(row.metadata ?? {}),
        truncated: true,
        output_state: 'truncated' as const,
      }
    : row.metadata;
```

Use the mapper without output truncation in compatibility mode.
Use it with output truncation in cursor mode.
Do not write the merged metadata back to the database.

- [ ] **Step 4: Verify the server GREEN.**

Run `bun test src/routes/api.workflow-runs.test.ts` from `packages/server`.
Expected: PASS.

- [ ] **Step 5: Write abort-forwarding client tests.**

In both client test files, create an `AbortController`, call the client with `signal: controller.signal`, and assert `fetchSpy.mock.calls[0]?.[1]?.signal` is that signal.
Also retain the exact query-string assertions for `afterSeq`, `limit`, `occurrenceId`, and `attemptId`.
Call each new detail client with ids containing slashes and spaces.
Assert the URL is `/api/workflows/runs/run%2Fone/nodes/node%20one/messages/message%2Fone`, the exact generated message row is returned, and the AbortSignal reaches fetch.
Name the production defect: omitting the `RequestInit` signal from either fetch boundary must fail its test.

- [ ] **Step 6: Run client tests and verify RED.**

Run `bun test src/lib/get-workflow-node-messages.test.ts` and `bun test src/experiments/console/skills/runs.node-messages.test.ts` from `packages/web`.
Expected: both new signal assertions fail.

- [ ] **Step 7: Forward the signal without serializing it.**

Destructure or read `options.signal` separately from URL query fields.
Call Legacy `fetchJSON(url, { signal: options.signal })` and Console `requestJson(url, { signal: options.signal })` only when a signal exists.
Do not put `signal` in `URLSearchParams`.
Implement the two detail functions against the already registered `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages/{messageId}` route.
Encode each path segment independently.

```ts
export async function getWorkflowNodeMessage(
  runId: string,
  nodeId: string,
  messageId: string,
  options?: { signal?: AbortSignal }
): Promise<WorkflowNodeMessageResponse> {
  const url =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages/' +
    encodeURIComponent(messageId);
  return fetchJSON(url, options?.signal === undefined ? undefined : { signal: options.signal });
}
```

Implement Console `getNodeMessage` with the identical encoded path and return `requestJson<WorkflowNodeMessage>(url, requestInit)`.

- [ ] **Step 8: Verify clients and commit.**

Run the two focused web tests and `bun --filter @archon/web type-check`.
Expected: PASS.

```bash
git add packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.ts packages/web/src/lib/get-workflow-node-messages.test.ts packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts
git commit -m "fix(run-history): preserve metadata and abort stale pages"
```

---

### Task 3: Build the Shared Cursor-Page State Machine

**Files:**

- Create: `packages/web/src/lib/node-message-pages.ts`.
- Test: `packages/web/src/lib/node-message-pages.test.ts`.

**Interfaces:**

- Uses `components['schemas']['WorkflowNodeMessage']` and `components['schemas']['WorkflowNodeMessagesResponse']` through a type-only import.
- Produces `nodeMessageScopeKey(runId: string, nodeId: string, selection: NodeMessageSelection): string`.
- Produces `createNodeMessageState(scopeKey: string): NodeMessageState`.
- Produces `reduceNodeMessagePage(state: NodeMessageState, scopeKey: string, page: NodeMessagePage): NodeMessageState`.
- Produces `reduceNodeMessageFailure(state: NodeMessageState, scopeKey: string, error: unknown): NodeMessageState`.
- Produces `drainNodeMessages(args: DrainNodeMessagesArgs): Promise<NodeMessageState>`.

- [ ] **Step 1: Write the reducer tests.**

Use generated aliases and cover these exact observable cases.

```ts
test('sorts by seq and keeps one row for duplicate seq values', () => {
  const state = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
    messages: [message(2), message(1), message(2)],
    hasMore: false,
    highWatermark: 2,
    nextCursor: '2',
  });
  expect(state.rows.map(row => row.seq)).toEqual([1, 2]);
});

test('is complete only after hasMore is false and the scoped watermark is reached', () => {
  const first = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
    messages: [message(1)],
    hasMore: false,
    highWatermark: 3,
    nextCursor: '1',
  });
  expect(first.complete).toBe(false);
  const second = reduceNodeMessagePage(first, 'scope-a', {
    messages: [message(2), message(3)],
    hasMore: false,
    highWatermark: 3,
    nextCursor: '3',
  });
  expect(second.complete).toBe(true);
});

test('ignores a page and a failure from an obsolete scope', () => {
  const current = createNodeMessageState('scope-b');
  expect(reduceNodeMessagePage(current, 'scope-a', page(1))).toBe(current);
  expect(reduceNodeMessageFailure(current, 'scope-a', new Error('late'))).toBe(current);
});

test('retains loaded rows and exposes retry after a later-page failure', () => {
  const loaded = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', page(1));
  const failed = reduceNodeMessageFailure(loaded, 'scope-a', new Error('network'));
  expect(failed.rows.map(row => row.seq)).toEqual([1]);
  expect(failed.error).toBe('network');
  expect(failed.complete).toBe(false);
});
```

- [ ] **Step 2: Run the tests and verify RED.**

Run `bun test src/lib/node-message-pages.test.ts` from `packages/web`.
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the types and reducer.**

Use this selection and loader boundary.

```ts
import type { components } from './api.generated';

export type NodeMessageRow = components['schemas']['WorkflowNodeMessage'];
export type NodeMessagePage = components['schemas']['WorkflowNodeMessagesResponse'];

export type NodeMessageSelection =
  | { kind: 'node'; rowId: string }
  | { kind: 'occurrence'; occurrenceId: string; attemptId?: string };

export interface NodeMessageState {
  scopeKey: string;
  rows: NodeMessageRow[];
  afterSeq: number;
  highWatermark: number | null;
  complete: boolean;
  loading: boolean;
  error: string | null;
}

export interface NodeMessageLoader {
  (
    runId: string,
    nodeId: string,
    options: {
      afterSeq: number;
      limit: number;
      occurrenceId?: string;
      attemptId?: string;
      signal?: AbortSignal;
    }
  ): Promise<NodeMessagePage>;
}
```

Deduplicate with `Map<number, NodeMessageRow>` and sort ascending.
Use a valid numeric `nextCursor` when supplied, otherwise use the maximum received `seq`.
Treat an empty nonterminal page that makes no cursor progress as an explicit error to prevent an infinite loop.
Set `complete` only when `hasMore !== true` and `afterSeq >= highWatermark`, with a missing watermark treated as the current `afterSeq` only for the compatibility shape.

- [ ] **Step 4: Add driver tests.**

Test that `drainNodeMessages` requests `limit: 100` repeatedly, passes the exact occurrence and attempt, reaches the watermark after a terminal empty poll, aborts when its signal aborts, and resumes from retained `afterSeq` after a failure.
Use a deterministic in-memory loader with queued promises, not a mocked module.

- [ ] **Step 5: Run driver tests and verify RED.**

Run `bun test src/lib/node-message-pages.test.ts`.
Expected: the reducer cases pass and the new driver cases fail because `drainNodeMessages` is absent.

- [ ] **Step 6: Implement the driver and verify GREEN.**

The driver must dispatch one request at a time.
It must call the supplied `onState(next)` after every page and failure.
It must not convert `AbortError` into a visible retry error.
The scope key must include `rowId` for unscoped fallback selections so two historical rows never share scroll or request state.
Run `bun test src/lib/node-message-pages.test.ts`.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/web/src/lib/node-message-pages.ts packages/web/src/lib/node-message-pages.test.ts
git commit -m "feat(run-history): add scoped cursor page state"
```

---

### Task 4: Project Recorded Rows into Agent History

**Files:**

- Create: `packages/web/src/lib/agent-history.ts`.
- Test: `packages/web/src/lib/agent-history.test.ts`.

**Interfaces:**

- Consumes `NodeMessageRow` from Task 3.
- Reuses `projectTextTranscript` and `projectToolTranscript`.
- Produces the discriminated union `AgentHistoryItem` and `buildAgentHistory(input: AgentHistoryInput): AgentHistoryItem[]`.
- Produces `toolContext(input: unknown): Array<{ label: string; value: string }>`.
- Produces `toolRuntime(events, nodeId, toolUseId): { durationMs: number | null }`.

- [ ] **Step 1: Write the projection tests.**

Use interleaved text deltas, a snapshot, tool call/result pairs, a status row, and one transport-truncated tool row.
Assert the resulting item kinds and sequence anchors are `assistant`, `tool`, and `lifecycle` in ascending order.
Assert the assistant body does not duplicate snapshot text.
Assert one tool card contains both Input and Output, status `failed` for a nonzero exit code, duration when recorded, and `canLoadFullOutput: true` only when metadata says `truncated` or `output_state === 'truncated'`.
Supply one `tool_completed` workflow event whose `step_name`, `data.tool_call_id`, and finite nonnegative `data.duration_ms` match the card and assert that duration.
Supply two matching completion events and assert duration is null because the join is ambiguous.
Assert `toolContext` returns the full trimmed values for `cmd`, `path`, `file_path`, `query`, and `url` and ignores every other field.
Use a value longer than 120 characters and assert it remains complete.

- [ ] **Step 2: Run the tests and verify RED.**

Run `bun test src/lib/agent-history.test.ts` from `packages/web`.
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the render-neutral union.**

Use these public shapes.

```ts
import type { components } from './api.generated';

export interface AgentHistoryInput {
  rows: readonly NodeMessageRow[];
  events: readonly components['schemas']['WorkflowEvent'][];
  nodeId: string;
}

export type AgentHistoryItem =
  | {
      kind: 'assistant';
      id: string;
      seq: number;
      role: 'assistant';
      text: string;
    }
  | {
      kind: 'tool';
      id: string;
      seq: number;
      role: 'tool';
      name: string;
      toolUseId: string;
      context: Array<{ label: string; value: string }>;
      input: unknown;
      output: unknown;
      outcome: 'running' | 'succeeded' | 'failed' | 'unknown';
      durationMs: number | null;
      canLoadFullOutput: boolean;
      messageId: string;
    }
  | {
      kind: 'lifecycle';
      id: string;
      seq: number;
      state: string;
      detail: string | null;
    };
```

Pair tool phases through `projectToolTranscript` and text modes through `projectTextTranscript` rather than duplicating either algorithm.
Choose a tool item's `seq` from its call row so it stays at the invocation position.
Set `toolUseId` from the recorded tool payload id.
Set `messageId` to `card.result?.id ?? card.call?.id ?? card.id` so full-output lookup targets the row that actually owns output while remaining total for the helper's nullable card fields.
Find duration only from a `tool_completed` event with the same node id and `data.tool_call_id`.
Use `data.duration_ms` only when exactly one event matches and the value is finite and nonnegative.
Return null when no event or more than one event matches, because node id alone cannot disambiguate repeated execution events.
Derive failure from recorded error, failed state, or nonzero exit code only.
Do not parse natural-language output to infer success or failure.
Render status rows as secondary lifecycle items.

- [ ] **Step 4: Verify GREEN and commit.**

Run `bun test src/lib/agent-history.test.ts src/lib/pair-tool-transcript.test.ts src/lib/project-text-transcript.test.ts` from `packages/web`.
Expected: PASS.

```bash
git add packages/web/src/lib/agent-history.ts packages/web/src/lib/agent-history.test.ts
git commit -m "feat(run-history): project structured agent history"
```

---

### Task 5: Model Execution Identity and Header Data

**Files:**

- Create: `packages/web/src/lib/execution-room-model.ts`.
- Test: `packages/web/src/lib/execution-room-model.test.ts`.
- Modify: `packages/web/src/components/workflows/build-log-rows.ts`.
- Modify: `packages/web/src/components/workflows/build-log-rows.test.ts`.
- Modify: `packages/web/src/experiments/console/components/inspect/build-log-rows.ts`.
- Modify: `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts`.

**Interfaces:**

- Consumes the existing Legacy and Console `LogRow` selections.
- Uses the existing generated `NodeExecution` alias rather than a new API interface.
- Produces `chooseExecutionForNode(rows, nodeId, lastExplicitRowId): LogRow | null`.
- Produces `buildExecutionHeader(input): ExecutionHeaderModel`.
- Produces `runtimeForSelection(events, row): { provider: string; model: string } | null`.
- Produces `roomOpenerId(surface, kind, key): string`.
- Produces `askCardId(requestId: string): string`.

- [ ] **Step 1: Write the choice tests.**

Assert this order with four rows for the same node.
A valid last-explicit row wins.
Without one, an awaiting row wins over running and completed.
Without awaiting, running wins.
Without awaiting or running, the latest row by `order` wins.
A stale last-explicit id is ignored.
A node with no rows returns null.

- [ ] **Step 2: Write the header tests.**

Assert labels `Iteration 2`, `Attempt 3`, and `Execution unknown` from actual selection data.
Assert `startedOffsetMs` is measured from the run's `started_at`.
Assert duration is absent when the selected execution has no `duration_ms` even if another execution does.
Assert provider/model comes from the `node_started` event whose `occurrence_id` and `attempt_id` match the selected row.
Assert an event for a later execution is not used.
Assert an unscoped row may use the latest unscoped `node_started` event for the same node and is marked `unknownScope: true`.

- [ ] **Step 3: Run the tests and verify RED.**

Run `bun test src/lib/execution-room-model.test.ts src/components/workflows/build-log-rows.test.ts src/experiments/console/components/inspect/build-log-rows.test.ts` from `packages/web`.
Expected: new model tests fail because the module is absent, and new timing assertions fail because the rows lack the derived fields.

- [ ] **Step 4: Implement the model with selected-row-only timing.**

Use this header contract.

```ts
export interface ExecutionHeaderModel {
  nodeId: string;
  nodeLabel: string;
  executionLabel: string;
  status: string;
  startedOffsetMs: number | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  unknownScope: boolean;
}
```

Do not compute a `timingAvailable` flag with `rows.some`.
Every visible timing and runtime field must come from the selected row or its matching start event.
Encode opener keys with `encodeURIComponent` and prefix them with `legacy-log-`, `legacy-graph-`, `console-log-`, or `console-graph-`.
Encode Ask request ids with `encodeURIComponent` and prefix them with `run-ask-card-`.

- [ ] **Step 5: Extend both log-row builders.**

Add `startedOffsetMs?: number` and `unknownScope: boolean` to the local `LogRow` interfaces.
For server `nodeExecutions`, compute offsets from `runStartedAt` passed into the builder and set `unknownScope` false when occurrence identity exists.
For event fallback, compute the best recorded offset and set `unknownScope` true.
Update every call site to pass the run start time.

- [ ] **Step 6: Verify GREEN and commit.**

Run the three focused test files and `bun --filter @archon/web type-check`.
Expected: PASS.

```bash
git add packages/web/src/lib/execution-room-model.ts packages/web/src/lib/execution-room-model.test.ts packages/web/src/components/workflows/build-log-rows.ts packages/web/src/components/workflows/build-log-rows.test.ts packages/web/src/experiments/console/components/inspect/build-log-rows.ts packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts
git commit -m "feat(run-room): model exact execution identity"
```

---

### Task 6: Model Room Visits, Responsive Mode, and Scroll Following

**Files:**

- Extend: `packages/web/src/lib/execution-room-model.ts`.
- Extend test: `packages/web/src/lib/execution-room-model.test.ts`.
- Create: `packages/web/src/lib/room-scroll-follow.ts`.
- Test: `packages/web/src/lib/room-scroll-follow.test.ts`.
- Create: `packages/web/src/lib/use-container-split-mode.ts`.
- Test: `packages/web/src/lib/use-container-split-mode.test.tsx`.

**Interfaces:**

- Produces `RoomVisitState`, `openRoom`, `closeRoom`, `applyRoomDeepLink`, `rememberRoomScroll`, and `resetRoomVisit`.
- Produces `createScrollFollow(status, savedScrollTop)`, `onRoomScroll`, and `jumpToLatest`.
- Produces `useContainerSplitMode(ref, minRem = 60): 'split' | 'single'`.

- [ ] **Step 1: Write visit-transition tests.**

Use this state shape.

```ts
export interface RoomVisitState {
  runId: string;
  selection: { nodeId: string; rowId: string; openerId: string | null } | null;
  lastExplicitRowByNode: Record<string, string>;
  appliedDeepLinkNode: string | null;
  scrollTopByScope: Record<string, number>;
}
```

Assert opening stores the explicit row and opener.
Assert closing clears only `selection`.
Assert closing does not clear `lastExplicitRowByNode` or `scrollTopByScope`.
Assert `applyRoomDeepLink(state, null, rows)` clears only the marker.
Assert a query value opens once, a manual close does not reopen it while the value remains, and leaving then re-entering the value opens again.
Assert an unknown query node leaves the room closed.
Assert a changed run id returns a fresh state with every map empty.

- [ ] **Step 2: Run visit tests and verify RED.**

Run `bun test src/lib/execution-room-model.test.ts`.
Expected: the new exports are missing.

- [ ] **Step 3: Implement visit transitions and verify GREEN.**

Use `chooseExecutionForNode` for graph and deep-link opens.
Do not place a React ref or HTMLElement inside `RoomVisitState`.
Keep focus restoration as the caller's DOM responsibility using `openerId`.

```ts
export function closeRoom(state: RoomVisitState): RoomVisitState {
  return { ...state, selection: null };
}

export function rememberRoomScroll(
  state: RoomVisitState,
  scopeKey: string,
  scrollTop: number
): RoomVisitState {
  return {
    ...state,
    scrollTopByScope: { ...state.scrollTopByScope, [scopeKey]: scrollTop },
  };
}
```

- [ ] **Step 4: Write scroll-follow tests.**

Assert completed and failed rows initialize at top unless a saved scroll exists.
Assert running and awaiting rows initialize at bottom and follow.
Assert a scroll more than 24 pixels away from bottom disables follow.
Assert a scroll within 24 pixels of bottom preserves follow.
Assert Jump to latest sets follow true and requests bottom alignment.
Assert saved `scrollTop` wins when reopening the same execution.

- [ ] **Step 5: Run scroll tests and verify RED.**

Run `bun test src/lib/room-scroll-follow.test.ts`.
Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement scroll following and verify GREEN.**

Keep the reducer DOM-free.
The component adapter will provide `scrollTop`, `scrollHeight`, and `clientHeight`.

```ts
export function onRoomScroll(
  state: ScrollFollowState,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }
): ScrollFollowState {
  const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return { ...state, follow: distance <= 24, scrollTop: metrics.scrollTop };
}
```

- [ ] **Step 7: Write container-mode tests.**

Install happy-dom before importing the hook harness.
Stub `ResizeObserver` with a callback registry.
Set the root font size to `16px` and report widths 959 and 960 to assert `single` then `split`.
Set the root font size to `20px` and report widths 1199 and 1200 to assert `single` then `split`.
Delete `ResizeObserver` and assert the hook uses `getBoundingClientRect` without throwing.
Assert `disconnect` runs on unmount.

- [ ] **Step 8: Run container tests and verify RED.**

Run `NODE_ENV=development bun test src/lib/use-container-split-mode.test.tsx` from `packages/web`.
Expected: FAIL because the module does not exist.

- [ ] **Step 9: Implement the rem-aware hook.**

On every observer callback, read `parseFloat(getComputedStyle(document.documentElement).fontSize)`.
Use 16 only when the parsed size is not finite or is nonpositive.
Compare `contentRect.width` with `minRem * rootFontPx`.
Use the element's initial `getBoundingClientRect().width` before the first observer callback.
Disconnect on cleanup.

```ts
function modeForWidth(width: number, minRem: number): 'split' | 'single' {
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const rootFontPx = Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  return width >= minRem * rootFontPx ? 'split' : 'single';
}
```

- [ ] **Step 10: Verify GREEN and commit.**

Run all three Task 6 test files.
Expected: PASS with no leaked timers or globals.

```bash
git add packages/web/src/lib/execution-room-model.ts packages/web/src/lib/execution-room-model.test.ts packages/web/src/lib/room-scroll-follow.ts packages/web/src/lib/room-scroll-follow.test.ts packages/web/src/lib/use-container-split-mode.ts packages/web/src/lib/use-container-split-mode.test.tsx
git commit -m "feat(run-room): model responsive visit state"
```

---

### Task 7: Integrate the Legacy Room Lifecycle

**Files:**

- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Modify: `packages/web/src/components/workflows/NodeRunList.tsx`.
- Delete: `packages/web/src/lib/select-initial-node.ts`.
- Delete: `packages/web/src/lib/select-initial-node.test.ts`.

**Interfaces:**

- `WorkflowExecution` owns `RoomVisitState` and `RoomSurface = 'legacy'`.
- `LegacyGraphLogsPane` receives controlled `selectedNodeId` and `selectedLogRowId`.
- `LegacyGraphLogsPane` emits `onOpenRoom(rowId, nodeId, openerId)` and `onCloseRoom()`.
- The pane receives `roomRatio` and `onRoomRatioChange`.
- The pane keeps the main view mounted and sets `hidden` only in single-pane room mode.

- [ ] **Step 1: Write Legacy pane behavior tests.**

Render the pane at split mode with `selectedNodeId={null}`.
Assert no `data-testid="legacy-node-room"` and no separator exists.
Rerender with a selected row.
Assert the main panel, separator, and room exist with `60%` and `40%` defaults.
Rerender with single mode.
Assert the main panel still exists with `hidden === true` and the room contains a Back button.
Click Back and assert `onCloseRoom` fires.
Rerender closed and assert the main panel is no longer hidden.

- [ ] **Step 2: Run the pane tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`.
Expected: the room is currently mounted as a fixed part of the pane or the new controlled props are absent.

- [ ] **Step 3: Make `LegacyGraphLogsPane` controlled.**

Remove its local `selectedLogRowId` state.
Resolve `selectedRow` strictly from the controlled row id and node id.
Render no room panel or separator while `selectedNodeId` is null.
Render the panels with `PercentResizablePanel` and stable ids `legacy-run-view` and `legacy-run-room`.
Convert `onLayoutChanged` room flex-grow to a clamped ratio and persist it through the callback.
Keep Log and Graph DOM mounted in single-pane room mode and use `hidden` on their containing main panel.
Do not change the existing Log/Graph tab control.

Keep the existing `leftPane` and `roomPane` variables, but render `roomPane` only when `selectedRow` is non-null.
Wrap `leftPane` in a div whose `hidden` value is `mode === 'single' && roomOpen`.
In split mode, place that wrapped `leftPane` in `PercentResizablePanel` id `legacy-run-view`, render the existing handle only when `roomOpen`, and place the existing `roomPane` in `PercentResizablePanel` id `legacy-run-room` only when `roomOpen`.
In single mode, render the wrapped `leftPane` and then `roomPane` only when `roomOpen`.
Do not invent `selectedRow` or `onClose` props on `LegacyNodeRoom`; retain its existing `row` prop and route Close or Back through the controlled room header or footer owned by the pane.

- [ ] **Step 4: Write WorkflowExecution visit tests.**

Assert an ordinary run visit has no selected node.
Click a Log row and assert the room opens with that row id.
Close and assert focus returns to that Log button.
Click a graph node twice around a different explicit row choice and assert the last explicit row is restored.
Navigate through `?node=review`, no query, then `?node=review` and assert the two valid entries each open once.
Change `runId` and assert no previous selection remains.
Assert retry, artifact, IDE, and overflow controls remain rendered after room close.

- [ ] **Step 5: Run WorkflowExecution tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx`.
Expected: ordinary visits fail because `selectInitialNode` selects a node, and lifecycle assertions fail because parent visit state is absent.

- [ ] **Step 6: Wire parent visit state.**

Replace `selectedDagNode` with `RoomVisitState`.
Call `applyRoomDeepLink` from an effect keyed by the parsed query value, run id, and execution rows.
On close, capture the current opener id, update state, then call `document.getElementById(openerId)?.focus()` after React commits.
Reset state when `runId` changes.
Relocate retry and artifact panels to the main run-detail shell if they currently depend on the room being mounted.
Remove both `select-initial-node` files and their import.

```ts
const handleCloseRoom = (): void => {
  const openerId = room.selection?.openerId ?? null;
  setRoom(closeRoom);
  requestAnimationFrame(() => {
    if (openerId !== null) document.getElementById(openerId)?.focus();
  });
};

useEffect(() => {
  setRoom(resetRoomVisit(runId));
}, [runId]);
```

- [ ] **Step 7: Give Legacy openers stable ids.**

Set every `NodeRunList` execution button id with `roomOpenerId('legacy', 'log', row.id)`.
Task 13 will give graph nodes their matching id.
Keep `data-node-id` and accessible labels intact.

- [ ] **Step 8: Verify GREEN and commit.**

Run both focused component tests and `bun --filter @archon/web type-check`.
Expected: PASS.

```bash
git add -A -- packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx packages/web/src/components/workflows/NodeRunList.tsx packages/web/src/lib/select-initial-node.ts packages/web/src/lib/select-initial-node.test.ts
git commit -m "feat(legacy): open the run room on demand"
```

---

### Task 8: Render Complete Legacy Execution History

**Files:**

- Create: `packages/web/src/components/workflows/NodeRoomHeader.test.tsx`.
- Create: `packages/web/src/components/workflows/NodeRoomHeader.tsx`.
- Create: `packages/web/src/components/workflows/RoomIncompleteNotice.tsx`.
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`.
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`.
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`.

**Interfaces:**

- `NodeRoomHeader` receives `model: ExecutionHeaderModel`, `options: readonly ExecutionHeaderOption[]`, `selectedRowId: string`, `onSelectRow(rowId: string): void`, and `onClose(): void`.
- `NodeTranscriptPane` receives `scopeKey`, `selection`, `initialScrollTop`, `onScrollTopChange`, and the abortable `NodeMessageLoader`.
- `NodeRoom` receives `items: readonly AgentHistoryItem[]`.
- `RoomIncompleteNotice` receives `error: string` and `onRetry(): void`.

- [ ] **Step 1: Write the Legacy header test.**

Render a header model for iteration 2 with status running, start offset 1500 milliseconds, no duration, provider `openai`, and model `gpt-5`.
Assert the node label, `Iteration 2`, running status, `+1.5s`, provider, and model are visible.
Assert no duration placeholder is rendered.
Select `Iteration 1` and assert `onSelectRow` receives its exact row id.
Click Close and assert `onClose` runs.

- [ ] **Step 2: Run the header test and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/NodeRoomHeader.test.tsx`.
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the sticky header.**

Use a semantic `header` with `position: sticky` through Tailwind.
Use a native `select` or accessible button list for execution switching.
Do not show provider, model, start, or duration when the selected model field is null.
Keep Close visible at every room width.

```tsx
<header className="sticky top-0 z-10 border-b border-border bg-surface">
  <div>{model.nodeLabel}</div>
  <div>{model.executionLabel}</div>
  <select
    aria-label="Execution"
    value={selectedRowId}
    onChange={event => onSelectRow(event.currentTarget.value)}
  >
    {options.map(option => (
      <option key={option.rowId} value={option.rowId}>
        {option.label}
      </option>
    ))}
  </select>
  <button type="button" onClick={onClose}>Close</button>
</header>
```

- [ ] **Step 4: Write transcript driver tests.**

Use controllable promises.
Open scope A, resolve page one, switch to scope B before page two resolves, and assert scope A's late page never appears.
Assert the scope A signal is aborted.
Reject page two after page one succeeded and assert page-one content remains with an incomplete-history notice and Retry.
Click Retry and assert loading resumes from the retained cursor.
For a running execution, complete the first drain, advance the fake timer by one second, and assert a new nonoverlapping request resumes from the retained cursor and appends newly recorded rows.
Change the run to terminal, resolve through the returned high-water mark, advance the timer again, and assert no further request starts.
For a completed row, assert initial scroll is zero.
For a running row, assert initial alignment is bottom, appending rows follows at bottom, manual upward scroll stops following, and Jump to latest restores it.
Unmount and assert the active request aborts.

- [ ] **Step 5: Run transcript tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx`.
Expected: the cursor, abort, retry, and follow assertions fail against the current one-shot loader.

- [ ] **Step 6: Implement the driver adapter.**

Create one `AbortController` per active `scopeKey`.
Call `drainNodeMessages` with the selected occurrence and attempt.
Abort on scope change and unmount.
Feed each reducer state to React.
Keep the previously loaded items visible under `RoomIncompleteNotice`.
Save the current container `scrollTop` through `onScrollTopChange` on scroll and before scope cleanup.
While the run is pending, running, or paused, schedule the next drain one second after the current drain settles and pass its retained state as `initialState`.
Never overlap drains for one scope.
When the run becomes completed, failed, or cancelled, perform at most the remaining drain through its captured high-water mark and stop scheduling polls.
Pass the selected node id and the run's recorded workflow events into `buildAgentHistory` so duration joins never read a different execution's display model.

```ts
useEffect(() => {
  const controller = new AbortController();
  void drainNodeMessages({
    runId,
    nodeId,
    selection,
    initialState: createNodeMessageState(scopeKey),
    load: loadMessages,
    signal: controller.signal,
    onState: setPageState,
  });
  return (): void => {
    controller.abort();
  };
}, [loadMessages, nodeId, runId, scopeKey, selection]);
```

- [ ] **Step 7: Render Legacy history items.**

Render assistant rows with a visible `ASSISTANT` role label.
Render tool items as one card with visible tool name and all context values.
Use separate `details open` elements labelled Input and Output so normal evidence starts expanded.
Apply `style={{ border: 'var(--rv-tool-card-border)' }}` because the token is a full border shorthand.
Render outcome and duration inline.
Render unmatched calls as pending, unmatched results as missing-call evidence, nonzero exits as failed, cancelled or aborted states as interrupted, and transport flags as truncated without parsing prose.
Use the existing structured JSON formatter as the fallback for unknown tools.
Put `data-tool-id={item.toolUseId}` on each tool card for stable accessibility and acceptance selection.
Render `View full output` only when `canLoadFullOutput` is true, call `getWorkflowNodeMessage` with the selected run, node, and `messageId`, and replace only that card's displayed output with the returned full payload.
Keep the truncated list value visible with an inline error and Retry if detail lookup fails.
Render lifecycle rows in secondary styling.
When `unknownScope` is true, show `Execution scope was not recorded; this history may include other executions of the same node.` above the history.
Give the room content `overflow-wrap: anywhere` and permit `overflow-x-auto` only on `pre`.
Define the private typed `AssistantHistory`, `ToolHistory`, and `LifecycleHistory` renderers in `NodeRoom.tsx` before using the map below.

```tsx
{items.map(item => {
  if (item.kind === 'assistant') return <AssistantHistory key={item.id} item={item} />;
  if (item.kind === 'tool') {
    return <ToolHistory key={item.id} item={item} data-tool-id={item.toolUseId} />;
  }
  return <LifecycleHistory key={item.id} item={item} />;
})}
```

- [ ] **Step 8: Wire exact row selection and saved scroll.**

Build header options only from rows for the active node.
On selector change, call `openRoom` with the selected row and preserve the original opener id.
Use the room scope key to read and write `scrollTopByScope` in `WorkflowExecution`.
Do not compute header provider/model from a different row.

- [ ] **Step 9: Verify GREEN and commit.**

Run the header, transcript, `agent-history`, and `WorkflowExecution` tests.
Expected: PASS.

```bash
git add packages/web/src/components/workflows/NodeRoomHeader.tsx packages/web/src/components/workflows/NodeRoomHeader.test.tsx packages/web/src/components/workflows/RoomIncompleteNotice.tsx packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(legacy): render complete execution history"
```

---

### Task 9: Share Legacy Ask Drafts Across Room and Chat

**Files:**

- Modify: `packages/web/src/components/workflows/AskCard.test.tsx`.
- Modify: `packages/web/src/components/workflows/AskCard.tsx`.
- Modify: `packages/web/src/components/workflows/build-chat-timeline.test.ts`.
- Modify: `packages/web/src/components/workflows/build-chat-timeline.ts`.
- Modify: `packages/web/src/components/workflows/ChatTimeline.test.tsx`.
- Modify: `packages/web/src/components/workflows/ChatTimeline.tsx`.
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx`.
- Modify: `packages/web/src/components/workflows/source-control/dag-run-tabs.tsx`.
- Modify: `packages/web/src/components/workflows/RunChatComposer.test.tsx`.
- Modify: `packages/web/src/components/workflows/RunChatComposer.tsx`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`.
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`.

**Interfaces:**

- Produces `AskDraft = Record<string, string | string[]>` and `AskDraftByRequest = Record<string, AskDraft | undefined>`.
- `AskCard` receives `draft: AskDraft` and `onDraftChange(next: AskDraft): void`.
- `buildChatTimeline` receives pending interactions and approval context plus execution rows.
- The timeline emits `ask` and `gate` entries with a matching row id or an explicit unscoped limitation.

- [ ] **Step 1: Write controlled AskCard tests.**

Render with a supplied single-choice and text draft.
Assert the supplied values render.
Change each field and assert `onDraftChange` receives a new complete draft without mutating the input object.
Rerender with the callback value and assert it is visible.
Assert submitting still produces the existing `AskAnswerBody`.

- [ ] **Step 2: Run AskCard tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx` from `packages/web`.
Expected: controlled-value assertions fail because the component owns local draft state.

- [ ] **Step 3: Make AskCard controlled.**

Remove `useState` for listed selections, other text, and free-form answers.
Derive every displayed value from `draft`.
On change, copy `draft` and replace only the addressed question id.
Put `id={askCardId(interaction.tool_use_id)}` and `tabIndex={-1}` on the Ask card root so awaiting actions can focus it after the room mounts.
Do not change validation or submission semantics.

```ts
function replaceDraftValue(
  draft: AskDraft,
  questionId: string,
  value: string | string[]
): AskDraft {
  return { ...draft, [questionId]: value };
}
```

- [ ] **Step 4: Write timeline placement tests.**

Create two executions of the same node and a scoped pending Ask for the second occurrence.
Assert the Ask entry follows only the second execution.
Create an unscoped Ask and assert it follows only the latest execution plus the limitation text.
Create an unscoped approval gate for the node and assert it appears only after the greatest-order row for that node with the scope limitation.
Assert ordinary assistant and tool entry ordering is unchanged.

- [ ] **Step 5: Run timeline tests and verify RED.**

Run `bun test src/components/workflows/build-chat-timeline.test.ts`.
Expected: Ask and gate timeline cases fail because those entry kinds do not exist.

- [ ] **Step 6: Implement deterministic placement.**

Match occurrence and attempt ids exactly when present.
Never assign a scoped interaction with node-id-only matching.
For legacy unscoped data, choose the latest row for that node and set `scopeLimitation` to the resolved copy.
Do not infer placement from prose or timestamps when execution ids exist.

```ts
const execution = interaction.execution_scope;
const exact =
  execution !== undefined &&
  row.selection.kind === 'occurrence' &&
  execution.occurrence_id === row.selection.occurrenceId &&
  execution.attempt_id === row.selection.attemptId;
```

- [ ] **Step 7: Write the shared-draft integration test.**

Render `WorkflowExecution` with one pending Ask shown in both the selected room and Chat timeline.
Type into the room field.
Assert the Chat field for the same `tool_use_id` has the exact text after rerender.
Change the Chat field and assert the room reflects it.
Change run id and assert the draft is empty.
Assert only one submit action can enter pending state through the existing action-state controller.
Submit and decline in separate cases, then assert the accepted answer or decline remains as a compact read-only card in both locations.
Click `WorkflowAskChrome` and assert it opens the matching execution and focuses the first enabled Ask control without changing the active main view.

- [ ] **Step 8: Run integration tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/ChatTimeline.test.tsx src/components/workflows/WorkflowExecution.test.tsx`.
Expected: the second rendering has independent local state.

- [ ] **Step 9: Lift drafts into WorkflowExecution and verify GREEN.**

Key drafts by `PendingInteraction.tool_use_id`.
Pass the same draft and updater to every rendering of that request.
Reset the draft map on run-id change.
Keep the existing action-state map as the single submit/retry state.
Keep every interaction row returned by `pending_interactions`, including answered and declined rows, in the deterministic placement model.
Run all Task 9 tests.
Expected: PASS.

```ts
const [askDrafts, setAskDrafts] = useState<AskDraftByRequest>({});
const updateAskDraft = (requestId: string, draft: AskDraft): void => {
  setAskDrafts(current => ({ ...current, [requestId]: draft }));
};
```

- [ ] **Step 10: Keep Legacy Chat and delivery limits visible.**

First add a failing `dag-run-tabs.test.tsx` case that renders `parentPlatformId={null}` and expects Graph, Logs, Chat, Source Control, and Terminal.
Add a failing `RunChatComposer.test.tsx` case that expects a disabled composer with `This run has no parent conversation, so replies cannot be delivered.`.
Remove the parent-id conditional around the Chat tab.
Keep `parentPlatformId` on the pane as delivery data, but do not use it as a navigation-visibility flag.
When Chat has no parent, render the workflow timeline from run events, skip conversation fetches, and pass the exact disabled reason to `RunChatComposer`.
Run `NODE_ENV=development bun test src/components/workflows/source-control/dag-run-tabs.test.tsx src/components/workflows/RunChatComposer.test.tsx src/components/workflows/WorkflowExecution.test.tsx`.
Expected: PASS.

```tsx
<TabsTrigger value="chat">
  <MessageSquare className="mr-1 h-3 w-3" />
  Chat
</TabsTrigger>
```

- [ ] **Step 11: Commit.**

```bash
git add packages/web/src/components/workflows/AskCard.tsx packages/web/src/components/workflows/AskCard.test.tsx packages/web/src/components/workflows/build-chat-timeline.ts packages/web/src/components/workflows/build-chat-timeline.test.ts packages/web/src/components/workflows/ChatTimeline.tsx packages/web/src/components/workflows/ChatTimeline.test.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.tsx packages/web/src/components/workflows/source-control/dag-run-tabs.test.tsx packages/web/src/components/workflows/RunChatComposer.tsx packages/web/src/components/workflows/RunChatComposer.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(legacy): place human input in execution history"
```

---

### Task 10: Integrate the Console Room and Shared History Renderer

**Files:**

- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`.
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx`.
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`.
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`.
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`.
- Modify: `packages/web/src/experiments/console/components/NodeDivider.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/NodeDivider.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.
- Modify: `packages/web/src/experiments/console/console-isolation.test.ts`.

**Interfaces:**

- Console uses the pure Task 1 through Task 6 modules through approved `@/lib` imports.
- Console does not import Legacy React components.
- `ConsoleInspectPane` receives controlled node id, row id, room ratio, ratio-change callback, and close callback props.
- `ConsoleAgentHistoryList` receives `items`, `showToolCalls`, `showSystem`, and `onLoadFullOutput`.
- `ConsoleNodeRoom` receives saved scroll position and emits scroll changes.
- The focusable `NodeDivider` button uses `roomOpenerId('console', 'log', row.id)`.

- [ ] **Step 1: Write Console pane lifecycle tests.**

Render the Console pane with no selection and assert the room and separator are absent, then rerender with a selected row and assert both are present.
Assert an ordinary visit has no room or separator.
Assert split mode is 60/40.
Assert single mode keeps the Log, Graph, or Artifacts main pane mounted with `hidden`.
Assert Back closes the room and the previous main pane content remains.
Open a room, switch to Artifacts, and assert `ArtifactPanel` occupies the main panel while the same room remains docked.
Switch back to Log and Graph and assert the same room selection survives.

- [ ] **Step 2: Run pane tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx`.
Expected: fixed `lg:w-[460px]` and unconditional room behavior fail the new assertions.

- [ ] **Step 3: Implement the controlled Console split.**

Replace the fixed aside with `ConsolePanelGroup`, `ConsolePanel`, and `ConsolePanelSeparator`.
Mount no room or separator when selection is null.
Use ids `console-run-view` and `console-run-room`.
Clamp `layout['console-run-room']` to 24 through 60 and persist it under `archon.run-room.ratio.console`.
Keep the main view mounted and hidden in single mode.
Extend the pane's main-view union to `'log' | 'graph' | 'artifacts'`.
Move `ArtifactPanel` from the outer `RunDetailPage` branch into the pane's main-panel renderer.
Do not hide or unmount the room when the selected top-level view is Artifacts.

Construct a typed `mainPane: ReactElement` from the existing Log and Graph branches plus `<ArtifactPanel runId={run.id} />` for Artifacts.
In split mode, render `mainPane` inside `ConsolePanel` id `console-run-view`, followed conditionally by `ConsolePanelSeparator` and `ConsolePanel` id `console-run-room` containing the existing fully-propped `ConsoleNodeRoom`.
In single mode, keep `mainPane` mounted inside a wrapper with `hidden={roomOpen}` and render the existing fully-propped `ConsoleNodeRoom` only when `roomOpen`.
Do not replace the existing `ConsoleNodeRoom` prop contract with an abbreviated illustrative call.

- [ ] **Step 4: Write Console header and history tests.**

Assert the Console header shows node label, execution label, status, selected start offset, selected duration when present, and selected provider/model when recorded.
Render assistant, tool, and lifecycle items through `ConsoleAgentHistoryList`.
Assert the Tool toggle hides only tool items.
Assert the System toggle hides only lifecycle items.
Assert Ask and gate children remain visible under either toggle.
Assert full tool context wraps and no context value is sliced.

- [ ] **Step 5: Run renderer tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
Expected: the new components and behavior are absent.

- [ ] **Step 6: Implement Console-owned renderers.**

Render a sticky identity header, selectable execution controls, ASSISTANT-labelled Markdown, expanded tool Input and Output, lifecycle rows, incomplete-history Retry, Close, and phone Back without importing Legacy React components.
Use `AgentHistoryItem` only as data.
Use `getNodeMessage` through the Console skill boundary for full-output expansion.
Put the same `data-tool-id` attribute on Console tool cards.
Open completed history at top, active history at bottom, stop following more than 24 pixels from bottom, expose Jump to latest, retain loaded rows on later failure, and resume Retry from the retained cursor.
Use the same one-second, nonoverlapping live-poll adapter and terminal high-water-mark stop rule specified in Task 8.

```tsx
<ConsoleRoomHeader
  model={header}
  options={executionOptions}
  selectedRowId={selectedRow.id}
  onSelectRow={onSelectRow}
  onClose={onClose}
/>
<ConsoleAgentHistoryList
  items={history}
  showToolCalls={showToolCalls}
  showSystem={showSystem}
  onLoadFullOutput={onLoadFullOutput}
/>
```

- [ ] **Step 7: Write RunDetailPage visit tests.**

Assert no default room selection.
Assert Log opens its exact row, while graph and deep-link opens use last explicit row, then awaiting, then running, then greatest-order fallback.
Assert close restores focus to the exact Console Log opener.
Assert query leave and re-entry works.
Assert changing run id clears selection, drafts, and saved scroll.
Assert top-level Log, Graph, and Artifacts view selection survives room open and close.
Assert Source Control-equivalent Console controls, usage, environment, provenance, IDE, cancel, retry, and review controls remain reachable.

- [ ] **Step 8: Run route tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected: current initial selection and local inspect behavior fail.

- [ ] **Step 9: Wire Console visit state and verify GREEN.**

Own `RoomVisitState` and ratio at `RunDetailPage`.
Use `applyRoomDeepLink` so one query value applies once, manual close does not reopen it, clearing the query resets the marker, and re-entering the value opens again.
Add a failing `NodeDivider.test.tsx` assertion for the focusable selection button's Task 5 opener id before changing the component.
Keep the outer `node-transition-${rowId}` scroll-anchor id unchanged, and add `id={roomOpenerId('console', 'log', rowId)}` to the existing inner selection button.
Keep the existing `ConsoleAskChrome` behavior.
Update `console-isolation.test.ts` allowlists only for the pure `@/lib/agent-history`, `@/lib/execution-room-model`, `@/lib/node-message-pages`, `@/lib/room-scroll-follow`, `@/lib/room-split-layout`, and `@/lib/use-container-split-mode` imports.
Run all Task 10 tests and `bun --filter @archon/web type-check`.
Expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/NodeDivider.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx packages/web/src/experiments/console/console-isolation.test.ts
git commit -m "feat(console): add responsive execution room"
```

---

### Task 11: Render One Console Log Section per Exact Execution

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/execution-interactions.test.ts`.
- Create: `packages/web/src/experiments/console/components/inspect/execution-interactions.ts`.
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`.
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`.
- Modify: `packages/web/src/experiments/console/components/RunStream.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/RunStream.tsx`.
- Modify: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.

**Interfaces:**

- Produces `interactionsForExecution(interactions, entry, allEntries): ExecutionInteractionAssignment`.
- `ConsoleExecutionHistory` loads messages with `entry.row.selection` rather than node id alone.
- `ConsoleExecutionHistory` receives `isLive: boolean`, polls at one-second intervals only while live, and aborts its active drain on unmount.
- `RunStream` receives optional `renderExecutionBody?(entry: ConsoleLogEntry): ReactNode` for incremental caller compatibility.
- `ConsoleAskCard` receives `draft: AskDraft` and `onDraftChange(next: AskDraft): void`.
- The current approval gate is attached to one exact or explicit fallback section.

- [ ] **Step 1: Write interaction-assignment tests.**

Create two `ConsoleLogEntry` values with the same node id and different occurrence and attempt ids.
Assert a scoped Ask appears only in the exact second entry.
Assert an Ask with a matching occurrence but different attempt appears in neither.
Assert an unscoped Ask appears only in the latest entry and carries the resolved limitation.
Assert an unscoped approval node id attaches only to the greatest-order entry for that node and carries the scope limitation.
Assert no assignment uses `Map<nodeId, firstEntry>` behavior.

- [ ] **Step 2: Run the pure tests and verify RED.**

Run `bun test src/experiments/console/components/inspect/execution-interactions.test.ts` from `packages/web`.
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact assignment.**

Use `PendingInteraction.execution_scope.occurrence_id` and `attempt_id`.
Use the row's `selection.kind === 'occurrence'` fields.
For unscoped data, find the last entry for that node by row order.
Return this shape.

```ts
export interface ExecutionInteractionAssignment {
  interactions: PendingInteraction[];
  showApproval: boolean;
  scopeLimitation: string | null;
}

function matchesScope(interaction: PendingInteraction, row: LogRow): boolean {
  const scope = interaction.execution_scope;
  return (
    scope !== undefined &&
    row.selection.kind === 'occurrence' &&
    scope.occurrence_id === row.selection.occurrenceId &&
    scope.attempt_id === row.selection.attemptId
  );
}
```

- [ ] **Step 4: Write ConsoleExecutionHistory tests.**

Render an entry for occurrence B with a loader that records request options.
Assert the loader receives occurrence B and its attempt.
Resolve assistant and tool rows and assert only that section displays them.
Supply a matching Ask and assert it renders after the recorded history.
Supply an unscoped Ask and assert the limitation is visible.
Toggle Tool and System off and assert the Ask remains.
Reject page two and assert page one plus Retry remain.

- [ ] **Step 5: Run component tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`.
Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement one section body.**

Render through `ConsoleAgentHistoryList` and call `drainNodeMessages` with `limit: 100`, retained `afterSeq`, exact occurrence and attempt, and an AbortSignal.
Pass the entry node id and recorded workflow events to `buildAgentHistory` for its duration join.
When `isLive` is true, begin the next nonoverlapping drain one second after the previous drain settles; when false, stop after the terminal scoped high-water mark is reached.
Show `Execution scope was not recorded; this history may include other executions of the same node.` for an unscoped fallback row.
Do not use global conversation messages as an execution transcript because they have no exact occurrence identity.
Pass each matching interaction to a controlled `ConsoleAskCard`.
Place the approval panel only when the assignment says `showApproval`.
Show the limitation adjacent to the unscoped interaction.

- [ ] **Step 7: Write RunStream tests.**

Render two entries for the same node with `renderExecutionBody` returning each row id.
Assert two `section` elements exist in log order.
Assert each NodeDivider is followed by only its own body.
Assert selecting the second divider emits its row id and node id.
Assert global message and event content is not duplicated inside either execution body when `logEntries` is supplied.
Retain current fallback tests for calls without `logEntries`.

- [ ] **Step 8: Run RunStream tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx`.
Expected: the current flat merged timeline duplicates or misassigns repeated-node content.

- [ ] **Step 9: Implement exact execution sections.**

When `logEntries` is present, render one semantic `section` per entry in row order.
Render `NodeDivider` and `renderExecutionBody(entry)` inside that section.
Keep run-start and run-finish chrome outside `RunStream` as already owned by `RunDetailPage`.
Keep the old merged timeline only for callers that omit `logEntries`.

Move the existing `log_row` `NodeDivider` prop mapping intact into the `logEntries !== undefined` branch so no usage, status, timing, or selection prop is lost.
Wrap each mapped divider in `<section key={entry.row.id} data-execution-row-id={entry.row.id}>` and append `renderExecutionBody?.(entry)` inside that same section.
Make `renderExecutionBody` optional so existing callers that supply `logEntries` keep their divider-only behavior until `ConsoleInspectPane` wires the section renderer in this task.

- [ ] **Step 10: Make ConsoleAskCard controlled.**

First render `ConsoleAskCard` with a supplied single-choice and text draft, change each field, and assert `onDraftChange` receives a new complete object without mutating the original.
Run `NODE_ENV=development bun test src/experiments/console/components/ask/ConsoleAskCard.test.tsx` and verify those controlled-value assertions fail against local state.
Remove local listed, other, and free-form draft state, then render values from `draft` and emit immutable replacements through `onDraftChange`.
Put `askCardId(interaction.tool_use_id)` on the card root with `tabIndex={-1}`.
Keep the existing answer controller and validation unchanged.
Rerun the focused test and require PASS.
Own `AskDraftByRequest` in `RunDetailPage`, share it between room and execution sections, and clear it when run id changes.

- [ ] **Step 11: Verify the complete Console slice and commit.**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/execution-interactions.test.ts src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/components/RunStream.test.tsx src/experiments/console/components/ask/ConsoleAskCard.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected: PASS.

```bash
git add packages/web/src/experiments/console/components/inspect/execution-interactions.ts packages/web/src/experiments/console/components/inspect/execution-interactions.test.ts packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx packages/web/src/experiments/console/components/RunStream.tsx packages/web/src/experiments/console/components/RunStream.test.tsx packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx
git commit -m "feat(console): group log history by execution"
```

---

### Task 12: Add a Safe Console Reply Composer

**Files:**

- Modify: `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`.
- Modify: `packages/web/src/experiments/console/skills/runs.ts`.
- Create: `packages/web/src/experiments/console/skills/conversations.test.ts`.
- Modify: `packages/web/src/experiments/console/skills/conversations.ts`.
- Modify: `packages/web/src/experiments/console/store/keys.ts`.
- Create: `packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx`.
- Create: `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.

**Interfaces:**

- Adds `parentPlatformId: string | null` to `ConsoleRunDetail` from existing response field `parent_platform_id`.
- Adds `getConversation(platformId: string, options?: { signal?: AbortSignal }): Promise<ConversationSummary>`.
- Adds `K.parentConversation(platformId: string | null): string`.
- `ConsoleReplyComposer` receives `state: ReplyDestinationState` and `onSend(message: string): Promise<void>`.
- `ReplyDestinationState` is `loading`, `ready`, `missing`, `non_web`, or `error`.

```ts
export type ReplyDestinationState =
  | { kind: 'loading' }
  | { kind: 'ready'; parentPlatformId: string }
  | { kind: 'missing' }
  | { kind: 'non_web' }
  | { kind: 'error' };
```

- [ ] **Step 1: Write the run-mapping test.**

Include `parent_platform_id: 'web-parent-1'` in the raw run detail response.
Assign `const detail = await getRun('run/1')` and assert `detail.parentPlatformId` equals `web-parent-1`.
Add a null case.
Do not modify the server route because it already returns this field.

- [ ] **Step 2: Run the mapping test and verify RED.**

Run `bun test src/experiments/console/skills/runs.node-messages.test.ts` from `packages/web`.
Expected: the mapped field is absent.

- [ ] **Step 3: Retain the field.**

Add `parentPlatformId: string | null` to `ConsoleRunDetail` and set it in `getRun` from `res.run.parent_platform_id ?? null`.
Do not add it to unrelated project run-list primitives unless their response already contains it.

```ts
const detail: ConsoleRunDetail = {
  run: toRun(res.run),
  events: res.events.map(toRunEvent),
  parentPlatformId: res.run.parent_platform_id ?? null,
  rawEvents: res.events,
  nodeStates: res.nodeStates,
  approval: res.run.metadata.approval ?? null,
  usage: res.usage,
  pendingInteractions: res.pending_interactions ?? [],
  viewerIsStarter: res.viewer_is_starter === true,
  starterDisplayName: res.starter_display_name,
  runError: typeof res.run.metadata.error === 'string' ? res.run.metadata.error : null,
  nodeExecutions: res.nodeExecutions,
};
```

- [ ] **Step 4: Write conversation lookup tests.**

Assert `getConversation('web/parent')` requests `/api/conversations/web%2Fparent`.
Return a raw row and assert `toConversationSummary` produces id, title, platform type, and last activity.
Assert non-2xx responses become `HttpError`.
Assert an AbortSignal reaches `requestJson`.
Assert `K.parentConversation('web/a')` differs from `K.parentConversation('web:a')` and from `K.parentConversation(null)`.

- [ ] **Step 5: Run lookup tests and verify RED.**

Run `bun test src/experiments/console/skills/conversations.test.ts`.
Expected: `getConversation` is absent.

- [ ] **Step 6: Implement lookup.**

Use the existing registered GET conversation route.
Use `requestJson<Parameters<typeof toConversationSummary>[0]>` and `toConversationSummary`.
Pass `signal` through `RequestInit`.
Do not call `createConversation`.

```ts
export async function getConversation(
  platformId: string,
  options?: { signal?: AbortSignal }
): Promise<ConversationSummary> {
  const raw = await requestJson<Parameters<typeof toConversationSummary>[0]>(
    '/api/conversations/' + encodeURIComponent(platformId),
    options?.signal === undefined ? undefined : { signal: options.signal }
  );
  return toConversationSummary(raw);
}
```

- [ ] **Step 7: Write composer tests.**

Assert `loading` disables the field and says `Loading parent conversation…`.
Assert `missing` says `Replies need a parent web conversation. This run has none.`.
Assert `error` says `Unable to verify the parent conversation.`.
Assert `non_web` says `Replies are available only for runs with a parent web conversation.`.
Assert `ready` enables Send, trims the message, calls `onSend` once, and clears only after fulfillment.
Assert a rejected send keeps the draft and displays the error.

- [ ] **Step 8: Run composer tests and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleReplyComposer.test.tsx`.
Expected: FAIL because the component does not exist.

- [ ] **Step 9: Implement the composer and route eligibility.**

In `RunDetailPage`, do not fetch when `parentPlatformId` is null.
When present, load that exact conversation with `useEntity` under a key derived from the parent platform id.
Map `platformType === 'web'` to ready and every other value to non_web.
Pass `skill.sendMessage(parentPlatformId, message)` only in ready state.
Never create or select another conversation as fallback.
Render the composer at the bottom of the run-detail work area in both room-open and room-closed states.

```ts
const parentConversation = useEntity<ConversationSummary | null>(
  K.parentConversation(parentPlatformId),
  () =>
    parentPlatformId === null
      ? Promise.resolve(null)
      : skill.getConversation(parentPlatformId)
);
```

```ts
const replyState: ReplyDestinationState =
  parentPlatformId === null
    ? { kind: 'missing' }
    : parentConversation.error !== undefined
        ? { kind: 'error' }
        : parentConversation.loading
          ? { kind: 'loading' }
          : parentConversation.data?.platformType === 'web'
            ? { kind: 'ready', parentPlatformId }
            : { kind: 'non_web' };
```

- [ ] **Step 10: Write and run the route integration test.**

Use three runs with no parent, a non-web parent, and a web parent.
Assert Send is enabled only for the web parent.
Click Send and assert the request URL contains the exact existing parent id.
Assert no POST to `/api/conversations` occurs.
Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected after implementation: PASS.

- [ ] **Step 11: Commit.**

```bash
git add packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/conversations.ts packages/web/src/experiments/console/skills/conversations.test.ts packages/web/src/experiments/console/store/keys.ts packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx
git commit -m "feat(console): reply through the recorded parent chat"
```

---

### Task 13: Align Header, Tabs, Graph, Tokens, and Focus Openers

**Files:**

- Modify: `packages/web/src/index.css`.
- Modify: `packages/docs-web/src/content/docs/brand/index.md`.
- Modify: `packages/web/src/components/workflows/ExecutionDagNode.test.tsx`.
- Modify: `packages/web/src/components/workflows/ExecutionDagNode.tsx`.
- Modify: `packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts`.
- Modify: `packages/web/src/components/workflows/build-workflow-dag-view-model.ts`.
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`.
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`.
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`.
- Modify: `packages/web/src/experiments/console/components/StreamToolbar.tsx`.
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.

**Interfaces:**

- Adds `--rv-node-kind-size`, `--rv-node-label-size`, `--rv-node-meta-size`, `--rv-tab-size`, and `--rv-tool-card-border` under both run-view scopes.
- `RunDetailHeader` receives `onAwaitingInput?: () => void`.
- Legacy and Console opener elements use Task 5 `roomOpenerId`.

- [ ] **Step 1: Write tests only for new behavior.**

In `ExecutionDagNode.test.tsx`, assert the node root has the expected opener id, `tabIndex={-1}` for programmatic focus, and token-driven classes or inline font sizes.
In the view-model test, assert each node data object receives the correct opener id.
In `RunGraphPanel.test.tsx`, assert the existing focusable node button has the Console graph opener id.
Keep the existing graph selection, overflow, pan, zoom, and awaiting tests because those behaviors already exist.
Do not add a new test that would pass before production changes.

- [ ] **Step 2: Run the opener tests and verify RED.**

Run `NODE_ENV=development bun test src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/build-workflow-dag-view-model.test.ts src/experiments/console/components/RunGraphPanel.test.tsx` from `packages/web`.
Expected: only the new id and presentation assertions fail.

- [ ] **Step 3: Implement opener ids and relative graph typography.**

Supply `openerId` through `buildWorkflowDagViewModel` into `ExecutionNodeData`.
Put the id and `tabIndex={-1}` on the Legacy node root.
Put the id on the current Console graph button.
Replace touched `text-[10px]` and `text-[11px]` literals with scoped token values expressed in rem.
Do not modify `DagNodeComponent.tsx` because it belongs to the workflow builder, not the run graph.
Do not modify `ProjectViewTabs.tsx` because it controls project Runs and Chat navigation, not run-detail Log, Graph, and Artifacts tabs.

```tsx
<div
  id={data.openerId}
  tabIndex={-1}
  className="rounded-lg border border-border px-3 py-2"
>
  <span className="text-[length:var(--rv-node-kind-size)]">{typeLabel}</span>
  <span className="text-[length:var(--rv-node-label-size)]">{data.label}</span>
</div>
```

- [ ] **Step 4: Write the actionable-header test.**

Render `RunDetailHeader` with paused Ask state and `onAwaitingInput`.
Assert `Awaiting input` is a button and click invokes the callback.
Render paused approval state and assert the status is not mislabeled as Ask.
Render a completed run and assert its status is not a button.

- [ ] **Step 5: Run the header test and verify RED.**

Run `NODE_ENV=development bun test src/experiments/console/components/RunDetailHeader.test.tsx`.
Expected: Awaiting input is currently a noninteractive span.

- [ ] **Step 6: Implement header and run-tab alignment.**

When `askAwaiting` and the callback exist, render the status as a warning button.
Route the callback through the existing awaiting-node resolver, open that execution, and preserve the current top-level view.
Keep `ConsoleAskChrome` as an existing alternate entry point.
Use `StreamToolbar.tsx` for run-detail tab presentation.
Keep its existing active underline and semantics.
Allow tab labels to wrap or scroll inside their own navigation container without creating page horizontal scroll.
Keep breadcrumb, workflow, status, environment, origin, usage, elapsed time, IDE, overflow, and cancel controls.

```tsx
{isPaused && askAwaiting && onAwaitingInput !== undefined ? (
  <button type="button" onClick={onAwaitingInput} className="text-warning">
    Awaiting input
  </button>
) : (
  <span>{statusLabel[run.status]}</span>
)}
```

- [ ] **Step 7: Add and document scoped tokens.**

Define the five `--rv-*` values under both `.legacy-run-view` and `.console-run-view`.
Use `0.625rem` for kind, `0.8125rem` for label, `0.6875rem` for meta and tab, and `1px solid var(--border)` for tool-card border.
Document those values and their scope in `packages/docs-web/src/content/docs/brand/index.md`.
Do not add split-ratio tokens that no runtime code consumes.

```css
.legacy-run-view,
.console-run-view {
  --rv-node-kind-size: 0.625rem;
  --rv-node-label-size: 0.8125rem;
  --rv-node-meta-size: 0.6875rem;
  --rv-tab-size: 0.6875rem;
  --rv-tool-card-border: 1px solid var(--border);
}
```

- [ ] **Step 8: Verify GREEN and commit.**

Run all Task 13 focused tests, `bun --filter @archon/web type-check`, and `bun run lint --max-warnings 0` from the repository root.
Expected: PASS.

```bash
git add packages/web/src/index.css packages/docs-web/src/content/docs/brand/index.md packages/web/src/components/workflows/ExecutionDagNode.tsx packages/web/src/components/workflows/ExecutionDagNode.test.tsx packages/web/src/components/workflows/build-workflow-dag-view-model.ts packages/web/src/components/workflows/build-workflow-dag-view-model.test.ts packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/RunDetailHeader.test.tsx packages/web/src/experiments/console/components/StreamToolbar.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx
git commit -m "feat(run-view): align responsive execution chrome"
```

---

### Task 14: Add a Deterministic Multi-Page Provider Fixture

**Files:**

- Modify: `packages/providers/src/e2e-fake/provider.test.ts`.
- Modify: `packages/providers/src/e2e-fake/provider.ts`.
- Create: `e2e/fixtures/workflows/e2e-hitl-long-history.yaml`.
- Modify: `e2e/lib/playwright/archon-runtime.ts`.

**Interfaces:**

- Adds optional `repeatTool` to the existing e2e scenario schema.
- Accepts integers from 1 through 200.
- Preserves the exact old trace and old tool id when `repeatTool` is omitted.
- Exports `E2E_HITL_LONG_WORKFLOW_NAME` and `HITL_LONG_NODE` from the Playwright runtime.

- [ ] **Step 1: Write provider tests.**

Collect the async provider output for `{"emitTool":true,"repeatTool":3}`.
Assert three tool calls and three results.
Assert each call/result pair shares an id and all three ids are distinct.
Assert `{"emitTool":true}` still emits the exact old id `e2e-fake-tool-<sessionId>` and the existing chunk sequence.
Assert 0, 201, noninteger, and nonnumber `repeatTool` directives fail schema parsing.

- [ ] **Step 2: Run provider tests and verify RED.**

Run `bun test src/e2e-fake/provider.test.ts` from `packages/providers`.
Expected: repeated-tool assertions fail because the schema and loop do not exist.

- [ ] **Step 3: Implement the bounded option.**

Add `repeatTool: z.number().int().min(1).max(200).optional()`.
Use one repetition when omitted.
Special-case the omitted option so the original tool id remains byte-for-byte unchanged.
When provided, suffix ids with `-1` through `-N`.
Emit each call immediately followed by its result to preserve deterministic ordering.
Do not add delay or network behavior.

```ts
if (scenario.emitTool === true) {
  const repeat = scenario.repeatTool ?? 1;
  yield { type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT };
  for (let index = 0; index < repeat; index += 1) {
    const toolCallId =
      scenario.repeatTool === undefined
        ? 'e2e-fake-tool-' + sessionId
        : 'e2e-fake-tool-' + sessionId + '-' + String(index + 1);
    yield {
      type: 'tool',
      toolName: E2E_FAKE_TOOL_NAME,
      toolInput: { ...E2E_FAKE_TOOL_INPUT },
      toolCallId,
    };
    yield {
      type: 'tool_result',
      toolName: E2E_FAKE_TOOL_NAME,
      toolOutput: E2E_FAKE_TOOL_OUTPUT,
      toolCallId,
      toolOutcome: 'success',
    };
  }
}
```

- [ ] **Step 4: Verify provider GREEN.**

Run `bun test src/e2e-fake/provider.test.ts`.
Expected: PASS.

- [ ] **Step 5: Add the exact fixture.**

Create `e2e/fixtures/workflows/e2e-hitl-long-history.yaml` with this exact content.

```yaml
name: e2e-hitl-long-history
description: "E2E — deterministic node history larger than one cursor page."
mutates_checkout: false

nodes:
  - id: long-history
    provider: e2e-fake
    model: e2e-fake-model
    prompt: |
      <<E2E_SCENARIO>>{"emitTool":true,"repeatTool":120}<</E2E_SCENARIO>>
      $ARGUMENTS
```

- [ ] **Step 6: Install the fixture in the runtime.**

Add the source path constant.
Copy it into the same temporary `workflows` directory as the existing HITL fixtures.
Add `runHitlLongHistoryWorkflow(): Promise<CliRunResult>` that invokes the exact new workflow name through the existing CLI runner.
Do not duplicate process-launch code.

- [ ] **Step 7: Verify fixture loading and commit.**

Run `bun test src/e2e-fake/provider.test.ts` from `packages/providers`.
Run `npm run typecheck` from `e2e`.
Expected: PASS.

```bash
git add packages/providers/src/e2e-fake/provider.ts packages/providers/src/e2e-fake/provider.test.ts e2e/fixtures/workflows/e2e-hitl-long-history.yaml e2e/lib/playwright/archon-runtime.ts
git commit -m "test(e2e): add multi-page agent history fixture"
```

---

### Task 15: Prove the End-to-End Room Contract and Close the Story

**Files:**

- Create: `e2e/ui/workflow-run-hitl-room.spec.ts`.
- Modify: `e2e/lib/playwright/run-detail.ts`.
- Modify: `e2e/ui/workflow-run-hitl-visual.spec.ts`.
- Create: `plans/reports/acceptance-260908-story-5-6.md`.
- Modify: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`.
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

**Interfaces:**

- The acceptance spec uses the existing real server, real browser, and `e2e-fake` provider runtime.
- `observeNodeMessagePages(page, runId, nodeId)` records request URLs and cursor query parameters.
- The existing no-query `listNodeMessages` helper remains the independent stored-row count.
- The acceptance report distinguishes automated evidence, visual observation, and untested live-provider behavior.

- [ ] **Step 1: Record Story 5.6 as in progress.**

Add the issue title, URL, the twenty-two acceptance criteria from this plan, and the brainstorm path to `epics.md`.
Set `5-6-align-agent-history-and-responsive-run-room: in-progress` in `sprint-status.yaml`.
Do not mark Epic 5 done yet.

- [ ] **Step 2: Add request observation helpers.**

In `run-detail.ts`, listen for requests whose encoded path matches the exact run and node message endpoint.
Record `afterSeq`, `limit`, `occurrenceId`, and `attemptId` from each URL.
Return a disposer plus the collected immutable records.
Do not satisfy the UI with route interception.

```ts
export interface NodeMessageRequest {
  afterSeq: string | null;
  limit: string | null;
  occurrenceId: string | null;
  attemptId: string | null;
}

export function observeNodeMessagePages(
  page: Page,
  runId: string,
  nodeId: string
): { records: NodeMessageRequest[]; dispose: () => void } {
  const records: NodeMessageRequest[] = [];
  const pathname =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages';
  const listener = (request: Request): void => {
    const url = new URL(request.url());
    if (url.pathname !== pathname) return;
    records.push({
      afterSeq: url.searchParams.get('afterSeq'),
      limit: url.searchParams.get('limit'),
      occurrenceId: url.searchParams.get('occurrenceId'),
      attemptId: url.searchParams.get('attemptId'),
    });
  };
  page.on('request', listener);
  return { records, dispose: () => page.off('request', listener) };
}
```

Import `Page` and Playwright `Request` as types from `@playwright/test`.

- [ ] **Step 3: Add behavioral acceptance cases.**

Create `workflow-run-hitl-room.spec.ts` with these exact cases.

- `[P1] Console room opens, closes, and releases its width` starts with no query, asserts no room or placeholder, records full main width, opens a Log row, asserts the initial room ratio is between 0.38 and 0.42, closes, and asserts main width returns within two pixels.
- `[P1] Legacy room is readable and percentage sized` opens a Legacy Log row and asserts the room ratio is between 0.38 and 0.42 and the width exceeds 240 pixels at 1024 by 900.
- `[P1] Graph selection restores the last explicit execution` selects iteration 1 in Log, closes, clicks that graph node, and asserts iteration 1 remains selected.
- `[P1] Agent history shows role, tool context, and outcome` asserts ASSISTANT, tool name, the full context marker, Input, Output, outcome, and duration when the fixture records it.
- `[P1] Execution selector requests the selected scope` opens a repeated node, selects two row ids in turn, asserts the header changes from Iteration 1 to Iteration 2, and asserts the observed requests use two different occurrence ids.
- `[P1] Ask draft is shared across room and execution section` types in one rendering and asserts the other rendering holds the same value without submitting.
- `[P1] Answered and declined Ask records remain in place` resolves one request each way and asserts both room and main section become read-only without losing the recorded choice.
- `[P1] Awaiting input focuses the matching Ask` clicks the existing awaiting action and asserts the exact Ask control becomes `document.activeElement`.
- `[P1] Narrow room uses Back without losing Log state` uses 390 by 844, opens the room, asserts the main pane is hidden but attached, clicks Back, and asserts previous tab, selected row, scroll position, and draft.
- `[P1] Mobile Ask remains reachable` focuses the Ask input at 390 by 844, asserts the card scrolls into the visible work area, and asserts the submit button's bottom edge is no lower than the viewport height.
- `[P1] Deep-link re-entry and focus restoration work` proves once-per-query entry and checks `document.activeElement.id` after close.
- `[P1] Reload restores the chosen ratio` drags the separator, records the resulting room ratio, reloads, reopens the node, and asserts the ratio is within 0.02.
- `[P1] Complete history crosses a cursor boundary` starts the long fixture, begins request observation, opens `long-history`, waits for drain completion, and asserts at least two cursor requests, every cursor request has `limit=100`, and a later request has numeric `afterSeq > 0`.
- `[P1] Complete history renders every distinct tool call` obtains the compatibility response only after UI draining, asserts more than 100 stored tool ids, and asserts the visible `[data-tool-id]` values equal the distinct stored payload ids.
- `[P1] Console Reply rejects a missing parent` asserts the disabled copy and confirms no conversation-create request, while Task 12's route test remains the deterministic non-web-parent proof.
- `[P1] Console Reply uses the exact parent web conversation` starts the existing web-parent fixture, sends a reply, and asserts the POST target is that parent platform id.
- `[P1] Legacy navigation and timeline survive without a parent` opens a CLI run and asserts Chat, Source Control, and Terminal tabs remain visible, Chat contains workflow records, and its composer is factually disabled.
- `[P1] Console Artifacts keeps the room docked` opens a room, switches to Artifacts, and asserts both the artifact main pane and the same selected room are visible.

The E2E suite is acceptance proof after the unit and integration RED-GREEN cycles.
Do not weaken an assertion merely because it is red.
Fix the product or fixture when a real accepted behavior fails.

- [ ] **Step 4: Run the focused acceptance suite.**

From `e2e`, run `npm ci` only when `node_modules` is absent or the lockfile changed.
Run `npx playwright install chromium` only when the configured browser is absent.
Run `npm run test:ui -- workflow-run-hitl-room`.
Expected: PASS.

- [ ] **Step 5: Repair the visual-spec truth condition.**

In `workflow-run-hitl-visual.spec.ts`, remove `mockupCaptured`, `mockupLimit`, the catch block, and `expect(mockupCaptured || mockupLimit.length > 0).toBe(true)`.
Navigate directly to `pathToFileURL(MOCKUP_CONSOLE).href` and `pathToFileURL(MOCKUP_LEGACY).href`, and let either failed navigation fail the test.
Import `pathToFileURL` from `node:url` and remove the now-unused `writeFileSync` import.
Assert both product and mockup screenshots show the same selected-node, room-open state.
Measure the product ratio against the Task 1 percentage contract only.
Do not assert that the product ratio matches the mockup's fixed pixel width.

```ts
const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x900', width: 768, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

await page.goto(pathToFileURL(MOCKUP_CONSOLE).href);
await expect(page.locator('body')).toBeVisible({ timeout: T.short });
for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.screenshot({
    path: join(CAPTURE_DIR, 'console-mockup-' + viewport.name + '.png'),
    fullPage: true,
  });
}
await page.goto(pathToFileURL(MOCKUP_LEGACY).href);
await expect(page.locator('body')).toBeVisible({ timeout: T.short });
for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.screenshot({
    path: join(CAPTURE_DIR, 'legacy-mockup-' + viewport.name + '.png'),
    fullPage: true,
  });
}
```

- [ ] **Step 6: Run visual and existing HITL suites.**

Run `npm run test:ui -- workflow-run-hitl-visual` and `npm run test:ui:hitl` from `e2e`.
Expected: PASS with no conditional assertion that succeeds solely because capture failed.

- [ ] **Step 7: Run repository validation.**

Run `bun run validate` from the repository root.
Expected: every bundled check, type-check, lint with zero warnings, format check, install check, and package-isolated test passes.
Run `npm run typecheck` and `npm run test:ui` from `e2e`.
Expected: PASS.

- [ ] **Step 8: Record honest viewport evidence.**

Create `acceptance-260908-story-5-6.md`.
For 1440 by 1000, 1024 by 900, 768 by 900, and 390 by 844, record Legacy and Console mode, measured room ratio, room readability, page horizontal overflow, Back or Close behavior, and a `matched` or `deviation` verdict.
At 1440 by 1000, repeat the observation after widening and collapsing the application rail and at browser zoom 200 percent.
For every deviation, name the exact visible difference and affected surface.
State that the journeys used `e2e-fake`.
State that live Claude and Codex behavior was not established unless those providers were actually exercised.
State that the mockup's fixed dimensions were not used as product sizing assertions.
State that headless Playwright cannot reproduce a physical on-screen keyboard, so the mobile geometry assertion proves reachability while physical-keyboard validation remains a named manual limitation.

- [ ] **Step 9: Close tracking only after all gates pass.**

Set `5-6-align-agent-history-and-responsive-run-room: done`.
Set `epic-5: done` only if every other Epic 5 story is already done.
Update `last_updated` to the actual local completion date and time.
If any required gate is red, leave the story in progress and record the failing command in the acceptance report.

- [ ] **Step 10: Commit acceptance evidence.**

```bash
git add e2e/lib/playwright/run-detail.ts e2e/ui/workflow-run-hitl-room.spec.ts e2e/ui/workflow-run-hitl-visual.spec.ts plans/reports/acceptance-260908-story-5-6.md _bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "test(e2e): prove responsive run-room behavior"
```

## Validation Matrix

| Command | Working directory | Required evidence |
| --- | --- | --- |
| `bun test src/lib/room-split-layout.test.ts src/lib/node-message-pages.test.ts src/lib/agent-history.test.ts src/lib/execution-room-model.test.ts src/lib/room-scroll-follow.test.ts` | `packages/web` | Shared pure contracts pass without a DOM. |
| `NODE_ENV=development bun test src/lib/use-container-split-mode.test.tsx src/components/workflows/` | `packages/web` | Legacy DOM, room, transcript, Ask, graph, and focus tests pass. |
| `NODE_ENV=development bun test src/experiments/console/` | `packages/web` | Console DOM, isolation, room, section, Reply, header, and graph tests pass. |
| `bun test src/routes/api.workflow-runs.test.ts` | `packages/server` | Compatibility metadata, paging, scoped watermark, truncation marking, and full detail pass. |
| `bun test src/e2e-fake/provider.test.ts` | `packages/providers` | Repeat-tool bounds, unique ids, and default compatibility pass. |
| `bun --filter @archon/web type-check` | Repository root | Generated aliases, abort options, and percentage props type-check. |
| `bun run lint --max-warnings 0` | Repository root | Zero warnings pass. |
| `bun run validate` | Repository root | The complete pre-PR validation gate passes. |
| `npm run typecheck` | `e2e` | Playwright helpers and fixtures type-check. |
| `npm run test:ui` | `e2e` | Room, HITL, and visual acceptance pass. |

## Requirement Traceability

| Requirement | Primary tasks |
| --- | --- |
| Execution-scoped assistant and tool history | Tasks 2, 3, 4, 8, 10, and 11. |
| Human Ask and gate placement | Tasks 9 and 11. |
| Responsive percentage room | Tasks 1, 6, 7, and 10. |
| Open, close, Back, deep link, focus, and state retention | Tasks 6, 7, and 10. |
| Execution identity and selector | Tasks 5, 8, 10, and 11. |
| Safe Console Reply | Task 12. |
| Header, tabs, graph, and existing controls | Task 13. |
| Multi-page and visual evidence | Tasks 14 and 15. |
| Prompt-capture limitation | Global Constraints and Open Questions. |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md`.
Use `superpowers:subagent-driven-development` for fresh task-level implementation and two-stage review, or use `superpowers:executing-plans` for inline batches with checkpoints.
