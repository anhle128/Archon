# Answer the Ask in the Legacy Node Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.
> Track each checkbox in order, and do not combine RED, GREEN, REFACTOR, or commit steps.

**Goal:** Let the authenticated run starter answer or decline a structured Ask card inline in the legacy agent room at the matching tool invocation, with warning awaiting chrome, teammate read-only copy, and no composer HITL.

**Architecture:** Keep `LegacyGraphLogsPane` as the single Graph, Logs, and Chat inspect shell with one `LegacyNodeRoom`.
Cards are selected from GET-run `pending_interactions` for the selected node, never from transcript `status` rows and never from the SSE buffer.
A pure merger places each Ask card immediately after the transcript `tool` row whose `payload.id` equals `tool_use_id`, or at the end of the room if that tool row is missing.
`answerAskHuman` in `@/lib/api` is the only POST client.
SSE `node_awaiting` and `interaction_resolved` remain identifier-only `workflow_status` events and must invalidate the GET-run query, including `paused`.
Awaiting chrome uses `--warning` tokens and the copy `waiting on you` / `Awaiting input (n)`.
CAP-7 start rejection uses `--error` tokens and the executor message `AskHuman is not supported by provider`.

**Tech Stack:** Bun, strict TypeScript, React 19, TanStack Query, happy-dom, react-dom/server, bun:test, existing shadcn `Button` / `Card` / `Textarea` / `AlertDialog`, and native radio/checkbox inputs.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.5, together with `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-3/4/6/7, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-design.md` Direction A and `PendingInteractionCard`, `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/app.js` `askCard`, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-3, AD-7, AD-8, AD-9.

**Issue:** https://github.com/anhle128/Archon/issues/90

## Global Constraints

- Story 6.5 implements the legacy Ask card, validity, Decline, teammate read-only copy, warning awaiting chrome, and CAP-7 error chrome only.
- Stories 5.4 and 6.3 are complete prerequisites and their characterization coverage must stay green except where this story deliberately replaces inspect-only Ask-chrome bans on the agent room and run header.
- Cards come from `pending_interactions` on GET `/api/workflows/runs/:runId`.
- SSE `node_awaiting` and `interaction_resolved` are refetch triggers and never card payloads.
- Transcript `status` rows are lifecycle notes and never Ask cards.
- One POST answers the whole card through Story 6.3: `POST /api/workflows/runs/{runId}/ask/{requestId}/answer` where `requestId` is `tool_use_id`.
- Submit stays disabled until every question is valid.
- Decline is a first-class card action with an `AlertDialog` confirm whose copy is exactly `The agent will be told you declined`.
- The Chat tab `RunChatComposer` remains a parent-conversation message path and must not read, answer, decline, or otherwise act on pending interactions.
- `@archon/web` must use generated API types from `@/lib/api` and must not import `@archon/workflows`.
- Do not import any legacy React Ask component into `packages/web/src/experiments/console/`.
- Do not add a shared React NodePanel.
- Do not render Permission cards.
- Do not implement Command Center Ask chrome.
- Do not change the engine, database schema, workflow YAML, provider resume, CLI, chat orchestrator, or `manage_run`.
- Do not add an `awaiting` run status.
- Do not write `metadata.approval` for AskHuman.
- Do not add `radio-group` or `checkbox` shadcn primitives, and do not add a package.
- All new and modified TypeScript remains strict, fully annotated, and free of `any`.
- Existing design tokens are sufficient: awaiting uses `--warning`; CAP-7 uses `--error`.
- Every production behavior follows RED, observed expected failure, minimal GREEN, explicit REFACTOR, focused GREEN, and commit.
- Run focused tests from the owning package directory.
- Never run `bun test` from the repository root.
- Do not update sprint tracking until all focused and repository validation succeeds.

## Verified Repository Baseline

- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` marks Story 5.4 done, Story 6.3 done, and Story 6.5 backlog.
- That sprint-status file currently contains two `last_updated` merge conflicts.
- Issue 90 requires the Story 6.5 acceptance criteria, focused test evidence, and the sprint-status transition before close.
- `packages/web/src/lib/api.generated.d.ts` already types `WorkflowRunDetail.pending_interactions`, `WorkflowNodeState.status` including `awaiting`, and `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`.
- `packages/web/src/lib/api.ts` already wraps `getWorkflowRun` and `getWorkflowNodeMessages` and does not wrap the Ask answer POST.
- `packages/web/src/components/workflows/WorkflowExecution.tsx` maps GET run into `WorkflowRunQueryData` and currently drops `pending_interactions`, `run.user_id`, and `metadata.error`.
- That query already polls every 3000 ms while the run is non-terminal, including `paused`.
- `isRunning` is `status === 'running' || status === 'pending'`, so `isLive` is false while an Ask pause is `paused`.
- `StatusBadge` has no `paused` or awaiting warning treatment.
- `packages/web/src/components/workflows/NodeRoom.tsx` renders `text` / `tool` / `status` only and has no Ask insertion point.
- `packages/web/src/components/workflows/NodeRoom.test.tsx` currently forbids `ask`, `waiting`, `awaiting`, and `pending-interaction` chrome.
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx` polls messages only while `isLive` is true.
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx` and `NodeRunList.tsx` color `awaiting` with accent tokens, the same as `running`.
- `packages/web/src/components/workflows/ExecutionDagNode.tsx` `STATUS_STYLES` has no `awaiting` warning treatment.
- `packages/web/src/components/workflows/StatusIcon.tsx` has no `awaiting` glyph.
- `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` `expectNoAskHumanChrome` currently forbids `AskHuman`, `awaiting`, and `waiting-on-you` on Graph and Logs.
- `packages/web/src/components/workflows/RunChatComposer.tsx` is a controlled parent-conversation composer with no pending-interaction knowledge.
- `packages/web/src/stores/workflow-store.ts` `handleWorkflowStatus` invalidates React Query only when `status === 'running'` or the status is terminal, so a `paused` SSE from `node_awaiting` does not refetch cards.
- `packages/server/src/adapters/web/workflow-bridge.ts` maps live `node_awaiting` to `{ type: 'workflow_status', status: 'paused' }` with no envelope.
- That bridge maps `interaction_resolved` to `running` when resumed and `paused` otherwise, still with no envelope.
- `packages/core/src/db/workflow-pending-interactions.ts` `listPendingInteractions` returns every status in `created_at ASC, id ASC` order.
- `packages/workflows/src/dag-executor.ts` CAP-7 throws `AskHuman is not supported by provider(s) '${list}'. Remove AskHuman from allowed_tools, or use claude or pi.` before the first turn.
- Failed-run error text lives in `metadata.error`, not a first-class `WorkflowRun.error` column.
- Better Auth `session.user.id` is not `workflow_runs.user_id`.
- `packages/web/src/components/ui/` has `button`, `card`, `textarea`, `alert-dialog`, and `badge`, and does not have `radio-group` or `checkbox`.
- `packages/web/src/index.css` already defines `--warning` and `--error`.

## Design Decisions

1. Keep Ask cards in the agent room, not in Chat timeline or the composer.
Story 5.4 and UX-DR7 already open the room from a status click.
FR3 places the card at the tool invocation inside that room.

2. Filter `pending_interactions` in the UI rather than asking the server for a second list.
GET run already embeds every row, including `answered` and `purged`.
Render `kind === 'ask'` rows for the selected `node_id`.
Ignore `kind === 'permission'` rows.

3. Key each card by `tool_use_id`.
Place the card immediately after the transcript tool row whose `payload.id` equals that id.
If no tool row matches, append the card after the last transcript item so a late transcript cannot hide a live Ask.

4. Keep `NodeRoom` inspect-only.
Add `mergeAgentRoomItems` plus `AskCard` and let `NodeTranscriptPane` compose them.
Do not teach `NodeRoom` about POST, identity, or pending rows.

5. Use native `<input type="radio">` and `<input type="checkbox">` inside `<fieldset>` / `<legend>`.
Do not add shadcn `radio-group` or `checkbox` files.
This matches the console's existing native checkbox pattern and avoids a new dependency.

6. Compute `viewer_is_starter` on GET run.
`true` only when `resolveAuthContext()?.userId` is a non-empty string equal to `run.user_id`.
Missing identity is not the starter.
Do not compare Better Auth `session.user.id` to `run.user_id`.

7. Teammate and unsigned copy is `Waiting for the run starter to answer`.
Do not add a users lookup or `starter_display_name` in this story.

8. Run chrome "awaiting input" is `status === 'paused'` AND count of `pending_interactions` with `status === 'pending'` is greater than 0.
Declared-gate pauses without pending Ask rows must not show the awaiting pill.

9. Node chrome uses projector `awaiting`.
Logs, graph, and the room header show warning tokens and the visible label `waiting on you` for that status.
Do not rebuild node lifecycle from raw events.

10. Invalidate React Query on SSE `paused` as well as `running` and terminal statuses.
Otherwise `node_awaiting` never refetches `pending_interactions` until the 3s poll.

11. Poll node messages while the run is `pending`, `running`, or `paused`.
An Ask pause must not freeze the tool row that the card anchors to.

12. CAP-7 chrome is a failed-run error banner whose message starts with `AskHuman is not supported by provider`.
It uses `text-error` / `border-error` and never warning tokens.
It is not shown while the run is paused with pending Asks.

13. Keep Chat timeline free of Ask cards, awaiting entries, and HITL forms.
Story 5.4 already omitted `node_awaiting` from the timeline, and Story 6.5 does not reopen that.

14. Multiple pending Ask rows on one node render as independent cards in `created_at ASC, id ASC` order.
Story 6.4 owns engine scheduling, not card rendering.

## Authoritative Interfaces

### Ask envelope parse and validity

Create `packages/web/src/components/workflows/parse-ask-envelope.ts` with these exact contracts.

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

export function isQuestionValid(question: AskQuestion, value: AskDraftValue | undefined): boolean;

export function isAskDraftValid(questions: readonly AskQuestion[], draft: AskDraft): boolean;

export function draftToAnswerBody(questions: readonly AskQuestion[], draft: AskDraft): {
  answers: Array<{ questionId: string; value: string | string[] }>;
};
```

Parse rules:

- Return `null` when `envelope.questions` is missing, not an array, empty, or any item fails the field checks.
- Each question requires non-empty string `id`, string `prompt`, `selection` of `'single'` or `'multi'`, `options` as an array of strings, and boolean `allowOther`.
- Duplicate question ids make the envelope invalid.
- Do not throw.

Validity rules:

- `single` is valid when `value` is a string that equals one `options` entry, or when `allowOther` is true and `value.trim()` is non-empty and `value` is not an `options` entry.
- `multi` is valid when `value` is a non-empty array of strings, every element is either an `options` entry or (`allowOther` and trimmed non-empty), and the array is not empty after considering those rules.
- `isAskDraftValid` is true only when every question is valid.
- `draftToAnswerBody` emits one item per question in envelope order and is only called when the draft is valid.

### Room item merger

Create `packages/web/src/components/workflows/merge-agent-room-items.ts` with these exact contracts.

```ts
import type { PendingInteraction, WorkflowNodeMessageResponse } from '@/lib/api';

export type AgentRoomItem =
  | { kind: 'message'; id: string; message: WorkflowNodeMessageResponse }
  | { kind: 'ask'; id: string; interaction: PendingInteraction };

export function selectNodeAskInteractions(
  pending: readonly PendingInteraction[],
  nodeId: string
): PendingInteraction[];

export function mergeAgentRoomItems(
  messages: readonly WorkflowNodeMessageResponse[],
  interactions: readonly PendingInteraction[]
): AgentRoomItem[];
```

Selection rules:

- Keep `kind === 'ask'` rows whose `node_id` equals the selected node id.
- Preserve GET-run order (`created_at ASC, id ASC`).
- Skip `permission` rows.
- Include `pending` and `answered` rows so a resolved stamp can remain in history.
- Skip `purged` rows.

Merge rules:

- Walk messages in `seq` ascending order and emit `{ kind: 'message', id: message.id, message }`.
- After a `tool` message, emit every not-yet-placed Ask whose `tool_use_id === message.payload.id`.
- After the last message, append remaining Asks in selection order.
- Ask item `id` is `ask:${tool_use_id}`.

### Ask answer client

Add these exports to `packages/web/src/lib/api.ts` immediately after `getWorkflowRun`.

