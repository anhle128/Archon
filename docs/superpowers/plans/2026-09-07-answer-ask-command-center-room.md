# Answer the Ask in the Command Center Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the authenticated run starter answer or decline every structured Ask inline at its tool invocation in the Command Center agent room, with the same envelope, validity, copy, and warning awaiting chrome as Story 6.5, while teammates see named read-only state and the console composer stays a conversation path.

**Architecture:** Keep console production code isolated under `packages/web/src/experiments/console/**`.
Consume generated OpenAPI types only from `@/lib/api.generated`, call the existing GET-run embed and Ask POST through console `requestJson`, and duplicate Story 6.5's pure Ask helpers plus a console-owned card shell so NFR4 and FR8 stay intact.
Do not import legacy React, `@/lib/api` functions, React Query, or `@/components/workflows/*`.
GET `/api/workflows/runs/:runId` `pending_interactions` remains the only Ask-card source.
SSE `workflow_status` (mapped from `node_awaiting` / `interaction_resolved`) remains an identifier-only refetch trigger.

**Tech Stack:** Bun, strict TypeScript, React 19, console `useEntity` cache, happy-dom, `bun:test`, native `form` / `radio` / `checkbox` / `dialog` / `textarea`, Hono OpenAPI-generated types, and existing console warning/error tokens.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` Story 6.6, `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3, CAP-4, CAP-6, and CAP-7, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` `PendingInteractionCard` plus Surface Fit, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-4, AD-7, AD-8, and AD-9.

**Issue:** `https://github.com/anhle128/Archon/issues/91`.

## Global Constraints

- Story 6.6 changes the Command Center `/console` run-detail inspect surface only.
- Stories 5.5 and 6.5 are completed prerequisites and their focused suites must remain green.
- Console still must not import `@/components`, `@/stores`, `@/contexts`, `@/routes`, `@/hooks`, `@tanstack/react-query`, or `@/lib/api` functions.
- Type-only `api.generated.d.ts` remains allowed.
- The one sanctioned production-web runtime import remains `@/lib/run-graph`.
- Console must not import legacy `AskCard`, `WorkflowAskChrome`, `parse-ask-envelope`, `merge-agent-room-items`, `ask-answer-controller`, `ask-card-presentation`, or `awaiting-chrome`.
- Duplicate those contracts under `packages/web/src/experiments/console/components/ask/` and render them with console-owned markup.
- GET `/api/workflows/runs/:runId` `pending_interactions` is the only source of Ask cards.
- SSE payloads never become cards.
- Transcript `status` rows remain lifecycle notes and never become Ask cards.
- One POST answers or declines one whole card through `/api/workflows/runs/:runId/ask/:requestId/answer`, where `requestId` is `tool_use_id`.
- Submit stays disabled until every question is valid, including non-empty Other text and at least one value for multi-select.
- Decline remains a first-class secondary action behind a confirmation whose description is exactly `The agent will be told you declined`.
- A teammate or unsigned viewer sees disabled answer inputs, factual `Waiting for <starter> to answer` copy, and no Submit or Decline affordance.
- ChatPage `ChatComposer` remains a parent-conversation message path and never receives pending-interaction props.
- `a` / `r` keymap bindings stay declared-gate only and never submit or decline an Ask.
- Awaiting chrome uses warning tokens and the visible copy `waiting on you` or `Awaiting input (n)`.
- CAP-7 start rejection uses error tokens and the persisted executor message beginning `AskHuman is not supported by provider`.
- Do not render `kind: permission` cards.
- Do not add a shared React NodePanel.
- Do not change the workflow engine, persistence schema, workflow YAML, provider resume behavior, CLI, chat orchestrator, `manage_run`, or legacy `packages/web/src/components/workflows/**` production code.
- Do not add an `awaiting` workflow-run status or write Ask state into `metadata.approval`.
- Do not add UI packages or shadcn radio, checkbox, or dialog primitives.
- Every new or modified TypeScript function has complete types and no unjustified `any`.
- Each production behavior follows an observed RED, minimal GREEN, and refactor only while green.
- Run package-scoped tests from the owning package directory and never run unscoped `bun test` at repository root.
- Do not use `mock.module()` in the new tests.
- Do not update sprint tracking until all focused tests and `bun run validate` pass.
- Run every `git add` and `git commit` from the repository root.

---

## Verified Repository Facts

- Story 6.6 acceptance criteria are at `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md:507`.
- NFR4 isolation is at `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md:64` and `eslint.config.mjs:116`.
- Unified render means envelope, states, validity, and copy, not a shared React module (`ARCHITECTURE-SPINE.md` convention table and Story 6.6 AC).
- Story 6.5 already added required GET-run fields `pending_interactions`, `viewer_is_starter`, and `starter_display_name` to `packages/web/src/lib/api.generated.d.ts:5084`.
- `AskAnswerBody` is `{ answers: { questionId: string; value: string | string[] }[] } | { decline: true }` at `api.generated.d.ts:4999`.
- `WorkflowNodeState.status` already includes `awaiting` and optional `error` at `api.generated.d.ts:5126`.
- `packages/web/src/lib/run-graph/types.ts:1` already includes `NodeState` `'awaiting'`.
- Console `getRun` currently drops the GET-run Ask fields at `packages/web/src/experiments/console/skills/runs.ts:70`.
- Console `inspectStatus` currently maps `awaiting` to `running` at `packages/web/src/experiments/console/components/inspect/inspect-status.ts:4`.
- `build-run-graph-input.test.ts` currently asserts awaiting is normalized to running before layout.
- `build-console-log-entries.test.ts` currently asserts awaiting display status is `running`.
- `console-isolation.test.ts:120` currently forbids `pending_interactions`, `AskCard`, `ChatComposer`, `Waiting on you`, and `awaiting` in inspect production files.
- `ConsoleNodeRoom.test.tsx:149` `assertNoEpicSix` currently forbids those same strings in mounted rooms.
- `ChatComposer` mounts only on `ChatPage.tsx:314` and sends conversation messages.
- Run-detail SSE already maps `node_awaiting` / `interaction_resolved` to `workflow_status` and invalidates `K.run` at `packages/web/src/experiments/console/lib/sse.ts:134`.
- Agent rooms already poll node messages every 1s while `isInspectRunLive` is true, and paused is live.
- `RunActionBar` returns null while `run.status === 'paused'`.
- Declared-gate UI remains the log footer `ApprovalContext` / `ApprovalPanel` path in `RunDetailPage.tsx:500`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml:60` currently has `6-6-answer-the-ask-in-the-command-center-room: backlog`.
- Stories 6.1 through 6.5 and 6.7 are already `done`.

## Locked Design and Interfaces

### Console GET-run Ask fields

Extend `ConsoleRunDetail` in `packages/web/src/experiments/console/skills/runs.ts` to this exact shape.

```ts
export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export interface ConsoleRunDetail {
  run: Run;
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  usage: RunDetailResponse['usage'];
  pendingInteractions: PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  runError: string | null;
}
```

`getRun` keeps the current `toRun`, `events`, `rawEvents`, `nodeStates`, `approval`, and `usage` mapping.
It also sets `pendingInteractions` to `res.pending_interactions ?? []`, `viewerIsStarter` to `res.viewer_is_starter === true`, `starterDisplayName` to `res.starter_display_name`, and `runError` to the string `res.run.metadata.error` or `null` when that value is missing or not a string.

Add this exact skill beside `getRun`.

```ts
export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse> {
  return requestJson<WorkflowRunActionResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}
