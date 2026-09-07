# Answer the Ask in the Legacy Node Room Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md`
Derived slug: `2026-09-07-answer-ask-legacy-node-room`

## Overview

Story 6.5 of the Workflow Run View HITL epic completes the legacy workflow run view for human-in-the-loop agent interactions:
The authenticated run starter can answer or decline every structured Ask inline at its tool invocation in the legacy agent room, while teammates see named read-only state, and awaiting and CAP-7 chrome remain visually distinct.

Architecture:
1. Extend the existing GET-run read model with server-derived `viewer_is_starter` and `starter_display_name` fields, and continue treating `pending_interactions` as the only Ask-card source.
2. Keep one legacy Graph/Logs/Chat room (`LegacyNodeRoom`), add generic transcript extension slots (`renderAfterMessage`, `renderAtEnd`) to `NodeRoom`, and let `NodeTranscriptPane` select, parse, and place Ask cards without teaching the generic transcript renderer about HITL or mutation.
3. Keep mutation in a small per-request controller (`ask-answer-controller.ts`) owned by `WorkflowExecution`, and derive card, run, and node presentation from generated API types plus exact persisted state.
4. Distinguish run-level and node-level awaiting chrome (warning tokens, "waiting on you", "Awaiting input (n)") from CAP-7 provider rejection errors (error tokens, persisted `AskHuman is not supported by provider` error banner).