```ts
export type PendingInteraction = components['schemas']['PendingInteraction'];
export type AskAnswerBody = components['schemas']['AskAnswerBody'];
export type WorkflowRunActionResponse = components['schemas']['WorkflowRunActionResponse'];

export function getApiErrorStatus(error: unknown): number | null;

export async function answerAskHuman(
  runId: string,
  requestId: string,
  body: AskAnswerBody
): Promise<WorkflowRunActionResponse>;
```

`answerAskHuman` POSTs JSON to `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer` with `Content-Type: application/json`.
`getApiErrorStatus` returns `error.status` when `error` is a non-null object with numeric `status`, otherwise `null`.

### GET run viewer flag

Update `workflowRunDetailSchema` in `packages/server/src/routes/schemas/workflow.schemas.ts` to this exact added field.

```ts
export const workflowRunDetailSchema = z
  .object({
    run: workflowRunSchema.extend({
      worker_platform_id: z.string().optional(),
      parent_platform_id: z.string().optional(),
      conversation_platform_id: z.string().nullable(),
    }),
    events: z.array(workflowEventSchema),
    nodeStates: z.array(workflowNodeStateSchema),
    pending_interactions: z.array(pendingInteractionResponseSchema),
    usage: nullableUsageReportResponseSchema,
    viewer_is_starter: z.boolean(),
  })
  .openapi('WorkflowRunDetail');
```

Handler rule in `packages/server/src/routes/api.ts` GET run:

```ts
const requester = await resolveAuthContext(c);
const viewer_is_starter =
  requester !== undefined &&
  requester.userId !== '' &&
  run.user_id !== null &&
  requester.userId === run.user_id;
```

Regenerate `packages/web/src/lib/api.generated.d.ts` with `bun --filter @archon/web generate:types` while the server is running.

### Ask card

Create `packages/web/src/components/workflows/AskCard.tsx` with this exact public contract.

```ts
import type { PendingInteraction } from '@/lib/api';

export type AskCardViewState =
  | 'pending'
  | 'sending'
  | 'answered'
  | 'declined'
  | 'rejected-late'
  | 'failed-resume';

export interface AskCardProps {
  interaction: PendingInteraction;
  questions: readonly AskQuestion[];
  viewerIsStarter: boolean;
  viewState: AskCardViewState;
  error: string | null;
  nodeId: string;
  onSubmit: (body: { answers: Array<{ questionId: string; value: string | string[] }> }) => void;
  onDecline: () => void;
}

export function AskCard(props: AskCardProps): React.ReactElement;
```

Render rules:

- Root is `<form aria-label="question from agent, N questions">` where `N` is `questions.length`.
- Elevated surface classes include `border-l-2 border-warning bg-surface-elevated`.
- Header copy for a pending starter card is exactly `The agent is asking`.
- Do not render the strings `AskHuman`, `awaiting`, or `waiting-on-you` inside the card.
- Each question is a `<fieldset>` with `<legend>` equal to `question.prompt`.
- `single` renders one radio per option plus, when `allowOther` is true, a radio labelled `Other` that reveals a text `<input aria-label="Other answer">` with `aria-required="true"` while selected.
- `multi` renders one checkbox per option plus the same Other text field when `allowOther` is true.
- Radio `name` is `ask-${tool_use_id}-${question.id}`.
- Submit is a `Button` labelled `Submit` and is `disabled` unless `viewerIsStarter`, `viewState === 'pending'`, and `isAskDraftValid`.
- Decline is an outline `Button` labelled `Decline` and is disabled unless `viewerIsStarter` and `viewState === 'pending'`.
- Decline opens existing `AlertDialog` with title `Decline this ask?`, description `The agent will be told you declined`, cancel `Cancel`, and confirm `Decline`.
- Confirming Decline calls `onDecline` and does not call `onSubmit`.
- Teammate or unsigned pending cards disable every control and show footer copy exactly `Waiting for the run starter to answer`.
- `sending` disables controls and shows `Sending…`.
- `answered` shows `Answered · by you` and a compact summary of stored answers, with no Submit or Decline.
- `declined` shows `Declined`.
- `rejected-late` shows `Already answered`.
- `failed-resume` shows `Resume failed — node failed; your answer is preserved below` with `text-error` on that stamp only.
- A `<details>` labelled `View payload` contains `JSON.stringify(interaction.envelope, null, 2)`.
- Opening a pending starter card focuses the first radio, checkbox, or Other text input.

### Awaiting chrome helpers

Create `packages/web/src/components/workflows/awaiting-chrome.ts` with these exact contracts.

```ts
import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

export function countPendingAsks(pending: readonly PendingInteraction[]): number;

export function isAskAwaitingRun(
  runStatus: WorkflowRunStatus,
  pending: readonly PendingInteraction[]
): boolean;

export function firstAwaitingNodeId(
  nodeStates: readonly WorkflowNodeStateResponse[]
): string | null;

export function isAskHumanUnsupportedError(message: string | null | undefined): boolean;

export function nodeStatusLabel(status: WorkflowNodeStateResponse['status']): string;
```

Rules:

- `countPendingAsks` counts rows with `kind === 'ask'` and `status === 'pending'`.
- `isAskAwaitingRun` is `runStatus === 'paused' && countPendingAsks(pending) > 0`.
- `firstAwaitingNodeId` returns the first `nodeStates` entry whose `status === 'awaiting'`, otherwise `null`.
- `isAskHumanUnsupportedError` is true when the message starts with `AskHuman is not supported by provider`.
- `nodeStatusLabel('awaiting')` returns `waiting on you`.
- Every other status label is the status string itself.

### Ask card view-state helper

Create `packages/web/src/components/workflows/ask-card-view-state.ts`.

```ts
import type { PendingInteraction } from '@/lib/api';
import type { WorkflowNodeStateResponse } from '@/lib/api';
import type { AskCardViewState } from './AskCard';

export function resolveAskCardViewState(input: {
  interaction: PendingInteraction;
  nodeStatus: WorkflowNodeStateResponse['status'] | undefined;
  sendingRequestId: string | null;
  rejectedLateRequestId: string | null;
}): AskCardViewState;
```

Rules:

- If `sendingRequestId === tool_use_id`, return `sending`.
- If `rejectedLateRequestId === tool_use_id`, return `rejected-late`.
- If `interaction.status === 'answered'` and `interaction.answer` is a record with `decline === true`, return `declined`.
- If `interaction.status === 'answered'` and `nodeStatus === 'failed'`, return `failed-resume`.
- If `interaction.status === 'answered'`, return `answered`.
- Otherwise return `pending`.

