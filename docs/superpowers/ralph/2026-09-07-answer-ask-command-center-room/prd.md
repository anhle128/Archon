# Answer the Ask in the Command Center Room Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-answer-ask-command-center-room.md`
Derived slug: `2026-09-07-answer-ask-command-center-room`

## Overview

Story 6.6 of the Workflow Run View HITL epic completes human-in-the-loop agent interactions for the Command Center (`/console`):
The authenticated run starter can answer or decline every structured Ask inline at its tool invocation in the Command Center agent room, with the same envelope, validity, copy, and warning awaiting chrome as Story 6.5, while teammates see named read-only state and the console composer stays a conversation path.

Architecture:
1. Keep console production code isolated under `packages/web/src/experiments/console/**` to satisfy NFR4 and FR8.
2. Consume generated OpenAPI types only from `@/lib/api.generated` via console `skills/runs.ts`, calling the existing GET-run embed and Ask POST through console `requestJson`.
3. Mirror only the Story 6.5 pure helper behavior under `packages/web/src/experiments/console/components/ask/` that the console actually calls (envelope parser, selector, mutation controller, card presentation, awaiting helpers).
4. Console-owned accessible UI components (`ConsoleAskCard`, `ConsoleAskChrome`, `AgentTranscript` extension slots) using native HTML elements (`form`, `dialog`, `fieldset`, `legend`, `input`, `textarea`, `button`) without adding shadcn primitives or importing legacy UI.
5. Unified awaiting inspect status policy: `awaiting` is preserved through to layout and display, showing `waiting on you` with warning tokens, and prioritized in inspect selection over running nodes.
6. Run-detail page ownership: `RunDetailPage` manages per-run mutation controller and request action states, renders `ConsoleAskChrome` under header, guards shortcut keys `a`/`r` for declared gates only, and keeps conversation composer completely decoupled from HITL.

