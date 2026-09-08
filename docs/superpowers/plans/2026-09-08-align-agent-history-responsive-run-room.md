# Align Agent History and the Responsive Run Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one execution of one node readable end-to-end in both the Legacy and Console run views, inside a room that opens, closes, and resizes as a percentage of the available work area.

**Architecture:** Keep every renderer where it already lives and add shared, framework-agnostic model modules under `packages/web/src/lib/` that both surfaces consume, because `console-isolation.test.ts` forbids shared React components but permits `@/lib/*` modules that are not `@/lib/api`.
The room's data path changes from a single unpaged fetch to a cursor-paged reducer that drains to the server high-watermark, and the split layout changes from numeric `react-resizable-panels` sizes (which v4 reads as **pixels**) to percent strings driven by container width.
Presentation changes reuse the existing `projectTextTranscript` and `projectToolTranscript` helpers and add a role/tool-context/lifecycle model on top of them, so stored transcript rows and their order are never rewritten.

**Tech Stack:** Bun, TypeScript, React 19, React Router, Tailwind CSS v4, `react-resizable-panels` v4, TanStack Query (legacy surface only), the console's own `useEntity` cache, `happy-dom`, `bun:test`, and Playwright.

**Spec:** GitHub issue `#147`; the approved brainstorm `plans/reports/brainstorm-260908-1653-workflow-run-hitl-ui-gap.md`; PR #146 evidence in `plans/reports/captures-260908-1653-hitl-gap/`; the canonical mockup at `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/`; and `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`.

## Root Cause Already Established

`react-resizable-panels@4.7.3` resolves a **number** size prop as pixels and a **string** size prop by its unit suffix.
The v4 bundle contains `case "number": return [e, "px"]`, so `defaultSize={33}` means 33 pixels, not 33 percent.
`packages/web/src/components/workflows/LegacyGraphLogsPane.tsx:414-421` passes `67`, `33`, `22`, and `52` as numbers, so the room clamps to `maxSize` = 52 pixels.
That is exactly the `51.96875` width recorded in `plans/reports/captures-260908-1653-hitl-gap/observations.json`.
`packages/web/src/components/workflows/source-control/source-control-split.tsx:15-22` already passes `"30%"`-style strings and renders correctly, which confirms the diagnosis.
The Console room is not a resizable panel at all: `ConsoleInspectPane.tsx` renders a fixed `lg:w-[460px]` `<aside>` that stays mounted after Close.

## Global Constraints

- Do not change database schemas, workflow YAML semantics, provider behavior, or application navigation.
- The only server-side change permitted by this plan is adding `metadata` to the non-cursor branch of the node-messages route and adding a `repeatTool` option to the env-gated `e2e-fake` provider.
- Console production code must not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api`; `@/lib/api.generated` may only be imported `import type`.
- Shared model modules live in `packages/web/src/lib/` and export pure functions or hooks only; never a React component shared across the Legacy and Console boundary.
- Never pass a bare number to `defaultSize`, `minSize`, or `maxSize` on a `react-resizable-panels` panel; always pass a `` `${number}%` `` string.
- Never replace missing historical data with mockup text, and never reconstruct a prompt from the current workflow definition.
- Preserve real tool results, execution identity, HITL authorization, retained answers, and stored event order.
- Preserve Source Control, Artifacts, usage, environment, provenance, IDE links, cancel, resume, retry, and re-run controls; relocate them rather than deleting them.
- Sizing uses percentages of the available work area and relative typography units; fixed pixel panel widths are not the layout contract.
- Derive the two-pane / one-pane transition from the **container** width measured with `ResizeObserver`, not from `window.matchMedia` alone, because the application rail changes available width without changing viewport width.
- Use complete TypeScript annotations and introduce no `any`.
- Do not use `mock.module()` in new tests; use `spyOn` or dependency injection, because Bun's module mock cache is process-global and irreversible.
- Every new web test installs happy-dom through the existing helpers and restores globals in `afterEach`.
- Run focused tests from `packages/web`; run the repository-wide suite only through `bun run validate` from the repository root.
- Run every `git add` and `git commit` from the repository root, and commit only the files that task names.
- Keep each task independently revertible so a presentation regression can be rolled back without removing stored execution history.

## Acceptance Criteria

- AC1: On both surfaces the node room is closed on a normal first visit, opens from a graph node, a Logs or Log row, a chat timeline entry, or a `?node=` deep link, and returns its space to the main view on Close.
- AC2: On both surfaces the open room occupies a percentage of the available work area (default 40 percent), the divider resizes that ratio by pointer and keyboard, and the chosen ratio survives view switches and reloads.
- AC3: Below the measured container threshold the pane shows a single full-width room with a Back control that restores the previous main view, its selection, its drafts, and its reading position.
- AC4: The room header shows node type, name, status, start offset, and duration, keeps that identity visible while the transcript scrolls, shows provider and model only when the run recorded them, and states "timing unavailable" rather than rendering `0:00` when the run has no occurrence timing.
- AC5: The room header exposes one selectable control per recorded execution of the node with readable iteration, pass, and retry labels, and displays an explicit limitation when an execution's scope is unknown.
- AC6: Agent prose renders as one `ASSISTANT` role label plus a complete Markdown block reconstructed by `projectTextTranscript`, using relative typography units from the run-view tokens.
- AC7: Every tool invocation renders as one inset card with its name, a factual context taken verbatim from an allowlisted recorded input field, and visible input and output; missing, pending, failed, interrupted, and truncated output are distinct visible states, and only a truncated state offers a full-output link, which resolves to the stored message-detail route.
- AC8: Lifecycle notes render as quiet secondary entries with readable copy instead of raw `started` / `completed` tokens.
- AC9: The room loads every page of the selected execution's history through the cursor API, dedupes by `seq`, drains to the reported `highWatermark` after the run reaches a terminal state, and never stops at the first 100 rows.
- AC10: A failed later page keeps already-loaded rows visible, shows an explicit incomplete-history notice with a Retry action, and never renders as an empty execution.
- AC11: Opening a completed execution starts at the beginning, opening an active execution starts at the latest output, scrolling up stops auto-follow and reveals a jump-to-latest control, and new output never moves focus or scrolls a user away from older history.
- AC12: Console `Log` renders one section per execution that owns its own messages, tools, Ask cards, and gate controls, and the System toggle changes only secondary lifecycle detail, never execution structure or pending human actions.
- AC13: Console keeps the room docked when the user switches to Artifacts, and the Console Reply composer sends only through a valid parent web conversation and otherwise shows a factual disabled reason without creating a conversation.
- AC14: Legacy Chat renders contextual Ask and gate cards that share one draft and one action state with the room presentation of the same request.
- AC15: Run-view typography and tool-card presentation read from the `--rv-*` tokens in `packages/web/src/index.css` on both surfaces, and the brand guide table matches those token values.
- AC16: The Playwright acceptance spec asserts room ratio, close-restores-width, absence of a second `Select a node` placeholder, transcript structure, and multi-page history, and no assertion passes merely because a screenshot was written.

## Specification Traceability

| Brainstorm requirement | Planned proof |
| --- | --- |
| Delivery boundary 1, complete history loading and execution reading structure | Tasks 2, 3, 4, 5, 9, 11 |
| Delivery boundary 2, open / close / resize / phone / state preservation | Tasks 1, 6, 7, 10 |
| Delivery boundary 3, execution sections, contextual HITL, composer | Tasks 12, 13 |
| Delivery boundary 4, headers, tabs, graph, retained controls, tokens | Tasks 1, 8, 14 |
| Delivery boundary 5, verified journeys and matched-state comparison | Task 15 |
| Data completeness gap in the messages route | Tasks 2, 3 |
| Legacy 52 px room defect | Task 1, Task 7 |
| Console Close keeps 460 px and shows two `Select a node` labels | Task 10 |
| Percentage-based responsive requirement and container-aware rules | Tasks 1, 6, 7, 10 |
| Prompt / instruction capture | Open Questions, deliberately not implemented |

## File Structure

### Create

- `packages/web/src/lib/room-split-layout.ts` owns the percent-string size contract, ratio clamping, and per-surface ratio persistence.
- `packages/web/src/lib/room-split-layout.test.ts` locks the percent contract and the persistence round-trip.
- `packages/web/src/lib/panel-size-guard.test.ts` fails when any web source passes a numeric size to a resizable panel.
- `packages/web/src/lib/node-message-pages.ts` owns the cursor-page reducer and scope key.
- `packages/web/src/lib/node-message-pages.test.ts` covers dedupe, ordering, completion, and error retention.
- `packages/web/src/lib/load-node-message-pages.ts` drives the reducer across as many pages as the server reports.
- `packages/web/src/lib/load-node-message-pages.test.ts` covers draining, page caps, abort, and failure retention.
- `packages/web/src/lib/build-agent-history.ts` turns projected transcript items into role, tool, and lifecycle presentation items.
- `packages/web/src/lib/build-agent-history.test.ts` covers role labelling, the tool-context allowlist, output states, and lifecycle copy.
- `packages/web/src/lib/build-execution-header.ts` builds room identity and the execution selector model.
- `packages/web/src/lib/build-execution-header.test.ts` covers labels, offsets, missing timing, and unknown scope.
- `packages/web/src/lib/room-scroll-follow.ts` owns initial position, follow mode, and jump-to-latest state.
- `packages/web/src/lib/room-scroll-follow.test.ts` covers each transition.
- `packages/web/src/lib/use-container-split-mode.ts` measures container width with `ResizeObserver` and returns `split` or `single`.
- `packages/web/src/lib/use-container-split-mode.test.tsx` covers the stubbed observer, the fallback, and the threshold.
- `packages/web/src/lib/node-room-visibility.ts` owns room open state, opener focus, and last-execution memory.
- `packages/web/src/lib/node-room-visibility.test.ts` covers open, close, deep link, and node-change transitions.
- `packages/web/src/components/workflows/NodeRoomHeader.tsx` renders the Legacy room identity row, meta line, and execution selector.
- `packages/web/src/components/workflows/NodeRoomHeader.test.tsx` covers the header contract.
- `packages/web/src/components/workflows/RoomIncompleteNotice.tsx` renders the Legacy incomplete-history notice and Retry.
- `packages/web/src/experiments/console/primitives/console-resizable.tsx` wraps `react-resizable-panels` for console-owned splits.
- `packages/web/src/experiments/console/primitives/console-resizable.test.tsx` proves the console wrapper renders percent sizes.
- `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx` renders the Console room identity row and execution selector.
- `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx` covers the header contract.
- `packages/web/src/experiments/console/components/inspect/build-execution-sections.ts` groups the Console stream timeline into one section per execution.
- `packages/web/src/experiments/console/components/inspect/build-execution-sections.test.ts` covers assignment, ordering, and the System toggle boundary.
- `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx` renders the Console bottom Reply composer.
- `packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx` covers enabled, disabled, and error states.
- `e2e/fixtures/workflows/e2e-hitl-long-history.yaml` produces a node transcript larger than one API page.
- `e2e/ui/workflow-run-hitl-room.spec.ts` asserts the room lifecycle, ratio, history structure, and multi-page history.

### Modify

- `packages/web/src/components/ui/resizable.tsx` narrows the panel size props to percent strings.
- `packages/web/src/index.css` replaces fixed panel-width tokens with ratio tokens and converts run-view typography to relative units.
- `packages/docs-web/src/content/docs/brand/index.md` mirrors the new run-view token values.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` adopts percent sizes, room visibility, single-pane mode, and relocated footers.
- `packages/web/src/components/workflows/WorkflowExecution.tsx` drops auto-selection, adds the `?node=` deep link, and moves retry and artifact panels out of the room pane.
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx` adopts `NodeRoomHeader` and the execution selection callback.
- `packages/web/src/components/workflows/NodeRoom.tsx` renders `AgentHistoryItem` values and the token-driven presentation.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` adopts cursor paging, follow state, and the incomplete notice.
- `packages/web/src/components/workflows/build-log-rows.ts` adds `startOffsetMs` and `unknownScope` to `LogRow`.
- `packages/web/src/components/workflows/build-chat-timeline.ts` adds Ask and gate timeline entries.
- `packages/web/src/components/workflows/ChatTimeline.tsx` renders those entries through the existing `AskCard` and gate chrome.
- `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` becomes a percent split with a conditionally mounted room.
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` adopts the header, history model, paging, and follow state.
- `packages/web/src/experiments/console/components/inspect/build-log-rows.ts` adds `startOffsetMs` and `unknownScope`.
- `packages/web/src/experiments/console/components/RunStream.tsx` renders execution sections instead of one flat sorted list.
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx` keeps the room docked on Artifacts and mounts the Reply composer.
- `packages/web/src/experiments/console/components/RunDetailHeader.tsx` and `ProjectViewTabs.tsx` adopt the mockup hierarchy.
- `packages/web/src/experiments/console/components/RunGraphPanel.tsx` and `packages/web/src/components/workflows/WorkflowDagViewer.tsx` adopt token-driven node typography and selected state.
- `packages/server/src/routes/api.ts` includes `metadata` in the non-cursor node-messages branch.
- `packages/providers/src/e2e-fake/provider.ts` gains a bounded `repeatTool` scenario option.
- `e2e/lib/playwright/archon-runtime.ts` installs the long-history fixture and exposes a runner for it.
- `e2e/ui/workflow-run-hitl-visual.spec.ts` replaces its vacuous final assertion with real comparisons.
- `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` records Story 5.6.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` tracks Story 5.6.

### Delete

- `packages/web/src/lib/select-initial-node.ts` and `packages/web/src/lib/select-initial-node.test.ts`, because automatic node selection is exactly the behavior the brainstorm requires removing.

---

## Task 1: Lock the Percentage Split Contract and the Run-View Tokens

**Files:**

- Create: `packages/web/src/lib/room-split-layout.ts`
- Create: `packages/web/src/lib/room-split-layout.test.ts`
- Create: `packages/web/src/lib/panel-size-guard.test.ts`
- Create: `packages/web/src/experiments/console/primitives/console-resizable.tsx`
- Create: `packages/web/src/experiments/console/primitives/console-resizable.test.tsx`
- Modify: `packages/web/src/components/ui/resizable.tsx`
- Modify: `packages/web/src/index.css`
- Modify: `packages/docs-web/src/content/docs/brand/index.md`
- Modify: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Interfaces:**

- Consumes: `react-resizable-panels` v4 `Group`, `Panel`, and `Separator`; the existing `.legacy-run-view` and `.console-run-view` token scopes.
- Produces: `PanelPercent`, `ROOM_SPLIT`, `clampRoomRatio`, `roomSplitSizes`, `readRoomRatio`, `writeRoomRatio`, and the console-owned `ConsolePanelGroup`, `ConsolePanel`, `ConsolePanelSeparator`.

- [ ] **Step 1: Write the failing layout-contract test**

Create `packages/web/src/lib/room-split-layout.test.ts`.

```ts
import { afterEach, describe, expect, test } from 'bun:test';

import {
  ROOM_SPLIT,
  clampRoomRatio,
  readRoomRatio,
  roomSplitSizes,
  writeRoomRatio,
} from './room-split-layout';

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    store.set(k, v);
  },
};

afterEach(() => {
  store.clear();
});