### Transcript polling

Replace `transcriptRefetchInterval` in `packages/web/src/components/workflows/NodeTranscriptPane.tsx` with:

```ts
import type { WorkflowRunStatus } from '@/lib/types';

export function transcriptRefetchInterval(status: WorkflowRunStatus): 1000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 1000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
}
```

### Query data

Extend `WorkflowRunQueryData` in `packages/web/src/components/workflows/WorkflowExecution.tsx` with:

```ts
pendingInteractions: PendingInteraction[];
viewerIsStarter: boolean;
runError: string | null;
```

Mapper rules:

- `pendingInteractions` is `data.pending_interactions`.
- `viewerIsStarter` is `data.viewer_is_starter`.
- `runError` is `data.run.metadata.error` when that value is a string, otherwise `null`.

### Header pill

In the WorkflowExecution header, after `StatusBadge`, render a button when `isAskAwaitingRun(status, pendingInteractions)` is true.

Exact visible label: `Awaiting input (${n})` where `n` is `countPendingAsks`.
Classes: `bg-warning/20 text-warning`.
`aria-live="polite"`.
Clicking selects `firstAwaitingNodeId(nodeStates)` through the existing `setSelectedDagNode` path and does not change `activeView`.
If there is no awaiting node id, the click is a no-op.

When `workflow.status === 'failed'` and `isAskHumanUnsupportedError(runError)`, render an error banner with classes `border-error bg-error/10 text-error` whose text is the `runError` string.
Do not render the awaiting pill on that failed run.

### SSE refetch

In `packages/web/src/stores/workflow-store.ts` `handleWorkflowStatus`, change the invalidate predicate to:

```ts
if (
  event.status === 'running' ||
  event.status === 'paused' ||
  isTerminalStatus(event.status)
) {
  invalidateWorkflowQueries();
}
```

Do not map Ask envelopes onto the store.
Do not treat SSE `paused` as `metadata.approval` unless `event.approval` is present, which Ask events do not send.

## File Map

| File | Action | Justification |
| --- | --- | --- |
| `packages/web/src/components/workflows/parse-ask-envelope.ts` | CREATE | Pure envelope parse and Submit validity |
| `packages/web/src/components/workflows/parse-ask-envelope.test.ts` | CREATE | RED/GREEN contract for parse and validity |
| `packages/web/src/components/workflows/merge-agent-room-items.ts` | CREATE | Place cards at tool invocation |
| `packages/web/src/components/workflows/merge-agent-room-items.test.ts` | CREATE | RED/GREEN merger and filter contract |
| `packages/web/src/components/workflows/ask-card-view-state.ts` | CREATE | Map row plus node status onto card states |
| `packages/web/src/components/workflows/ask-card-view-state.test.ts` | CREATE | RED/GREEN state matrix |
| `packages/web/src/components/workflows/awaiting-chrome.ts` | CREATE | Run pill, labels, and CAP-7 detector |
| `packages/web/src/components/workflows/awaiting-chrome.test.ts` | CREATE | RED/GREEN chrome helpers |
| `packages/web/src/components/workflows/AskCard.tsx` | CREATE | Structured Ask form |
| `packages/web/src/components/workflows/AskCard.test.tsx` | CREATE | Validity, teammate, Decline, stamps |
| `packages/web/src/lib/api.ts` | UPDATE | `answerAskHuman`, `getApiErrorStatus`, type re-exports |
| `packages/web/src/lib/api.ask.test.ts` | CREATE | URL-encoding and JSON body contract |
| `packages/server/src/routes/schemas/workflow.schemas.ts` | UPDATE | `viewer_is_starter` on GET run |
| `packages/server/src/routes/api.ts` | UPDATE | Compute `viewer_is_starter` |
| `packages/server/src/routes/api.workflow-runs.test.ts` | UPDATE | Starter, teammate, and unsigned GET-run cases |
| `packages/web/src/lib/api.generated.d.ts` | UPDATE | Regenerated OpenAPI types |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` | UPDATE | Poll while paused; compose messages plus Ask cards |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` | UPDATE | Paused polling and card insertion |
| `packages/web/src/components/workflows/LegacyNodeRoom.tsx` | UPDATE | Pass pending rows, identity, and warning awaiting header |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` | UPDATE | Thread Ask props; keep composer non-HITL |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx` | UPDATE | Three-door card, composer isolation, narrowed chrome bans |
| `packages/web/src/components/workflows/WorkflowExecution.tsx` | UPDATE | Keep pending rows, pill, CAP-7 banner, answer POST |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | UPDATE | Query mapping and header chrome |
| `packages/web/src/components/workflows/NodeRunList.tsx` | UPDATE | Warning `waiting on you` label |
| `packages/web/src/components/workflows/NodeRunList.test.tsx` | UPDATE | Awaiting warning characterization |
| `packages/web/src/components/workflows/StatusIcon.tsx` | UPDATE | Awaiting warning glyph |
| `packages/web/src/components/workflows/ExecutionDagNode.tsx` | UPDATE | Awaiting warning ring |
| `packages/web/src/components/workflows/ExecutionDagNode.test.tsx` | UPDATE | Awaiting warning characterization |
| `packages/web/src/stores/workflow-store.ts` | UPDATE | Invalidate GET run on paused SSE |
| `packages/web/src/stores/workflow-store.test.ts` | UPDATE | Paused invalidation |
| `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` | UPDATE | Mark Story 6.5 done after validation |

Do not modify `packages/web/src/components/chat/ChatInterface.tsx`.
Do not modify `packages/web/src/components/workflows/ChatTimeline.tsx` except if a test import path requires it.
Do not modify `packages/web/src/components/workflows/RunChatComposer.tsx` production code.
Do not modify `packages/web/src/experiments/console/`.
Do not modify `packages/web/src/lib/run-graph/`.
Do not modify engine, providers, or migrations.

## Step-by-Step Tasks

### Task 1: CREATE ask envelope parse and validity

**Files:**