```

### Duplicated pure Ask modules

Create console-owned copies under `packages/web/src/experiments/console/components/ask/`.
Copy the Story 6.5 algorithms exactly from the legacy files listed below, changing only import paths so they use console `PendingInteraction`, `AskAnswerBody`, `WorkflowRunActionResponse`, `WorkflowNodeMessage`, and `HttpError`.

| Console file | Copy algorithm from |
| --- | --- |
| `parse-ask-envelope.ts` | `packages/web/src/components/workflows/parse-ask-envelope.ts` |
| `merge-agent-room-items.ts` | `packages/web/src/components/workflows/merge-agent-room-items.ts` |
| `ask-answer-controller.ts` | `packages/web/src/components/workflows/ask-answer-controller.ts` |
| `ask-card-presentation.ts` | `packages/web/src/components/workflows/ask-card-presentation.ts` |
| `awaiting-chrome.ts` | `packages/web/src/components/workflows/awaiting-chrome.ts` |

Public contracts must stay exactly these signatures.

```ts
export interface AskQuestion {
  id: string;
  prompt: string;
  selection: 'single' | 'multi';
  options: string[];
  allowOther: boolean;
}

export type AskDraftValue = string | string[];
export type AskDraft = Record<string, AskDraftValue>;

export function parseAskEnvelope(envelope: Record<string, unknown>): AskQuestion[] | null;
export function parseAskAnswer(answer: Record<string, unknown> | null): AskAnswerBody | null;
export function isQuestionValid(question: AskQuestion, value: AskDraftValue | undefined): boolean;
export function isAskDraftValid(questions: readonly AskQuestion[], draft: AskDraft): boolean;
export function draftToAnswerBody(
  questions: readonly AskQuestion[],
  draft: AskDraft
): Extract<AskAnswerBody, { answers: unknown }>;
```

`parseAskEnvelope` returns `null` for missing, non-array, or empty `questions`, a non-object item, an empty question id, a non-string prompt, an invalid selection, non-string options, non-boolean `allowOther`, or duplicate question ids.
It uses type guards and must not import Zod or `@archon/workflows`.
Single-select validity accepts one listed option or one trimmed non-empty custom value when `allowOther` is true.
Multi-select validity requires a non-empty array whose values are listed options or one trimmed non-empty custom value when `allowOther` is true.
`draftToAnswerBody` emits exactly one answer per question in envelope order and is called only for a valid draft.
`parseAskAnswer` recognizes only the strict `{ decline: true }` union member or a non-empty strict `answers` array with non-empty `questionId` and string or string-array `value`.

```ts
export type AgentRoomItem =
  | { kind: 'message'; id: string; message: WorkflowNodeMessage }
  | { kind: 'ask'; id: string; interaction: PendingInteraction };

export function selectVisibleNodeAskInteractions(input: {
  pending: readonly PendingInteraction[];
  nodeId: string;
  allMessages: readonly WorkflowNodeMessage[];
  visibleMessages: readonly WorkflowNodeMessage[];
}): PendingInteraction[];

export function mergeAgentRoomItems(
  visibleMessages: readonly WorkflowNodeMessage[],
  interactions: readonly PendingInteraction[]
): AgentRoomItem[];
```

Selection keeps `kind === 'ask'`, the selected `node_id`, and status `pending` or `answered`, while preserving GET order and excluding `purged` and `permission` rows.
An Ask with a tool id found in the full transcript is included only when that tool row is in the selected loop slice.
An Ask with no matching tool row anywhere is included only when the visible slice reaches the end of the full transcript, including the ordinary whole-node selection.
The merger sorts visible messages by `seq`, inserts matching cards immediately after the matching tool message, and appends only the remaining already-selected Ask rows.
Ask item ids use `ask:${interaction.id}`.

```ts
export type AskActionState =
  | { phase: 'sending' }
  | { phase: 'accepted'; answer: AskAnswerBody; resolvedAt: string }
  | { phase: 'rejected-late' }
  | { phase: 'error'; message: string };

export type AskActionStateByRequest = Record<string, AskActionState | undefined>;

export interface AskAnswerController {
  submit: (requestId: string, answer: AskAnswerBody) => Promise<void>;
}

export function createAskAnswerController(input: {
  runId: string;
  postAnswer: (
    runId: string,
    requestId: string,
    answer: AskAnswerBody
  ) => Promise<WorkflowRunActionResponse>;
  setActionState: (requestId: string, state: AskActionState) => void;
  invalidate: () => Promise<void>;
  now: () => Date;
}): AskAnswerController;
```

Detect HTTP 409 with `error instanceof HttpError && error.status === 409`.
Do not import `getApiErrorStatus`.
A duplicate in-flight submit for the same request id returns without another POST.
Different request ids may submit concurrently.
Emit `sending` before POST, `accepted` after success, `rejected-late` for 409, and `error` with the thrown message or `Failed to answer.` otherwise.
Success and 409 both call `invalidate` after updating local state.
An invalidation failure logs one `console.warn` with run and request ids and leaves accepted or rejected-late state intact.

```ts
export type AskCardViewState =
  | 'pending'
  | 'sending'
  | 'answered'
  | 'declined'
  | 'rejected-late'
  | 'failed-resume';

export interface AskCardPresentation {
  viewState: AskCardViewState;
  answer: AskAnswerBody | null;
  error: string | null;
  resolvedAt: string | null;
}

export function resolveAskCardPresentation(input: {
  interaction: PendingInteraction;
  action: AskActionState | undefined;
  nodeStatus: WorkflowNodeState['status'] | undefined;
  nodeError: string | undefined;
}): AskCardPresentation;
```

`rejected-late` remains visible even after refetch finds the winning canonical answer.
Canonical `interaction.answer` takes precedence over a local accepted answer for summaries.
An accepted local answer remains visible until GET refetch catches up.
`failed-resume` is selected only when an effective accepted or canonical answer exists, node status is `failed`, and node error starts with `Could not resume the AskHuman session`.
An unrelated node failure after an answered Ask remains `answered` or `declined`.
Malformed canonical answers produce inline error `Malformed canonical answer` while retaining the honest answered state.

```ts
export function countPendingAsks(pending: readonly PendingInteraction[]): number;
export function isAskAwaitingRun(
  status: Run['status'],
  pending: readonly PendingInteraction[]
): boolean;
export function firstAwaitingNodeId(nodes: readonly WorkflowNodeState[]): string | null;
export function isAskHumanUnsupportedError(error: string | null | undefined): boolean;
export function nodeStatusLabel(status: WorkflowNodeState['status'] | string): string;
```

Run awaiting is exactly `status === 'paused'` with at least one pending Ask.
Permission rows, answered rows, purged rows, and declared-gate pauses do not contribute to the count.
The node label for `awaiting` is exactly `waiting on you`.
CAP-7 matching is a prefix check for `AskHuman is not supported by provider`.

### Inspect status policy

Replace `packages/web/src/experiments/console/components/inspect/inspect-status.ts` with this exact policy.

```ts
export type InspectStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'awaiting';