Linked issue: [#91](https://github.com/anhle128/Archon/issues/91).

## Problem

1. When an AI workflow pauses on an `AskHuman` tool call, the Command Center `/console` inspect room cannot render the structured Ask question inline at the tool invocation.
2. Console's `getRun` drops `pending_interactions`, `viewer_is_starter`, `starter_display_name`, and metadata errors returned by the GET-run endpoint.
3. Console `inspectStatus` currently normalizes `awaiting` to `running`, suppressing warning awaiting chrome across Graph and Log dividers and breaking initial inspect selection for awaiting nodes.
4. Without console-owned Ask cards and controllers, operators cannot answer single/multi-choice questions, submit custom "Other" answers, or decline with prompt feedback.
5. Teammates lack named read-only visibility into who needs to respond.
6. The room and page must maintain NFR4 isolation: no imports from legacy `@/components/workflows`, `@/lib/api` functions, `@tanstack/react-query`, or `@/components/ui/*`.

## Solution

1. **Typed Console Ask Boundary (`skills/runs.ts`)**:
   - Extend `ConsoleRunDetail` with `pendingInteractions`, `viewerIsStarter`, `starterDisplayName`, and string `runError`.
   - Export `answerAskHuman(runId, requestId, body)` calling `POST /api/workflows/runs/:runId/ask/:requestId/answer` via console `requestJson`.
2. **Console-Owned Pure Codecs & Helpers (`components/ask/`)**:
   - `parse-ask-envelope.ts`: parse questions, validate drafts (single/multi/Other), convert draft to answer body, and parse canonical answers without Zod.
   - `select-visible-node-ask-interactions.ts`: select visible pending/answered Ask rows for the active node and visible loop slice without cross-iteration leaks.
   - `ask-answer-controller.ts`: per-request mutation controller tracking in-flight submits, handling HTTP 409 `rejected-late` via console `HttpError`, and triggering query invalidations.
   - `ask-card-presentation.ts`: derive view states (`pending`, `sending`, `answered`, `declined`, `rejected-late`, `failed-resume`), handling resume errors strictly.
   - `awaiting-chrome.ts`: pure helpers for pending Ask counts, `isAskAwaitingRun` check, first awaiting node resolution, and CAP-7 unsupported provider detection.
3. **Inspect Status & Awaiting Chrome (`components/inspect/`, `NodeDivider`, `RunGraphPanel`)**:
   - Update `inspectStatus` to preserve `'awaiting'` as a first-class status; update `inspectStatusLabel` to map `'awaiting'` to `'waiting on you'`.
   - Update `resolveInitialInspectSelection` so awaiting nodes take precedence over running nodes.
   - Update `NodeDivider` and `RunGraphPanel` to render warning tokens, pulsing animations, and `waiting on you` labels for awaiting nodes.
4. **Console UI Components (`ConsoleAskCard.tsx`, `ConsoleAskChrome.tsx`, `lib/format.ts`)**:
   - `formatDurationMs` in `lib/format.ts` for duration formatting.
   - `ConsoleAskCard`: accessible form with warning border, prompt legends, radio/checkbox/textarea, native modal `dialog` for decline confirmation, disabled teammate view, and resolution stamps.
   - `ConsoleAskChrome`: warning button `Awaiting input (n)` (switching to Graph and selecting awaiting node) or CAP-7 error alert banner.
5. **Room & Page Integration (`ConsoleNodeRoom.tsx`, `ConsoleInspectPane.tsx`, `RunDetailPage.tsx`, `RunDetailHeader.tsx`)**:
   - Extend `AgentTranscript` with `renderAfterMessage` and `renderAtEnd` slots.
   - `ConsoleNodeRoom` places anchored cards after matching tool messages and unanchored cards at transcript tail; displays unanchored cards even during transcript query errors.
   - `ConsoleInspectPane` threads Ask props through the persistent room without remounting on Log/Graph switches.
   - `RunDetailHeader` displays `Awaiting input` during Ask pauses.
   - `RunDetailPage` instantiates and owns the controller, binds shortcut keys `a`/`r` only when declared approval gate is active, renders `ConsoleAskChrome`, and keeps `ChatComposer` isolated.
6. **Architecture Guard & Validation**:
   - Update `console-isolation.test.ts` to assert zero imports from `components/workflows`, zero HITL identifiers in `ChatComposer`/`ChatPage`, and proper console module usage.
   - Update `packages/web/src/experiments/console/README.md`.
   - Verify all tests and validation pass, then mark sprint status done.

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Retain and wrap Ask data boundary | `getRun` preserves all Ask fields and metadata error; `answerAskHuman` posts encoded URL with JSON body | `runs.node-messages.test.ts`, `runs.ask.test.ts` |
| Zero legacy UI imports (NFR4) | Zero imports from `@/components/workflows`, `@/lib/api` functions, or React Query in console code | `console-isolation.test.ts` |
| Loop-safe inline card placement | Cards anchor after matching tool message; do not leak across loop slices; unanchored cards appear at tail | `select-visible-node-ask-interactions.test.ts`, `ConsoleNodeRoom.test.tsx` |
| Complete Ask card UX parity | Validated single/multi/Other drafts, native decline dialog confirmation, named teammate read-only state, resolution stamps | `ConsoleAskCard.test.tsx` |
| Distinct awaiting and CAP-7 chrome | Warning `Awaiting input (n)` pill navigates to awaiting node; CAP-7 displays persistent error alert banner | `awaiting-chrome.test.ts`, `ConsoleAskChrome.test.tsx` |
| Composer and keymap isolation | `ChatComposer` remains conversation-only; keymap `a`/`r` bindings trigger only on declared approval gates | `RunDetailPage.test.tsx`, `console-isolation.test.ts` |
| Full verification and validation | All focused console tests, Story 6.5 legacy tests, type-check, lint, formatting, and `bun run validate` pass | Terminal execution logs |

## Non-Goals

- Do not implement legacy Ask chrome (completed in Story 6.5).
- Do not add a shared React NodePanel between legacy and console rooms.
- Do not render `kind: permission` cards.
- Do not change workflow engine, persistence schema, workflow YAML, provider resume behavior, CLI, chat orchestrator, or `manage_run`.
- Do not add an `awaiting` workflow-run status or write Ask state into `metadata.approval`.
- Do not add external UI packages or shadcn primitives.
- Do not wire pending interactions into `ChatComposer` or `ChatPage`.

## Technical Context

- Console runs data skill: `packages/web/src/experiments/console/skills/runs.ts`
- Console HTTP client: `packages/web/src/experiments/console/lib/http.ts`
- Console format utilities: `packages/web/src/experiments/console/lib/format.ts`
- Console inspect status policy: `packages/web/src/experiments/console/components/inspect/inspect-status.ts`
- Console inspect selection: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts`
- Console divider component: `packages/web/src/experiments/console/components/NodeDivider.tsx`
- Console graph panel: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Console node room: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Console inspect pane: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Console header: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Console run detail page: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Console architecture isolation: `packages/web/src/experiments/console/console-isolation.test.ts`
- Sprint status tracking: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

## Story Overview Table

| ID | Title | Priority | Dependencies | Plan Ref | Key Files |
| --- | --- | --- | --- | --- | --- |
| US-001 | Extend the typed console Ask data boundary | 1 | None | Task 1 | `skills/runs.ts`, `runs.node-messages.test.ts`, `runs.ask.test.ts` |
| US-002 | Duplicate the Ask envelope parser | 2 | US-001 | Task 2 | `components/ask/parse-ask-envelope.ts`, `parse-ask-envelope.test.ts` |
| US-003 | Add loop-safe Ask selection | 3 | US-001 | Task 3 | `components/ask/select-visible-node-ask-interactions.ts`, `select-visible-node-ask-interactions.test.ts` |
| US-004 | Add the Ask mutation controller | 4 | US-001 | Task 4 | `components/ask/ask-answer-controller.ts`, `ask-answer-controller.test.ts` |
| US-005 | Add canonical and optimistic Ask presentation | 5 | US-001, US-002, US-004 | Task 5 | `components/ask/ask-card-presentation.ts`, `ask-card-presentation.test.ts` |
| US-006 | Derive awaiting state and initial inspect selection | 6 | US-001 | Task 6 | `components/ask/awaiting-chrome.ts`, `inspect/inspect-status.ts`, `inspect/console-inspect-selection.ts` |
| US-007 | Render awaiting warning chrome in Logs and Graph | 7 | US-006 | Task 7 | `components/NodeDivider.tsx`, `components/RunGraphPanel.tsx` |
| US-008 | Build the console Ask card | 8 | US-001, US-002, US-005 | Task 8 | `lib/format.ts`, `components/ask/ConsoleAskCard.tsx` |
| US-009 | Build the console run Ask chrome | 9 | US-001, US-006 | Task 9 | `components/ask/ConsoleAskChrome.tsx`, `ConsoleAskChrome.test.tsx` |
| US-010 | Place Ask cards in the Command Center agent room | 10 | US-001, US-002, US-003, US-005, US-008 | Task 10 | `components/ConsoleNodeRoom.tsx`, `components/ConsoleInspectPane.tsx` |
| US-011 | Wire run-detail ownership, chrome, and composer isolation | 11 | US-001, US-004, US-006, US-007, US-009, US-010 | Task 11 | `routes/RunDetailPage.tsx`, `components/RunDetailHeader.tsx` |
| US-012 | Isolation, docs, validate, and close tracking | 12 | US-011 | Task 12 | `console-isolation.test.ts`, `README.md`, `sprint-status.yaml` |