- Create `packages/web/src/components/workflows/parse-ask-envelope.ts`.
- Create `packages/web/src/components/workflows/parse-ask-envelope.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Cover these cases with literal fixtures:

1. A well-formed single-select plus multi-select envelope parses both questions in order.
2. Missing `questions`, a non-array, or an empty array returns `null`.
3. A question missing `id`, `prompt`, `selection`, `options`, or `allowOther` returns `null`.
4. Duplicate question ids return `null`.
5. `single` with an option string is valid.
6. `single` with Other text is valid only when `allowOther` is true and the trimmed text is non-empty.
7. `single` with `'   '` is invalid.
8. `multi` with `[]` is invalid.
9. `multi` with one option is valid.
10. `isAskDraftValid` is false until every question is valid.
11. `draftToAnswerBody` preserves envelope order.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
bun test src/components/workflows/parse-ask-envelope.test.ts
```

Confirm the file is missing or the exports are missing.

- [ ] **Step 3: Implement the parser and validators.**

Use type guards only.
Do not import Zod.
Do not import `@archon/workflows`.

- [ ] **Step 4: Run GREEN.**

```bash
cd packages/web
bun test src/components/workflows/parse-ask-envelope.test.ts
```

- [ ] **Step 5: Refactor only while green, then commit.**

```bash
git add packages/web/src/components/workflows/parse-ask-envelope.ts packages/web/src/components/workflows/parse-ask-envelope.test.ts
git commit -m "feat(web): parse AskHuman envelopes without workflows imports"
```

### Task 2: CREATE room item merger

**Files:**

- Create `packages/web/src/components/workflows/merge-agent-room-items.ts`.
- Create `packages/web/src/components/workflows/merge-agent-room-items.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Cover:

1. `selectNodeAskInteractions` keeps only `kind: 'ask'` rows for that `node_id` and drops `permission` and other nodes.
2. Purged rows are dropped and answered rows are kept.
3. A tool message whose `payload.id` matches `tool_use_id` is followed immediately by that Ask item.
4. Two Asks on one node stay independent and ordered.
5. An Ask with no matching tool row is appended after the last message.
6. Status and text messages never spawn a card by themselves.
7. Empty messages with one pending Ask still emit that Ask item.

Use a helper that builds a `PendingInteraction` with every generated field explicit.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
bun test src/components/workflows/merge-agent-room-items.test.ts
```

- [ ] **Step 3: Implement selection and merge.**

- [ ] **Step 4: Run GREEN.**

```bash
cd packages/web
bun test src/components/workflows/merge-agent-room-items.test.ts
```

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/components/workflows/merge-agent-room-items.ts packages/web/src/components/workflows/merge-agent-room-items.test.ts
git commit -m "feat(web): place Ask cards at matching tool invocations"
```

### Task 3: CREATE awaiting chrome and card view-state helpers

**Files:**

- Create `packages/web/src/components/workflows/awaiting-chrome.ts`.
- Create `packages/web/src/components/workflows/awaiting-chrome.test.ts`.
- Create `packages/web/src/components/workflows/ask-card-view-state.ts`.
- Create `packages/web/src/components/workflows/ask-card-view-state.test.ts`.

- [ ] **Step 1: Write the failing tests.**

Cover:

1. `countPendingAsks` ignores permission, answered, and purged rows.
2. `isAskAwaitingRun` is true only for `paused` plus pending Asks.
3. A paused declared-gate run with zero pending Asks is not awaiting.
4. `firstAwaitingNodeId` returns the first `awaiting` node and `null` when none exist.
5. `isAskHumanUnsupportedError` matches the CAP-7 prefix and rejects other errors.
6. `nodeStatusLabel('awaiting')` is `waiting on you`.
7. View-state matrix: pending, sending, answered, declined, rejected-late, failed-resume.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
bun test src/components/workflows/awaiting-chrome.test.ts src/components/workflows/ask-card-view-state.test.ts
```

- [ ] **Step 3: Implement the helpers.**

- [ ] **Step 4: Run GREEN and commit.**

```bash
cd packages/web
bun test src/components/workflows/awaiting-chrome.test.ts src/components/workflows/ask-card-view-state.test.ts
git add packages/web/src/components/workflows/awaiting-chrome.ts packages/web/src/components/workflows/awaiting-chrome.test.ts packages/web/src/components/workflows/ask-card-view-state.ts packages/web/src/components/workflows/ask-card-view-state.test.ts
git commit -m "feat(web): derive Ask awaiting chrome and card view states"
```

### Task 4: UPDATE Ask answer client

**Files:**

- Modify `packages/web/src/lib/api.ts`.
- Create `packages/web/src/lib/api.ask.test.ts`.

- [ ] **Step 1: Write the failing URL tests.**

Mirror `api.conversations.test.ts`.
Stub `globalThis.fetch`.
Assert `answerAskHuman('run/1', 'tool/2', { decline: true })` POSTs `/api/workflows/runs/run%2F1/ask/tool%2F2/answer` with JSON `{ decline: true }`.
Assert an answers body is serialized as `{ answers: [...] }`.
Assert `getApiErrorStatus` reads `status` from the thrown `fetchJSON` error shape.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
bun test src/lib/api.ask.test.ts
```

- [ ] **Step 3: Add the client wrappers immediately after `getWorkflowRun`.**

- [ ] **Step 4: Run GREEN and commit.**

```bash
cd packages/web
bun test src/lib/api.ask.test.ts
git add packages/web/src/lib/api.ts packages/web/src/lib/api.ask.test.ts
git commit -m "feat(web): add AskHuman answer client"
```

### Task 5: UPDATE GET run with `viewer_is_starter`

**Files:**

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify `packages/server/src/routes/api.ts`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts`.
- Regenerate `packages/web/src/lib/api.generated.d.ts`.

- [ ] **Step 1: Write the failing GET-run tests.**

Add cases next to the existing `pending_interactions` serialization test:

1. When `X-Archon-User` matches `run.user_id`, `viewer_is_starter` is `true`.
2. When `X-Archon-User` is a different user, `viewer_is_starter` is `false`.
3. When no identity resolves, `viewer_is_starter` is `false`.
4. `pending_interactions` remains required and unchanged.

- [ ] **Step 2: Run RED.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

- [ ] **Step 3: Add the schema field and compute it in the GET run handler.**

Do not require auth for GET run.
Do not add `starter_display_name`.

- [ ] **Step 4: Run GREEN.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

- [ ] **Step 5: Regenerate web types.**