export function inspectStatus(value: string): InspectStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'awaiting'
  ) {
    return value;
  }
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'waiting on you' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}

export function isInspectLiveNode(status: string): boolean {
  const mapped = inspectStatus(status);
  return mapped === 'running' || mapped === 'awaiting';
}
```

`resolveInitialInspectSelection` precedence is exact: valid `?node=` wins, else the first `awaiting` node, else the first `running` node, else declared approval, else the first log row, else none.
Do not treat awaiting as running.

`NodeDivider` status union adds `'awaiting'`.
Its label for awaiting is `waiting on you`.
Its color class is `text-warning`.
`RunGraphPanel` `InspectCardStatus` adds `'awaiting'` with warning fill, warning border, warning glyph class, visible `waiting on you`, optional pulse, and `motion-reduce:animate-none`.
`build-run-graph-input` passes `awaiting` through to `@/lib/run-graph` so taken-path stays on.

### Console Ask card

Create `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`.
Do not import shadcn or `@/components/ui/*`.
Use native `form`, `fieldset`, `legend`, `input type="radio"`, `input type="checkbox"`, `textarea`, `button`, and `dialog`.

```ts
export interface ConsoleAskCardProps {
  interaction: PendingInteraction;
  questions: readonly AskQuestion[];
  presentation: AskCardPresentation;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  agentDisplayName: string;
  nodeId: string;
  autoFocus: boolean;
  nowMs: number;
  onSubmit: (body: Extract<AskAnswerBody, { answers: unknown }>) => void;
  onDecline: () => void;
}

export function ConsoleAskCard(props: ConsoleAskCardProps): React.ReactElement;

export function ConsoleInvalidAskCard(props: {
  interaction: PendingInteraction;
  agentDisplayName: string;
  nodeId: string;
}): React.ReactElement;
```

Copy the Story 6.5 interaction model and copy exactly.

- Root form `aria-label` is `question from agent, N questions`.
- Warning border and elevated surface classes are `border-warning bg-surface-elevated`.
- Header is `${agentDisplayName} is asking`.
- Meta row shows `nodeId` plus elapsed waiting time from `interaction.created_at` and `nowMs` using console `formatDurationMs`.
- Each question is a fieldset whose legend is the prompt.
- Keep Other-selected flags and Other text in separate component state.
- Project an empty-string sentinel into the draft while selected Other text is empty.
- Other text input is labelled `Other answer for ${question.prompt}` with `aria-required="true"` while selected.
- Only the first actionable card receives `autoFocus: true` and focuses its first choice.
- Starter pending cards render Submit and Decline.
- Non-starter pending cards render disabled answer controls, omit both action buttons, and show `Waiting for ${starterDisplayName ?? 'the run starter'} to answer`.
- Decline opens a native `dialog` with title `Decline this ask?`, description `The agent will be told you declined`, Cancel, and Decline.
- Sending disables the form and shows `Sending…`.
- Any non-pending presentation disables answer controls and omits Submit and Decline.
- The form handler always prevents browser navigation and calls `onSubmit` only when the starter's current draft is valid.
- Answered shows a question-labelled summary and `Answered · by you` only for the current starter, while a teammate sees `Answered` without `by you`.
- Declined shows `Declined`.
- Rejected-late shows `Already answered`.
- Failed resume shows `Resume failed — node failed; your answer is preserved below` with error text only on that stamp.
- An ordinary non-409 mutation error leaves the card pending, re-enables starter actions, and renders the error inline.
- Resolved stamps include a semantic `<time dateTime={presentation.resolvedAt}>` when the timestamp exists.
- Every state retains a `View payload` details disclosure with pretty-printed envelope JSON.
- `ConsoleInvalidAskCard` is a non-interactive `role="alert"` surface with `Invalid Ask payload`, node identity, and the same raw-payload disclosure.

Add this helper to `packages/web/src/experiments/console/lib/format.ts`.

```ts
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

### Run chrome

Create `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx`.

```ts
export interface ConsoleAskChromeProps {
  status: Run['status'];
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeState[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string) => void;
  onRequestGraphView: () => void;
}

export function ConsoleAskChrome(props: ConsoleAskChromeProps): React.ReactElement | null;
```

Failed plus a matching CAP-7 message renders an error banner with `role="alert"`, `border-error bg-error/10 text-error`, the full persisted message, and no awaiting pill.
Paused plus pending Ask renders a button with `aria-live="polite"`, warning tokens, and `Awaiting input (${count})`.
Clicking it first calls `onRequestGraphView` and then `onSelectAwaitingNode` with the first awaiting node.
The click is a no-op when no projected awaiting node exists.

Run-detail header paused copy is `Awaiting input` when `isAskAwaitingRun` is true.
Otherwise keep the existing `statusLabel` map, including `Waiting for approval` for declared-gate pauses.
Do not change `lib/run-status.ts` globally.

### Room composition

Extend `AgentTranscript` with generic slots and no interaction-specific types.

```ts
renderAfterMessage?: (message: WorkflowNodeMessage) => React.ReactNode;
renderAtEnd?: React.ReactNode;
```

Render `renderAfterMessage(message)` immediately after that message.
Render `renderAtEnd` after the selected transcript slice.
When the selected slice is empty and `renderAtEnd` is present, render the end content instead of `Node hasn't produced output`.
Loading continues to suppress both slots.
The error state renders its retry UI followed by `renderAtEnd`.

`ConsoleNodeRoom` receives these additional props, all optional with empty defaults so existing inspect tests compile until Task 9 wires them.

```ts
pendingInteractions?: readonly PendingInteraction[];
viewerIsStarter?: boolean;
starterDisplayName?: string | null;
actionStates?: AskActionStateByRequest;
onSubmitAsk?: (requestId: string, body: AskAnswerBody) => Promise<void>;
```

Only `resolution.kind === 'agent'` uses those props.
Compose cards with `selectNodeRoomMessages`, `selectVisibleNodeAskInteractions`, and the same first-actionable-id rule as `NodeTranscriptPane.tsx:106`.
`agentDisplayName` is `row?.label ?? ''`.
`nowMs` is `Date.now()`.
Do not pass Ask props into stdout, gate, workflow, route, or loop-group bodies.
Do not import or render `ChatComposer` in the room.

### Page ownership

`RunDetailPage` owns `AskActionStateByRequest` and one `createAskAnswerController` per `run.id`.
Reset local action state when `runId` changes.
Controller `invalidate` must `invalidate(K.run(runId))` and, when a node id is selected, `invalidate(K.nodeMessages(runId, nodeId))`.
Pass Ask fields from `detail` into `ConsoleInspectPane`.
Render `ConsoleAskChrome` under `RunDetailHeader`.
`onRequestGraphView` writes view `'graph'`.
`onSelectAwaitingNode` calls the existing `onInspectSelect`.
Tighten keymap `a` / `r` `when` to `isPaused && run.approval != null`.
Do not pass pending interactions into `ChatComposer`, `ChatPage`, or `RunActionBar`.

### Isolation rewrite

Keep the NFR4 import scan.
Replace the premature-HITL identifier scan with these exact rules.

- Inspect and room production files must not import `ChatComposer` or any `@/components/workflows/` module.
- Inspect and room production files may contain `pendingInteractions`, `ConsoleAskCard`, `waiting on you`, and `awaiting`.
- `ChatComposer.tsx` and `ChatPage.tsx` production source must not contain `pendingInteractions`, `answerAskHuman`, `ConsoleAskCard`, or `Waiting for`.

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/web/src/experiments/console/skills/runs.ts` | Modify | Keep GET-run Ask fields and wrap the answer POST |
| `packages/web/src/experiments/console/skills/runs.node-messages.test.ts` | Modify | Prove GET-run Ask field retention |
| `packages/web/src/experiments/console/skills/runs.ask.test.ts` | Create | Prove encoded answer POST and 409 `HttpError` |
| `packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts` | Create | Parse questions, answers, draft validity, and request body |
| `packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts` | Create | Prove parser and validity matrices |
| `packages/web/src/experiments/console/components/ask/merge-agent-room-items.ts` | Create | Select loop-safe Ask rows and interleave them with transcript messages |
| `packages/web/src/experiments/console/components/ask/merge-agent-room-items.test.ts` | Create | Prove selected-node, loop-slice, anchor, and fallback behavior |
| `packages/web/src/experiments/console/components/ask/ask-answer-controller.ts` | Create | Own independent mutation lifecycle and duplicate suppression |
| `packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts` | Create | Prove success, concurrency, 409, and error behavior |
| `packages/web/src/experiments/console/components/ask/ask-card-presentation.ts` | Create | Derive canonical and optimistic card presentation |
| `packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts` | Create | Prove state matrix and exact resume-failure classification |
| `packages/web/src/experiments/console/components/ask/awaiting-chrome.ts` | Create | Derive pending count, navigation target, labels, and CAP-7 match |
| `packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts` | Create | Prove exact run and node chrome decisions |
| `packages/web/src/experiments/console/components/inspect/inspect-status.ts` | Modify | Pass awaiting through with `waiting on you` |
| `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts` | Modify | Invert the Story 5.5 awaiting-as-running assertions |
| `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts` | Modify | Prefer first awaiting node after `?node=` |
| `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts` | Modify | Prove awaiting-over-running precedence |
| `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts` | Modify | Expect awaiting display status |
| `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts` | Modify | Expect awaiting nodeState on-path |
| `packages/web/src/experiments/console/components/NodeDivider.tsx` | Modify | Warning awaiting log chrome |
| `packages/web/src/experiments/console/components/NodeDivider.test.tsx` | Modify | Prove warning label and class |
| `packages/web/src/experiments/console/components/RunGraphPanel.tsx` | Modify | Warning awaiting graph chrome |
| `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx` | Modify | Prove `waiting on you` and warning tokens |
| `packages/web/src/experiments/console/lib/format.ts` | Modify | Add `formatDurationMs` |
| `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx` | Create | Console-owned accessible Ask card |
| `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx` | Create | Prove form semantics, copy, focus, actions, summaries, and errors |
| `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx` | Create | Run-level awaiting pill or CAP-7 banner |
| `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx` | Create | Prove run-chrome rendering and navigation callback |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` | Modify | Slot Ask cards into the agent transcript |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | Modify | Replace no-HITL assertions with Ask placement coverage |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` | Modify | Thread Ask props through the persistent room |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` | Modify | Prove Log and Graph doors share one Ask-capable room |
| `packages/web/src/experiments/console/components/RunDetailHeader.tsx` | Modify | Show `Awaiting input` instead of approval copy for Ask pauses |
| `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx` | Modify | Prove Ask versus declared-gate header copy |
| `packages/web/src/experiments/console/routes/RunDetailPage.tsx` | Modify | Own the controller, chrome, keymap gate, and pane props |
| `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` | Modify | Prove composer isolation, keymap, and chrome wiring |
| `packages/web/src/experiments/console/console-isolation.test.ts` | Modify | Keep NFR4 and allow console Ask chrome |
| `packages/web/src/experiments/console/README.md` | Modify | Replace the Epic 6 handoff paragraph |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | Modify last | Mark Story 6.6 and Epic 6 done after validation |

Do not modify `packages/web/src/components/workflows/**`, `packages/web/src/lib/api.ts`, `packages/web/src/lib/run-graph/**`, engine packages, provider packages, migrations, `ChatComposer.tsx` production behavior, or `PendingInputBanner.tsx`.

## TDD Execution Rule

Each numbered RED/GREEN cycle below is atomic.
Add only the named test, run the exact command until it fails for the stated missing behavior rather than an import, syntax, fixture, or environment error, implement only enough production code for that test, rerun to PASS with pristine output, and only then begin the next cycle.
Sprint YAML is the only test-first exception because it is tracking configuration.

Component suites that import `react-dom/client` must set `process.env.NODE_ENV = 'development'` as the first statement, matching `ConsoleInspectPane.test.tsx:1`.

---

## Tasks

### Task 1: Extend the typed console Ask data boundary

**Files:**

- Modify: `packages/web/src/experiments/console/skills/runs.ts`
- Modify: `packages/web/src/experiments/console/skills/runs.node-messages.test.ts`
- Create: `packages/web/src/experiments/console/skills/runs.ask.test.ts`

**Interfaces:**

- Consumes: generated `WorkflowRunDetail`, `PendingInteraction`, `AskAnswerBody`, `WorkflowRunActionResponse`, and `requestJson`.
- Produces: `ConsoleRunDetail.pendingInteractions`, `viewerIsStarter`, `starterDisplayName`, `runError`, and `answerAskHuman`.

- [ ] **Step 1: Write the failing GET-run Ask-field test.**

Add this test to `runs.node-messages.test.ts` inside `describe('getRun inspect boundary')`.

```ts
test('keeps pending interactions, viewer presentation, and string metadata error', async () => {
  const pending: components['schemas']['PendingInteraction'] = {
    id: 'pi-1',
    workflow_run_id: 'run/1',
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [{ id: 'q1', prompt: 'Ship?', selection: 'single', options: ['yes'], allowOther: false }] },
    answer: null,
    provider_session_id: 'sess-1',
    created_at: '2026-09-07T00:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };
  stubFetch(() =>
    jsonResponse({
      run: { ...detailRun('run/1'), user_id: 'user-1', metadata: { error: 'AskHuman is not supported by provider: grok' } },
      events: [],
      nodeStates: [],
      pending_interactions: [pending],
      usage: null,
      viewer_is_starter: true,
      starter_display_name: 'Avery',
    } satisfies RunDetailResponse)
  );
  const result = await getRun('run/1');
  expect(result.pendingInteractions).toEqual([pending]);
  expect(result.viewerIsStarter).toBe(true);
  expect(result.starterDisplayName).toBe('Avery');
  expect(result.runError).toBe('AskHuman is not supported by provider: grok');
});
```

- [ ] **Step 2: Run the GET-run Ask-field test and verify RED.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts --test-name-pattern "keeps pending interactions"`.
Expected failure: `pendingInteractions` is missing on the result.

- [ ] **Step 3: Implement the ConsoleRunDetail fields in `getRun`.**

Use the locked mapping.
Keep existing `toRun` / `rawEvents` / `approval` behavior.
Treat a non-string `metadata.error` as `null`.

- [ ] **Step 4: Rerun the GET-run Ask-field test and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts --test-name-pattern "keeps pending interactions"`.
Expected result: PASS.

- [ ] **Step 5: Write the failing answer POST tests.**

Create `runs.ask.test.ts` using the same `spyOn(globalThis, 'fetch')` pattern as `runs.node-messages.test.ts`.

```ts
test('answerAskHuman posts an encoded URL and JSON body', async () => {
  stubFetch(url => {
    expect(url).toBe('/api/workflows/runs/run%2F1/ask/toolu%20a/answer');
    return jsonResponse({ success: true, message: 'ok' });
  });
  const result = await answerAskHuman('run/1', 'toolu a', { decline: true });
  expect(result).toEqual({ success: true, message: 'ok' });
  const init = fetchSpy?.mock.calls[0]?.[1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(init.body).toBe(JSON.stringify({ decline: true }));
});

test('answerAskHuman rejects a 409 as HttpError with status 409', async () => {
  ensureWindow();
  stubFetch(() => new Response('taken', { status: 409 }));
  try {
    await answerAskHuman('run/1', 'toolu_1', { answers: [{ questionId: 'q1', value: 'yes' }] });
    throw new Error('expected reject');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
  }
});
```

- [ ] **Step 6: Run the answer POST tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.ask.test.ts`.
Expected failure: `answerAskHuman` is not exported.

- [ ] **Step 7: Add `answerAskHuman` with the locked URL and JSON POST.**

- [ ] **Step 8: Rerun both skill files and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/runs.ask.test.ts`.
Expected result: PASS.

- [ ] **Step 9: Format and commit Task 1.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/skills/runs.ts src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/runs.ask.test.ts
git add packages/web/src/experiments/console/skills/runs.ts packages/web/src/experiments/console/skills/runs.node-messages.test.ts packages/web/src/experiments/console/skills/runs.ask.test.ts
git commit -m "feat(web): expose console Ask run fields and answer POST"
```

### Task 2: Duplicate the Ask envelope parser

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts`
- Create: `packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts`

**Interfaces:**

- Consumes: `AskAnswerBody` from `../../skills/runs`.
- Produces: `AskQuestion`, `AskDraft`, `parseAskEnvelope`, `parseAskAnswer`, `isQuestionValid`, `isAskDraftValid`, `draftToAnswerBody`.

- [ ] **Step 1: Write the failing parser suite.**

Port the tables from `packages/web/src/components/workflows/parse-ask-envelope.test.ts` into the console file, importing from `./parse-ask-envelope`.
Required cases: empty questions, duplicate ids, invalid selection, missing allowOther, single listed option, single Other with trim, empty Other, multi empty array, multi listed plus Other, `draftToAnswerBody` order, `{ decline: true }`, answers array, extra keys rejected.

- [ ] **Step 2: Run the parser tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Copy `packages/web/src/components/workflows/parse-ask-envelope.ts` into the console path and change only the `AskAnswerBody` import to `../../skills/runs`.**

- [ ] **Step 4: Rerun the parser tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 2.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ask/parse-ask-envelope.ts src/experiments/console/components/ask/parse-ask-envelope.test.ts
git add packages/web/src/experiments/console/components/ask/parse-ask-envelope.ts packages/web/src/experiments/console/components/ask/parse-ask-envelope.test.ts
git commit -m "feat(web): parse console Ask envelopes without legacy imports"
```

### Task 3: Duplicate loop-safe Ask placement

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/merge-agent-room-items.ts`
- Create: `packages/web/src/experiments/console/components/ask/merge-agent-room-items.test.ts`

**Interfaces:**

- Consumes: `PendingInteraction` and `WorkflowNodeMessage` from `../../skills/runs`.
- Produces: `AgentRoomItem`, `selectVisibleNodeAskInteractions`, `mergeAgentRoomItems`.

- [ ] **Step 1: Write the failing merge suite.**

Port the cases from `packages/web/src/components/workflows/merge-agent-room-items.test.ts` using `WorkflowNodeMessage` instead of `WorkflowNodeMessageResponse`.
Required cases: other node excluded, permission excluded, purged excluded, GET order preserved, anchored Ask hidden in another loop slice, unanchored Ask shown only at transcript tail, merge inserts after matching tool id, unanchored Ask appended, item id `ask:${interaction.id}`.

- [ ] **Step 2: Run the merge tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/merge-agent-room-items.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Copy the legacy merge module, switching types to `WorkflowNodeMessage`.**

- [ ] **Step 4: Rerun the merge tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/merge-agent-room-items.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 3.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ask/merge-agent-room-items.ts src/experiments/console/components/ask/merge-agent-room-items.test.ts
git add packages/web/src/experiments/console/components/ask/merge-agent-room-items.ts packages/web/src/experiments/console/components/ask/merge-agent-room-items.test.ts
git commit -m "feat(web): merge console Ask cards into agent transcripts"
```

### Task 4: Duplicate mutation controller and presentation

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/ask-answer-controller.ts`
- Create: `packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts`
- Create: `packages/web/src/experiments/console/components/ask/ask-card-presentation.ts`
- Create: `packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts`

**Interfaces:**

- Consumes: `AskAnswerBody`, `WorkflowRunActionResponse`, `PendingInteraction`, `WorkflowNodeState`, and `HttpError`.
- Produces: `createAskAnswerController` and `resolveAskCardPresentation`.

- [ ] **Step 1: Write the failing controller suite.**

Port `packages/web/src/components/workflows/ask-answer-controller.test.ts`.
Use `new HttpError(409, '/ask', 'taken')` for the late-answer case instead of a generic status object.
Required cases: duplicate in-flight submit posts once, two request ids post concurrently, success emits accepted then invalidate, 409 emits rejected-late then invalidate, other errors emit `Failed to answer.` or the thrown message without invalidate, invalidate failure warns and keeps accepted state.

- [ ] **Step 2: Run the controller tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-answer-controller.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Copy the legacy controller and replace `getApiErrorStatus(error) === 409` with `error instanceof HttpError && error.status === 409`.**

- [ ] **Step 4: Rerun the controller tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-answer-controller.test.ts`.
Expected result: PASS.

- [ ] **Step 5: Write the failing presentation suite.**

Port `packages/web/src/components/workflows/ask-card-presentation.test.ts` onto console types.
Required cases: sending, accepted local answer, canonical answer wins summary, rejected-late survives canonical answer, malformed canonical answer, failed-resume prefix, unrelated node failure stays answered, pending error keeps pending.

- [ ] **Step 6: Run the presentation tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-card-presentation.test.ts`.
Expected failure: module not found.

- [ ] **Step 7: Copy the legacy presentation module, switching `WorkflowNodeStateResponse` to `WorkflowNodeState`.**

- [ ] **Step 8: Rerun controller and presentation tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ask-answer-controller.test.ts src/experiments/console/components/ask/ask-card-presentation.test.ts`.
Expected result: PASS.

- [ ] **Step 9: Format and commit Task 4.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ask/ask-answer-controller.ts src/experiments/console/components/ask/ask-answer-controller.test.ts src/experiments/console/components/ask/ask-card-presentation.ts src/experiments/console/components/ask/ask-card-presentation.test.ts
git add packages/web/src/experiments/console/components/ask/ask-answer-controller.ts packages/web/src/experiments/console/components/ask/ask-answer-controller.test.ts packages/web/src/experiments/console/components/ask/ask-card-presentation.ts packages/web/src/experiments/console/components/ask/ask-card-presentation.test.ts
git commit -m "feat(web): derive console Ask mutation and card presentation"
```

### Task 5: Promote awaiting inspect chrome

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/awaiting-chrome.ts`
- Create: `packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/inspect-status.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/inspect-status.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts`
- Modify: `packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts`
- Modify: `packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts`
- Modify: `packages/web/src/experiments/console/components/NodeDivider.tsx`
- Modify: `packages/web/src/experiments/console/components/NodeDivider.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.tsx`
- Modify: `packages/web/src/experiments/console/components/RunGraphPanel.test.tsx`

**Interfaces:**

- Consumes: `InspectStatus`, `WorkflowNodeState`, `PendingInteraction`, `Run['status']`.
- Produces: awaiting as a first-class inspect status with warning copy.

- [ ] **Step 1: Write the failing awaiting-chrome suite.**

Port `packages/web/src/components/workflows/awaiting-chrome.test.ts` onto console types.
Required cases: pending ask count ignores permission/answered/purged, `isAskAwaitingRun` requires paused plus count>0, `firstAwaitingNodeId` returns the first projector `awaiting` node, CAP-7 prefix match, `nodeStatusLabel('awaiting') === 'waiting on you'`.

- [ ] **Step 2: Run awaiting-chrome tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/awaiting-chrome.test.ts`.
Expected failure: module not found.

- [ ] **Step 3: Copy the legacy awaiting-chrome module onto console `Run` / `WorkflowNodeState` types.**

- [ ] **Step 4: Invert inspect-status tests to the locked policy.**

Replace `maps typed awaiting to running` with these assertions.

```ts
test('passes typed awaiting through', () => {
  expect(inspectStatus('awaiting')).toBe('awaiting');
});

test('labels typed awaiting as waiting on you', () => {
  expect(inspectStatusLabel('awaiting')).toBe('waiting on you');
});

test('treats running and awaiting as live nodes', () => {
  expect(isInspectLiveNode('running')).toBe(true);
  expect(isInspectLiveNode('awaiting')).toBe(true);
  expect(isInspectLiveNode('pending')).toBe(false);
});
```

Keep `isInspectRunLive` covering only `running` and `paused`.

- [ ] **Step 5: Run inspect-status tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/inspect/inspect-status.test.ts`.
Expected failure: `inspectStatus('awaiting')` is `'running'`.

- [ ] **Step 6: Implement the locked `inspect-status.ts`.**

- [ ] **Step 7: Update selection, log, graph-input, divider, and graph-panel tests and production code together.**

Change `resolveInitialInspectSelection` so the first awaiting node wins over a later running node.
Rename the invalid-query test to `an invalid query falls back to the first awaiting node` and keep selecting `review` in the existing fixture.
Add one new test where `review` is `running` and `ship` is `awaiting` and the selection is `ship`.
Change `build-console-log-entries.test.ts` `maps awaiting node status to running display status` to expect `displayStatus === 'awaiting'`.
Change `build-run-graph-input.test.ts` `normalizes awaiting to running before layout` to `passes awaiting through to layout as on-path` with `nodeState === 'awaiting'` and `incoming?.taken === true`.
Add `'awaiting'` to `NodeDivider` status maps with label `waiting on you` and class `text-warning`.
Add `'awaiting'` to `RunGraphPanel` `cardStatus`, warning fill/border/glyph, visible `waiting on you`, and replace `expect(text).not.toContain('awaiting')` with `expect(text).toContain('waiting on you')`.

- [ ] **Step 8: Run the Task 5 suites and verify GREEN.**

```bash
cd packages/web
bun test src/experiments/console/components/ask/awaiting-chrome.test.ts src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx
```

Expected result: PASS.

- [ ] **Step 9: Format and commit Task 5.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ask/awaiting-chrome.ts src/experiments/console/components/ask/awaiting-chrome.test.ts src/experiments/console/components/inspect/inspect-status.ts src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts src/experiments/console/components/NodeDivider.tsx src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.tsx src/experiments/console/components/RunGraphPanel.test.tsx
git add packages/web/src/experiments/console/components/ask/awaiting-chrome.ts packages/web/src/experiments/console/components/ask/awaiting-chrome.test.ts packages/web/src/experiments/console/components/inspect/inspect-status.ts packages/web/src/experiments/console/components/inspect/inspect-status.test.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.ts packages/web/src/experiments/console/components/inspect/console-inspect-selection.test.ts packages/web/src/experiments/console/components/inspect/build-console-log-entries.test.ts packages/web/src/experiments/console/components/graph/build-run-graph-input.test.ts packages/web/src/experiments/console/components/NodeDivider.tsx packages/web/src/experiments/console/components/NodeDivider.test.tsx packages/web/src/experiments/console/components/RunGraphPanel.tsx packages/web/src/experiments/console/components/RunGraphPanel.test.tsx
git commit -m "feat(web): show console awaiting chrome as waiting on you"
```

### Task 6: Build the console Ask card

**Files:**

- Modify: `packages/web/src/experiments/console/lib/format.ts`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx`

**Interfaces:**

- Consumes: `ConsoleAskCardProps`, parser, presentation, `formatDurationMs`.
- Produces: `ConsoleAskCard` and `ConsoleInvalidAskCard`.

- [ ] **Step 1: Write the failing card suite.**

Set `process.env.NODE_ENV = 'development'` first.
Use `installHappyDom` and `createRoot` like `ConsoleNodeRoom.test.tsx`.
Port the behavioral cases from `packages/web/src/components/workflows/AskCard.test.tsx` onto `ConsoleAskCard`.
Required assertions: `aria-label="question from agent, 2 questions"`, header `Claude is asking`, Submit disabled until valid, Other requires non-empty text, teammate copy `Waiting for Avery to answer` with no Submit/Decline, starter Submit/Decline present, decline dialog description `The agent will be told you declined`, sending shows `Sending…`, answered `Answered · by you`, teammate answered omits `by you`, declined `Declined`, rejected-late `Already answered`, failed-resume stamp, invalid card `Invalid Ask payload` with `role="alert"` and no Submit, `View payload` disclosure present.

- [ ] **Step 2: Run the card tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskCard.test.tsx`.
Expected failure: module not found.

- [ ] **Step 3: Add `formatDurationMs` to console `lib/format.ts` with the locked body.**

- [ ] **Step 4: Implement `ConsoleAskCard` and `ConsoleInvalidAskCard` with native HTML and the locked copy.**

Replicate the Story 6.5 state machine, including separate Other-selected flags.
Use `<dialog>` instead of shadcn `AlertDialog`.
Do not import `@/components/ui/*`.

- [ ] **Step 5: Rerun the card tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskCard.test.tsx`.
Expected result: PASS.

- [ ] **Step 6: Format and commit Task 6.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/lib/format.ts src/experiments/console/components/ask/ConsoleAskCard.tsx src/experiments/console/components/ask/ConsoleAskCard.test.tsx
git add packages/web/src/experiments/console/lib/format.ts packages/web/src/experiments/console/components/ask/ConsoleAskCard.tsx packages/web/src/experiments/console/components/ask/ConsoleAskCard.test.tsx
git commit -m "feat(web): render console-owned Ask cards"
```

### Task 7: Build the console run Ask chrome

**Files:**

- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx`
- Create: `packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`

**Interfaces:**

- Consumes: `ConsoleAskChromeProps` and awaiting-chrome helpers.
- Produces: the run-level pill and CAP-7 banner.

- [ ] **Step 1: Write the failing chrome suite.**

Port `packages/web/src/components/workflows/WorkflowAskChrome.test.tsx` onto `ConsoleAskChrome`.
Required cases: paused plus two pending asks renders `Awaiting input (2)` and `aria-live="polite"`, click calls graph then first awaiting node, click with no awaiting node is a no-op, CAP-7 failed run renders the full error with `role="alert"` and `text-error` and no `Awaiting input`, declared-gate pause with empty pending renders null.

- [ ] **Step 2: Run the chrome tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`.
Expected failure: module not found.

- [ ] **Step 3: Implement `ConsoleAskChrome` with the locked markup and callbacks.**

- [ ] **Step 4: Rerun the chrome tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ask/ConsoleAskChrome.test.tsx`.
Expected result: PASS.

- [ ] **Step 5: Format and commit Task 7.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ask/ConsoleAskChrome.tsx src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
git add packages/web/src/experiments/console/components/ask/ConsoleAskChrome.tsx packages/web/src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
git commit -m "feat(web): add console Ask awaiting pill and CAP-7 banner"
```

### Task 8: Place Ask cards in the Command Center agent room

**Files:**

- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx`

**Interfaces:**

- Consumes: optional Ask props, `selectNodeRoomMessages`, `selectVisibleNodeAskInteractions`, `ConsoleAskCard`.
- Produces: cards inline at tool invocation in the persistent room.

- [ ] **Step 1: Write the failing room placement tests.**

Remove `assertNoEpicSix`.
Replace it with `assertNoConversationComposer(host)` that forbids `ChatComposer` and `Reply…`.
Keep existing transcript, polling, and room-kind coverage.
Add these cases.

1. A pending Ask whose `tool_use_id` matches a visible tool row renders `ConsoleAskCard` immediately after that tool and not in a composer.
2. Two pending asks on one node render two independent cards.
3. A loop-iteration room hides an Ask anchored in another iteration.
4. An unanchored current Ask appears at the end when the visible slice reaches the transcript tail, including when the transcript is empty.
5. A permission row never renders a card.
6. Stdout and gate rooms ignore pending interactions.
7. A malformed envelope renders `Invalid Ask payload` without Submit.
8. Teammate pending cards show `Waiting for Avery to answer` and no Submit/Decline.
9. Transcript fetch error still renders `renderAtEnd` cards after Retry.
10. Header status for `selectedRow.status === 'awaiting'` is `waiting on you`.
11. Existing loop-iteration fixture no longer expects the header to say `running` solely because the row is awaiting.

- [ ] **Step 2: Run ConsoleNodeRoom tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx`.
Expected failure: Ask cards are absent or header still says `running`.

- [ ] **Step 3: Implement generic transcript slots and agent-only Ask composition in `ConsoleNodeRoom`.**

Follow the locked room-composition rules and the `NodeTranscriptPane.tsx:80-191` first-actionable and renderAfterMessage/renderAtEnd split.
Thread the optional Ask props through `ConsoleInspectPane` into `ConsoleNodeRoom` with empty defaults.

- [ ] **Step 4: Extend `ConsoleInspectPane.test.tsx` so switching Log to Graph does not remount the room and the Ask card remains.**

- [ ] **Step 5: Rerun room and pane tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx`.
Expected result: PASS.

- [ ] **Step 6: Format and commit Task 8.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/components/ConsoleNodeRoom.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx
git add packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.tsx packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx
git commit -m "feat(web): place Ask cards in the console agent room"
```

### Task 9: Wire run-detail ownership, chrome, and composer isolation

**Files:**

- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`

**Interfaces:**

- Consumes: `ConsoleRunDetail` Ask fields, `createAskAnswerController`, `answerAskHuman`, `ConsoleAskChrome`.
- Produces: page-owned mutation, header chrome, graph jump, gate-only keymap.

- [ ] **Step 1: Write the failing header copy test.**

When `run.status === 'paused'` and the caller passes `askAwaiting`, the header shows `Awaiting input` and does not show `Waiting for approval`.
When paused without ask awaiting, keep `Waiting for approval`.

- [ ] **Step 2: Run header tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/components/RunDetailHeader.test.tsx --test-name-pattern "Awaiting input"`.
Expected failure: copy still `Waiting for approval`.

- [ ] **Step 3: Add an optional `askAwaiting?: boolean` prop to `RunDetailHeader` and use the locked paused copy.**

- [ ] **Step 4: Write failing RunDetailPage tests.**

Required cases: `ConsoleAskChrome` receives GET-run pending interactions; clicking `Awaiting input (n)` sets view to graph and selects the first awaiting node; CAP-7 banner uses the mapped `runError`; `createAskAnswerController` is constructed with `answerAskHuman` and invalidates `K.run`; action state resets when `runId` changes; `a`/`r` keymap `when` is false for an Ask pause with `approval == null`; Chat composer is not rendered on the run detail page; declared-gate footer still renders when `run.approval` exists and pending asks are empty.

- [ ] **Step 5: Run RunDetailPage tests and verify RED.**

Run `cd packages/web && bun test src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected failure: Ask chrome and controller are unwired.

- [ ] **Step 6: Implement page wiring with the locked ownership rules.**

Pass `pendingInteractions`, `viewerIsStarter`, `starterDisplayName`, `actionStates`, and `onSubmitAsk` into `ConsoleInspectPane`.
Render `ConsoleAskChrome` under the header.
Do not add Ask props to `ChatComposer` or `RunActionBar`.

- [ ] **Step 7: Rerun header and page tests and verify GREEN.**

Run `cd packages/web && bun test src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx`.
Expected result: PASS.

- [ ] **Step 8: Format and commit Task 9.**

```bash
cd packages/web && bun x prettier --write src/experiments/console/routes/RunDetailPage.tsx src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/components/RunDetailHeader.tsx src/experiments/console/components/RunDetailHeader.test.tsx
git add packages/web/src/experiments/console/routes/RunDetailPage.tsx packages/web/src/experiments/console/routes/RunDetailPage.test.tsx packages/web/src/experiments/console/components/RunDetailHeader.tsx packages/web/src/experiments/console/components/RunDetailHeader.test.tsx
git commit -m "feat(web): wire console run-detail Ask ownership"
```

### Task 10: Isolation, docs, validate, and close tracking

**Files:**

- Modify: `packages/web/src/experiments/console/console-isolation.test.ts`
- Modify: `packages/web/src/experiments/console/README.md`
- Modify last: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Interfaces:**

- Consumes: completed Tasks 1 through 9.
- Produces: NFR4 proof, README contract, sprint done.

- [ ] **Step 1: Rewrite the premature-HITL isolation test to the locked rules and add ChatPage/ChatComposer source guards.**

Keep the existing NFR4 import scan unchanged.

- [ ] **Step 2: Run isolation tests and verify RED if the README still describes awaiting as running.**

Run `cd packages/web && bun test src/experiments/console/console-isolation.test.ts`.
Expected result after the rewrite: PASS only if production files already obey the new rules from Tasks 8 and 9.

- [ ] **Step 3: Replace the README Epic 6 handoff paragraph with this exact text.**

```md
- **AskHuman.** Command Center agent rooms render structured Ask cards from GET-run `pending_interactions` at the matching tool invocation. Awaiting chrome uses warning tokens and `waiting on you` / `Awaiting input (n)`. Console still must not import production UI modules, React Query, `@/lib/api` functions, or legacy Ask React modules. `ChatComposer` on the chat page is not an Ask path.
```

- [ ] **Step 4: Run focused console Ask and inspect suites.**

```bash
cd packages/web
bun test src/experiments/console/skills/runs.node-messages.test.ts src/experiments/console/skills/runs.ask.test.ts
bun test src/experiments/console/components/ask/parse-ask-envelope.test.ts src/experiments/console/components/ask/merge-agent-room-items.test.ts src/experiments/console/components/ask/ask-answer-controller.test.ts src/experiments/console/components/ask/ask-card-presentation.test.ts src/experiments/console/components/ask/awaiting-chrome.test.ts src/experiments/console/components/ask/ConsoleAskCard.test.tsx src/experiments/console/components/ask/ConsoleAskChrome.test.tsx
bun test src/experiments/console/components/inspect/inspect-status.test.ts src/experiments/console/components/inspect/console-inspect-selection.test.ts src/experiments/console/components/inspect/build-console-log-entries.test.ts src/experiments/console/components/graph/build-run-graph-input.test.ts
bun test src/experiments/console/components/NodeDivider.test.tsx src/experiments/console/components/RunGraphPanel.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/console-isolation.test.ts
```

Expected result: every command exits 0 with no warning or unhandled rejection.

- [ ] **Step 5: Run Story 6.5 legacy Ask regressions so the console work did not import or break them.**

```bash
cd packages/web
bun test src/components/workflows/parse-ask-envelope.test.ts src/components/workflows/merge-agent-room-items.test.ts src/components/workflows/ask-answer-controller.test.ts src/components/workflows/ask-card-presentation.test.ts src/components/workflows/awaiting-chrome.test.ts src/components/workflows/AskCard.test.tsx src/components/workflows/WorkflowAskChrome.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx
```

Expected result: PASS.

- [ ] **Step 6: Run type-check, lint, formatting, and repository validation from repository root.**

```bash
bun run type-check
bun run lint
bun run format:check
bun run validate
```

Expected result: every command exits 0 with zero lint warnings.

- [ ] **Step 7: Update sprint tracking only after Steps 4 through 6 are green.**

Set both comment-form and YAML-form `last_updated` fields to the same current `+0700` timestamp because that is the file's established offset.
Set `6-6-answer-the-ask-in-the-command-center-room` from `backlog` to `done`.
Set `epic-6` from `in-progress` to `done` because 6.1 through 6.7 are then all `done`.
Leave `epic-6-retrospective: optional`.

- [ ] **Step 8: Validate the tracking file.**

Run `bun -e 'const text = await Bun.file("_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml").text(); Bun.YAML.parse(text); console.log("valid")'`.
Run `git diff --check`.

- [ ] **Step 9: Commit Task 10.**

```bash
git add packages/web/src/experiments/console/console-isolation.test.ts packages/web/src/experiments/console/README.md _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman command-center room story 6.6 done"
```

- [ ] **Step 10: Record implementation evidence.**

Record the exact commands from Steps 4 through 6 and their passing results.
Do not claim manual browser, keyboard, screen-reader, or multi-user evidence unless it was actually performed.
Do not close issue 91 directly unless the later PR workflow links it with `Closes #91`.

## Acceptance Criteria

- [ ] Opening the asking node's room on `/console` from Log or Graph shows the same envelope, states, validity, and copy as Story 6.5.
- [ ] The card appears inline at the tool invocation, not in `ChatComposer` or the run action bar.
- [ ] Cards originate only from GET-run `pending_interactions`; transcript status rows and SSE payloads never create cards.
- [ ] Submit stays disabled until every question is valid, including Other and multi-select.
- [ ] Decline is a first-class action behind exact copy `The agent will be told you declined`.
- [ ] One POST answers the whole card through `/api/workflows/runs/:runId/ask/:requestId/answer`.
- [ ] Two Ask cards on one node have independent sending, error, accepted, and duplicate states.
- [ ] A teammate or unsigned viewer sees `Waiting for <starter> to answer` and no Submit or Decline.
- [ ] Warning awaiting chrome uses `waiting on you` and `Awaiting input (n)` and never error tokens.
- [ ] Clicking the awaiting pill opens Graph and selects the first awaiting node.
- [ ] CAP-7 start rejection renders the persisted unsupported-provider message with error chrome and no awaiting pill.
- [ ] Declared-gate pauses without pending asks keep approval chrome and do not render Ask awaiting chrome.
- [ ] Console composer/Reply is not HITL, and `a`/`r` remain gate-only.
- [ ] Console production code still does not import production UI modules, React Query, `@/lib/api` functions, or legacy Ask React modules.
- [ ] Logs remain on console and the persistent room still survives Log/Graph switches.
- [ ] Permission rows are not rendered.
- [ ] Focused console tests, legacy Ask regressions, type-check, lint, formatting, and `bun run validate` all pass.
- [ ] Sprint tracking marks `6-6-answer-the-ask-in-the-command-center-room` and `epic-6` done.

## Open Questions

1. Should the duplicated parser live in a second sanctioned `@/lib` module instead of `experiments/console/components/ask/`?
Provisional default: keep the duplicate under console.
NFR4 currently names `@/lib/run-graph` as the only sanctioned runtime exception, and Story 6.6 AC forbids importing legacy Ask React while still requiring console isolation.

2. Should the runs-feed `PendingInputBanner` and global `statusLabel.paused = 'Waiting for approval'` change for Ask-paused runs?
Provisional default: no.
Story 6.6 is the Command Center room and run-detail chrome; the feed remains declared-gate language unless a later story retargets it.

3. Should decline confirmation use a custom overlay instead of native `dialog`?
Provisional default: native `dialog`.
Console cannot import shadcn `AlertDialog`, and native `dialog` preserves the exact copy and focus trap without a new primitive.

The approved Story 6.6 artifacts and current repository provide enough information for the locked defaults above.