Linked issue: [#90](https://github.com/anhle128/Archon/issues/90).

## Problem

When an AI workflow agent pauses on an `AskHuman` tool call (Stories 6.2 and 6.3):
1. The legacy UI has no way to present structured questions (single-select, multi-select, custom "Other" responses) directly in the execution context where the agent asked them.
2. The UI read model lacks canonical starter identity (`viewer_is_starter`, `starter_display_name`), making it impossible for teammates or unsigned viewers to see who is authorized to respond.
3. Multiple pending Asks or historical loop-iteration Asks could bleed into the wrong room or loop slice if transcript placement is not partitioned cleanly.
4. Transcripts currently stop polling when the run is paused, which prevents fresh messages or Ask state from appearing during an Ask pause.
5. Operators need clear navigation and status cues distinguishing between a run paused waiting for starter input versus a run that failed at start because the provider does not support AskHuman (CAP-7).

## Solution

1. **GET-Run Identity Presentation (`packages/server`)**:
   - Add required `viewer_is_starter: boolean` and `starter_display_name: string | null` to `workflowRunDetailSchema`.
   - In the GET-run route handler (`api.ts:5063`), resolve the requester with `resolveAuthContext(c)`, compare `requester.userId === run.user_id`, and look up the starter's display name from `userDb.getUserById` with fallback to `run.user_id`. Starter-less runs return `false` and `null`.
   - Regenerate web types in `packages/web/src/lib/api.generated.d.ts`.

2. **Typed Ask Answer Client (`packages/web/src/lib/api.ts`)**:
   - Export generated types `PendingInteraction`, `AskAnswerBody`, and `WorkflowRunActionResponse`.
   - Implement `answerAskHuman(runId, requestId, body)` calling `POST /api/workflows/runs/:runId/ask/:requestId/answer` with URL-encoded parameters.
   - Implement `getApiErrorStatus(error: unknown): number | null` to safely inspect HTTP status codes (e.g. 409).

3. **Ask Envelope and Answer Codec (`packages/web/src/components/workflows/parse-ask-envelope.ts`)**:
   - Pure parser and validator without external dependencies or Zod runtime imports.
   - Parse `questions[]` into `AskQuestion[]`, validating single/multi choice, prompt, options, and `allowOther`. Reject duplicate IDs or malformed envelopes.
   - Validate drafts: require valid option or non-empty trimmed "Other" text; require at least one selection for multi-choice.
   - Convert valid draft to `Extract<AskAnswerBody, { answers: unknown }>`.
   - Parse stored canonical answer payloads for display summaries.

4. **Loop-Safe Placement & Generic Slots (`merge-agent-room-items.ts` & `NodeRoom.tsx`)**:
   - `selectVisibleNodeAskInteractions`: filters `kind === 'ask'` for the selected node, keeps only rows belonging to the visible loop slice, and places unanchored Asks only at the transcript tail.
   - `mergeAgentRoomItems`: interleaves visible messages and Ask cards in sequence order, anchoring cards immediately after matching tool messages.
   - Extend `NodeRoom` with generic slots: `renderAfterMessage(message)` and `renderAtEnd`. Preserves availability even if transcript query fails.

5. **Per-Request Mutation Controller & Presentation State (`ask-answer-controller.ts` & `ask-card-presentation.ts`)**:
   - `createAskAnswerController`: tracks in-flight request IDs in a private Set to prevent rapid duplicate submits. Emits `sending`, `accepted`, `rejected-late` (HTTP 409), and `error`. Invalidates queries on success and 409.
   - `resolveAskCardPresentation`: derives view state (`pending`, `sending`, `answered`, `declined`, `rejected-late`, `failed-resume`). Distinguishes exact resume failure (`Could not resume the AskHuman session`) from unrelated node failures.

6. **Accessible AskCard Component (`AskCard.tsx`)**:
   - Accessible form with `aria-label="question from agent, N questions"`, agent header, node ID, elapsed waiting duration.
   - Form controls: native radio (single) and checkbox (multi), expandable Other input. Only the first actionable card receives autoFocus.
   - Starter actions: Submit (enabled only when valid) and Decline (opens AlertDialog: "The agent will be told you declined").
   - Teammate view: disabled inputs, no buttons, "Waiting for <starter> to answer".
   - Resolved states: Answered summaries ("by you" only for starter), Declined, Already answered (409), Resume failed stamp, and details disclosure for raw payload.
   - `InvalidAskCard`: non-interactive `role="alert"` surface with "Invalid Ask payload" and raw disclosure.

7. **Awaiting and CAP-7 Run/Node Chrome (`awaiting-chrome.ts`, `WorkflowAskChrome.tsx`, `StatusIcon.tsx`, `ExecutionDagNode.tsx`, `NodeRunList.tsx`, `LegacyNodeRoom.tsx`)**:
   - Pure helpers: `countPendingAsks`, `isAskAwaitingRun` (`paused` + pending Asks > 0), `firstAwaitingNodeId`, `isAskHumanUnsupportedError`, and `nodeStatusLabel('awaiting') === 'waiting on you'`.
   - `WorkflowAskChrome`: renders warning pill `Awaiting input (n)` (click navigates to graph view and selects awaiting node) OR CAP-7 error banner (persisted `AskHuman is not supported by provider` message).
   - Warning tokens and "waiting on you" labels applied across graph nodes, node list sidebar, status icons, and legacy room header.

8. **SSE Paused Invalidation & Polling (`workflow-store.ts`, `NodeTranscriptPane.tsx`)**:
   - `workflow-store.ts`: invalidate `['workflowRun']` query when `status === 'paused'`.
   - `NodeTranscriptPane`: keep message polling active for `pending`, `running`, and `paused` run statuses (1000ms), stopping only on terminal statuses.

9. **Vertical Legacy Integration (`WorkflowExecution.tsx`, `LegacyGraphLogsPane.tsx`, `LegacyNodeRoom.tsx`, `NodeTranscriptPane.tsx`)**:
   - `mapWorkflowRunDetail`: maps pending interactions, viewer identity, starter display name, and metadata error from GET run.
   - `WorkflowExecution`: owns `AskActionStateByRequest` map (reset on run ID change), instantiates memoized controller, passes mapped props to `LegacyGraphLogsPane` and renders `WorkflowAskChrome`.
   - Shared three-door access: Logs, Graph, and Chat all display the same anchored Ask cards in the agent room, while keeping composer and non-agent rooms isolated.

10. **Validation & Sprint Completion**:
    - Full package tests, server tests, typecheck, lint, formatting, and `bun run validate`.
    - Clean up sprint status YAML conflict diagnostics and mark Story 6.5 `done`.

## Goals and Success Metrics

| Goal | Success metric | Evidence source |
| --- | --- | --- |
| Truthful starter and viewer presentation | Server GET run returns exact `viewer_is_starter` and `starter_display_name` across starter, teammate, unsigned, and unowned runs | `packages/server/src/routes/api.workflow-runs.test.ts` |
| Validated structured Ask answering | Starters can answer single/multi/other questions; submits only valid drafts; decline confirmed via dialog; prevents duplicate in-flight POSTs | `packages/web/src/components/workflows/AskCard.test.tsx`, `ask-answer-controller.test.ts` |
| Loop-safe and fault-tolerant transcript placement | Cards anchor after matching tool row; current unanchored cards render at end; loop iteration slices do not leak cards; transcript query errors still display Asks | `merge-agent-room-items.test.ts`, `NodeRoom.test.tsx`, `NodeTranscriptPane.test.tsx` |
| Named read-only state for teammates | Teammates and unsigned viewers see disabled controls, "Waiting for <starter> to answer", and zero mutation affordances | `AskCard.test.tsx`, `LegacyGraphLogsPane.test.tsx` |
| Distinct awaiting and CAP-7 chrome | Paused + Ask shows warning `Awaiting input (n)` and navigates to awaiting node; CAP-7 shows error banner; node chrome uses warning "waiting on you" | `awaiting-chrome.test.ts`, `WorkflowAskChrome.test.tsx`, `StatusIcon.test.tsx`, `ExecutionDagNode.test.tsx` |
| Regression-free legacy integration | All three doors (Logs, Graph, Chat) share the same agent room with cards; composer and non-agent rooms remain isolated; full repo validation passes | `LegacyGraphLogsPane.test.tsx`, `WorkflowExecution.test.tsx`, `bun run validate` |

## Non-Goals

- Do not implement Command Center Ask chrome in this story (`packages/web/src/experiments/console/`).
- Do not add a shared React NodePanel or unify console and legacy room implementations.
- Do not render `kind: permission` cards.
- Do not change workflow engine, persistence schema, workflow YAML, provider resume behavior, CLI, chat orchestrator, or `manage_run`.
- Do not add an `awaiting` workflow run status or write Ask state into `metadata.approval`.
- Do not add UI packages or new shadcn radio/checkbox primitives.
- Do not modify `RunChatComposer.tsx` or `ChatTimeline.tsx` to handle pending interactions.

## Technical Context

- Server GET run assembly: `packages/server/src/routes/api.ts:5063` and `packages/server/src/routes/schemas/workflow.schemas.ts:209-231`.
- User display name lookup: `userDb.getUserById` in `packages/core/src/db/users.ts:41`.
- Web generated types: `packages/web/src/lib/api.generated.d.ts` and `packages/web/src/lib/api.ts:429`.
- Pure parser & codec: `packages/web/src/components/workflows/parse-ask-envelope.ts`.
- Room item merger: `packages/web/src/components/workflows/merge-agent-room-items.ts`.
- Generic transcript slots: `packages/web/src/components/workflows/NodeRoom.tsx:15-22, 204-251`.
- Mutation controller: `packages/web/src/components/workflows/ask-answer-controller.ts`.
- Card presentation derivation: `packages/web/src/components/workflows/ask-card-presentation.ts`.
- Accessible Ask card: `packages/web/src/components/workflows/AskCard.tsx`.
- Awaiting helpers & chrome: `packages/web/src/components/workflows/awaiting-chrome.ts`, `WorkflowAskChrome.tsx`, `StatusIcon.tsx`, `ExecutionDagNode.tsx`, `NodeRunList.tsx`.
- Query invalidation: `packages/web/src/stores/workflow-store.ts:186-231`.
- Legacy surface composition: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`, `LegacyNodeRoom.tsx`, `LegacyGraphLogsPane.tsx`, and `WorkflowExecution.tsx`.
- Sprint tracking: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

## Story Overview Table

| Priority | ID | Title | Depends On | Plan Task Reference |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Extend GET run with viewer and starter presentation | - | Task 1 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:438-517`) |
| 2 | US-002 | Add the typed Ask answer client | US-001 | Task 2 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:518-577`) |
| 3 | US-003 | Parse Ask envelopes, answers, and valid drafts | US-002 | Task 3 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:578-654`) |
| 4 | US-004 | Add loop-safe placement and generic transcript slots | US-001 | Task 4 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:655-750`) |
| 5 | US-005 | Implement independent Ask mutation and presentation state | US-002, US-003 | Task 5 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:751-840`) |
| 6 | US-006 | Render the accessible Ask card | US-003, US-005 | Task 6 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:841-945`) |
| 7 | US-007 | Add awaiting and CAP-7 presentation chrome | US-001 | Task 7 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:946-1050`) |
| 8 | US-008 | Invalidate Ask data on paused SSE | US-001 | Task 8 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:1051-1090`) |
| 9 | US-009 | Integrate Ask cards through the complete legacy run surface | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008 | Task 9 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:1091-1310`) |
| 10 | US-010 | Run regressions, validate, and close sprint tracking | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009 | Task 10 (`docs/superpowers/plans/2026-09-07-answer-ask-legacy-node-room.md:1311-1430`) |