Start or reuse the package server, then run:

```bash
bun --filter @archon/web generate:types
```

Confirm `WorkflowRunDetail` includes `viewer_is_starter: boolean`.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "feat(server): tell the run viewer whether they are the Ask starter"
```

### Task 6: CREATE AskCard

**Files:**

- Create `packages/web/src/components/workflows/AskCard.tsx`.
- Create `packages/web/src/components/workflows/AskCard.test.tsx`.

Use `renderToStaticMarkup` for static states and happy-dom only for Decline confirm, Submit disablement after clicks, and focus.

- [ ] **Step 1: Write the failing tests.**

Cover:

1. Pending starter card is a form labelled `question from agent, 2 questions` for a two-question envelope.
2. Submit is disabled until both single and multi questions are valid, including Other text.
3. Decline is present and does not enable by validity.
4. Decline confirm copy is `The agent will be told you declined`.
5. Confirm Decline calls `onDecline` once and does not call `onSubmit`.
6. Cancel Decline leaves the card pending.
7. Teammate pending card shows `Waiting for the run starter to answer` and has no enabled Submit or Decline.
8. Sending shows `Sending…` and disabled controls.
9. Answered and declined stamps hide Submit and Decline.
10. `rejected-late` shows `Already answered`.
11. `failed-resume` shows the resume-failed copy with `text-error`.
12. Visible text does not contain `AskHuman`, `awaiting`, or `waiting-on-you`.
13. `View payload` contains the envelope JSON.
14. Warning border class `border-warning` is present and `border-error` is absent on pending cards.
15. First option receives focus when `viewState` is `pending` and `viewerIsStarter` is true.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx
```

- [ ] **Step 3: Implement `AskCard` with native inputs, existing `Button`, `AlertDialog`, and `Textarea` or `input`.**

Keep Other as a first-class option.
Do not POST from the card.
The parent owns the network.

- [ ] **Step 4: Run GREEN, refactor, commit.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx
git add packages/web/src/components/workflows/AskCard.tsx packages/web/src/components/workflows/AskCard.test.tsx
git commit -m "feat(web): render the legacy Ask card with validity and Decline"
```

### Task 7: UPDATE SSE paused invalidation and node awaiting chrome

**Files:**

- Modify `packages/web/src/stores/workflow-store.ts`.
- Modify `packages/web/src/stores/workflow-store.test.ts`.
- Modify `packages/web/src/components/workflows/StatusIcon.tsx`.
- Modify `packages/web/src/components/workflows/ExecutionDagNode.tsx`.
- Modify `packages/web/src/components/workflows/ExecutionDagNode.test.tsx`.
- Modify `packages/web/src/components/workflows/NodeRunList.tsx`.
- Modify `packages/web/src/components/workflows/NodeRunList.test.tsx`.
- Modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx` header classes only after tests exist; if header tests live in pane tests, keep the color map change here.

- [ ] **Step 1: Write the failing store test.**

Spy or stub `queryClient.invalidateQueries` the same way existing store tests observe side effects.
If the current file does not spy invalidation, assert a new dedicated test by injecting a mock at the existing `invalidateWorkflowQueries` seam, or extract that function to a testable named export if and only if a spy cannot be added without that extract.
The required behavior is: `handleWorkflowStatus({ status: 'paused' })` invalidates `workflowRun`.
Also assert `running`, `completed`, and `failed` still invalidate, and that a random non-status code path is unchanged.

If extracting a seam is required, keep it local to `workflow-store.ts` and do not add a new package.

- [ ] **Step 2: Write failing chrome tests.**

`StatusIcon` for `awaiting` uses `text-warning` and is not `text-error`.
`ExecutionDagNode` awaiting uses `border-warning` and `motion-reduce:animate-none`.
`NodeRunList` shows `waiting on you` with `text-warning` for an awaiting row.

- [ ] **Step 3: Run RED.**

```bash
cd packages/web
bun test src/stores/workflow-store.test.ts
NODE_ENV=development bun test src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/NodeRunList.test.tsx
```

- [ ] **Step 4: Implement paused invalidation and warning awaiting chrome.**

`STATUS_COLORS.awaiting` in `NodeRunList` and `LegacyNodeRoom` must become `bg-warning/20 text-warning`.
Visible awaiting label must use `nodeStatusLabel`.

- [ ] **Step 5: Run GREEN and commit.**

```bash
git add packages/web/src/stores/workflow-store.ts packages/web/src/stores/workflow-store.test.ts packages/web/src/components/workflows/StatusIcon.tsx packages/web/src/components/workflows/ExecutionDagNode.tsx packages/web/src/components/workflows/ExecutionDagNode.test.tsx packages/web/src/components/workflows/NodeRunList.tsx packages/web/src/components/workflows/NodeRunList.test.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx
git commit -m "feat(web): refetch Ask state on pause and warn on awaiting nodes"
```

### Task 8: UPDATE NodeTranscriptPane to compose Ask cards

**Files:**

- Modify `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
- Modify `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`.
- Modify `packages/web/src/components/workflows/NodeRoom.tsx` only if a render slot is required.
- Keep `NodeRoom.test.tsx` inspect-only: that file must continue to pass without Ask props.

Preferred composition: `NodeTranscriptPane` renders `RoomRegion` itself for the agent body when Ask items exist, reusing `NodeRoom` for the no-Ask path, or `NodeRoom` gains an optional `footerItems?: ReactNode` only if tests prove a slot is necessary.
Do not put pending-interaction parsing inside `NodeRoom`.

The required pane props are:

```ts
export interface NodeTranscriptPaneProps {
  runId: string;
  row: LogRow | null;
  runStatus: WorkflowRunStatus;
  loadMessages: typeof getWorkflowNodeMessages;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  sendingRequestId: string | null;
  rejectedLateRequestId: string | null;
  submitError: string | null;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => void;
  onDeclineAsk: (requestId: string) => void;
}
```

Remove `isLive: boolean` from this component.

- [ ] **Step 1: Write the failing pane tests.**

Cover:

1. `transcriptRefetchInterval('paused')` is `1000` and terminal statuses are `false`.
2. A pending Ask whose `tool_use_id` matches a tool message id renders `AskCard` after that tool chip.
3. Cards are absent when `pendingInteractions` is empty.
4. Status transcript rows still do not become cards.
5. Submit from the card calls `onSubmitAsk` with `tool_use_id` and the answers body.
6. Teammate `viewerIsStarter: false` shows the waiting-for-starter footer.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx
```