describe('room split layout', () => {
  test('default ratio is 40 percent of the work area', () => {
    expect(ROOM_SPLIT.defaultRoomRatio).toBe(40);
  });

  test('sizes are percent strings, never numbers', () => {
    const sizes = roomSplitSizes(40);
    expect(sizes.view.defaultSize).toBe('60%');
    expect(sizes.room.defaultSize).toBe('40%');
    expect(sizes.view.minSize).toBe('30%');
    expect(sizes.room.minSize).toBe('24%');
    expect(sizes.room.maxSize).toBe('60%');
    for (const value of Object.values({ ...sizes.view, ...sizes.room })) {
      expect(typeof value).toBe('string');
      expect(value.endsWith('%')).toBe(true);
    }
  });

  test('clamps out-of-range ratios instead of trusting stored input', () => {
    expect(clampRoomRatio(5)).toBe(24);
    expect(clampRoomRatio(95)).toBe(60);
    expect(clampRoomRatio(Number.NaN)).toBe(40);
  });

  test('persists and reads a ratio per surface', () => {
    writeRoomRatio('legacy', 55, memoryStorage);
    expect(readRoomRatio('legacy', memoryStorage)).toBe(55);
    expect(readRoomRatio('console', memoryStorage)).toBe(40);
  });

  test('a corrupt stored ratio falls back to the default', () => {
    memoryStorage.setItem('archon.run-room.ratio.console', 'not-a-number');
    expect(readRoomRatio('console', memoryStorage)).toBe(40);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `bun test src/lib/room-split-layout.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./room-split-layout`.

- [ ] **Step 3: Implement the layout contract**

Create `packages/web/src/lib/room-split-layout.ts`.

```ts
/**
 * Percentage split contract for the run-view node room.
 *
 * react-resizable-panels v4 resolves a NUMBER size prop as pixels and a
 * STRING size prop by its unit suffix. Passing 33 therefore means 33 pixels,
 * which is how the Legacy room collapsed to about 52 px. Every size this
 * module emits is a percent string.
 */
export type PanelPercent = `${number}%`;

export type RoomSurface = 'legacy' | 'console';

export const ROOM_SPLIT = {
  defaultRoomRatio: 40,
  minRoomRatio: 24,
  maxRoomRatio: 60,
  minViewRatio: 30,
} as const;

export interface RoomPanelSizes {
  view: { defaultSize: PanelPercent; minSize: PanelPercent };
  room: { defaultSize: PanelPercent; minSize: PanelPercent; maxSize: PanelPercent };
}

export function clampRoomRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return ROOM_SPLIT.defaultRoomRatio;
  if (ratio < ROOM_SPLIT.minRoomRatio) return ROOM_SPLIT.minRoomRatio;
  if (ratio > ROOM_SPLIT.maxRoomRatio) return ROOM_SPLIT.maxRoomRatio;
  return ratio;
}

function percent(value: number): PanelPercent {
  return `${value}%`;
}

export function roomSplitSizes(ratio: number): RoomPanelSizes {
  const room = clampRoomRatio(ratio);
  return {
    view: { defaultSize: percent(100 - room), minSize: percent(ROOM_SPLIT.minViewRatio) },
    room: {
      defaultSize: percent(room),
      minSize: percent(ROOM_SPLIT.minRoomRatio),
      maxSize: percent(ROOM_SPLIT.maxRoomRatio),
    },
  };
}

export interface RatioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function ratioKey(surface: RoomSurface): string {
  return `archon.run-room.ratio.${surface}`;
}

function safeLocalStorage(): RatioStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readRoomRatio(surface: RoomSurface, storage?: RatioStorage): number {
  const store = storage ?? safeLocalStorage();
  if (store === null) return ROOM_SPLIT.defaultRoomRatio;
  try {
    const raw = store.getItem(ratioKey(surface));
    if (raw === null) return ROOM_SPLIT.defaultRoomRatio;
    return clampRoomRatio(Number.parseFloat(raw));
  } catch {
    return ROOM_SPLIT.defaultRoomRatio;
  }
}

export function writeRoomRatio(surface: RoomSurface, ratio: number, storage?: RatioStorage): void {
  const store = storage ?? safeLocalStorage();
  if (store === null) return;
  try {
    store.setItem(ratioKey(surface), String(clampRoomRatio(ratio)));
  } catch {
    // Storage disabled by the browser; the ratio simply does not persist.
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `bun test src/lib/room-split-layout.test.ts` from `packages/web`.
Expected: PASS, 5 tests.

- [ ] **Step 5: Narrow the shared panel size props**

Modify `packages/web/src/components/ui/resizable.tsx` so a numeric size becomes a compile error.

```tsx
import type { PanelPercent } from '@/lib/room-split-layout';

export type ResizablePanelProps = Omit<
  ResizablePrimitive.PanelProps,
  'defaultSize' | 'minSize' | 'maxSize' | 'collapsedSize'
> & {
  defaultSize?: PanelPercent;
  minSize?: PanelPercent;
  maxSize?: PanelPercent;
  collapsedSize?: PanelPercent;
};

function ResizablePanel({ ...props }: ResizablePanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}
```

Keep the existing `ResizablePanelGroup` and `ResizableHandle` unchanged, and add `ResizablePanelProps` to the export list.

- [ ] **Step 6: Write the numeric-size guard test**

Create `packages/web/src/lib/panel-size-guard.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WEB_SRC = join(import.meta.dir, '..');

/**
 * A bare numeric literal, or a ternary between two numeric literals, in a
 * panel size prop. Percent sizes are quoted strings, so they can never match
 * `={` followed by a digit — no allowlist skip is needed or wanted.
 */
const NUMERIC_SIZE =
  /\b(defaultSize|minSize|maxSize|collapsedSize)=\{\s*(?:\d+(?:\.\d+)?|[^{}]*\?\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?)\s*\}/;

describe('resizable panel sizes', () => {
  test('no web source passes a numeric panel size', async () => {
    const violations: string[] = [];
    for await (const path of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: WEB_SRC })) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue;
      const source = await readFile(join(WEB_SRC, path), 'utf8');
      for (const line of source.split('\n')) {
        if (NUMERIC_SIZE.test(line)) violations.push(`${path}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 7: Run the guard and confirm it fails on the real defect**

Run `bun test src/lib/panel-size-guard.test.ts` from `packages/web`.
Expected: FAIL listing the three `LegacyGraphLogsPane.tsx` lines that pass `45`, `67`, `55`, `33`, `28`, `32`, `22`, `72`, and `52`.
Leave this failure standing; Task 7 removes those numbers and turns the guard green.

- [ ] **Step 8: Add the console-owned split primitives**

Create `packages/web/src/experiments/console/primitives/console-resizable.tsx`.
The console cannot import `@/components/ui/resizable`, so it wraps the library directly under the same percent-only contract.

```tsx
/**
 * Console-owned split primitives.
 *
 * console-isolation.test.ts forbids `@/components` imports, so the console
 * cannot reuse the shadcn wrapper. Sizes are percent strings only, for the
 * same react-resizable-panels v4 reason documented in room-split-layout.ts.
 */
import type { ReactElement } from 'react';
import * as ResizablePrimitive from 'react-resizable-panels';

import type { PanelPercent } from '@/lib/room-split-layout';

export type ConsolePanelProps = Omit<
  ResizablePrimitive.PanelProps,
  'defaultSize' | 'minSize' | 'maxSize' | 'collapsedSize'
> & {
  defaultSize?: PanelPercent;
  minSize?: PanelPercent;
  maxSize?: PanelPercent;
};

export function ConsolePanelGroup(props: ResizablePrimitive.GroupProps): ReactElement {
  return (
    <ResizablePrimitive.Group
      data-slot="console-panel-group"
      className="flex h-full min-h-0 w-full aria-[orientation=vertical]:flex-col"
      {...props}
    />
  );
}

export function ConsolePanel(props: ConsolePanelProps): ReactElement {
  return <ResizablePrimitive.Panel data-slot="console-panel" {...props} />;
}

export function ConsolePanelSeparator(props: ResizablePrimitive.SeparatorProps): ReactElement {
  return (
    <ResizablePrimitive.Separator
      data-slot="console-panel-separator"
      className="relative flex w-px shrink-0 items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
      {...props}
    />
  );
}
```

Create `packages/web/src/experiments/console/primitives/console-resizable.test.tsx`.
Use `installHappyDom` and `restoreHappyDom` from `../test/install-happy-dom` in `beforeEach` and `afterEach`.
Mount a `ConsolePanelGroup` containing `ConsolePanel` with `defaultSize="60%"`, a `ConsolePanelSeparator`, and `ConsolePanel` with `defaultSize="40%"`.
Assert that both `[data-slot="console-panel"]` elements have an inline `flex` style whose first component is a number greater than `1`, which proves a relative rather than a pixel size.
Assert that the separator element reports `role="separator"`.

- [ ] **Step 9: Run the console wrapper test**

Run `NODE_ENV=development bun test src/experiments/console/primitives/console-resizable.test.tsx` from `packages/web`.
Expected: PASS, 2 tests.

- [ ] **Step 10: Convert the run-view tokens to ratios and relative units**

Modify the `.legacy-run-view, .console-run-view` block in `packages/web/src/index.css` so it reads exactly:

```css
.legacy-run-view,
.console-run-view {
  /* Agent message typography — mockup .pmsg-text, expressed relatively */
  --rv-agent-font-size: 0.78125rem;
  --rv-agent-line-height: 1.5;
  --rv-role-label-font-size: 0.625rem;
  --rv-role-label-tracking: 0.06em;

  /* Tool card inset surface — mockup .ptool */
  --rv-tool-card-bg: var(--surface-inset);
  --rv-tool-card-border: 1px solid var(--border);
  --rv-tool-card-radius: var(--radius);
  --rv-tool-card-padding: 0.5rem 0.625rem;
  --rv-tool-name-font-size: 0.71875rem;
  --rv-tool-io-font-size: 0.6875rem;
  --rv-tool-io-label-font-size: 0.59375rem;
  --rv-tool-output-max-height: 24rem;

  /* Lifecycle notes — mockup .psys */
  --rv-lifecycle-font-size: 0.6875rem;

  /* Ask card — mockup .ask-card */
  --rv-ask-card-border-color: var(--warning);
  --rv-ask-card-radius: var(--radius);
  --rv-ask-card-padding: 0.75rem 0.875rem;

  /* Room split — the layout contract is a ratio of the work area, not a width */
  --rv-room-default-ratio: 40%;
  --rv-room-min-ratio: 24%;
  --rv-room-max-ratio: 60%;
  --rv-view-min-ratio: 30%;
  --rv-split-min-container: 60rem;
}
```

- [ ] **Step 11: Mirror the tokens in the brand guide**

Modify the run-view token table in `packages/docs-web/src/content/docs/brand/index.md`.
Delete the `--rv-panel-default-width`, `--rv-panel-min-width`, and `--rv-panel-max-width` rows.
Update `--rv-agent-font-size` to `0.78125rem`, `--rv-tool-card-padding` to `0.5rem 0.625rem`, `--rv-tool-io-font-size` to `0.6875rem`, and `--rv-ask-card-padding` to `0.75rem 0.875rem`.
Add rows for `--rv-role-label-font-size`, `--rv-role-label-tracking`, `--rv-tool-name-font-size`, `--rv-tool-io-label-font-size`, `--rv-tool-output-max-height`, `--rv-lifecycle-font-size`, `--rv-room-default-ratio`, `--rv-room-min-ratio`, `--rv-room-max-ratio`, `--rv-view-min-ratio`, and `--rv-split-min-container`, with the exact values from Step 10.
Add one sentence below the table stating that the run-room split is a percentage of the available work area and that fixed panel widths are no longer part of the token set.

- [ ] **Step 12: Record Story 5.6 in the epics file**

Modify `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`.
Insert a `### Story 5.6: Align agent history and the responsive run room` section immediately after the Story 5.5 section and before the `## Epic 6: Answer an agent mid-turn` heading, following the structure the neighbouring stories already use.
Copy AC1 through AC16 from this plan verbatim as the story's acceptance criteria.
Record that the source of truth for the story is `plans/reports/brainstorm-260908-1653-workflow-run-hitl-ui-gap.md` together with the PR #146 captures.

- [ ] **Step 13: Track the story in the sprint file**

Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
Change `epic-5: done` to `epic-5: in-progress`.
Add `5-6-align-agent-history-and-responsive-run-room: in-progress` directly after the `5-5-...: done` line.
Update `last_updated` to the current local date and time using the file's existing format.

- [ ] **Step 14: Format and commit**

Run `bun x prettier --write src/lib/room-split-layout.ts src/lib/room-split-layout.test.ts src/lib/panel-size-guard.test.ts src/components/ui/resizable.tsx src/index.css src/experiments/console/primitives/console-resizable.tsx src/experiments/console/primitives/console-resizable.test.tsx` from `packages/web`.

```bash
git add packages/web/src/lib/room-split-layout.ts packages/web/src/lib/room-split-layout.test.ts packages/web/src/lib/panel-size-guard.test.ts packages/web/src/components/ui/resizable.tsx packages/web/src/index.css packages/web/src/experiments/console/primitives/console-resizable.tsx packages/web/src/experiments/console/primitives/console-resizable.test.tsx packages/docs-web/src/content/docs/brand/index.md _bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "feat(web): define percentage run-room split and run-view tokens"
```

## Task 2: Page the Node Transcript Through the Cursor API

**Files:**

- Create: `packages/web/src/lib/node-message-pages.ts`
- Create: `packages/web/src/lib/node-message-pages.test.ts`
- Create: `packages/web/src/lib/load-node-message-pages.ts`
- Create: `packages/web/src/lib/load-node-message-pages.test.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`

**Interfaces:**

- Consumes: `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` with `afterSeq`, `limit`, `occurrenceId`, and `attemptId`, plus its `nextCursor`, `hasMore`, and `highWatermark` fields.
- Produces: `NodeMessageRow`, `NodeMessagePage`, `NodeMessageState`, `emptyNodeMessageState`, `nodeMessageScopeKey`, `appendNodeMessagePage`, `NODE_MESSAGE_PAGE_LIMIT`, `MAX_NODE_MESSAGE_PAGES`, `NodeMessageLoader`, and `advanceNodeMessages`.

- [ ] **Step 1: Write the failing reducer test**

Create `packages/web/src/lib/node-message-pages.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import {
  appendNodeMessagePage,
  emptyNodeMessageState,
  nodeMessageScopeKey,
  type NodeMessageRow,
} from './node-message-pages';

function row(seq: number): NodeMessageRow {
  return {
    id: `m${String(seq)}`,
    seq,
    kind: 'text',
    payload: { text: `t${String(seq)}` },
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

describe('node message pages', () => {
  test('an empty state holds no rows and is not complete', () => {
    const state = emptyNodeMessageState();
    expect(state.messages).toEqual([]);
    expect(state.complete).toBe(false);
    expect(state.lastSeq).toBe(0);
    expect(state.error).toBeNull();
  });

  test('appending pages keeps sequence order and advances the cursor', () => {
    let state = emptyNodeMessageState();
    state = appendNodeMessagePage(state, {
      messages: [row(1), row(2)],
      hasMore: true,
      highWatermark: 4,
    });
    state = appendNodeMessagePage(state, {
      messages: [row(3), row(4)],
      hasMore: false,
      highWatermark: 4,
    });
    expect(state.messages.map(m => m.seq)).toEqual([1, 2, 3, 4]);
    expect(state.lastSeq).toBe(4);
    expect(state.complete).toBe(true);
  });

  test('overlapping pages never duplicate a seq and keep the newest row', () => {
    let state = emptyNodeMessageState();
    state = appendNodeMessagePage(state, {
      messages: [row(1), row(2)],
      hasMore: true,
      highWatermark: 3,
    });
    const updated: NodeMessageRow = { ...row(2), payload: { text: 'updated' } };
    state = appendNodeMessagePage(state, {
      messages: [updated, row(3)],
      hasMore: false,
      highWatermark: 3,
    });
    expect(state.messages.map(m => m.seq)).toEqual([1, 2, 3]);
    expect(state.messages[1].payload).toEqual({ text: 'updated' });
  });

  test('a page short of the high watermark is not complete', () => {
    const state = appendNodeMessagePage(emptyNodeMessageState(), {
      messages: [row(1)],
      hasMore: false,
      highWatermark: 9,
    });
    expect(state.complete).toBe(false);
  });

  test('an absent high watermark falls back to hasMore alone', () => {
    const state = appendNodeMessagePage(emptyNodeMessageState(), {
      messages: [row(1)],
      hasMore: false,
    });
    expect(state.complete).toBe(true);
  });

  test('the scope key separates occurrence and attempt', () => {
    expect(nodeMessageScopeKey('r1', 'n1', { occurrenceId: 'o1', attemptId: 'a1' })).toBe(
      'r1 n1 o1 a1'
    );
    expect(nodeMessageScopeKey('r1', 'n1', {})).toBe('r1 n1  ');
  });
});
```

- [ ] **Step 2: Run the reducer test and confirm it fails**

Run `bun test src/lib/node-message-pages.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./node-message-pages`.

- [ ] **Step 3: Implement the reducer**

Create `packages/web/src/lib/node-message-pages.ts`.

```ts
/**
 * Cursor-page accumulator for one node execution's transcript.
 *
 * The messages route returns at most `limit` rows plus `nextCursor`,
 * `hasMore`, and `highWatermark`. A room that ignores the cursor silently
 * truncates any history longer than one page, so this reducer owns
 * accumulation, dedupe, and the completion decision for both surfaces.
 */
export interface NodeMessageRowMetadata {
  execution?: { occurrence_id?: string; attempt_id?: string };
  stream_id?: string;
  message_id?: string;
  block_id?: string;
  text_mode?: 'complete' | 'delta' | 'snapshot';
  tool_phase?: 'call' | 'result';
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exit_code?: number;
  truncated?: boolean;
  output_state?: 'full' | 'truncated' | 'missing' | 'unknown';
}

interface NodeMessageRowBase {
  id: string;
  seq: number;
  created_at: string;
  metadata?: NodeMessageRowMetadata | null;
}

/**
 * A DISCRIMINATED union, mirroring workflowNodeMessageResponseSchema.
 *
 * One interface with `kind: string` would make `Extract<T, { kind: 'tool' }>`
 * resolve to `never` inside projectToolTranscript, so the folded tool rows
 * would silently lose their types. NodeMessageRowMetadata is assignable to
 * BOTH ProjectableTextMetadata and PairableToolMetadata, so neither projection
 * needs a type assertion.
 */
export interface NodeMessageTextRow extends NodeMessageRowBase {
  kind: 'text';
  payload: { text: string };
}

export interface NodeMessageToolRow extends NodeMessageRowBase {
  kind: 'tool';
  payload: { name: string; id: string; input?: unknown; output?: unknown };
}

export interface NodeMessageStatusRow extends NodeMessageRowBase {
  kind: 'status';
  payload: { state: string; detail?: string };
}

export type NodeMessageRow = NodeMessageTextRow | NodeMessageToolRow | NodeMessageStatusRow;

export interface NodeMessagePage {
  messages: readonly NodeMessageRow[];
  nextCursor?: string;
  hasMore?: boolean;
  highWatermark?: number;
}

export interface NodeMessageState {
  messages: readonly NodeMessageRow[];
  lastSeq: number;
  highWatermark: number | null;
  complete: boolean;
  error: string | null;
}

/**
 * The route caps `limit` at 500. 200 keeps a normal execution to one round
 * trip while staying well inside that ceiling.
 */
export const NODE_MESSAGE_PAGE_LIMIT = 200;

export function emptyNodeMessageState(): NodeMessageState {
  return { messages: [], lastSeq: 0, highWatermark: null, complete: false, error: null };
}

export function nodeMessageScopeKey(
  runId: string,
  nodeId: string,
  scope: { occurrenceId?: string; attemptId?: string }
): string {
  return [runId, nodeId, scope.occurrenceId ?? '', scope.attemptId ?? ''].join(' ');
}

export function appendNodeMessagePage(
  state: NodeMessageState,
  page: NodeMessagePage
): NodeMessageState {
  const bySeq = new Map<number, NodeMessageRow>();
  for (const row of state.messages) bySeq.set(row.seq, row);
  for (const row of page.messages) bySeq.set(row.seq, row);
  const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const lastSeq = messages.length === 0 ? 0 : messages[messages.length - 1].seq;
  const highWatermark = page.highWatermark ?? state.highWatermark;
  const hasMore = page.hasMore ?? false;
  const drained = highWatermark === null || lastSeq >= highWatermark;
  return { messages, lastSeq, highWatermark, complete: !hasMore && drained, error: null };
}
```

- [ ] **Step 4: Run the reducer test and confirm it passes**

Run `bun test src/lib/node-message-pages.test.ts` from `packages/web`.
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing driver test**

Create `packages/web/src/lib/load-node-message-pages.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import { MAX_NODE_MESSAGE_PAGES, advanceNodeMessages } from './load-node-message-pages';
import {
  emptyNodeMessageState,
  type NodeMessagePage,
  type NodeMessageRow,
} from './node-message-pages';

function row(seq: number): NodeMessageRow {
  return {
    id: `m${String(seq)}`,
    seq,
    kind: 'text',
    payload: { text: `t${String(seq)}` },
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

describe('advanceNodeMessages', () => {
  test('drains every page and always requests cursor mode', async () => {
    const calls: { afterSeq?: number; limit?: number }[] = [];
    const load = async (
      _runId: string,
      _nodeId: string,
      options?: { afterSeq?: number; limit?: number }
    ): Promise<NodeMessagePage> => {
      calls.push({ ...options });
      const afterSeq = options?.afterSeq ?? 0;
      if (afterSeq === 0) return { messages: [row(1), row(2)], hasMore: true, highWatermark: 4 };
      return { messages: [row(3), row(4)], hasMore: false, highWatermark: 4 };
    };
    const next = await advanceNodeMessages({
      load,
      runId: 'r1',
      nodeId: 'n1',
      scope: {},
      state: emptyNodeMessageState(),
    });
    expect(next.messages.map(m => m.seq)).toEqual([1, 2, 3, 4]);
    expect(next.complete).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].limit).toBeGreaterThan(0);
    expect(calls[1].afterSeq).toBe(2);
  });

  test('a failed later page keeps loaded rows and records the error', async () => {
    let call = 0;
    const load = async (): Promise<NodeMessagePage> => {
      call += 1;
      if (call === 1) return { messages: [row(1)], hasMore: true, highWatermark: 3 };
      throw new Error('page two failed');
    };
    const next = await advanceNodeMessages({
      load,
      runId: 'r1',
      nodeId: 'n1',
      scope: {},
      state: emptyNodeMessageState(),
    });
    expect(next.messages.map(m => m.seq)).toEqual([1]);
    expect(next.complete).toBe(false);
    expect(next.error).toBe('page two failed');
  });

  test('a first-page failure with no prior rows still reports the error', async () => {
    const load = async (): Promise<NodeMessagePage> => {
      throw new Error('offline');
    };
    const next = await advanceNodeMessages({
      load,
      runId: 'r1',
      nodeId: 'n1',
      scope: {},
      state: emptyNodeMessageState(),
    });
    expect(next.messages).toEqual([]);
    expect(next.error).toBe('offline');
  });

  test('an aborted signal stops before the next request', async () => {
    const controller = new AbortController();
    let calls = 0;
    const load = async (): Promise<NodeMessagePage> => {
      calls += 1;
      controller.abort();
      return { messages: [row(1)], hasMore: true, highWatermark: 9 };
    };
    const next = await advanceNodeMessages({
      load,
      runId: 'r1',
      nodeId: 'n1',
      scope: {},
      state: emptyNodeMessageState(),
      signal: controller.signal,
    });
    expect(calls).toBe(1);
    expect(next.complete).toBe(false);
    expect(next.error).toBeNull();
  });

  test('a server that never reports completion stops at the page cap', async () => {
    let seq = 0;
    const load = async (): Promise<NodeMessagePage> => {
      seq += 1;
      return { messages: [row(seq)], hasMore: true, highWatermark: 10_000 };
    };
    const next = await advanceNodeMessages({
      load,
      runId: 'r1',
      nodeId: 'n1',
      scope: {},
      state: emptyNodeMessageState(),
    });
    expect(next.messages).toHaveLength(MAX_NODE_MESSAGE_PAGES);
    expect(next.complete).toBe(false);
    expect(next.error).toContain('page limit');
  });
});
```

- [ ] **Step 6: Run the driver test and confirm it fails**

Run `bun test src/lib/load-node-message-pages.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./load-node-message-pages`.

- [ ] **Step 7: Implement the driver**

Create `packages/web/src/lib/load-node-message-pages.ts`.

```ts
/**
 * Drive the cursor API until the selected execution's history is drained.
 *
 * Cursor mode is REQUIRED, not optional: the route selects it when any of
 * afterSeq, limit, occurrenceId, or attemptId is present, and only the cursor
 * branch used to return `metadata`, which the text and tool projections need.
 * Passing `limit` alone is therefore always correct.
 */
import {
  NODE_MESSAGE_PAGE_LIMIT,
  appendNodeMessagePage,
  type NodeMessagePage,
  type NodeMessageState,
} from './node-message-pages';

/** Backstop against a server that never reports completion. 200 pages of 200 rows. */
export const MAX_NODE_MESSAGE_PAGES = 200;

export interface NodeMessageScope {
  occurrenceId?: string;
  attemptId?: string;
}

export type NodeMessageLoader = (
  runId: string,
  nodeId: string,
  options?: { afterSeq?: number; limit?: number; occurrenceId?: string; attemptId?: string }
) => Promise<NodeMessagePage>;

export interface AdvanceNodeMessagesInput {
  load: NodeMessageLoader;
  runId: string;
  nodeId: string;
  scope: NodeMessageScope;
  state: NodeMessageState;
  signal?: AbortSignal;
}

export async function advanceNodeMessages(
  input: AdvanceNodeMessagesInput
): Promise<NodeMessageState> {
  let state: NodeMessageState = { ...input.state, error: null };
  for (let page = 0; page < MAX_NODE_MESSAGE_PAGES; page += 1) {
    if (input.signal?.aborted === true) return state;
    try {
      const result = await input.load(input.runId, input.nodeId, {
        ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
        limit: NODE_MESSAGE_PAGE_LIMIT,
        ...(input.scope.occurrenceId !== undefined
          ? { occurrenceId: input.scope.occurrenceId }
          : {}),
        ...(input.scope.attemptId !== undefined ? { attemptId: input.scope.attemptId } : {}),
      });
      state = appendNodeMessagePage(state, result);
    } catch (error: unknown) {
      return {
        ...state,
        complete: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (state.complete) return state;
    if (input.signal?.aborted === true) return state;
  }
  return {
    ...state,
    complete: false,
    error: `Stopped after the ${String(MAX_NODE_MESSAGE_PAGES)} page limit; history may be incomplete.`,
  };
}
```

- [ ] **Step 8: Run the driver test and confirm it passes**

Run `bun test src/lib/load-node-message-pages.test.ts` from `packages/web`.
Expected: PASS, 5 tests.

- [ ] **Step 9: Write the failing server test for non-cursor metadata**

Modify `packages/server/src/routes/api.workflow-runs.test.ts`.
Add a test immediately after the existing `cursor mode returns metadata, nextCursor, hasMore, and highWatermark` test.
Seed one `tool` node message whose stored `metadata` is `{ tool_phase: 'call' }`, request the messages endpoint with no query string, and assert `body.messages[0].metadata` equals `{ tool_phase: 'call' }`.

- [ ] **Step 10: Run the server test and confirm it fails**

Run `bun test src/routes/api.workflow-runs.test.ts` from `packages/server`.
Expected: FAIL, because the non-cursor branch drops `metadata`.

- [ ] **Step 11: Include metadata in the non-cursor branch**

Modify the `if (!cursorMode)` mapping inside `getWorkflowNodeMessagesRoute` in `packages/server/src/routes/api.ts`.

```ts
messages: rows.map(row => ({
  id: row.id,
  seq: row.seq,
  kind: row.kind,
  payload: row.payload,
  created_at: toISOString(row.created_at),
  ...(row.metadata !== undefined && row.metadata !== null ? { metadata: row.metadata } : {}),
})),
```

Do not add tool-output truncation to this branch.
Every client this plan changes requests cursor mode, and the non-cursor branch stays the untruncated compatibility path.

- [ ] **Step 12: Run the server test and confirm it passes**

Run `bun test src/routes/api.workflow-runs.test.ts` from `packages/server`.
Expected: PASS.

- [ ] **Step 13: Format and commit**

Run `bun x prettier --write src/lib/node-message-pages.ts src/lib/node-message-pages.test.ts src/lib/load-node-message-pages.ts src/lib/load-node-message-pages.test.ts` from `packages/web`.
Run `bun x prettier --write src/routes/api.ts src/routes/api.workflow-runs.test.ts` from `packages/server`.

```bash
git add packages/web/src/lib/node-message-pages.ts packages/web/src/lib/node-message-pages.test.ts packages/web/src/lib/load-node-message-pages.ts packages/web/src/lib/load-node-message-pages.test.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(web): page node transcripts through the cursor API"
```

## Task 3: Model the Agent History Presentation

**Files:**

- Create: `packages/web/src/lib/build-agent-history.ts`
- Create: `packages/web/src/lib/build-agent-history.test.ts`

**Interfaces:**

- Consumes: `projectTextTranscript` from `@/lib/project-text-transcript` and `projectToolTranscript` from `@/lib/pair-tool-transcript`, plus `NodeMessageRow` from `@/lib/node-message-pages`.
- Produces: `AgentHistoryItem`, `AssistantHistoryItem`, `ToolHistoryItem`, `LifecycleHistoryItem`, `TOOL_CONTEXT_FIELDS`, `toolContextSummary`, `lifecycleNoteLabel`, and `buildAgentHistory`.

- [ ] **Step 1: Write the failing history-model test**

Create `packages/web/src/lib/build-agent-history.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import { buildAgentHistory, lifecycleNoteLabel, toolContextSummary } from './build-agent-history';
import type {
  NodeMessageRow,
  NodeMessageRowMetadata,
  NodeMessageToolRow,
} from './node-message-pages';

const AT = '2026-09-08T00:00:00.000Z';

function textRow(seq: number, text: string, metadata?: NodeMessageRowMetadata): NodeMessageRow {
  return {
    id: `m${String(seq)}`,
    seq,
    kind: 'text',
    payload: { text },
    created_at: AT,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function toolRow(
  seq: number,
  payload: NodeMessageToolRow['payload'],
  metadata?: NodeMessageRowMetadata
): NodeMessageRow {
  return {
    id: `m${String(seq)}`,
    seq,
    kind: 'tool',
    payload,
    created_at: AT,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function statusRow(seq: number, state: string, detail?: string): NodeMessageRow {
  return {
    id: `m${String(seq)}`,
    seq,
    kind: 'status',
    payload: { state, ...(detail === undefined ? {} : { detail }) },
    created_at: AT,
  };
}

describe('buildAgentHistory', () => {
  test('assistant prose carries a role label and reconstructed markdown', () => {
    const items = buildAgentHistory([
      textRow(1, '## Plan\n', { stream_id: 's', message_id: 'm', block_id: 'b', text_mode: 'delta' }),
      textRow(2, 'step one', { stream_id: 's', message_id: 'm', block_id: 'b', text_mode: 'delta' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant', roleLabel: 'ASSISTANT' });
    expect(items[0].kind === 'assistant' ? items[0].markdown : '').toBe('## Plan\nstep one');
  });

  test('independent complete messages stay separate blocks', () => {
    const items = buildAgentHistory([textRow(1, 'first'), textRow(2, 'second')]);
    expect(items.map(i => i.kind)).toEqual(['assistant', 'assistant']);
  });

  test('a call and its result become one tool card with visible input and output', () => {
    const items = buildAgentHistory([
      toolRow(1, { name: 'Read', id: 't1', input: { file_path: 'src/a.ts' } }, { tool_phase: 'call' }),
      toolRow(2, { name: 'Read', id: 't1', output: 'contents' }, { tool_phase: 'result', outcome: 'success' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'tool',
      name: 'Read',
      context: 'src/a.ts',
      pending: false,
      outcome: 'success',
      outputState: 'present',
    });
  });

  test('a call with no result is pending, not missing', () => {
    const items = buildAgentHistory([
      toolRow(1, { name: 'Bash', id: 't1', input: { command: 'bun test' } }, { tool_phase: 'call' }),
    ]);
    expect(items[0]).toMatchObject({ kind: 'tool', context: 'bun test', pending: true, outputState: 'pending' });
  });

  test('recorded output states are distinct and never invented', () => {
    const truncated = buildAgentHistory([
      toolRow(1, { name: 'Bash', id: 't1', input: { command: 'ls' } }, { tool_phase: 'call' }),
      toolRow(2, { name: 'Bash', id: 't1', output: 'partial' }, { tool_phase: 'result', output_state: 'truncated', truncated: true }),
    ]);
    expect(truncated[0]).toMatchObject({ outputState: 'truncated' });

    const missing = buildAgentHistory([
      toolRow(1, { name: 'Bash', id: 't1' }, { tool_phase: 'call' }),
      toolRow(2, { name: 'Bash', id: 't1' }, { tool_phase: 'result', output_state: 'missing' }),
    ]);
    expect(missing[0]).toMatchObject({ outputState: 'missing', pending: false });

    const interrupted = buildAgentHistory([
      toolRow(1, { name: 'Bash', id: 't1' }, { tool_phase: 'call' }),
      toolRow(2, { name: 'Bash', id: 't1', output: '' }, { tool_phase: 'result', outcome: 'interrupted' }),
    ]);
    expect(interrupted[0]).toMatchObject({ outcome: 'interrupted' });
  });

  test('an unmatched result stays visible and is marked as such', () => {
    const items = buildAgentHistory([
      toolRow(1, { name: 'Grep', id: 't9', output: 'hit' }, { tool_phase: 'result' }),
    ]);
    expect(items[0]).toMatchObject({ kind: 'tool', unmatchedResult: true });
  });

  test('tool context uses the field allowlist in priority order and never invents prose', () => {
    expect(toolContextSummary({ file_path: 'a.ts', command: 'ls' })).toBe('a.ts');
    expect(toolContextSummary({ command: 'bun run validate' })).toBe('bun run validate');
    expect(toolContextSummary({ pattern: 'TODO' })).toBe('TODO');
    expect(toolContextSummary({ unlisted: 'value' })).toBeNull();
    expect(toolContextSummary({ file_path: 42 })).toBeNull();
    expect(toolContextSummary(undefined)).toBeNull();
    expect(toolContextSummary({ command: 'x'.repeat(200) })).toHaveLength(120);
  });

  test('lifecycle notes get readable secondary copy', () => {
    expect(lifecycleNoteLabel('started')).toBe('Node started');
    expect(lifecycleNoteLabel('completed')).toBe('Node completed');
    expect(lifecycleNoteLabel('failed')).toBe('Node failed');
    expect(lifecycleNoteLabel('iteration_started', '2')).toBe('Iteration 2 started');
    expect(lifecycleNoteLabel('iteration_completed', '2')).toBe('Iteration 2 completed');
    expect(lifecycleNoteLabel('iteration_failed', '2')).toBe('Iteration 2 failed');
    expect(lifecycleNoteLabel('some_new_state')).toBe('some new state');
  });

  test('lifecycle rows keep their transcript position', () => {
    const items = buildAgentHistory([
      statusRow(1, 'started'),
      textRow(2, 'hello'),
      statusRow(3, 'completed'),
    ]);
    expect(items.map(i => i.kind)).toEqual(['lifecycle', 'assistant', 'lifecycle']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `bun test src/lib/build-agent-history.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./build-agent-history`.

- [ ] **Step 3: Implement the history model**

Create `packages/web/src/lib/build-agent-history.ts`.

```ts
/**
 * Presentation model for one execution's agent history.
 *
 * This layer adds ROLE, CONTEXT, and READABLE LIFECYCLE COPY on top of the
 * existing projections. It never reorders stored rows, never merges
 * independent complete messages, and never generates a summary that is not a
 * verbatim recorded field.
 */
import { projectToolTranscript } from './pair-tool-transcript';
import type { NodeMessageRow } from './node-message-pages';
import { projectTextTranscript } from './project-text-transcript';

export type ToolOutputState = 'present' | 'pending' | 'missing' | 'truncated' | 'unknown';

export interface AssistantHistoryItem {
  kind: 'assistant';
  id: string;
  seq: number;
  roleLabel: 'ASSISTANT';
  markdown: string;
}

export interface ToolHistoryItem {
  kind: 'tool';
  id: string;
  seq: number;
  name: string;
  context: string | null;
  input: unknown;
  output: unknown;
  pending: boolean;
  unmatchedResult: boolean;
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exitCode?: number;
  outputState: ToolOutputState;
  /** Ids of the transcript rows folded into this card, for Ask anchoring. */
  messageIds: readonly string[];
}

export interface LifecycleHistoryItem {
  kind: 'lifecycle';
  id: string;
  seq: number;
  label: string;
}

export type AgentHistoryItem = AssistantHistoryItem | ToolHistoryItem | LifecycleHistoryItem;

/**
 * Allowlist, in priority order. Only these recorded input fields may become a
 * tool card's factual context line.
 */
export const TOOL_CONTEXT_FIELDS = [
  'file_path',
  'path',
  'notebook_path',
  'command',
  'pattern',
  'query',
  'url',
] as const;

const CONTEXT_MAX_CHARS = 120;

export function toolContextSummary(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const field of TOOL_CONTEXT_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    return trimmed.length > CONTEXT_MAX_CHARS ? trimmed.slice(0, CONTEXT_MAX_CHARS) : trimmed;
  }
  return null;
}

const LIFECYCLE_LABELS: Record<string, string> = {
  started: 'Node started',
  completed: 'Node completed',
  failed: 'Node failed',
  cancelled: 'Node cancelled',
  skipped: 'Node skipped',
};

export function lifecycleNoteLabel(state: string, detail?: string): string {
  const known = LIFECYCLE_LABELS[state];
  if (known !== undefined) return known;
  if (state === 'iteration_started') return `Iteration ${detail ?? '?'} started`;
  if (state === 'iteration_completed') return `Iteration ${detail ?? '?'} completed`;
  if (state === 'iteration_failed') return `Iteration ${detail ?? '?'} failed`;
  const readable = state.replace(/_/g, ' ');
  return detail === undefined || detail.length === 0 ? readable : `${readable} ${detail}`;
}

function outputStateFor(input: {
  pending: boolean;
  hasOutput: boolean;
  recorded?: 'full' | 'truncated' | 'missing' | 'unknown';
  truncated?: boolean;
}): ToolOutputState {
  if (input.recorded === 'missing') return 'missing';
  if (input.recorded === 'truncated' || input.truncated === true) return 'truncated';
  if (input.pending) return 'pending';
  if (input.hasOutput) return 'present';
  if (input.recorded === 'unknown') return 'unknown';
  return 'missing';
}

export function buildAgentHistory(messages: readonly NodeMessageRow[]): AgentHistoryItem[] {
  const projected = projectToolTranscript(projectTextTranscript(messages));
  const items: AgentHistoryItem[] = [];
  for (const entry of projected) {
    if (entry.kind === 'tool-card') {
      const hasOutput = entry.output !== undefined;
      items.push({
        kind: 'tool',
        id: entry.id,
        seq: entry.messages[0]?.seq ?? 0,
        name: entry.name,
        context: toolContextSummary(entry.input),
        input: entry.input,
        output: entry.output,
        pending: entry.pending,
        unmatchedResult: entry.call === null,
        ...(entry.outcome !== undefined ? { outcome: entry.outcome } : {}),
        ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
        outputState: outputStateFor({
          pending: entry.pending,
          hasOutput,
          ...(entry.outputState !== undefined ? { recorded: entry.outputState } : {}),
          ...(entry.truncated !== undefined ? { truncated: entry.truncated } : {}),
        }),
        messageIds: entry.messages.map(message => message.id),
      });
      continue;
    }
    const message = entry.message;
    if (message.kind === 'text') {
      items.push({
        kind: 'assistant',
        id: message.id,
        seq: message.seq,
        roleLabel: 'ASSISTANT',
        markdown: message.payload.text,
      });
      continue;
    }
    // projectToolTranscript folds every tool row into a tool-card above, so a
    // plain message here is text or status only. Skipping instead of throwing
    // keeps a future row kind from blanking an entire transcript.
    if (message.kind !== 'status') continue;
    items.push({
      kind: 'lifecycle',
      id: message.id,
      seq: message.seq,
      label: lifecycleNoteLabel(message.payload.state, message.payload.detail),
    });
  }
  return items;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `bun test src/lib/build-agent-history.test.ts` from `packages/web`.
Expected: PASS, 9 tests.

- [ ] **Step 5: Format and commit**

Run `bun x prettier --write src/lib/build-agent-history.ts src/lib/build-agent-history.test.ts` from `packages/web`.

```bash
git add packages/web/src/lib/build-agent-history.ts packages/web/src/lib/build-agent-history.test.ts
git commit -m "feat(web): model agent history roles, tool context, and lifecycle notes"
```

## Task 4: Model Execution Identity and the Execution Selector

**Files:**

- Create: `packages/web/src/lib/build-execution-header.ts`
- Create: `packages/web/src/lib/build-execution-header.test.ts`
- Modify: `packages/web/src/components/workflows/build-log-rows.ts`
- Modify: `packages/web/src/components/workflows/build-log-rows.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/build-log-rows.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts`

**Interfaces:**

- Consumes: `NodeExecution` from the generated API types, which carries `occurrence_id`, `attempt_id`, `retry_epoch`, `loop_ancestry`, `route_activation_seq`, `started_at`, `duration_ms`, `start_offset_ms`, `unknown_scope`, and `unknown_reason`.
- Produces: `ExecutionOption`, `ExecutionHeaderModel`, `buildExecutionHeader`, `formatStartOffset`, `formatDurationMs`, and the extended `LogRow` fields `startOffsetMs` and `unknownScope`.

- [ ] **Step 1: Write the failing execution-header test**

Create `packages/web/src/lib/build-execution-header.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import {
  buildExecutionHeader,
  formatDurationMs,
  formatStartOffset,
} from './build-execution-header';
import type { ExecutionInput } from './build-execution-header';

function execution(overrides: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    node_id: 'specify',
    status: 'completed',
    occurrence_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
    started_at: '2026-09-08T00:00:01.000Z',
    duration_ms: 2000,
    start_offset_ms: 1000,
    ...overrides,
  };
}

describe('buildExecutionHeader', () => {
  test('a single execution needs no selector but still reports identity', () => {
    const model = buildExecutionHeader({
      nodeId: 'specify',
      executions: [execution()],
      selectedRowId: '22222222-2222-4222-8222-222222222222',
    });
    expect(model.options).toHaveLength(1);
    expect(model.options[0].label).toBe('');
    expect(model.showSelector).toBe(false);
    expect(model.selected?.startOffsetLabel).toBe('0:01');
    expect(model.selected?.durationLabel).toBe('2s');
    expect(model.timingAvailable).toBe(true);
  });

  test('loop iterations become readable iteration labels', () => {
    const model = buildExecutionHeader({
      nodeId: 'ralph-loop-run',
      executions: [
        execution({ node_id: 'ralph-loop-run', loop_ancestry: [{ node_id: 'ralph-loop-run', iteration: 1 }] }),
        execution({
          node_id: 'ralph-loop-run',
          attempt_id: '33333333-3333-4333-8333-333333333333',
          loop_ancestry: [{ node_id: 'ralph-loop-run', iteration: 2 }],
        }),
      ],
      selectedRowId: null,
    });
    expect(model.options.map(o => o.label)).toEqual(['Iteration 1', 'Iteration 2']);
    expect(model.selectorLabel).toBe('iterations');
    expect(model.showSelector).toBe(true);
  });

  test('retry epochs become pass labels', () => {
    const model = buildExecutionHeader({
      nodeId: 'sync-back',
      executions: [
        execution({ node_id: 'sync-back', retry_epoch: 0 }),
        execution({ node_id: 'sync-back', attempt_id: '44444444-4444-4444-8444-444444444444', retry_epoch: 1 }),
      ],
      selectedRowId: null,
    });
    expect(model.options.map(o => o.label)).toEqual(['Pass 1', 'Pass 2']);
    expect(model.selectorLabel).toBe('runs');
  });

  test('route activations become run labels', () => {
    const model = buildExecutionHeader({
      nodeId: 'converge',
      executions: [
        execution({ node_id: 'converge', route_activation_seq: 1 }),
        execution({ node_id: 'converge', attempt_id: '55555555-5555-4555-8555-555555555555', route_activation_seq: 2 }),
      ],
      selectedRowId: null,
    });
    expect(model.options.map(o => o.label)).toEqual(['Run 1', 'Run 2']);
  });

  test('missing timing reports unavailable instead of a zero clock', () => {
    const model = buildExecutionHeader({
      nodeId: 'specify',
      executions: [execution({ started_at: undefined, duration_ms: undefined, start_offset_ms: undefined })],
      selectedRowId: null,
    });
    expect(model.timingAvailable).toBe(false);
    expect(model.selected?.startOffsetLabel).toBeNull();
    expect(model.selected?.durationLabel).toBeNull();
  });

  test('an unknown scope surfaces its recorded reason', () => {
    const model = buildExecutionHeader({
      nodeId: 'specify',
      executions: [execution({ unknown_scope: true, unknown_reason: 'pre-occurrence run' })],
      selectedRowId: null,
    });
    expect(model.options[0].unknownScope).toBe(true);
    expect(model.limitation).toBe('pre-occurrence run');
  });

  test('an unknown scope with no reason still states the limitation', () => {
    const model = buildExecutionHeader({
      nodeId: 'specify',
      executions: [execution({ unknown_scope: true })],
      selectedRowId: null,
    });
    expect(model.limitation).toBe('This execution has no recorded scope identity.');
  });

  test('a running execution has no duration label', () => {
    const model = buildExecutionHeader({
      nodeId: 'specify',
      executions: [execution({ status: 'running', duration_ms: undefined })],
      selectedRowId: null,
    });
    expect(model.selected?.durationLabel).toBeNull();
    expect(model.selected?.running).toBe(true);
  });

  test('formatters match the mockup clock and duration shapes', () => {
    expect(formatStartOffset(0)).toBe('0:00');
    expect(formatStartOffset(61_000)).toBe('1:01');
    expect(formatStartOffset(3_601_000)).toBe('60:01');
    expect(formatDurationMs(900)).toBe('0.9s');
    expect(formatDurationMs(2000)).toBe('2s');
    expect(formatDurationMs(65_000)).toBe('1m 5s');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `bun test src/lib/build-execution-header.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./build-execution-header`.

- [ ] **Step 3: Implement the execution-header model**

Create `packages/web/src/lib/build-execution-header.ts`.

```ts
/**
 * Room identity and execution-selector model.
 *
 * The selected object is ONE execution of ONE node in ONE run. Occurrence and
 * attempt ids stay internal; the user sees iteration, pass, and run labels.
 * When an execution has no recorded scope, the limitation is displayed rather
 * than guessed around.
 */
export interface LoopAncestryEntry {
  node_id: string;
  iteration: number;
}

export interface ExecutionInput {
  node_id: string;
  status: string;
  occurrence_id?: string;
  attempt_id?: string;
  retry_epoch?: number;
  loop_ancestry?: LoopAncestryEntry[];
  route_activation_seq?: number;
  started_at?: string;
  duration_ms?: number;
  start_offset_ms?: number;
  unknown_scope?: boolean;
  unknown_reason?: string;
}

export interface ExecutionOption {
  /** Stable row id: attempt id, else occurrence id, else a positional fallback. */
  id: string;
  label: string;
  status: string;
  occurrenceId?: string;
  attemptId?: string;
  startOffsetLabel: string | null;
  durationLabel: string | null;
  running: boolean;
  unknownScope: boolean;
}

export interface ExecutionHeaderModel {
  options: readonly ExecutionOption[];
  selected: ExecutionOption | null;
  selectorLabel: 'iterations' | 'runs';
  showSelector: boolean;
  timingAvailable: boolean;
  limitation: string | null;
}

const NO_SCOPE_LIMITATION = 'This execution has no recorded scope identity.';

export function formatStartOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms / 100) / 10)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
}

function iterationOf(execution: ExecutionInput): number | null {
  const ancestry = execution.loop_ancestry;
  if (ancestry === undefined || ancestry.length === 0) return null;
  return ancestry[ancestry.length - 1]?.iteration ?? null;
}

function labelFor(execution: ExecutionInput, index: number, total: number): string {
  const iteration = iterationOf(execution);
  if (iteration !== null) return `Iteration ${String(iteration)}`;
  if (typeof execution.route_activation_seq === 'number') {
    return `Run ${String(execution.route_activation_seq)}`;
  }
  if (typeof execution.retry_epoch === 'number' && execution.retry_epoch > 0) {
    return `Pass ${String(execution.retry_epoch + 1)}`;
  }
  // A lone ordinary execution carries no pass marker in the mockup; the header
  // falls back to the node name when the label is empty.
  if (total === 1) return '';
  return `Pass ${String(index + 1)}`;
}

export function buildExecutionHeader(input: {
  nodeId: string;
  executions: readonly ExecutionInput[];
  selectedRowId: string | null;
}): ExecutionHeaderModel {
  const mine = input.executions.filter(execution => execution.node_id === input.nodeId);
  const options: ExecutionOption[] = mine.map((execution, index) => {
    const running = execution.status === 'running' || execution.status === 'pending';
    return {
      id: execution.attempt_id ?? execution.occurrence_id ?? `exec:${input.nodeId}:${String(index)}`,
      label: labelFor(execution, index, mine.length),
      status: execution.status,
      ...(execution.occurrence_id !== undefined ? { occurrenceId: execution.occurrence_id } : {}),
      ...(execution.attempt_id !== undefined ? { attemptId: execution.attempt_id } : {}),
      startOffsetLabel:
        typeof execution.start_offset_ms === 'number'
          ? formatStartOffset(execution.start_offset_ms)
          : null,
      durationLabel:
        typeof execution.duration_ms === 'number' ? formatDurationMs(execution.duration_ms) : null,
      running,
      unknownScope: execution.unknown_scope === true,
    };
  });
  const matched = options.findIndex(option => option.id === input.selectedRowId);
  const index = matched >= 0 ? matched : options.length - 1;
  const selected = index >= 0 ? (options[index] ?? null) : null;
  const selectedSource = index >= 0 ? mine[index] : undefined;
  const limitation =
    selected !== null && selected.unknownScope
      ? (selectedSource?.unknown_reason ?? NO_SCOPE_LIMITATION)
      : null;
  const hasIterations = mine.some(execution => iterationOf(execution) !== null);
  return {
    options,
    selected,
    selectorLabel: hasIterations ? 'iterations' : 'runs',
    showSelector: options.length > 1,
    timingAvailable: options.some(
      option => option.startOffsetLabel !== null || option.durationLabel !== null
    ),
    limitation,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `bun test src/lib/build-execution-header.test.ts` from `packages/web`.
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing LogRow timing tests**

Modify `packages/web/src/components/workflows/build-log-rows.test.ts`.
Add a test asserting that a row built from a `NodeExecution` carrying `start_offset_ms: 1500` and `unknown_scope: true` produces `startOffsetMs === 1500` and `unknownScope === true`.
Add a second test asserting that a row built from the event-based fallback leaves `startOffsetMs` `undefined` and `unknownScope` `false`.
Make the same two additions in `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts`.

- [ ] **Step 6: Run both suites and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/build-log-rows.test.ts src/experiments/console/components/inspect/build-log-rows.test.ts` from `packages/web`.
Expected: FAIL, because neither field exists on `LogRow`.

- [ ] **Step 7: Extend LogRow in both builders**

In both `build-log-rows.ts` files, add these fields to the `LogRow` interface.

```ts
  /** ms since run start — present only when built from server nodeExecutions */
  startOffsetMs?: number;
  /** true when the server could not attribute this execution to a scope */
  unknownScope: boolean;
```

In each `buildFromOccurrences` mapping, add `...(typeof exec.start_offset_ms === 'number' ? { startOffsetMs: exec.start_offset_ms } : {})` and `unknownScope: exec.unknown_scope === true`.
In every event-based fallback row construction in both files, add `unknownScope: false` and omit `startOffsetMs`.

- [ ] **Step 8: Run both suites and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/build-log-rows.test.ts src/experiments/console/components/inspect/build-log-rows.test.ts` from `packages/web`.
Expected: PASS.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/lib/build-execution-header.ts src/lib/build-execution-header.test.ts src/components/workflows/build-log-rows.ts src/components/workflows/build-log-rows.test.ts src/experiments/console/components/inspect/build-log-rows.ts src/experiments/console/components/inspect/build-log-rows.test.ts` from `packages/web`.

```bash
git add packages/web/src/lib/build-execution-header.ts packages/web/src/lib/build-execution-header.test.ts packages/web/src/components/workflows/build-log-rows.ts packages/web/src/components/workflows/build-log-rows.test.ts packages/web/src/experiments/console/components/inspect/build-log-rows.ts packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts
git commit -m "feat(web): model run-room execution identity and selection"
```

## Task 5: Own Reading Position, Follow Mode, and Container Split Mode

**Files:**

- Create: `packages/web/src/lib/room-scroll-follow.ts`
- Create: `packages/web/src/lib/room-scroll-follow.test.ts`
- Create: `packages/web/src/lib/use-container-split-mode.ts`
- Create: `packages/web/src/lib/use-container-split-mode.test.tsx`
- Create: `packages/web/src/lib/test/install-happy-dom.ts`
- Modify: `packages/web/package.json`

**Interfaces:**

- Consumes: DOM scroll geometry supplied by the caller, and `ResizeObserver` resolved from the element's own document view.
- Produces: `FollowState`, `initialFollowState`, `onFollowScroll`, `onFollowContentGrew`, `jumpToLatest`, `FOLLOW_BOTTOM_THRESHOLD_PX`, `SplitMode`, `SPLIT_MIN_CONTAINER_PX`, and `useContainerSplitMode`.

- [ ] **Step 1: Write the failing follow-state test**

Create `packages/web/src/lib/room-scroll-follow.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import {
  initialFollowState,
  jumpToLatest,
  onFollowContentGrew,
  onFollowScroll,
} from './room-scroll-follow';

describe('room scroll follow', () => {
  test('a completed execution opens at the top and does not follow', () => {
    const state = initialFollowState('completed');
    expect(state.startAt).toBe('top');
    expect(state.following).toBe(false);
  });

  test('an active execution opens at the latest output and follows', () => {
    for (const status of ['running', 'pending', 'awaiting'] as const) {
      const state = initialFollowState(status);
      expect(state.startAt).toBe('bottom');
      expect(state.following).toBe(true);
    }
  });

  test('scrolling up stops following and offers a jump control', () => {
    const state = onFollowScroll(initialFollowState('running'), {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(state.following).toBe(false);
    expect(state.showJumpToLatest).toBe(true);
  });

  test('returning to the bottom resumes following and hides the control', () => {
    let state = onFollowScroll(initialFollowState('running'), {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    state = onFollowScroll(state, { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 });
    expect(state.following).toBe(true);
    expect(state.showJumpToLatest).toBe(false);
  });

  test('new output while following keeps the view pinned', () => {
    const state = onFollowContentGrew(initialFollowState('running'));
    expect(state.scrollToBottomToken).toBeGreaterThan(0);
  });

  test('new output while reading older history never moves the view', () => {
    const paused = onFollowScroll(initialFollowState('running'), {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    const after = onFollowContentGrew(paused);
    expect(after.scrollToBottomToken).toBe(paused.scrollToBottomToken);
    expect(after.showJumpToLatest).toBe(true);
  });

  test('jump to latest resumes following explicitly', () => {
    const paused = onFollowScroll(initialFollowState('running'), {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    const jumped = jumpToLatest(paused);
    expect(jumped.following).toBe(true);
    expect(jumped.showJumpToLatest).toBe(false);
    expect(jumped.scrollToBottomToken).toBeGreaterThan(paused.scrollToBottomToken);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `bun test src/lib/room-scroll-follow.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./room-scroll-follow`.

- [ ] **Step 3: Implement follow state**

Create `packages/web/src/lib/room-scroll-follow.ts`.

```ts
/**
 * Reading-position policy for a node room transcript.
 *
 * Completed executions open at the beginning; active executions open at the
 * latest output and follow it. Scrolling up stops following, and new output
 * must never pull a reader away from older history.
 */
export const FOLLOW_BOTTOM_THRESHOLD_PX = 120;

export interface FollowState {
  startAt: 'top' | 'bottom';
  following: boolean;
  showJumpToLatest: boolean;
  /** Monotonic token; a change instructs the view to scroll to the bottom. */
  scrollToBottomToken: number;
}

export function initialFollowState(status: string): FollowState {
  const active = status === 'running' || status === 'pending' || status === 'awaiting';
  return {
    startAt: active ? 'bottom' : 'top',
    following: active,
    showJumpToLatest: false,
    scrollToBottomToken: active ? 1 : 0,
  };
}

export function onFollowScroll(
  state: FollowState,
  geometry: { scrollTop: number; scrollHeight: number; clientHeight: number }
): FollowState {
  const distance = geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight;
  const atBottom = distance <= FOLLOW_BOTTOM_THRESHOLD_PX;
  if (atBottom) return { ...state, following: true, showJumpToLatest: false };
  return { ...state, following: false, showJumpToLatest: true };
}

export function onFollowContentGrew(state: FollowState): FollowState {
  if (!state.following) return { ...state, showJumpToLatest: true };
  return { ...state, scrollToBottomToken: state.scrollToBottomToken + 1 };
}

export function jumpToLatest(state: FollowState): FollowState {
  return {
    ...state,
    following: true,
    showJumpToLatest: false,
    scrollToBottomToken: state.scrollToBottomToken + 1,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `bun test src/lib/room-scroll-follow.test.ts` from `packages/web`.
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing container split-mode test**

First create `packages/web/src/lib/test/install-happy-dom.ts` by copying `packages/web/src/experiments/console/test/install-happy-dom.ts` verbatim, including its `installGlobalValue` comment block and its `installHappyDom` / `restoreHappyDom` exports.
The console copy cannot be imported from `@/lib`, because that would make a shared module depend on the console experiment; a `@/lib`-owned copy keeps the dependency pointing the right way and gives future `src/lib` component tests a harness.
Add `'ResizeObserver'` to that copy's `INSTALLED_GLOBAL_KEYS` array and to its install bag as `win.ResizeObserver`, because happy-dom 20 exposes it on the window but the console's key list predates any need for it.

Then modify the `test` script in `packages/web/package.json` so its first leg reads `NODE_ENV=development bun test src/lib/`.
Bun runs every file in one leg in a single process, and React's development build must be selected before `react-dom/client` is imported; the existing `src/lib` tests are pure, so the change is inert for them.

Then create `packages/web/src/lib/use-container-split-mode.test.tsx`.

```tsx
process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { installHappyDom, restoreHappyDom } from './test/install-happy-dom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const mod = await import('./use-container-split-mode');

const { act, createElement, useRef } = react;
const { createRoot } = reactDomClient;
const { useContainerSplitMode, SPLIT_MIN_CONTAINER_PX } = mod;

let observed: { element: Element; cb: (entries: unknown[]) => void }[] = [];

class ResizeObserverStub {
  constructor(private readonly cb: (entries: unknown[]) => void) {}
  observe(element: Element): void {
    observed.push({ element, cb: this.cb });
  }
  disconnect(): void {
    observed = observed.filter(entry => entry.cb !== this.cb);
  }
  unobserve(): void {}
}

function Probe({ onMode }: { onMode: (mode: string) => void }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const mode = useContainerSplitMode(ref);
  onMode(mode);
  return createElement('div', { ref });
}

describe('useContainerSplitMode', () => {
  beforeEach(() => {
    installHappyDom();
    observed = [];
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: ResizeObserverStub,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    restoreHappyDom();
  });

  test('a wide container reports split', () => {
    const modes: string[] = [];
    const root = createRoot(document.createElement('div'));
    act(() => {
      root.render(createElement(Probe, { onMode: (m: string) => modes.push(m) }));
    });
    act(() => {
      observed[0].cb([{ contentRect: { width: SPLIT_MIN_CONTAINER_PX + 100 } }]);
    });
    expect(modes[modes.length - 1]).toBe('split');
  });

  test('a narrow container reports single', () => {
    const modes: string[] = [];
    const root = createRoot(document.createElement('div'));
    act(() => {
      root.render(createElement(Probe, { onMode: (m: string) => modes.push(m) }));
    });
    act(() => {
      observed[0].cb([{ contentRect: { width: SPLIT_MIN_CONTAINER_PX - 1 } }]);
    });
    expect(modes[modes.length - 1]).toBe('single');
  });

  test('an environment with no ResizeObserver defaults to split rather than crashing', () => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    const modes: string[] = [];
    const root = createRoot(document.createElement('div'));
    act(() => {
      root.render(createElement(Probe, { onMode: (m: string) => modes.push(m) }));
    });
    expect(modes[modes.length - 1]).toBe('split');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run `NODE_ENV=development bun test src/lib/use-container-split-mode.test.tsx` from `packages/web`.
Expected: FAIL with a module-resolution error for `./use-container-split-mode`.

- [ ] **Step 7: Implement the container split-mode hook**

Create `packages/web/src/lib/use-container-split-mode.ts`.

```ts
/**
 * Choose between the two-pane split and the single full-width room from the
 * CONTAINER width, not the viewport width.
 *
 * The application rail changes the run view's available width without
 * changing the viewport, so a media query alone cannot make this decision.
 * 960 px is the content minimum: the view pane's 30 percent floor and the
 * room's 24 percent floor both stay above their readable minimums there.
 */
import { useEffect, useState, type RefObject } from 'react';

export type SplitMode = 'split' | 'single';

/** 60rem at the default 16px root size, matching --rv-split-min-container. */
export const SPLIT_MIN_CONTAINER_PX = 960;

export function useContainerSplitMode(ref: RefObject<HTMLElement | null>): SplitMode {
  const [mode, setMode] = useState<SplitMode>('split');

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const Observer = element.ownerDocument.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof Observer !== 'function') return undefined;
    const apply = (width: number): void => {
      setMode(width >= SPLIT_MIN_CONTAINER_PX ? 'split' : 'single');
    };
    const observer = new Observer(entries => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      apply(entry.contentRect.width);
    });
    observer.observe(element);
    apply(element.getBoundingClientRect().width);
    return (): void => {
      observer.disconnect();
    };
  }, [ref]);

  return mode;
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run `NODE_ENV=development bun test src/lib/use-container-split-mode.test.tsx` from `packages/web`.
Expected: PASS, 3 tests.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/lib/room-scroll-follow.ts src/lib/room-scroll-follow.test.ts src/lib/use-container-split-mode.ts src/lib/use-container-split-mode.test.tsx src/lib/test/install-happy-dom.ts package.json` from `packages/web`.

```bash
git add packages/web/src/lib/room-scroll-follow.ts packages/web/src/lib/room-scroll-follow.test.ts packages/web/src/lib/use-container-split-mode.ts packages/web/src/lib/use-container-split-mode.test.tsx packages/web/src/lib/test/install-happy-dom.ts packages/web/package.json
git commit -m "feat(web): own run-room reading position and container split mode"
```

## Task 6: Model Node-Room Visibility, Opener Focus, and Execution Memory

**Files:**

- Create: `packages/web/src/lib/node-room-visibility.ts`
- Create: `packages/web/src/lib/node-room-visibility.test.ts`

**Interfaces:**

- Consumes: node ids, log-row ids, and an opener token supplied by whichever control opened the room.
- Produces: `RoomVisibilityState`, `closedRoomState`, `openRoomForNode`, `openRoomForRow`, `closeRoom`, `applyDeepLinkNode`, and `rememberedRowForNode`.

- [ ] **Step 1: Write the failing visibility test**

Create `packages/web/src/lib/node-room-visibility.test.ts`.

```ts
import { describe, expect, test } from 'bun:test';

import {
  applyDeepLinkNode,
  closeRoom,
  closedRoomState,
  openRoomForNode,
  openRoomForRow,
  rememberedRowForNode,
} from './node-room-visibility';

describe('node room visibility', () => {
  test('a first visit starts closed with no selection', () => {
    const state = closedRoomState();
    expect(state.open).toBe(false);
    expect(state.nodeId).toBeNull();
    expect(state.rowId).toBeNull();
    expect(state.openerId).toBeNull();
  });

  test('opening from a graph node records the opener for focus return', () => {
    const state = openRoomForNode(closedRoomState(), 'specify', 'graph-node-specify');
    expect(state.open).toBe(true);
    expect(state.nodeId).toBe('specify');
    expect(state.openerId).toBe('graph-node-specify');
  });

  test('opening from a log row selects that exact execution', () => {
    const state = openRoomForRow(closedRoomState(), 'loop-node', 'attempt-2', 'log-row-attempt-2');
    expect(state.nodeId).toBe('loop-node');
    expect(state.rowId).toBe('attempt-2');
  });

  test('a graph click restores the last explicit execution for that node', () => {
    let state = openRoomForRow(closedRoomState(), 'loop-node', 'attempt-2', 'log-row');
    state = openRoomForNode(state, 'other', 'graph-node-other');
    state = openRoomForNode(state, 'loop-node', 'graph-node-loop');
    expect(state.rowId).toBe('attempt-2');
    expect(rememberedRowForNode(state, 'loop-node')).toBe('attempt-2');
  });

  test('a node with no earlier explicit selection defers to the caller', () => {
    const state = openRoomForNode(closedRoomState(), 'fresh', 'graph-node-fresh');
    expect(state.rowId).toBeNull();
  });

  test('closing keeps the selection memory and reports the opener to refocus', () => {
    let state = openRoomForRow(closedRoomState(), 'loop-node', 'attempt-2', 'log-row');
    state = closeRoom(state);
    expect(state.open).toBe(false);
    expect(state.focusOpenerId).toBe('log-row');
    expect(rememberedRowForNode(state, 'loop-node')).toBe('attempt-2');
  });

  test('reopening after a close restores the same execution', () => {
    let state = openRoomForRow(closedRoomState(), 'loop-node', 'attempt-2', 'log-row');
    state = closeRoom(state);
    state = openRoomForNode(state, 'loop-node', 'graph-node-loop');
    expect(state.open).toBe(true);
    expect(state.rowId).toBe('attempt-2');
  });

  test('a deep link opens the requested node exactly once', () => {
    let state = applyDeepLinkNode(closedRoomState(), 'specify');
    expect(state.open).toBe(true);
    expect(state.nodeId).toBe('specify');
    state = closeRoom(state);
    state = applyDeepLinkNode(state, 'specify');
    expect(state.open).toBe(false);
  });

  test('a null deep link never closes an open room', () => {
    const open = openRoomForNode(closedRoomState(), 'specify', 'graph');
    expect(applyDeepLinkNode(open, null).open).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run `bun test src/lib/node-room-visibility.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error for `./node-room-visibility`.

- [ ] **Step 3: Implement room visibility**

Create `packages/web/src/lib/node-room-visibility.ts`.

```ts
/**
 * Room visibility is separate from node selection.
 *
 * The room is closed on a normal first visit; a deep link, a graph node, a log
 * row, or a chat entry opens it. Closing returns the space to the main view,
 * reports which control should regain focus, and keeps the last explicit
 * execution for each node so reopening resumes where the user left off.
 */
export interface RoomVisibilityState {
  open: boolean;
  nodeId: string | null;
  rowId: string | null;
  openerId: string | null;
  /** Set on close so the view can return focus; cleared on the next open. */
  focusOpenerId: string | null;
  /** Last explicitly chosen execution row per node, for this visit. */
  rowByNode: Readonly<Record<string, string>>;
  /** Deep-link node ids already honoured, so a close is not undone. */
  appliedDeepLinks: readonly string[];
}

export function closedRoomState(): RoomVisibilityState {
  return {
    open: false,
    nodeId: null,
    rowId: null,
    openerId: null,
    focusOpenerId: null,
    rowByNode: {},
    appliedDeepLinks: [],
  };
}

export function rememberedRowForNode(state: RoomVisibilityState, nodeId: string): string | null {
  return state.rowByNode[nodeId] ?? null;
}

export function openRoomForNode(
  state: RoomVisibilityState,
  nodeId: string,
  openerId: string | null
): RoomVisibilityState {
  return {
    ...state,
    open: true,
    nodeId,
    rowId: rememberedRowForNode(state, nodeId),
    openerId,
    focusOpenerId: null,
  };
}

export function openRoomForRow(
  state: RoomVisibilityState,
  nodeId: string,
  rowId: string,
  openerId: string | null
): RoomVisibilityState {
  return {
    ...state,
    open: true,
    nodeId,
    rowId,
    openerId,
    focusOpenerId: null,
    rowByNode: { ...state.rowByNode, [nodeId]: rowId },
  };
}

export function closeRoom(state: RoomVisibilityState): RoomVisibilityState {
  return { ...state, open: false, focusOpenerId: state.openerId };
}

export function applyDeepLinkNode(
  state: RoomVisibilityState,
  nodeId: string | null
): RoomVisibilityState {
  if (nodeId === null) return state;
  if (state.appliedDeepLinks.includes(nodeId)) return state;
  return {
    ...openRoomForNode(state, nodeId, null),
    appliedDeepLinks: [...state.appliedDeepLinks, nodeId],
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `bun test src/lib/node-room-visibility.test.ts` from `packages/web`.
Expected: PASS, 9 tests.

- [ ] **Step 5: Format and commit**

Run `bun x prettier --write src/lib/node-room-visibility.ts src/lib/node-room-visibility.test.ts` from `packages/web`.

```bash
git add packages/web/src/lib/node-room-visibility.ts packages/web/src/lib/node-room-visibility.test.ts
git commit -m "feat(web): separate node-room visibility from node selection"
```

## Task 7: Make the Legacy Run Room Open, Close, Resize, and Reflow

**Files:**

- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`
- Delete: `packages/web/src/lib/select-initial-node.ts`
- Delete: `packages/web/src/lib/select-initial-node.test.ts`

**Interfaces:**

- Consumes: `roomSplitSizes`, `readRoomRatio`, `writeRoomRatio` from `@/lib/room-split-layout`; `useContainerSplitMode` from `@/lib/use-container-split-mode`; the whole `@/lib/node-room-visibility` module.
- Produces: `LegacyGraphLogsPaneProps` gains `roomOpen: boolean`, `onOpenRoom: (nodeId: string, rowId: string | null, openerId: string | null) => void`, `onCloseRoom: () => void`, `roomActions?: ReactNode`, and `viewFooter?: ReactNode`; `roomHeader` and `roomFooter` are removed.

- [ ] **Step 1: Write the failing pane behavior tests**

Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.
Add a `describe('room lifecycle')` block containing these tests, using the file's existing happy-dom harness and render helper.

- `renders no room region when roomOpen is false` mounts the pane with `roomOpen={false}` and asserts `document.querySelectorAll('[role="region"]').length === 0` and that no element has the text `Select a node`.
- `gives the whole work area to the view when the room is closed` asserts exactly one `[data-slot="resizable-panel"]` element exists when `roomOpen` is false.
- `renders a percentage split when the room is open` mounts with `roomOpen={true}` and asserts both panels exist and that neither panel's inline `flex` style resolves to a pixel basis, by asserting the style string contains `0px` as the flex-basis and a grow factor greater than `1`.
- `calls onOpenRoom with the clicked graph node and its opener id` clicks the rendered graph stub's node button and asserts the handler received `('review', null, 'graph-node-review')`.
- `calls onOpenRoom with the exact row for a Logs selection` clicks a `NodeRunList` row and asserts the handler received that row's `nodeId`, its `id`, and an opener id beginning with `log-row-`.
- `renders a Close control that calls onCloseRoom` clicks the room's `Close` button and asserts the handler ran once.
- `renders a single-pane room with Back when the container is narrow` stubs `ResizeObserver` to report `600` and asserts that only the room renders, that a `Back` button exists, and that clicking it calls `onCloseRoom`.
- `keeps the view footer mounted when the room is closed` passes `viewFooter={<div>artifact summary</div>}` with `roomOpen={false}` and asserts the text is present.

- [ ] **Step 2: Run the pane tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`.
Expected: FAIL, because `roomOpen`, `onOpenRoom`, `onCloseRoom`, and `viewFooter` do not exist.

- [ ] **Step 3: Rewire the Legacy pane**

Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.

- Replace the `roomHeader` and `roomFooter` props with `roomActions?: ReactNode` (rendered inside the room, above the transcript) and `viewFooter?: ReactNode` (rendered under the left pane, always mounted).
- Add `roomOpen`, `onOpenRoom`, and `onCloseRoom` to `LegacyGraphLogsPaneProps` and remove `onSelectNode`.
- Replace `useStackedViewport` with `const paneRef = useRef<HTMLDivElement | null>(null)` plus `const splitMode = useContainerSplitMode(paneRef)`; keep the import removal complete so the module is no longer referenced here.
- Hold the ratio in state: `const [roomRatio, setRoomRatio] = useState(() => readRoomRatio('legacy'))`, and persist on the group's `onLayoutChanged` by writing the room panel's percentage through `writeRoomRatio('legacy', ratio)`.
- Compute `const sizes = roomSplitSizes(roomRatio)` and pass `sizes.view` and `sizes.room` straight to the two `ResizablePanel` elements, with no numeric literal anywhere.
- Change `handleGraphNodeClick` to call `onOpenRoom(nodeId, null, 'graph-node-' + nodeId)`, `handleLogRowSelect` to call `onOpenRoom(row.nodeId, row.id, 'log-row-' + row.id)`, and `handleNodeStatusSelect` to call `onOpenRoom(row.nodeId, rowExists ? row.id : null, 'timeline-entry-' + entry.id)`.
- In the existing effect that clears a vanished row selection, call `onCloseRoom()` instead of `onSelectNode(null)`, and only when the currently selected row has disappeared or the run id changed.
- Render the room only when `roomOpen` is true.
- When `splitMode === 'single'` and `roomOpen` is true, render the room alone at full width with a leading `Back` button whose accessible name is `Back`; when `roomOpen` is false render the left pane alone at full width with no resizable group.
- Add a `Close` button to the room pane wrapper with accessible name `Close`, calling `onCloseRoom`.
- Keep `ResizableHandle withHandle aria-label="Resize node room"` so the native keyboard resize stays available.
- Set the root element to `ref={paneRef}` and keep `className="flex min-h-0 flex-1 flex-col"`.

- [ ] **Step 4: Run the pane tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing run-page tests**

Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx`.
Add tests asserting that:

- mounting a completed DAG run renders no `[role="region"]` node room and no `Select a node` text, proving auto-selection is gone;
- mounting with the URL search `?node=review` opens the room for `review`;
- the retry action panel and the artifact summary remain in the document while the room is closed.

- [ ] **Step 6: Run the run-page tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx` from `packages/web`.
Expected: FAIL, because `selectInitialNode` still auto-selects and the panels live inside the room.

- [ ] **Step 7: Remove auto-selection and add the deep link**

Modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.

- Delete the `selectInitialNode` import and the `useEffect` at lines 563 to 568 that auto-selects a node.
- Replace the `selectedDagNode` state with `const [room, setRoom] = useState<RoomVisibilityState>(closedRoomState)` from `@/lib/node-room-visibility`.
- Add `const [searchParams, setSearchParams] = useSearchParams()` from `react-router`.
- Add an effect that calls `setRoom(current => applyDeepLinkNode(current, searchParams.get('node')))` whenever the search string changes.
- Add `openRoom(nodeId, rowId, openerId)` and `closeRoomHandler()` callbacks that update `room` through `openRoomForNode` / `openRoomForRow` / `closeRoom` and mirror the node into the `node` search param with `setSearchParams(next, { replace: true })`, deleting the param on close.
- Add an effect that, when `room.focusOpenerId` is non-null, calls `document.getElementById(room.focusOpenerId)?.focus()` and then clears `focusOpenerId`.
- Pass `selectedNodeId={room.open ? room.nodeId : null}`, `roomOpen={room.open}`, `onOpenRoom={openRoom}`, and `onCloseRoom={closeRoomHandler}` to `LegacyGraphLogsPane`.
- Move `retryActionPanel` from `roomHeader` to the new `roomActions` prop, and move the `ArtifactSummary` block from `roomFooter` to the new `viewFooter` prop so both survive a closed room.

- [ ] **Step 8: Delete the auto-selection module**

```bash
git rm packages/web/src/lib/select-initial-node.ts packages/web/src/lib/select-initial-node.test.ts
```

Run `grep -rn "select-initial-node\|selectInitialNode" packages/web/src` from the repository root and confirm there are no remaining references.

- [ ] **Step 9: Run the run-page tests and the size guard**

Run `NODE_ENV=development bun test src/components/workflows/WorkflowExecution.test.tsx` from `packages/web`.
Expected: PASS.
Run `bun test src/lib/panel-size-guard.test.ts` from `packages/web`.
Expected: PASS, because `LegacyGraphLogsPane.tsx` no longer contains a numeric size.

- [ ] **Step 10: Format and commit**

Run `bun x prettier --write src/components/workflows/LegacyGraphLogsPane.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.tsx src/components/workflows/WorkflowExecution.test.tsx` from `packages/web`.

```bash
git add packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/components/workflows/WorkflowExecution.test.tsx packages/web/src/lib/select-initial-node.ts packages/web/src/lib/select-initial-node.test.ts
git commit -m "fix(web): give the legacy run room a real percentage split and lifecycle"
```

## Task 8: Give the Legacy Room an Execution Header

**Files:**

- Create: `packages/web/src/components/workflows/NodeRoomHeader.tsx`
- Create: `packages/web/src/components/workflows/NodeRoomHeader.test.tsx`
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.tsx`
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`

**Interfaces:**

- Consumes: `buildExecutionHeader`, `ExecutionHeaderModel`, and `ExecutionOption` from `@/lib/build-execution-header`; `nodeStatusLabel` from `./awaiting-chrome`; the existing `TYPE_LABELS` map in `LegacyNodeRoom.tsx`.
- Produces: `NodeRoomHeader` with props `{ nodeId, label, typeLabel, status, header, provider, model, onSelectExecution, onClose }`.

- [ ] **Step 1: Write the failing header test**

Create `packages/web/src/components/workflows/NodeRoomHeader.test.tsx` using the happy-dom harness from `LegacyNodeRoom.test.tsx`.
Assert that:

- the type label, node name, node id, and status label all render;
- `started 0:01 · 2s` renders when the model supplies both a start offset and a duration;
- `timing unavailable` renders and no `0:00` appears when `timingAvailable` is false;
- `running…` renders instead of a duration for a running execution;
- one button per option renders under an `iterations` or `runs` label when `showSelector` is true, and the selected option's button is `disabled` and carries `aria-current="true"`;
- clicking a non-selected option calls `onSelectExecution` with that option's `id`;
- no selector renders when `showSelector` is false;
- the limitation string renders when `model.limitation` is non-null;
- provider and model render only when both props are non-null;
- a `Close` button renders and calls `onClose`;
- the header element carries `class` containing `sticky` so it stays reachable while the transcript scrolls.

- [ ] **Step 2: Run the header test and confirm it fails**

Run `NODE_ENV=development bun test src/components/workflows/NodeRoomHeader.test.tsx` from `packages/web`.
Expected: FAIL with a module-resolution error for `./NodeRoomHeader`.

- [ ] **Step 3: Implement the header**

Create `packages/web/src/components/workflows/NodeRoomHeader.tsx`.
The header renders three stacked rows inside one `sticky top-0 z-10 border-b border-border bg-surface px-4 py-3` element.

- Row one is the identity row: a type pill, a truncating node name, the monospace node id, the status label from `nodeStatusLabel`, and a right-aligned `Close` button.
- Row two is the meta line: `started {startOffsetLabel} · {durationLabel}` when timing is available, `started {startOffsetLabel} · running…` for a running execution, and the single string `timing unavailable` when `timingAvailable` is false.
- Row two also appends ` · {provider}/{model}` when both values are non-null, and renders nothing extra otherwise.
- Row three is the execution selector, rendered only when `model.showSelector` is true: a `{model.selectorLabel}` caption followed by one `<button type="button">` per option, wrapped with `flex flex-wrap` so a narrow room wraps instead of scrolling horizontally.
- The selected option is `disabled`, carries `aria-current="true"`, and each button's `title` repeats its start offset so the mockup's chip tooltip behavior is preserved.
- When `model.limitation` is non-null, render it below the selector as `text-[length:var(--rv-lifecycle-font-size)] text-warning`.
- Use `var(--rv-role-label-font-size)`, `var(--rv-lifecycle-font-size)`, and the existing status colour map rather than new hard-coded sizes.

- [ ] **Step 4: Run the header test and confirm it passes**

Run `NODE_ENV=development bun test src/components/workflows/NodeRoomHeader.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing LegacyNodeRoom integration test**

Modify `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`.
Add tests asserting that the room renders `NodeRoomHeader` content for a selected row, that two recorded executions produce two selector buttons, and that clicking the second one calls the new `onSelectExecution` prop with that option id.

- [ ] **Step 6: Run the test and confirm it fails**

Run `NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx` from `packages/web`.
Expected: FAIL, because `LegacyNodeRoom` still renders its own inline header.

- [ ] **Step 7: Adopt the header in LegacyNodeRoom**

Modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.

- Add `nodeExecutions: readonly NodeExecution[]`, `onSelectExecution: (optionId: string) => void`, and `onClose: () => void` to `LegacyNodeRoomProps`.
- Replace the inline `header` element with `NodeRoomHeader`, passing `buildExecutionHeader({ nodeId: row.nodeId, executions: nodeExecutions, selectedRowId: row.id })` as `header`.
- Read `provider` and `model` from the node's most recent `node_started` event data, passing `null` for either when the run did not record it.
- Keep every existing body branch untouched.
- Thread `nodeExecutions` and the two new callbacks through `LegacyGraphLogsPane` from `WorkflowExecution`; `onSelectExecution` maps the option id to the matching `LogRow` id and calls `onOpenRoom(row.nodeId, row.id, null)`.

- [ ] **Step 8: Run the test and confirm it passes**

Run `NODE_ENV=development bun test src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/components/workflows/NodeRoomHeader.tsx src/components/workflows/NodeRoomHeader.test.tsx src/components/workflows/LegacyNodeRoom.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/components/workflows/LegacyGraphLogsPane.tsx src/components/workflows/WorkflowExecution.tsx` from `packages/web`.

```bash
git add packages/web/src/components/workflows/NodeRoomHeader.tsx packages/web/src/components/workflows/NodeRoomHeader.test.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.test.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): show execution identity and selection in the legacy room"
```

## Task 9: Rebuild the Legacy Transcript on the History Model

**Files:**

- Create: `packages/web/src/components/workflows/RoomIncompleteNotice.tsx`
- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`

**Interfaces:**

- Consumes: `buildAgentHistory` and `AgentHistoryItem` from `@/lib/build-agent-history`; `advanceNodeMessages` from `@/lib/load-node-message-pages`; `emptyNodeMessageState`, `nodeMessageScopeKey`, and `NodeMessageState` from `@/lib/node-message-pages`; the follow helpers from `@/lib/room-scroll-follow`.
- Produces: `NodeRoomProps` gains `items: readonly AgentHistoryItem[]`, `incomplete: string | null`, `follow: FollowState`, `onScrollGeometry`, and `onJumpToLatest`, and loses `messages`, `selection`, and `isPending`.

- [ ] **Step 1: Write the failing transcript rendering tests**

Modify `packages/web/src/components/workflows/NodeRoom.test.tsx`.
Convert the existing cases to the new `items` prop and add tests asserting that:

- an assistant item renders an `ASSISTANT` role label followed by the rendered Markdown;
- a tool item renders its name, its context string, an `Input` block, and an `Output` block inside one `.ptool` card;
- a pending tool item renders `Awaiting output` and no `Output` block;
- a `missing` output state renders `Output not recorded`, a `truncated` state renders `Output truncated`, and an `interrupted` outcome renders `interrupted`;
- an unmatched result item renders `Result with no recorded call`;
- a lifecycle item renders its readable label and carries the lifecycle token class rather than the assistant text size;
- a tool card's output region carries `max-h-[var(--rv-tool-output-max-height)] overflow-auto` so long output scrolls locally without collapsing the card;
- `incomplete` renders the notice text plus a `Retry` button that calls `onRetry`;
- `follow.showJumpToLatest` renders a `Jump to latest` button that calls `onJumpToLatest`.
- a `truncated` output state renders a `View full output` link whose `href` ends with the tool result's message id, and a `missing` state renders no such link.

- [ ] **Step 2: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx` from `packages/web`.
Expected: FAIL, because `NodeRoom` still takes raw messages.

- [ ] **Step 3: Rebuild the renderer**

Create `packages/web/src/components/workflows/RoomIncompleteNotice.tsx`.

```tsx
/**
 * Explicit incomplete-history state.
 *
 * A failed later page must not read as an empty execution, so this notice sits
 * ABOVE the retained rows and keeps them visible.
 */
export function RoomIncompleteNotice({
  reason,
  onRetry,
}: {
  reason: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-warning/30 bg-warning/5 px-3 py-2 text-[length:var(--rv-lifecycle-font-size)] text-text-secondary"
    >
      <span>History is incomplete: {reason}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-primary transition-colors hover:text-accent-bright"
      >
        Retry
      </button>
    </div>
  );
}
```

Modify `packages/web/src/components/workflows/NodeRoom.tsx`.

- Replace `NodeRoomProps` with the new contract, and keep `selectNodeRoomMessages`, `RoomPlaceholder`, and `RoomRegion` exported unchanged: `NodeTranscriptPane` still calls the first, and `GateRoom`, `StdoutRoom`, `ChildWorkflowRoom`, `RouteControllerRoom`, `LoopGroupRoom`, and `LegacyNodeRoom` all import the other two.
- Render each `AgentHistoryItem` through a small `switch` on `item.kind`.
- An `assistant` item renders `<p class="text-[length:var(--rv-role-label-font-size)] uppercase tracking-[var(--rv-role-label-tracking)] text-text-tertiary">ASSISTANT</p>` above a `ReactMarkdown` block whose wrapper uses `text-[length:var(--rv-agent-font-size)] leading-[var(--rv-agent-line-height)]`; do not wrap it in a chat bubble.
- A `tool` item renders one inset card using `bg-[var(--rv-tool-card-bg)]`, `border-[var(--rv-tool-card-border)]`, `rounded-[var(--rv-tool-card-radius)]`, and `p-[var(--rv-tool-card-padding)]`, with the name at `var(--rv-tool-name-font-size)` and the context string beside it at `var(--rv-tool-io-font-size)`.
- The card always shows `Input` when `input !== undefined`, and shows exactly one of an `Output` block, `Awaiting output`, `Output not recorded`, `Output truncated`, or `Output state unknown`, chosen from `item.outputState`; add the `outcome` and `exitCode` words beside the name when recorded.
- Wrap the output `pre` in `max-h-[var(--rv-tool-output-max-height)] overflow-auto` and keep `whitespace-pre-wrap break-words` so wide code scrolls locally rather than forcing page-level horizontal scroll.
- A `lifecycle` item renders one `<p class="text-[length:var(--rv-lifecycle-font-size)] italic text-text-tertiary">` line.
- When `outputState === 'truncated'`, render a `View full output` link to `/api/workflows/runs/{runId}/nodes/{nodeId}/messages/{item.messageIds[item.messageIds.length - 1]}`, which is the existing message-detail route and returns the untruncated payload.
- Render no such link for `missing` or `unknown`, because that output was never retained and a link would promise recovery that cannot happen.
- Give the scroll region `scroll-pb-32` and have each Ask card call `scrollIntoView({ block: 'center' })` when it receives focus, so an on-screen keyboard cannot cover an active Ask input or its submit control.
- When the room is opened from an awaiting-input control, scroll the matching Ask card into view and focus it, which is the existing `autoFocus` path driven by `firstActionableId`.
- Render the incomplete notice as its own `role="status"` element, separate from the header's node-status chip, so a failed connection never reads as a failed node.
- Render `RoomIncompleteNotice` above the item list when `incomplete !== null`, and render a `Jump to latest` button pinned to the bottom of the region when `follow.showJumpToLatest` is true.
- Attach `onScroll` to the scroll region and forward `{ scrollTop, scrollHeight, clientHeight }` to `onScrollGeometry`.
- Add a `useEffect` keyed on `follow.scrollToBottomToken` that sets `element.scrollTop = element.scrollHeight`, and a `useEffect` keyed on the node and row that sets `scrollTop` to `0` when `follow.startAt === 'top'` on first render of that scope.

- [ ] **Step 4: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing pagination tests**

Modify `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`.
Add tests asserting that:

- the pane requests page two with `afterSeq` set to the last seq of page one and renders rows from both pages;
- every request carries a `limit`, proving cursor mode and therefore metadata delivery;
- a page-two rejection keeps page-one rows on screen and renders the incomplete notice;
- switching the selected row aborts the previous scope and never merges rows from two scopes;
- a terminal run keeps fetching until `lastSeq` reaches `highWatermark` and then stops issuing requests.

- [ ] **Step 6: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx` from `packages/web`.
Expected: FAIL, because the pane issues one unpaged request.

- [ ] **Step 7: Adopt paging and follow state in the pane**

Modify `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.

- Key the query on `const queryKey = ['workflowNodeMessages', nodeMessageScopeKey(runId, nodeId ?? '', { occurrenceId, attemptId })] as const` so a scope change starts a fresh cache entry and a late response from the old scope cannot land.
- Replace the single `useQuery` with one whose `queryFn` resumes from the cached state and forwards React Query's own signal.

```ts
const query = useQuery({
  queryKey,
  enabled: nodeId !== null,
  queryFn: ({ signal }): Promise<NodeMessageState> =>
    advanceNodeMessages({
      load: loadMessages,
      runId,
      nodeId: nodeId ?? '',
      scope: { occurrenceId, attemptId },
      state: queryClient.getQueryData<NodeMessageState>(queryKey) ?? emptyNodeMessageState(),
      signal,
    }),
  refetchInterval: (q): 1000 | false =>
    transcriptRefetchInterval(runStatus, q.state.data ?? null),
});
```

- Change the exported polling policy so a terminal run keeps polling until the drain reports completion, which is what AC9 requires and what makes the old one-shot drain effect unnecessary.

```ts
export function transcriptRefetchInterval(
  status: WorkflowRunStatus,
  state: NodeMessageState | null
): 1000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 1000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      // Keep draining a terminal run until the reported high-watermark is
      // reached. A page error stops the loop; the user retries explicitly.
      return state === null || (!state.complete && state.error === null) ? 1000 : false;
  }
}
```

- Update every existing caller and test of `transcriptRefetchInterval` for the new second parameter; `NodeTranscriptPane.tsx` is the only production caller.
- Delete the `drainedRef` / `drainKeyRef` effect entirely, because the interval policy above now owns terminal draining.
- Derive `items` with `buildAgentHistory(selectNodeRoomMessages(state.messages, selection))`, keeping the existing loop-iteration slicing.
- Hold `FollowState` in `useState`, initialise it from `initialFollowState(nodeState?.status ?? runStatus)`, reset it whenever the scope key changes, and call `onFollowContentGrew` whenever `items.length` increases.
- Compute `incomplete` as `state.error ?? (state.complete ? null : null)`, so only a real error or a page-cap stop shows the notice while an in-progress drain shows nothing.
- Keep the existing Ask anchoring and `renderAskCard` logic, matching anchored Asks against `item.messageIds` instead of `message.payload.id`.

- [ ] **Step 8: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/components/workflows/RoomIncompleteNotice.tsx src/components/workflows/NodeRoom.tsx src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.tsx src/components/workflows/NodeTranscriptPane.test.tsx` from `packages/web`.

```bash
git add packages/web/src/components/workflows/RoomIncompleteNotice.tsx packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/NodeRoom.test.tsx packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx
git commit -m "feat(web): render complete legacy agent history with roles and paging"
```

## Task 10: Make the Console Inspect Pane a Real Split

**Files:**

- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`

**Interfaces:**

- Consumes: `ConsolePanelGroup`, `ConsolePanel`, `ConsolePanelSeparator` from `../primitives/console-resizable`; `roomSplitSizes`, `readRoomRatio`, `writeRoomRatio` from `@/lib/room-split-layout`; `useContainerSplitMode` from `@/lib/use-container-split-mode`.
- Produces: `ConsoleInspectPaneProps` gains `roomOpen: boolean` and `view: 'log' | 'graph' | 'artifacts'`, and `artifacts: ReactNode`.

- [ ] **Step 1: Write the failing inspect-pane tests**

Modify `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`.
Add tests asserting that:

- with `roomOpen={false}` the `[data-testid="console-inspect-room"]` element is absent and only one `[data-slot="console-panel"]` renders;
- with `roomOpen={false}` the string `Select a node` appears zero times anywhere in the document, which is the exact defect the PR #146 capture recorded;
- with `roomOpen={true}` both panels render and neither carries a fixed pixel width class such as `w-[460px]`;
- with `view="artifacts"` and `roomOpen={true}` the artifacts content and the room both render, proving the room stays docked;
- a narrow container renders only the room with a `Back` button that calls `onCloseRoom`;
- switching `view` between `log` and `graph` does not unmount the room, asserted by a room-owned `useEffect` counter rendered as text.

- [ ] **Step 2: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx` from `packages/web`.
Expected: FAIL, because the `<aside>` is unconditional and fixed at `lg:w-[460px]`.

- [ ] **Step 3: Rewire the console inspect pane**

Modify `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`.

- Widen `view` to `'log' | 'graph' | 'artifacts'` and add an `artifacts: ReactNode` prop rendered in the left pane when `view === 'artifacts'`.
- Add `roomOpen: boolean` and render the `ConsoleNodeRoom` only when it is true.
- Replace the outer `div` and `aside` with `ConsolePanelGroup` plus two `ConsolePanel` elements sized from `roomSplitSizes(ratio)`, separated by `ConsolePanelSeparator` with `aria-label="Resize node room"`.
- Hold the ratio in state seeded from `readRoomRatio('console')` and persist it from the group's `onLayoutChanged` through `writeRoomRatio('console', ratio)`.
- Measure the pane root with `useContainerSplitMode`; in `single` mode render only the room when it is open, with a leading `Back` button calling `onCloseRoom`, and only the view when it is closed.
- Keep `data-testid="console-inspect-pane"` on the root and `data-testid="console-inspect-room"` on the room panel.
- Remove every `lg:w-[460px]`, `lg:min-w-[320px]`, `lg:max-w-[720px]`, and `max-h-[40vh]` class.

- [ ] **Step 4: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleInspectPane.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing run-page tests**

Modify `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`.
Add tests asserting that a fresh visit with no `?node=` renders no room, that `?node=inspect-file` opens the room, that Close removes the param and the room, and that switching to Artifacts keeps the room mounted.

- [ ] **Step 6: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx` from `packages/web`.
Expected: FAIL, because Artifacts still replaces the inspect composition.

- [ ] **Step 7: Rewire the console run page**

Modify `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.

- Replace `inspectSelection` with `RoomVisibilityState` from `@/lib/node-room-visibility`, keeping the existing `?node=` read and `replaceNodeSearch` write behavior.
- Route the deep-link effect through `applyDeepLinkNode` so a user who closes the room is not re-opened by the unchanged search string.
- Change `onInspectSelect(nodeId, rowId)` to call `openRoomForRow` when a row id is supplied and `openRoomForNode` otherwise, recording an opener id of `log-row-<rowId>` or `graph-node-<nodeId>`.
- Change `onCloseRoom` to call `closeRoom`, clear the `node` search param, and focus `document.getElementById(focusOpenerId)` when present.
- Always render `ConsoleInspectPane`, passing `view={view}` including `'artifacts'`, passing `<ArtifactPanel runId={runId} />` as `artifacts`, and passing `roomOpen={room.open}`.
- Delete the `showInspectPane` branch that removed the composition on Artifacts, keeping the existing `projectCwd === undefined` loading branch.

- [ ] **Step 8: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/console-isolation.test.ts` from `packages/web`.
Expected: PASS, including the isolation guard.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/experiments/console/components/ConsoleInspectPane.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/routes/RunDetailPage.tsx src/experiments/console/routes/RunDetailPage.test.tsx` from `packages/web`.

```bash
git add packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx
git commit -m "fix(web): return console room space on close and dock it on artifacts"
```

## Task 11: Align the Console Room Header and Transcript

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`

**Interfaces:**

- Consumes: `buildExecutionHeader` and `ExecutionHeaderModel` from `@/lib/build-execution-header`; `buildAgentHistory` from `@/lib/build-agent-history`; `advanceNodeMessages` from `@/lib/load-node-message-pages`; `emptyNodeMessageState` and `nodeMessageScopeKey` from `@/lib/node-message-pages`; the follow helpers from `@/lib/room-scroll-follow`; `inspectStatusLabel` from `./inspect-status`.
- Produces: `ConsoleRoomHeader`; `ConsoleNodeRoomProps` gains `nodeExecutions: readonly NodeExecution[]` and `onSelectExecution: (optionId: string) => void`.

- [ ] **Step 1: Write the failing console header test**

Create `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx` using `installHappyDom` from `../../test/install-happy-dom`.
Assert the same eleven behaviors listed in Task 8 Step 1, with `inspectStatusLabel` supplying the status wording so `awaiting` reads as `waiting on you`.

- [ ] **Step 2: Run the test and confirm it fails**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx` from `packages/web`.
Expected: FAIL with a module-resolution error for `./ConsoleRoomHeader`.

- [ ] **Step 3: Implement the console header**

Create `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`.
Render the same three rows described in Task 8 Step 3, with these console-specific differences.

- The component is console-owned and must not import `@/components`; it may import `@/lib/build-execution-header`.
- Status wording comes from `inspectStatusLabel`.
- The container is `sticky top-0 z-10 border-b border-border bg-surface px-4 py-3`.
- Sizes come from the `--rv-*` tokens, replacing every current hard-coded `text-[13px]` and `text-[11px]` in the existing `RoomHeader`.
- Keep the existing `Close` button markup and behavior so the console keyboard map and tests continue to find it.

- [ ] **Step 4: Run the test and confirm it passes**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing console room tests**

Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
Add tests asserting that:

- the room renders `ASSISTANT` above prose and no chat bubble wrapper;
- a tool card shows its context taken from a recorded `path` input;
- the room drains a second page and renders rows from both, with every request carrying a `limit`;
- a failed second page keeps the first page visible and renders the incomplete notice with a `Retry` control;
- selecting a second execution refetches under a new scope key and never mixes rows;
- lifecycle rows render through `lifecycleNoteLabel`, so a raw `started` token no longer appears;
- a `Jump to latest` control appears after the scroll handler reports a scrolled-up geometry.

- [ ] **Step 6: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx` from `packages/web`.
Expected: FAIL.

- [ ] **Step 7: Rebuild the console room body**

Modify `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`.

- Replace the local `RoomHeader` with `ConsoleRoomHeader`, passing `buildExecutionHeader({ nodeId: row.nodeId, executions: nodeExecutions, selectedRowId: row.id })`.
- Replace the inline `AgentTranscript` tool and text rendering with a render pass over `buildAgentHistory(visibleMessages)`, matching the Legacy item contract exactly so both surfaces satisfy the same acceptance cases without sharing a component.
- Replace the `useEntity` single-fetch with local `useState<NodeMessageState>` plus a `useEffect` that calls `advanceNodeMessages`, seeded from the current state, guarded by an incrementing generation ref, and aborted through an `AbortController` when the scope key changes or the component unmounts.
- Keep the existing one-second interval while `isLive && agentActive`, but have each tick call `advanceNodeMessages` with the retained state so the poll fetches only new rows.
- Reset the state, the follow state, and the generation whenever `nodeMessageScopeKey(run.id, nodeId, { occurrenceId, attemptId })` changes.
- Render the incomplete notice from `state.error` above the retained items, with a `Retry` button that re-runs the drain.
- Render the same `View full output` link for a `truncated` output state, pointing at the message-detail route, and render no link for `missing` or `unknown`.
- Render the incomplete notice as its own `role="status"` element, separate from the header's status line, and apply the same `scroll-pb-32` and Ask `scrollIntoView` keyboard handling as the Legacy room.
- Hold `FollowState`, wire the scroll region's `onScroll`, and render a `Jump to latest` control exactly as the Legacy room does.
- Keep every non-agent body branch, the Ask anchoring, and `ApprovalPanel` usage unchanged, anchoring Asks against `item.messageIds`.
- Replace every remaining hard-coded `text-[11.5px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, and `text-[9.5px]` inside the transcript with the matching `--rv-*` token.

- [ ] **Step 8: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts` from `packages/web`.
Expected: PASS.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/experiments/console/components/inspect/ConsoleRoomHeader.tsx src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx src/experiments/console/components/ConsoleNodeRoom.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx` from `packages/web`.

```bash
git add packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
git commit -m "feat(web): align the console room header and agent history"
```

## Task 12: Give the Console Log One Section per Execution

**Files:**

- Create: `packages/web/src/experiments/console/components/inspect/build-execution-sections.ts`
- Create: `packages/web/src/experiments/console/components/inspect/build-execution-sections.test.ts`
- Create: `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx`
- Create: `packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunStream.tsx`
- Modify: `packages/web/src/experiments/console/components/RunStream.test.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`

**Interfaces:**

- Consumes: the existing `TimelineEntry` union built inside `RunStream`, plus `ConsoleLogEntry` and the run's pending interactions.
- Produces: `ExecutionSection`, `buildExecutionSections`, `ConsoleReplyComposer`, and `RunStreamProps` gains `pendingInteractions`, `renderAsk`, and `renderGate`.

- [ ] **Step 1: Write the failing section-grouping test**

Create `packages/web/src/experiments/console/components/inspect/build-execution-sections.test.ts`.
Assert that:

- entries between two `log_row` markers belong to the earlier marker's section, and entries before the first marker fall into a leading `null`-row section;
- an entry whose `nodeId` matches a later section is placed in that section regardless of its timestamp, because identity beats the positional window;
- sections keep the marker order produced by `entry.row.order` then `entry.row.sourceIndex`;
- a pending Ask interaction is attached to the section whose `nodeId` matches it;
- toggling `showSystem` to false removes only `system` and `system_row` entries and leaves every section, Ask, and gate intact;
- toggling `showToolCalls` to false removes only `tool` entries and leaves Ask entries intact;
- an empty entry list combined with an empty `logEntries` list produces an empty section list rather than throwing, while an empty entry list with markers still returns one section per marker.

- [ ] **Step 2: Run the test and confirm it fails**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/build-execution-sections.test.ts` from `packages/web`.
Expected: FAIL with a module-resolution error.

- [ ] **Step 3: Implement section grouping**

Create `packages/web/src/experiments/console/components/inspect/build-execution-sections.ts`.

```ts
/**
 * Group the console run stream into one section per execution.
 *
 * The mockup's Log owns each body inside its execution section; a flat
 * time-sorted list cannot express that. Grouping is derived from the ALREADY
 * SORTED timeline, so stored event order is preserved and the System and Tool
 * toggles only remove secondary detail — never execution structure and never a
 * pending human action.
 */
import type { ConsoleLogEntry } from './build-console-log-entries';

export interface SectionMemberEntry {
  key: string;
  at: number;
  kind: string;
  nodeId: string | null;
}

export interface ExecutionSection<TEntry extends SectionMemberEntry> {
  /** null for entries that precede the first execution marker. */
  entry: ConsoleLogEntry | null;
  members: TEntry[];
}

export interface BuildExecutionSectionsInput<TEntry extends SectionMemberEntry> {
  entries: readonly TEntry[];
  logEntries: readonly ConsoleLogEntry[];
  showToolCalls: boolean;
  showSystem: boolean;
}

export function buildExecutionSections<TEntry extends SectionMemberEntry>(
  input: BuildExecutionSectionsInput<TEntry>
): ExecutionSection<TEntry>[] {
  const ordered = [...input.logEntries].sort(
    (a, b) => a.row.order - b.row.order || a.row.sourceIndex - b.row.sourceIndex
  );
  const sections: ExecutionSection<TEntry>[] = [{ entry: null, members: [] }];
  const byNode = new Map<string, ExecutionSection<TEntry>>();
  for (const entry of ordered) {
    const section: ExecutionSection<TEntry> = { entry, members: [] };
    sections.push(section);
    if (!byNode.has(entry.row.nodeId)) byNode.set(entry.row.nodeId, section);
  }

  const startAt = new Map<ExecutionSection<TEntry>, number>();
  for (const section of sections) {
    startAt.set(
      section,
      section.entry === null ? Number.NEGATIVE_INFINITY : new Date(section.entry.startedAt).getTime()
    );
  }

  for (const member of input.entries) {
    if (member.kind === 'log_row' || member.kind === 'node') continue;
    if (member.kind === 'tool' && !input.showToolCalls) continue;
    if ((member.kind === 'system' || member.kind === 'system_row') && !input.showSystem) continue;
    const identity = member.nodeId === null ? undefined : byNode.get(member.nodeId);
    if (identity !== undefined) {
      identity.members.push(member);
      continue;
    }
    let target = sections[0];
    for (const section of sections) {
      if ((startAt.get(section) ?? Number.NEGATIVE_INFINITY) <= member.at) target = section;
    }
    target.members.push(member);
  }

  return sections.filter(section => section.entry !== null || section.members.length > 0);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run `NODE_ENV=development bun test src/experiments/console/components/inspect/build-execution-sections.test.ts` from `packages/web`.
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing stream rendering tests**

Modify `packages/web/src/experiments/console/components/RunStream.test.tsx`.
Add tests asserting that:

- each `NodeDivider` is the first child of a `<section data-execution-row="<rowId>">` element that also contains that execution's messages and tools;
- a pending Ask for a node renders inside that node's section, via the injected `renderAsk` prop;
- a declared gate for a node renders inside that node's section, via the injected `renderGate` prop;
- turning `showSystem` off leaves every section present and every Ask visible;
- turning `showToolCalls` off leaves every Ask visible.

- [ ] **Step 6: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/experiments/console/components/RunStream.test.tsx` from `packages/web`.
Expected: FAIL, because the stream renders one flat list.

- [ ] **Step 7: Render execution sections**

Modify `packages/web/src/experiments/console/components/RunStream.tsx`.

- Keep the existing `timeline` memo and the `visible` node-filter behavior unchanged.
- Add a local `entryNodeId(entry: TimelineEntry): string | null` returning `entry.nodeId` for `tool`, `entry.node.nodeId` for `node`, `entry.entry.row.nodeId` for `log_row`, and `null` for every other kind, because the existing union does not carry `nodeId` on every member.
- Map `visible` to `visible.map(entry => ({ ...entry, nodeId: entryNodeId(entry) }))` so it satisfies `SectionMemberEntry`, then feed that into `buildExecutionSections` and render one `<section data-execution-row={...}>` per returned section.
- Render the section's `NodeDivider` first, then its members in their existing order and with their existing renderers.
- Add `pendingInteractions`, `renderAsk?: (nodeId: string) => ReactNode`, and `renderGate?: (nodeId: string) => ReactNode` to `RunStreamProps`, and call them at the end of the matching section so the Ask and gate sit in their own execution context rather than the log footer.
- Keep the `Waiting for first event…` empty state for an empty section list.

- [ ] **Step 8: Write the failing composer test**

Create `packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx`.
Assert that the composer renders a textarea and a `Reply` button; that with a `disabledReason` it renders that reason, disables the control, and never calls `onSubmit`; that a successful submit clears the draft; and that a rejected submit keeps the draft and renders the error.

- [ ] **Step 9: Run the composer test and confirm it fails**

Run `NODE_ENV=development bun test src/experiments/console/components/ConsoleReplyComposer.test.tsx` from `packages/web`.
Expected: FAIL with a module-resolution error.

- [ ] **Step 10: Implement the composer and mount it**

Create `packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx`.
It renders a bottom composer with props `{ value, onValueChange, onSubmit, sending, disabledReason, error }`, and it never creates a conversation.
Its disabled copy is exactly `Replies need a parent web conversation. This run has none.` when there is no parent, and `Continuing chats from other platforms in the Web UI is coming soon` when the parent conversation's `platform_type` is not `web`, matching the wording the Legacy composer already uses.

Modify `packages/web/src/experiments/console/routes/RunDetailPage.tsx`.

- Resolve the run's parent conversation through the existing run-detail data.
- Mount `ConsoleReplyComposer` directly above `RunActionBar`, wired to the existing `sendMessage` export in `packages/web/src/experiments/console/skills/conversations.ts`, which already posts to `/api/conversations/:id/message` and therefore keeps the console clear of `@/lib/api`.
- Pass `pendingInteractions`, `renderAsk`, and `renderGate` into `ConsoleInspectPane` so `RunStream` can place them, using the same `ConsoleAskCard` and `ApprovalPanel` the room already uses and sharing one `actionStates` map so a draft is identical in both presentations.
- Remove the approval panel that is appended at the log footer, because the gate now renders inside its execution section.

- [ ] **Step 11: Run the console suite and confirm it passes**

Run `NODE_ENV=development bun test src/experiments/console/` from `packages/web`.
Expected: PASS, including `console-isolation.test.ts`.

- [ ] **Step 12: Format and commit**

Run `bun x prettier --write src/experiments/console/components/inspect/build-execution-sections.ts src/experiments/console/components/inspect/build-execution-sections.test.ts src/experiments/console/components/ConsoleReplyComposer.tsx src/experiments/console/components/ConsoleReplyComposer.test.tsx src/experiments/console/components/RunStream.tsx src/experiments/console/components/RunStream.test.tsx src/experiments/console/routes/RunDetailPage.tsx` from `packages/web`.

```bash
git add packages/web/src/experiments/console/components/inspect/build-execution-sections.ts packages/web/src/experiments/console/components/inspect/build-execution-sections.test.ts packages/web/src/experiments/console/components/ConsoleReplyComposer.tsx packages/web/src/experiments/console/components/ConsoleReplyComposer.test.tsx packages/web/src/experiments/console/components/RunStream.tsx packages/web/src/experiments/console/components/RunStream.test.tsx packages/web/src/experiments/console/routes/RunDetailPage.tsx
git commit -m "feat(web): give the console log execution sections and a reply composer"
```

## Task 13: Put Ask and Gate Cards in the Legacy Chat Timeline

**Files:**

- Modify: `packages/web/src/components/workflows/build-chat-timeline.ts`
- Modify: `packages/web/src/components/workflows/build-chat-timeline.test.ts`
- Modify: `packages/web/src/components/workflows/ChatTimeline.tsx`
- Modify: `packages/web/src/components/workflows/ChatTimeline.test.tsx`
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`

**Interfaces:**

- Consumes: `PendingInteraction` from `@/lib/api`, the existing `AskCard` and `InvalidAskCard`, `resolveAskCardPresentation`, `parseAskEnvelope`, and `GateRoom`'s `selectGateChrome` data.
- Produces: two new `ChatTimelineEntry` variants, `ask` and `gate`, and `ChatTimelineProps` gains `renderAsk` and `renderGate`.

- [ ] **Step 1: Write the failing timeline model tests**

Modify `packages/web/src/components/workflows/build-chat-timeline.test.ts`.
Add tests asserting that:

- a pending interaction produces an `ask` entry positioned by its `created_at` among the existing entries;
- an answered interaction still produces an `ask` entry so the retained decision stays in history;
- an `approval_requested` event produces a `gate` entry at its event time;
- an interaction whose node has no timeline presence still appears, ordered by its own timestamp;
- entries remain stable when the same interaction is supplied twice.

- [ ] **Step 2: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/build-chat-timeline.test.ts` from `packages/web`.
Expected: FAIL, because the union has only `user` and `node_status`.

- [ ] **Step 3: Extend the timeline model**

Modify `packages/web/src/components/workflows/build-chat-timeline.ts`.

- Add `pendingInteractions: readonly PendingInteraction[]` to `buildChatTimeline`'s input.
- Add two variants to `ChatTimelineEntry`.

```ts
  | {
      kind: 'ask';
      id: string;
      createdAt: string;
      nodeId: string;
      interaction: PendingInteraction;
    }
  | {
      kind: 'gate';
      id: string;
      createdAt: string;
      nodeId: string;
      gateType: 'approval' | 'plannotator_gate';
    }
```

- Build `ask` entries from every supplied interaction, keyed `ask:${interaction.id}`, timestamped from `interaction.created_at`.
- Build `gate` entries from every `approval_requested` event whose `data.gateType` is `approval` or `plannotator_gate`, keyed `gate:${event.id}`.
- Feed both through the existing `IndexedEntry` sort so ordering rules stay in one place.

- [ ] **Step 4: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/build-chat-timeline.test.ts` from `packages/web`.
Expected: PASS.

- [ ] **Step 5: Write the failing timeline rendering tests**

Modify `packages/web/src/components/workflows/ChatTimeline.test.tsx`.
Assert that an `ask` entry renders through the injected `renderAsk`, that a `gate` entry renders through the injected `renderGate`, that neither renderer receives a `node_status` entry, and that omitting both renderers leaves the timeline rendering only its existing entries without throwing.

- [ ] **Step 6: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/ChatTimeline.test.tsx` from `packages/web`.
Expected: FAIL.

- [ ] **Step 7: Render the cards and share one action state**

Modify `packages/web/src/components/workflows/ChatTimeline.tsx` to accept `renderAsk?: (entry) => ReactNode` and `renderGate?: (entry) => ReactNode` and call them for the matching entry kinds.

Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.

- Pass `pendingInteractions` into `buildChatTimeline`.
- Supply `renderAsk` that reuses the same `AskCard`, `parseAskEnvelope`, and `resolveAskCardPresentation` path as the room, with `mountContext="chat"`, and that reads and writes the same `actionStates` map and the same `onSubmitAsk` callback, so one request has one draft and one action state across both presentations.
- Supply `renderGate` that renders the existing gate chrome with `onApprove` and `onReject`.
- Keep the existing composer disabled reasons unchanged, and never turn composer free text into an approval decision.
- Keep the timeline rendering its node, Ask, and gate entries when the run has no parent web conversation, so the history stays readable while the composer explains why it cannot send.

- [ ] **Step 8: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/ChatTimeline.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/build-chat-timeline.test.ts` from `packages/web`.
Expected: PASS.

- [ ] **Step 9: Format and commit**

Run `bun x prettier --write src/components/workflows/build-chat-timeline.ts src/components/workflows/build-chat-timeline.test.ts src/components/workflows/ChatTimeline.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/LegacyGraphLogsPane.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx` from `packages/web`.

```bash
git add packages/web/src/components/workflows/build-chat-timeline.ts packages/web/src/components/workflows/build-chat-timeline.test.ts packages/web/src/components/workflows/ChatTimeline.tsx packages/web/src/components/workflows/ChatTimeline.test.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.tsx packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx
git commit -m "feat(web): render contextual ask and gate cards in the legacy chat timeline"
```

## Task 14: Align Headers, Tabs, Graph Presentation, and Retained Controls

**Files:**

- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ProjectViewTabs.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowDagViewer.tsx`
- Modify: `packages/web/src/components/workflows/DagNodeComponent.tsx`
- Modify: `packages/web/src/components/workflows/DagNodeComponent.test.ts`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`

**Interfaces:**

- Consumes: the `--rv-*` tokens established in Task 1 and the existing status colour maps.
- Produces: no new exported symbols; this task changes presentation and control placement only.

- [ ] **Step 1: Write the failing header and tab tests**

Modify `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`.
Assert that the header renders, in one identity row, the workflow name, the run status pill, and the elapsed or total duration; that the project name and the run id render as secondary metadata that wraps rather than truncating the workflow name; and that an `awaiting` run's status pill is a button whose accessible name contains `Awaiting input`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/experiments/console/components/RunDetailHeader.test.tsx` from `packages/web`.
Expected: FAIL.

- [ ] **Step 3: Align the headers and tabs**

Modify `packages/web/src/experiments/console/components/RunDetailHeader.tsx` so the identity row holds workflow name, status pill, and duration, and every other field wraps beneath it with `flex flex-wrap`.
Modify `packages/web/src/experiments/console/components/ProjectViewTabs.tsx` so the tab treatment matches the mockup: an underlined selected tab, a `--rv-role-label-font-size` label, and a wrapping row that never hides a tab at narrow widths.
Modify the Legacy outer header in `packages/web/src/components/workflows/WorkflowExecution.tsx` so its tab row and identity row use the same hierarchy and wrapping rules, and confirm that Source Control, Terminal, usage, environment, provenance, IDE links, cancel, resume, retry, and re-run controls all remain rendered.

- [ ] **Step 4: Write the failing graph presentation tests**

Modify `packages/web/src/components/workflows/DagNodeComponent.test.ts` and `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`.
Assert that a node card renders its kind label and status line at the token font sizes rather than hard-coded pixel sizes, that a selected node carries a distinct selected class or `aria-current`, and that the graph container exposes a scrollable or pannable region so a wide graph never forces page-level horizontal scrolling.

- [ ] **Step 5: Run the tests and confirm they fail**

Run `NODE_ENV=development bun test src/components/workflows/DagNodeComponent.test.ts src/experiments/console/components/RunGraphPanel.test.tsx` from `packages/web`.
Expected: FAIL.

- [ ] **Step 6: Align graph typography and selection**

Modify `packages/web/src/components/workflows/DagNodeComponent.tsx` and `packages/web/src/components/workflows/WorkflowDagViewer.tsx` to read node label and status typography from the `--rv-*` tokens and to mark the selected node with both a visible treatment and `aria-current="true"`.
Modify `packages/web/src/experiments/console/components/RunGraphPanel.tsx` the same way, and confirm the graph viewport keeps its own pan and zoom region with `overflow-hidden` on the container so it satisfies the reflow requirement.

- [ ] **Step 7: Run the tests and confirm they pass**

Run `NODE_ENV=development bun test src/components/workflows/ src/experiments/console/` from `packages/web`.
Expected: PASS.

- [ ] **Step 8: Format and commit**

Run `bun x prettier --write src/experiments/console/components/RunDetailHeader.tsx src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/components/ProjectViewTabs.tsx src/experiments/console/components/RunGraphPanel.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/components/workflows/WorkflowDagViewer.tsx src/components/workflows/DagNodeComponent.tsx src/components/workflows/DagNodeComponent.test.ts src/components/workflows/WorkflowExecution.tsx` from `packages/web`.

```bash
git add packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/RunDetailHeader.test.tsx packages/web/src/experiments/console/components/ProjectViewTabs.tsx packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx packages/web/src/components/workflows/WorkflowDagViewer.tsx packages/web/src/components/workflows/DagNodeComponent.tsx packages/web/src/components/workflows/DagNodeComponent.test.ts packages/web/src/components/workflows/WorkflowExecution.tsx
git commit -m "feat(web): align run-view headers, tabs, and graph presentation with the tokens"
```

## Task 15: Prove the Journeys and Close the Story

**Files:**

- Create: `e2e/ui/workflow-run-hitl-room.spec.ts`
- Create: `e2e/fixtures/workflows/e2e-hitl-long-history.yaml`
- Modify: `e2e/lib/playwright/archon-runtime.ts`
- Modify: `e2e/ui/workflow-run-hitl-visual.spec.ts`
- Modify: `packages/providers/src/e2e-fake/provider.ts`
- Modify: `packages/providers/src/e2e-fake/provider.test.ts`
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Interfaces:**

- Consumes: the existing `archon` Playwright fixture, `openRunDetail`, `openLegacyRunDetail`, and `listNodeMessages` from `e2e/lib/playwright/run-detail.ts`.
- Produces: `E2E_HITL_LONG_WORKFLOW_NAME`, `runHitlLongHistoryWorkflow`, and the `repeatTool` scenario option.

- [ ] **Step 1: Write the failing provider test for repeatTool**

Modify `packages/providers/src/e2e-fake/provider.test.ts`.
Add a test asserting that a prompt carrying `{"emitTool":true,"repeatTool":3}` yields three tool call chunks and three tool result chunks, and a test asserting that `{"repeatTool":0}` and `{"repeatTool":500}` both throw a validation error.

- [ ] **Step 2: Run the provider test and confirm it fails**

Run `bun test src/e2e-fake/provider.test.ts` from `packages/providers`.
Expected: FAIL, because `repeatTool` is rejected by the strict scenario schema.

- [ ] **Step 3: Add the bounded repeatTool option**

Modify `packages/providers/src/e2e-fake/provider.ts`.
Add `repeatTool: z.number().int().min(1).max(200).optional()` to `scenarioSchema`.
In the `scenario.emitTool === true` branch, loop `scenario.repeatTool ?? 1` times, giving each iteration a distinct `toolCallId` of `e2e-fake-tool-${sessionId}-${String(index)}` and emitting one assistant chunk, one tool chunk, and one tool result chunk per iteration.
The default behavior with `repeatTool` absent must be byte-identical to today's single-tool emission.

- [ ] **Step 4: Run the provider test and confirm it passes**

Run `bun test src/e2e-fake/provider.test.ts` from `packages/providers`.
Expected: PASS.

- [ ] **Step 5: Add the long-history fixture and its runner**

Create `e2e/fixtures/workflows/e2e-hitl-long-history.yaml`.

```yaml
name: e2e-hitl-long-history
description: "E2E — one node whose transcript exceeds a single API page."
mutates_checkout: false

nodes:
  - id: long-history
    provider: e2e-fake
    model: e2e-fake-model
    prompt: |
      <<E2E_SCENARIO>>{"emitTool":true,"repeatTool":120}<</E2E_SCENARIO>>
      $ARGUMENTS
```

Modify `e2e/lib/playwright/archon-runtime.ts`.
Add `LONG_HISTORY_WORKFLOW_FIXTURE`, export `E2E_HITL_LONG_WORKFLOW_NAME = 'e2e-hitl-long-history'` and `HITL_LONG_NODE = 'long-history'`, copy the fixture beside the existing two in the `mkdirSync(join(home, 'workflows'))` block, and add `runHitlLongHistoryWorkflow()` mirroring `runHitlWorkflow` with the new name.

- [ ] **Step 6: Write the failing acceptance spec**

Create `e2e/ui/workflow-run-hitl-room.spec.ts` with these tests, all using real assertions rather than saved artifacts.

- `[P1] Console room opens, closes, and returns its width` runs the HITL fixture, opens the run with no `node` query, asserts `console-inspect-room` is absent and that `Select a node` appears zero times, records the inspect pane's `boundingBox().width`, opens a node from the Log, asserts the room's width divided by the pane's width is between `0.30` and `0.55`, clicks `Close`, and asserts the view pane's width returns to within two pixels of the recorded full width.
- `[P1] Legacy room is readable and percentage sized` opens the legacy run detail, opens a node from Logs, and asserts the room's width divided by the pane's width is between `0.30` and `0.55`; this is the direct regression test for the 52-pixel capture.
- `[P1] Agent history shows role, tool context, and outcome` asserts an `ASSISTANT` label is visible, that a `.ptool` card shows the recorded tool name and its `HITL_TOOL_INPUT.txt` context, and that both `Input` and `Output` regions are visible with `HITL_TOOL_OUTPUT_VISIBLE` present.
- `[P1] Execution selector switches loop iterations` opens `inspect-twice`, asserts two selector buttons labelled `Iteration 1` and `Iteration 2`, clicks the second, and asserts the visible transcript changes.
- `[P1] History longer than one API page loads completely` runs the long-history fixture, opens `long-history`, calls `listNodeMessages` to count stored rows, asserts the count exceeds `100`, and asserts the rendered `.ptool` card count equals the number of distinct tool ids the API returned.
- `[P1] Ask card keeps one draft across room and stream` opens `ask-starter`, types into the room's Ask input, and asserts the same text is present in the stream-section Ask card.
- `[P1] Narrow viewport gives the room the whole work area with Back` sets the viewport to 390 by 844, opens a node, asserts the view pane is not visible, clicks `Back`, and asserts the Log is visible again with its previous selection.
- `[P1] Reload restores the chosen ratio` drags the divider, reloads, and asserts the room ratio is within two percentage points of the dragged value.

- [ ] **Step 7: Run the acceptance spec and confirm it fails where expected**

Run `npm run test:ui -- workflow-run-hitl-room` from `e2e` after `npm ci` and `npx playwright install chromium`.
Expected: the new spec runs against the built app; record every failing assertion and fix the product code, not the assertion.
This spec must be fully green before Step 8, otherwise the visual spec's new ratio comparison will fail for a reason that has nothing to do with the mockup.

- [ ] **Step 8: Replace the vacuous visual assertion**

Modify `e2e/ui/workflow-run-hitl-visual.spec.ts`.
Delete `expect(mockupCaptured || mockupLimit.length > 0).toBe(true)`, which is true in every outcome including a failed mockup capture.
Replace it with `expect(mockupLimit, 'mockup capture must succeed for a comparable verdict').toBe('')` followed by `expect(mockupCaptured).toBe(true)`.
Add an assertion, before the loop, that the Console room and the mockup panel are captured in the SAME state, by asserting a node is selected and the room is open in both, so the two screenshot sets are comparable.
Add an assertion that at each viewport the product room's width ratio and the mockup panel's width ratio differ by no more than `0.08`.

- [ ] **Step 9: Run the full validation gate**

Run `bun run validate` from the repository root.
Expected: PASS for `check:bundled`, `check:bundled-skill`, `check:bundled-schema`, `check:pi-vendor-map`, `check:capability-matrix`, `type-check`, `lint --max-warnings 0`, `format:check`, `test:install`, and `test`.
Run `npm run test:ui` from `e2e`.
Expected: PASS for `workflow-run-hitl-room.spec.ts`, `workflow-run-hitl.spec.ts`, and `workflow-run-hitl-visual.spec.ts`.

- [ ] **Step 10: Record the visual verdict**

Create `plans/reports/acceptance-260908-story-5-6.md` recording, for each of the four required viewports and for both surfaces, the measured room ratio, the mockup ratio, the difference, and an explicit `matched` or `deviation` verdict with a one-line reason.
State plainly which journeys were exercised against the `e2e-fake` provider and that live Claude and Codex behavior was not established, mirroring the honesty of the PR #146 report.

- [ ] **Step 11: Close the story**

Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
Set `5-6-align-agent-history-and-responsive-run-room: done` and `epic-5: done`.
Update `last_updated` to the current local date and time.

- [ ] **Step 12: Format and commit**

Run `bun x prettier --write src/e2e-fake/provider.ts src/e2e-fake/provider.test.ts` from `packages/providers`.

```bash
git add e2e/ui/workflow-run-hitl-room.spec.ts e2e/ui/workflow-run-hitl-visual.spec.ts e2e/fixtures/workflows/e2e-hitl-long-history.yaml e2e/lib/playwright/archon-runtime.ts packages/providers/src/e2e-fake/provider.ts packages/providers/src/e2e-fake/provider.test.ts plans/reports/acceptance-260908-story-5-6.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "test(e2e): assert run-room lifecycle, ratio, and complete agent history"
```

## Validation

Run these from the repository root unless a package directory is stated.

| Command | Where | Purpose |
| --- | --- | --- |
| `bun test src/lib/` | `packages/web` | Every shared model module added by Tasks 1 through 6. |
| `NODE_ENV=development bun test src/components/` | `packages/web` | Legacy pane, room, header, transcript, and chat timeline. |
| `NODE_ENV=development bun test src/experiments/console/` | `packages/web` | Console pane, room, stream sections, composer, and the NFR4 isolation guard. |
| `bun test src/routes/api.workflow-runs.test.ts` | `packages/server` | Node-messages route metadata in both branches. |
| `bun test src/e2e-fake/provider.test.ts` | `packages/providers` | The bounded `repeatTool` scenario option. |
| `bun --filter @archon/web type-check` | repository root | Proves no numeric panel size survives the narrowed prop types. |
| `bun run lint --max-warnings 0` | repository root | Zero-warning gate. |
| `bun run validate` | repository root | The full pre-PR gate that CI mirrors. |
| `npm ci && npx playwright install chromium && npm run test:ui` | `e2e` | The room, HITL, and visual acceptance specs. |

## Open Questions

**1. Scope width: the story title is narrower than the brainstorm.**
The issue titles Story 5.6 "Align agent history and the responsive run room," which reads as brainstorm delivery boundaries 1, 2, and 5.
The brainstorm itself says "Each step remains part of this request; the order does not defer the surrounding UI scope," which includes boundaries 3 and 4.
Provisional default taken here: include all five boundaries in this one plan, ordered as the brainstorm orders them, so nothing is silently dropped.
If the reviewer prefers a narrower story, cut Tasks 12, 13, and 14 into a follow-on story and keep Tasks 1 through 11 and 15; the earlier tasks do not depend on the later ones.

**2. Prompt and instruction capture.**
The brainstorm leaves open whether each execution's history should also include the prompt sent into the node.
The transcript schema at `packages/workflows/src/schemas/node-message.ts` has no prompt or role variant, and the executor writes assistant content as `text`.
Provisional default taken here: do not add prompt capture.
This plan renders only recorded history and never reconstructs a prompt from the current workflow definition, which is the safe behavior the brainstorm requires either way.
Adding it later means a new recorded row kind written at execution time, not a UI change.

**3. Provider and model in the room header.**
`node_started` records `provider`, `model`, `tier`, `effort`, and `thinking` for AI nodes, but bash and script nodes record only `type`.
Provisional default taken here: render provider and model only when both are present on the node's most recent `node_started` event, and render nothing otherwise, per the brainstorm's "only when recorded data is available."

**4. The 960-pixel single-pane threshold.**
The brainstorm asks that the transition be derived from content and navigation width during browser validation rather than fixed in advance.
Provisional default taken here: `SPLIT_MIN_CONTAINER_PX = 960`, which is where the view pane's 30 percent floor and the room's 24 percent floor both stay above their readable minimums.
Task 15 Step 7 is the point at which to re-measure and adjust the constant if real transcript content disagrees; changing it is a one-line change in `use-container-split-mode.ts` plus the matching `--rv-split-min-container` token.

**5. Ratio persistence scope.**
The chosen ratio is stored in `localStorage` per surface, not per run and not per user account.
Provisional default taken here: per surface, because the brainstorm asks only that the user's chosen ratio be retained, and a per-run key would make the setting feel forgotten on every new run.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-align-agent-history-responsive-run-room.md`.
Two execution options.

**1. Subagent-Driven (recommended).**
Dispatch a fresh subagent per task with review between tasks, using `superpowers:subagent-driven-development`.

**2. Inline Execution.**
Execute the tasks in one session with checkpoints, using `superpowers:executing-plans`.