- [ ] **Step 3: Implement composition and paused polling.**

Parse each selected interaction with `parseAskEnvelope`.
Skip a row whose envelope is `null` rather than rendering a broken form.
Use `resolveAskCardViewState` with the selected row's status.

- [ ] **Step 4: Run GREEN and commit.**

```bash
git add packages/web/src/components/workflows/NodeTranscriptPane.tsx packages/web/src/components/workflows/NodeTranscriptPane.test.tsx packages/web/src/components/workflows/NodeRoom.tsx packages/web/src/components/workflows/LegacyNodeRoom.tsx
git commit -m "feat(web): insert Ask cards into the legacy agent transcript"
```

### Task 9: UPDATE pane and execution wiring, header pill, CAP-7, and POST

**Files:**

- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`.
- Modify `packages/web/src/components/workflows/LegacyGraphLogsPane.test.tsx`.
- Modify `packages/web/src/components/workflows/LegacyNodeRoom.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx`.

Thread these props from `WorkflowExecution` through the pane into `LegacyNodeRoom` / `NodeTranscriptPane`:

```ts
pendingInteractions: readonly PendingInteraction[];
viewerIsStarter: boolean;
runError: string | null;
```

`WorkflowExecution` owns answer state:

```ts
const [sendingRequestId, setSendingRequestId] = useState<string | null>(null);
const [rejectedLateRequestId, setRejectedLateRequestId] = useState<string | null>(null);
const [submitError, setSubmitError] = useState<string | null>(null);
```

Submit handler:

1. Set `sendingRequestId` to `requestId`.
2. Clear `submitError`.
3. Call `answerAskHuman(runId, requestId, body)` once.
4. On success, clear sending, then `queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] })` and `['workflowNodeMessages', runId]`.
5. On failure, clear sending.
6. If `getApiErrorStatus` is `409`, set `rejectedLateRequestId`.
7. Otherwise set `submitError` to the `Error` message or `Failed to answer.`.

Decline handler posts `{ decline: true }` through the same path.

Keep `RunChatComposer` on the Chat tab with the existing parent-conversation POST.
Do not pass pending interactions into the composer.

- [ ] **Step 1: Write the failing execution and pane tests.**

Cover:

1. `WorkflowRunQueryData` mapping includes `pending_interactions` and `viewer_is_starter`.
2. Paused plus one pending Ask renders header text `Awaiting input (1)` with `text-warning` and without `text-error`.
3. Clicking the pill selects the first awaiting node and leaves `activeView` unchanged.
4. Failed CAP-7 `metadata.error` renders the executor message with `text-error` and no awaiting pill.
5. Opening the asking node from Logs, Graph, and Chat all show the same Ask card in the same room region.
6. Chat composer still has aria-label `Run conversation composer` and posting it calls `sendParentMessage`, not `answerAskHuman`.
7. `expectNoAskHumanChrome` remains on bash, gate, workflow, route, and loop-group rooms.
8. Agent rooms with pending Asks are allowed to contain the card form and `waiting on you` node chrome.
9. Chat timeline still omits Ask cards and `node_awaiting` entries.

- [ ] **Step 2: Run RED.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx
```

- [ ] **Step 3: Implement query mapping, pill, CAP-7 banner, prop threading, and POST.**

Pass `runStatus` into `NodeTranscriptPane` instead of `isLive`.
Keep Graph/Logs/Chat on one `LegacyNodeRoom`.

- [ ] **Step 4: Run GREEN, refactor, commit.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/AskCard.test.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/RunChatComposer.test.tsx
git add packages/web/src/components/workflows packages/web/src/lib/api.ts
git commit -m "feat(web): answer AskHuman from the legacy node room"
```

### Task 10: Narrow inspect-only chrome bans and keep NodeRoom tests green

**Files:**

- Modify `packages/web/src/components/workflows/NodeRoom.test.tsx` only if production `NodeRoom` gained optional slots; otherwise leave it unchanged.
- Modify `packages/web/src/components/workflows/ChatTimeline.test.tsx` only if it starts failing; it must still forbid Ask forms.
- Modify `packages/web/src/components/workflows/GateRoom.test.tsx` only if awaiting warning labels leak into gate copy; gate rooms must still have no Ask card.

- [ ] **Step 1: Run the inspect-only suites.**

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/GateRoom.test.tsx src/components/workflows/RunChatComposer.test.tsx
```

- [ ] **Step 2: Fix only failures caused by shared label helpers.**

Do not weaken Chat timeline or composer assertions.

- [ ] **Step 3: Commit if anything changed.**

```bash
git add packages/web/src/components/workflows/NodeRoom.test.tsx packages/web/src/components/workflows/ChatTimeline.test.tsx packages/web/src/components/workflows/GateRoom.test.tsx
git commit -m "test(web): keep inspect-only rooms free of Ask forms"
```

Skip the commit when the step is a no-op.

### Task 11: Focused regression of Story 5.4 and 6.3 seams used by this story

- [ ] **Step 1: Run the focused web suites this story touched.**

```bash
cd packages/web
bun test src/lib/api.ask.test.ts src/lib/api.conversations.test.ts src/stores/workflow-store.test.ts
NODE_ENV=development bun test src/components/workflows/parse-ask-envelope.test.ts src/components/workflows/merge-agent-room-items.test.ts src/components/workflows/awaiting-chrome.test.ts src/components/workflows/ask-card-view-state.test.ts src/components/workflows/AskCard.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/NodeRunList.test.tsx src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/RunChatComposer.test.tsx src/components/workflows/NodeRoom.test.tsx
```

- [ ] **Step 2: Run the server GET-run and Ask-answer suites.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

- [ ] **Step 3: Fix regressions without expanding scope.**

- [ ] **Step 4: Commit only if fixes were required.**

### Task 12: Full validation and sprint close

- [ ] **Step 1: Run repository validation from the repo root.**

```bash
bun run validate
```

- [ ] **Step 2: Resolve the two `last_updated` conflicts in `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` by keeping a single timestamp.**
Use the current local time in `+0700` if the implementer is in that offset, otherwise use the machine local offset already used in that file.
Set `6-5-answer-the-ask-in-the-legacy-node-room` to `done`.
Leave `6-4`, `6-6`, and `6-7` unchanged.

- [ ] **Step 3: Commit tracking only after validation is green.**

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman legacy room story 6.5 done"
```

Do not close GitHub issue 90 from this plan unless the user asks.

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `parse-ask-envelope.test.ts` | parse failures, Other, multi empty, draftToAnswerBody order | FR4 validity |
| `merge-agent-room-items.test.ts` | tool-id match, append fallback, permission skip, two cards | FR3 inline card |
| `awaiting-chrome.test.ts` | paused+pending, gate pause, CAP-7 prefix, waiting-on-you label | UX-DR6, UX-DR8 |
| `ask-card-view-state.test.ts` | six view states | card state machine |
| `api.ask.test.ts` | encoded POST URL and JSON union body | FR11 POST |
| `api.workflow-runs.test.ts` | viewer_is_starter true/false/unsigned | FR6 |
| `AskCard.test.tsx` | Submit disabled, Decline dialog, teammate footer, stamps | FR4, FR6, UX-DR5 |
| `NodeTranscriptPane.test.tsx` | paused poll, card after tool, no status-row cards | FR3, FR11 |
| `LegacyGraphLogsPane.test.tsx` | three doors, composer isolation, non-agent rooms | FR8, FR12, UX-DR7 |
| `WorkflowExecution.test.tsx` | pill, CAP-7 banner, query mapping | AD-8, UX-DR8 |
| `workflow-store.test.ts` | paused invalidation | SSE refetch |
| `NodeRunList.test.tsx` / `ExecutionDagNode.test.tsx` | warning awaiting chrome | UX-DR6 |

### Edge Cases Checklist

- [ ] Envelope `questions` missing or malformed hides the card rather than crashing.
- [ ] Other whitespace-only values keep Submit disabled.
- [ ] Second submit after 409 shows `Already answered` and does not retry in a loop.
- [ ] Teammate never sees enabled Submit or Decline.
- [ ] Unsigned viewer is treated as not starter.
- [ ] Declared-gate pause without pending Asks does not show `Awaiting input`.
- [ ] CAP-7 failed run uses error chrome and not warning awaiting chrome.
- [ ] Chat composer cannot answer the Ask.
- [ ] Permission pending rows do not render cards.
- [ ] Two pending Asks on one node are independent.
- [ ] Child-run Asks are answered on the child run id because the room is the child's run view; do not add parent-run forwarding.

## Validation Commands

Focused, in order:

```bash
cd packages/web
bun test src/lib/api.ask.test.ts
bun test src/components/workflows/parse-ask-envelope.test.ts src/components/workflows/merge-agent-room-items.test.ts src/components/workflows/awaiting-chrome.test.ts src/components/workflows/ask-card-view-state.test.ts
NODE_ENV=development bun test src/components/workflows/AskCard.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx src/components/workflows/WorkflowExecution.test.tsx src/components/workflows/NodeRunList.test.tsx src/components/workflows/ExecutionDagNode.test.tsx src/components/workflows/ChatTimeline.test.tsx src/components/workflows/RunChatComposer.test.tsx src/components/workflows/NodeRoom.test.tsx
bun test src/stores/workflow-store.test.ts
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

From the repository root:

```bash
bun run type-check
bun run lint
bun run validate
```

Do not run unscoped `bun test` from the repository root.

## Acceptance Criteria

- [ ] A pending `kind: ask` on the selected agent node shows a structured card inline in the legacy agent room at the matching tool invocation, from Logs, Graph, and Chat doors.
- [ ] Cards come from `pending_interactions` and refetch when GET run is invalidated, including on SSE `paused`.
- [ ] Transcript `status` rows and SSE payloads never become cards.
- [ ] Submit stays disabled until every question is valid, including Other text.
- [ ] Decline is a first-class card action with the confirm copy `The agent will be told you declined`.
- [ ] One POST to `/api/workflows/runs/{runId}/ask/{requestId}/answer` answers or declines the whole card.
- [ ] Paused plus pending Asks shows warning `Awaiting input (n)` and never error tokens for that state.
- [ ] Awaiting node chrome uses warning tokens and the label `waiting on you`.
- [ ] A viewer who is not `workflow_runs.user_id` sees `Waiting for the run starter to answer` and no Submit or Decline.
- [ ] The Chat composer remains a parent-conversation path and is not an Ask path.
- [ ] CAP-7 start rejection on this surface uses error chrome and the executor unsupported-provider message, distinct from awaiting.
- [ ] Copy, validity, and states match this contract in legacy React only; console does not import the Ask card.
- [ ] All validation commands pass.
- [ ] Sprint key `6-5-answer-the-ask-in-the-legacy-node-room` is `done`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `expectNoAskHumanChrome` fails every Graph/Logs test after awaiting labels ship | High | High | Narrow the helper to non-agent rooms and keep Chat timeline banned |
| Better Auth id compared to `run.user_id` | Med | High | Only `viewer_is_starter` from `resolveAuthContext` |
| Paused SSE never refetches cards | High | High | Invalidate on `paused` |
| Message polling stops on Ask pause | High | Med | Poll transcripts while `paused` |
| CAP-7 and awaiting share red chrome | Med | High | Prefix detector plus error-only banner |
| OpenAPI regen skipped, `viewer_is_starter` untyped | Med | Med | Regenerator is a required Task 5 step |
| Sprint-status merge conflict left in the tree | High | Low | Resolve timestamps only in Task 12 |

## Open Questions

1. Should teammate copy name the starter's `display_name`?
Provisional default: no.
Use exactly `Waiting for the run starter to answer` because GET run does not join `remote_agent_users`.

2. Should legacy add shadcn `radio-group` and `checkbox` primitives as `ux-design.md` suggested?
Provisional default: no.
Use native inputs so this story adds no package and no new `components/ui` primitive.

3. Should the Chat timeline start showing `awaiting` node-status entries?
Provisional default: no.
Story 5.4 omitted `node_awaiting`, and Story 6.5 puts awaiting chrome on the run pill, Logs, graph, and room header.

4. Should identity live on GET `/api/auth/me` instead of GET run?
Provisional default: no.
Add `viewer_is_starter` on the GET-run payload the room already fetches, and do not add a new auth route.
