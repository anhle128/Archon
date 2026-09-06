# Answer or Decline the Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the run starter POST one valid answer set or decline so the pending Ask CAS-resolves, the last pending row in the run resumes the workflow, and Claude/Pi continue with provider-owned `resumeInteractions`.

**Architecture:** `workflow-operations.answerAskHuman` is the only Ask caller of `resumeWorkflowRun`.
`resolvePendingInteraction` CAS-updates `remote_agent_pending_interactions` and writes `interaction_resolved` in the same transaction.
When that write leaves zero `status='pending'` rows on the run, the same transaction flips the run to `running`.
The executor never calls `resumeWorkflowRun` for an Ask pause.
On hydrate-when-running it re-enters every node with no `node_completed` and at least one `answered` pending row, passing `SendQueryOptions.resumeInteractions`.
Claude maps those rows to one new user message on `options.resume` with `forkSession: false`.
Pi appends matching `ToolResultMessage`s then calls `session.agent.continue()`.
Stories 6.5 and 6.6 own Ask cards.
Story 6.7 owns permission POST.
Story 6.4 owns extra concurrent-ask tests, but this story already resumes only on the last pending row in the run.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite/PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.3.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md`, `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`.

**Issue:** https://github.com/anhle128/Archon/issues/88

## Global Constraints

- Story 6.3 owns answer POST, CAS resolve, last-pending Ask resume, `resumeInteractions`, provider continue, hydrate-when-running re-entry, purge-on-cancel/fail, and `interaction_resolved` SSE refetch triggers.
- Do not implement Ask cards, awaiting chrome, teammate copy, or composer HITL.
- Do not implement `POST /api/workflows/runs/:runId/permissions/:callId/confirm`.
- Do not add CLI, chat, or `manage_run` answer UX.
- Do not add a workflow YAML field for AskHuman.
- Do not wrap Claude `AskUserQuestion`.
- Do not classify assistant prose as an ask.
- Do not put answers into the executor prompt.
- Do not write `metadata.approval` on Ask pause or Ask resume.
- Do not add a run status `awaiting`.
- Do not write `node_completed` for an asking node until the continued turn actually completes.
- Do not call `resumeWorkflowRun` from the executor for an Ask pause.
- Do not resume while any `status='pending'` row remains on the run.
- Do not add a timeout or auto-default for an unanswered Ask.
- Do not log answer bodies, question text, or envelope payloads.
- `NativeTool.handler` remains `(input, context?) => Promise<string>`.
- Canonical row schema stays `pendingInteractionSchema` in `packages/workflows/src/schemas/pending-interaction.ts`.
- Server route schemas import or `.extend` that schema and do not fork it.
- Claude SDK stays exact `0.3.209`.
- Pi stays lockfile `0.80.6` and uses `session.agent.continue()`, not `AgentSession.continue()`.
- Do not use `any`.
- Import engine Zod from `@hono/zod-openapi`.
- Add every new `mock.module()` test file as its own `bun test <file>` process.
- When adding an export to a module, update every `mock.module('<that module>'` factory.
- Do not run an unscoped `bun test` from the repository root.
- Run focused tests from the package directory.
- Finish with `bun run validate` from the repository root.
- Keep each RED test in place, observe the expected failure, add only the minimal production behavior, observe GREEN, then run an explicit REFACTOR step while those tests remain green, then commit.
- Keep each full Markdown sentence on its own physical line in this plan.

---

## Verified Repository Baseline

- Story 6.1 is `done` and confirmed Claude `0.3.209` host-abort plus one provider-owned user message, and Pi durable `SessionManager.appendMessage(ToolResultMessage)` then `session.agent.continue()`.
- Story 6.2 is `done`: pending table, `insertPendingInteraction`, `listPendingInteractions`, AskHuman persist-then-throw, Ask pause without `metadata.approval`, GET-run embed, `node_awaiting` SSE, projector `awaiting`.
- `IWorkflowPendingInteractionStore` has insert and list only at `packages/workflows/src/store.ts`.
- `interaction_resolved` is already in `WORKFLOW_EVENT_TYPES` and the projector ignores it as completion.
- No production `resolvePendingInteraction`, answer POST, `resumeInteractions`, or `interaction_resolved` SSE mapping exists.
- `approveWorkflow` keeps the run `paused` and does not call `resumeWorkflowRun`; `hydrateResumableRun` is today's resume CAS caller.
- `resumeWorkflow` in `packages/core/src/operations/workflow-operations.ts` accepts only `failed|paused|cancelled`.
- `inspectResumableRun` returns null when there are zero `node_completed` rows and no interactive-loop / plannotator / child-workflow gate.
- A first-node Ask therefore has zero completed nodes and must be treated as re-runnable Ask state.
- `executeNodeInternal` sets `forkSession: true` whenever `resumeSessionId` is set; Ask continue must force `forkSession: false`.
- Claude `sendQuery` calls `query({ prompt, options })` and sets `options.resume = resumeSessionId`.
- Pi `sendQuery` always `session.prompt(prompt)` after `resolvePiSession`; a missing session currently starts fresh (`resumeFailed: true`).
- Ask continue must not cold-start a fresh Pi session.
- `cancelWorkflowRun` and `failWorkflowRun` do not purge pending rows.
- `pendingInteractionSchema.answer` is a JSON object or null, so decline is stored as `{ decline: true }` in the column and mapped to payload `"declined"` at resume time.
- FR6 allows only `workflow_runs.user_id` to mutate; admins do not override.
- NFR6 forbids CLI/chat answer UX in this epic set.

## File Map

### Contracts

- Modify `packages/providers/src/types.ts` to add `ResumeInteraction` and `SendQueryOptions.resumeInteractions`.
- Modify `packages/workflows/src/schemas/pending-interaction.ts` to add `askAnswerBodySchema`, `resolvePendingInteractionInputSchema`, and result types.
- Modify `packages/workflows/src/schemas/pending-interaction.test.ts` for those schemas.
- Modify `packages/workflows/src/ask-human.ts` to export `askHumanQuestionSchema`.
- Modify `packages/core/src/schemas/pending-interaction.ts` and `packages/core/src/schemas/index.ts` if the new types are re-exported from core.

### Persistence and operations

- Modify `packages/core/src/db/workflows.ts` to extract the resume CAS body so Ask resolve can run it inside an open transaction.
- Modify `packages/core/src/db/workflow-pending-interactions.ts` to add `resolvePendingInteraction` and `purgePendingInteractions`.
- Modify `packages/core/src/db/workflow-pending-interactions.test.ts` for CAS, validation, last-pending resume, 409, and no-log invariants.
- Modify `packages/core/src/db/workflows.ts` `cancelWorkflowRun` and `failWorkflowRun` to purge remaining pending rows in the same transaction.
- Modify `packages/core/src/db/workflows.test.ts` and `packages/core/src/db/workflows.resume-cas.integration.test.ts` only as needed for the extracted helper.
- Modify `packages/workflows/src/store.ts` to add the new pending ports.
- Modify `packages/core/src/workflows/store-adapter.ts` and `packages/core/src/workflows/store-adapter.test.ts`.
- Modify every IWorkflowStore test double: `packages/workflows/src/dag-executor.test.ts`, `executor.test.ts`, `executor-preamble.test.ts`, `script-node-deps.test.ts`, `subrun.test.ts`, `ask-human.test.ts`.
- Modify `packages/core/src/operations/workflow-operations.ts` to add `answerAskHuman` and to allow hydrate-when-running of an already-running Ask-resumed run.
- Modify `packages/core/src/operations/workflow-operations.test.ts` and its `mock.module('../db/workflows')` factory.

### HTTP and SSE

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` to export `askAnswerBodySchema` via `.openapi('AskAnswerBody')`.
- Modify `packages/server/src/routes/api.ts` to register `POST /api/workflows/runs/{runId}/ask/{requestId}/answer`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` and its pending-interaction mock factory.
- Modify `packages/workflows/src/event-emitter.ts` to add `interaction_resolved`.
- Modify `packages/workflows/src/event-emitter.test.ts`.
- Modify `packages/server/src/adapters/web/workflow-bridge.ts` and its tests plus `dashboard-event-poller.test.ts`.
- Modify `packages/adapters/src/chat/slack/workflow-bridge.ts` exhaustive switch.

### Executor and providers

- Modify `packages/workflows/src/executor.ts` `inspectResumableRun` and `hydrateResumableRun`.
- Modify `packages/workflows/src/executor.test.ts`.
- Modify `packages/core/src/handlers/command-handler.ts` only if resume error copy must mention unanswered Asks.
- Modify `packages/core/src/handlers/command-handler.test.ts` if that copy is asserted.
- Modify `packages/workflows/src/dag-executor.ts` to pass `resumeInteractions`, force `forkSession: false`, use pending `provider_session_id`, and fail-node-keep-answer.
- Modify `packages/workflows/src/dag-executor.test.ts`.
- Modify `packages/providers/src/claude/provider.ts` and `packages/providers/src/claude/provider.test.ts`.
- Modify `packages/providers/src/community/pi/provider.ts`, `event-bridge.ts`, and `provider.test.ts`.

### Completion

- Modify `packages/web/src/lib/api.generated.d.ts` only through `bun --filter @archon/web generate:types`.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after validation passes.

## Authoritative Contracts

### HTTP

`POST /api/workflows/runs/:runId/ask/:requestId/answer`

`requestId` is `tool_use_id`.

Body schema (engine-owned, server OpenAPI-wraps):

```ts
export const askAnswerItemSchema = z
  .object({
    questionId: z.string().min(1),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .strict();

export const askAnswerBodySchema = z.union([
  z.object({ answers: z.array(askAnswerItemSchema).min(1) }).strict(),
  z.object({ decline: z.literal(true) }).strict(),
]);
```

Status mapping:

- `200` `{ success: true, message: string }` using `workflowRunActionResponseSchema`.
- `400` invalid JSON, both variants present, empty answers, unknown `questionId`, missing question, wrong value shape, empty Other text, `kind !== 'ask'`.
- `401` run has `user_id` and `resolveAuthContext` is missing.
- `403` requester `userId !== workflow_runs.user_id`.
- `404` missing run or missing `(runId, requestId)` row.
- `409` row exists but `status !== 'pending'`.
- `500` unexpected.

Admins cannot answer another user's Ask.

When web auth and the API gate are both off (solo) and `run.user_id` is set, allow the write and store `resolved_by = run.user_id`.

### Stored answer vs resume payload

DB `answer` is a JSON object:

- Decline: `{ decline: true }`.
- Answers: `{ answers: Array<{ questionId: string, value: string | string[] }> }`.

`ResumeInteraction`:

```ts
export interface ResumeInteraction {
  tool_use_id: string;
  payload: unknown;
  declined: boolean;
}
```

Mapping:

- Decline → `{ tool_use_id, payload: 'declined', declined: true }`.
- Answers → `{ tool_use_id, payload: answersArray, declined: false }`.

Store order is `created_at ASC, id ASC` for that node.

### Other / validity (server)

Parse `envelope.questions` with exported `askHumanQuestionSchema`.

Every question id must appear exactly once in `answers`.

No extra `questionId` values.

`selection: 'single'` requires `value` to be a string.

`selection: 'multi'` requires `value` to be a non-empty `string[]`.

If `value` (or each multi element) is in `options`, it is valid.

If it is not in `options` and `allowOther` is true, the string must be non-empty after trim.

If it is not in `options` and `allowOther` is false, reject with 400.

Decline skips question validation.

### CAS + last-pending resume

`resolvePendingInteraction` must, in one `withTransaction`:

1. Parse caller input before opening the transaction.
2. `SELECT` the run `FOR UPDATE` (Postgres only; SQLite uses the existing transaction lock).
3. Throw a normal `Error` if the run is missing.
4. `SELECT` the pending row `WHERE workflow_run_id = $1 AND tool_use_id = $2` with the same lock suffix.
5. Throw `PendingInteractionNotFoundError` if missing.
6. Throw `PendingInteractionAlreadyResolvedError` if `status !== 'pending'`.
7. Throw `PendingInteractionValidationError` if `kind !== 'ask'` or answers are invalid.
8. `UPDATE` the row to `answered`, set `answer`, `resolved_at = now()`, `resolved_by`.
9. `insertWorkflowEvent` with `event_type: 'interaction_resolved'`, `step_name: node_id`, and `data: { node_id, tool_use_id, kind, declined }` only.
10. Count remaining rows with `status = 'pending'` for this run.
11. If that count is `0`, run the extracted resume CAS against the locked run and require `rowCount > 0`.
12. Return `{ row, resumed: remaining === 0, remainingPending }`.

Never log `envelope` or `answer`.

Corrupt stored envelope JSON throws `PendingInteractionCorruptRowError` with only the row id.

### Purge

`purgePendingInteractions(workflowRunId)` updates every `pending` row on that run to `purged`, sets `resolved_at`, leaves `answer` null, writes one `interaction_resolved` event per row with `data: { node_id, tool_use_id, kind, declined: false, purged: true }`, and never calls resume.

`cancelWorkflowRun` and `failWorkflowRun` must call it inside the same transaction as the status update after the status CAS matches.

A cancel/fail no-op (already terminal) must not purge.

### Hydrate-when-running

`inspectResumableRun` treats “at least one `answered` row and zero `pending` rows” as re-runnable even when `priorCompletedNodes.size === 0`.

If any row is still `pending`, `hydrateResumableRun` must not call `resumeWorkflowRun` and must throw `AskHumanStillPendingError` with message `Answer or decline the Ask before resuming run ${id}`.

If the candidate status is already `running` and Ask re-entry is eligible, return `{ preCreatedRun: candidate, priorCompletedNodes, priorTokenUsage }` without calling `resumeWorkflowRun`.

`resumeWorkflow` must accept that already-running Ask-continue case so `/workflow resume` and `tryAutoResumeAfterGate` can dispatch after the operations CAS.

Unanswered paused Asks are not resumable through `/workflow resume`.

### Executor re-entry

Before `sendQuery` on a `command` / `prompt` / `loop` node, load pending rows for the run.

If the node has one or more `answered` rows and the run has zero `pending` rows:

- `resumeSessionId` is the shared `provider_session_id` (fail the node if the answered rows disagree).
- `forkSession` is `false`.
- `resumeInteractions` is the mapped answered rows in store order.
- Do not overwrite that session id with `lastSequentialSession` or `persist_session`.

If re-entry throws or Pi reports `resumeFailed` while `resumeInteractions` is non-empty:

- Log `workflow.ask_resume_failed` with `workflowRunId`, `nodeId`, `toolUseIds`, `error`, and no answer body.
- Fail that node.
- Keep the answered rows.
- Do not retry that failure as a transient provider retry.

Answers must not be concatenated onto the node prompt.

A pending `node_id` that is not in the DAG logs `workflow.ask_resume_failed` and is skipped; other nodes continue.

### Claude mapping

When `resumeInteractions` is non-empty:

- `options.resume` is the third-argument `resumeSessionId`.
- `forkSession` is false.
- `query({ prompt: buildClaudeAskResumePrompt(resumeInteractions), options })`.
- Ignore the executor prompt string for that `query()` call.
- Keep registering `AskHuman` so a later turn may ask again.
- Do not retry the branded control error path.

```ts
export function buildClaudeAskResumePrompt(
  interactions: readonly ResumeInteraction[]
): string {
  const blocks = interactions.map(item => {
    if (item.declined) {
      return `AskHuman ${item.tool_use_id} was declined.`;
    }
    return `AskHuman ${item.tool_use_id} answers:\n${JSON.stringify(item.payload)}`;
  });
  return `${blocks.join('\n\n')}\n\nContinue the task using these answers. Do not call AskHuman again for these tool_use_id values.`;
}
```

### Pi mapping

When `resumeInteractions` is non-empty:

- `resolvePiSession` must find the session; `resumeFailed` throws instead of creating a fresh session.
- Before `createAgentSession`, `sessionManager.appendMessage` each matching `ToolResultMessage` in store order unless that `toolCallId` is already the transcript tail.
- `ToolResultMessage` shape:

```ts
{
  role: 'toolResult',
  toolCallId: item.tool_use_id,
  toolName: 'AskHuman',
  content: [{ type: 'text', text: item.declined ? 'declined' : JSON.stringify(item.payload) }],
  isError: false,
  timestamp: Date.now(),
}
```

- After `createAgentSession`, verify `session.agent.state.messages.at(-1)` is that tool result (or the last appended result).
- `bridgeSession` must call `session.agent.continue()` instead of `session.prompt(prompt)`.
- Still `dispose()` in `finally`.

### Logging and SSE

- `workflow.ask_resolved` on winning CAS: `{ workflowRunId, nodeId, toolUseId, declined, resumed }`.
- `workflow.ask_resume_failed` on re-entry failure: `{ workflowRunId, nodeId, toolUseIds, error, errorType }`.
- Live emitter `interaction_resolved` with `{ type, runId, nodeId }` only.
- SSE maps it like `node_awaiting`: `workflow_status` refetch trigger, no envelope, no answers.
- After last-pending resume, status in that SSE payload is `running`; otherwise `paused`.

### Auto-continue after POST

If `resumed === true` and the run has a web parent conversation, call `tryAutoResumeAfterGate(run, 'ask-answer', actorUserId)` so `/workflow resume` hydrates-when-running.

If `resumed === false`, return 200 with a message that other Asks are still pending and do not dispatch.

---

### Task 1: Add answer and resume contracts with TDD

**Files:**

- Modify: `packages/workflows/src/schemas/pending-interaction.ts`
- Modify: `packages/workflows/src/schemas/pending-interaction.test.ts`
- Modify: `packages/workflows/src/ask-human.ts`
- Modify: `packages/providers/src/types.ts`

**Interfaces:**

- Produces: `askAnswerBodySchema`, `ResumeInteraction`, `SendQueryOptions.resumeInteractions`, exported `askHumanQuestionSchema`.

- [ ] **Step 1: Write the failing schema tests.**

Add to `packages/workflows/src/schemas/pending-interaction.test.ts`:

```ts
import {
  askAnswerBodySchema,
  insertPendingInteractionSchema,
  pendingInteractionSchema,
} from './pending-interaction';

test('accepts answers or decline and rejects a mixed body', () => {
  expect(
    askAnswerBodySchema.parse({
      answers: [{ questionId: 'direction', value: 'east' }],
    })
  ).toEqual({ answers: [{ questionId: 'direction', value: 'east' }] });
  expect(askAnswerBodySchema.parse({ decline: true })).toEqual({ decline: true });
  expect(
    askAnswerBodySchema.safeParse({
      answers: [{ questionId: 'direction', value: 'east' }],
      decline: true,
    }).success
  ).toBe(false);
  expect(askAnswerBodySchema.safeParse({ answers: [] }).success).toBe(false);
  expect(askAnswerBodySchema.safeParse({ decline: false }).success).toBe(false);
});

test('accepts multi-select value arrays', () => {
  expect(
    askAnswerBodySchema.parse({
      answers: [{ questionId: 'labels', value: ['a', 'b'] }],
    }).answers[0]?.value
  ).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run RED.**

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
```

Expected: FAIL because `askAnswerBodySchema` is not exported.

- [ ] **Step 3: Add the schemas and `ResumeInteraction`.**

Export `askHumanQuestionSchema` from `ask-human.ts`.

Add to `SendQueryOptions`:

```ts
resumeInteractions?: ResumeInteraction[];
```

- [ ] **Step 4: Run GREEN, refactor if needed, commit.**

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
(cd packages/providers && bun x tsc --noEmit)
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts packages/workflows/src/ask-human.ts packages/providers/src/types.ts
git commit -m "feat(workflows): add AskHuman answer body and resumeInteractions types"
```

---

### Task 2: Implement resolvePendingInteraction CAS with TDD

**Files:**

- Modify: `packages/core/src/db/workflow-pending-interactions.ts`
- Modify: `packages/core/src/db/workflow-pending-interactions.test.ts`
- Modify: `packages/core/src/db/workflows.ts` (extract resume CAS helper)

**Interfaces:**

- Produces: `resolvePendingInteraction`, `PendingInteractionAlreadyResolvedError`, `PendingInteractionNotFoundError`, `PendingInteractionValidationError`.

- [ ] **Step 1: Write RED tests in the existing isolated pending test file.**

Reuse `seedRun`, then pause the run before last-pending resume:

```ts
await db.query("UPDATE remote_agent_workflow_runs SET status = 'paused' WHERE id = $1", ['run-1']);
```

Required cases:

- First answer wins and stores `{ answers }` plus `resolved_by`.
- Second answer on the same `tool_use_id` throws `PendingInteractionAlreadyResolvedError` and leaves the first answer.
- `{ decline: true }` stores `{ decline: true }` and maps later to `"declined"`.
- Empty Other text throws `PendingInteractionValidationError` and leaves `status='pending'`.
- Missing `questionId` throws validation and inserts no `interaction_resolved`.
- `kind: 'permission'` row cannot be answered by this function.
- Last pending row on a paused run writes `interaction_resolved` and sets run `status='running'` in the same transaction.
- A remaining pending sibling does not resume the run.
- If `interaction_resolved` insert is aborted by a trigger, the pending row stays `pending` and the run stays `paused`.
- Info/error logs do not contain `SENTINEL_QUESTION` or `SENTINEL_ANSWER`.

Use a real questions envelope, not `{ questions: [] }`.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
```

Expected: FAIL on missing `resolvePendingInteraction`.

- [ ] **Step 3: Extract resume CAS and implement resolve.**

Move the transaction body of `resumeWorkflowRun` into an internal helper that accepts the `query` function.

`resumeWorkflowRun` must keep its current public behavior.

`resolvePendingInteraction` uses that helper only when remaining pending count is 0.

Validate answers against exported `askHumanQuestionSchema`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts && bun test src/db/workflows.test.ts && bun test src/db/workflows.resume-cas.integration.test.ts)
git add packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/workflows.ts
git commit -m "feat(core): CAS-resolve AskHuman pending rows and resume on last pending"
```

---

### Task 3: Purge pending rows on cancel and fail with TDD

**Files:**

- Modify: `packages/core/src/db/workflow-pending-interactions.ts`
- Modify: `packages/core/src/db/workflow-pending-interactions.test.ts`
- Modify: `packages/core/src/db/workflows.ts`
- Modify: `packages/core/src/db/workflows.test.ts`

- [ ] **Step 1: Write RED tests.**

- `purgePendingInteractions` sets remaining `pending` rows to `purged`, keeps `answer` null, and writes id-only `interaction_resolved` events.
- It does not change `answered` rows.
- It does not set the run to `running`.
- `cancelWorkflowRun` on a paused Ask run purges leftovers in the same transaction.
- `failWorkflowRun` on a running run with pending rows purges leftovers.
- Cancel no-op on an already-cancelled run does not rewrite purged rows.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts src/db/workflows.test.ts)
```

- [ ] **Step 3: Implement purge and fold it into cancel/fail transactions.**

Avoid a circular import: `workflows.ts` may import `purgePendingInteractions`; pending-interactions must not import `workflows.ts`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts && bun test src/db/workflows.test.ts)
git add packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts
git commit -m "feat(core): purge pending AskHuman rows on cancel and fail"
```

---

### Task 4: Extend IWorkflowStore ports and doubles

**Files:**

- Modify: `packages/workflows/src/store.ts`
- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts`
- Modify: `packages/core/src/db/index.ts` if new names need exporting (they already re-export the module).
- Modify every store double listed in the File Map.

- [ ] **Step 1: Write RED adapter tests that `resolvePendingInteraction` and `purgePendingInteractions` are required methods and are delegated.**

Update `mock.module('../db/workflow-pending-interactions')` in `store-adapter.test.ts` first.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

- [ ] **Step 3: Implement ports and update every double so `bun run validate` type-check cannot fail on missing methods.**

Search `mock.module` factories and object literals that implement `IWorkflowStore`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
git add packages/workflows/src/store.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/executor.test.ts packages/workflows/src/executor-preamble.test.ts packages/workflows/src/script-node-deps.test.ts packages/workflows/src/subrun.test.ts packages/workflows/src/ask-human.test.ts
git commit -m "feat(workflows): add resolve and purge pending-interaction store ports"
```

---

### Task 5: Add answerAskHuman and Ask-aware resumeWorkflow with TDD

**Files:**

- Modify: `packages/core/src/operations/workflow-operations.ts`
- Modify: `packages/core/src/operations/workflow-operations.test.ts`

- [ ] **Step 1: Extend the workflows and pending mock factories, then write RED tests.**

Cases:

- Starter identity matching `run.user_id` calls `resolvePendingInteraction` with `resolved_by`.
- Missing actor on a started run throws an error whose message includes `Authentication required`.
- Different actor throws an error whose message includes `Only the run starter`.
- Winning last-pending resolve logs `workflow.ask_resolved` without the answer sentinel.
- `resumeWorkflow` throws `AskHumanStillPendingError` while pending rows exist.
- `resumeWorkflow` returns an already-running run that has answered rows and zero pending rows.
- `resumeWorkflow` still rejects a plain `running` run with no Ask re-entry state.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
```

- [ ] **Step 3: Implement `answerAskHuman` and the resumeWorkflow branches.**

Emit live `interaction_resolved` from operations after the CAS commits using `getWorkflowEventEmitter()`.

Do not call `resumeWorkflowRun` again; the DB CAS already did that.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/core && bun test src/operations/workflow-operations.test.ts)
git add packages/core/src/operations/workflow-operations.ts packages/core/src/operations/workflow-operations.test.ts
git commit -m "feat(core): answer or decline AskHuman through workflow-operations"
```

---

### Task 6: Add the Ask answer POST route with TDD

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`

- [ ] **Step 1: Write RED HTTP tests.**

Mirror `approveWorkflowRunRoute` registration.

Cases:

- `200` on `{ answers }` for the starter, body uses `workflowRunActionResponseSchema`.
- `200` on `{ decline: true }` does not fail the node.
- `409` when operations throws `PendingInteractionAlreadyResolvedError`.
- `403` when `resolveAuthContext().userId` differs from `run.user_id`.
- `401` when the run has `user_id` and no auth context.
- `404` for unknown run or unknown requestId.
- `400` for empty Other / mixed body.
- Last-pending `200` calls `tryAutoResumeAfterGate` with action `'ask-answer'`.
- Non-last pending `200` does not auto-resume.

Mock `answerAskHuman` rather than the DB.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

- [ ] **Step 3: Register `POST /api/workflows/runs/{runId}/ask/{requestId}/answer` through `registerOpenApiRoute`.**

Params: `z.object({ runId: z.string(), requestId: z.string() })`.

Body: `askAnswerBodySchema.openapi('AskAnswerBody')`.

Responses include 200, 400, 401, 403, 404, 409, 500.

Extend `tryAutoResumeAfterGate` action union with `'ask-answer'` and greppable log names `api.workflow_ask_answer_auto_resume_dispatched` / `_failed` / `_skipped_non_web_parent`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(server): add AskHuman answer POST with starter-only CAS errors"
```

---

### Task 7: Map interaction_resolved as an SSE refetch trigger with TDD

**Files:**

- Modify: `packages/workflows/src/event-emitter.ts`
- Modify: `packages/workflows/src/event-emitter.test.ts`
- Modify: `packages/server/src/adapters/web/workflow-bridge.ts`
- Modify: `packages/server/src/adapters/web/workflow-bridge.test.ts`
- Modify: `packages/server/src/adapters/web/dashboard-event-poller.test.ts`
- Modify: `packages/adapters/src/chat/slack/workflow-bridge.ts`

- [ ] **Step 1: Write RED tests.**

- Emitter delivers `{ type: 'interaction_resolved', runId, nodeId }` with no envelope.
- Live web map returns `workflow_status` without approval or answers.
- Poller allowlist includes `interaction_resolved`.
- Persisted row map is a refetch trigger.
- Slack exhaustive switch compiles.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/workflows && bun test src/event-emitter.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts src/adapters/web/dashboard-event-poller.test.ts)
```

- [ ] **Step 3: Add the event type and mappings.**

Slack `case 'interaction_resolved': break;` next to `node_awaiting`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/workflows && bun test src/event-emitter.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/adapters && bun test src/chat/slack/workflow-bridge.ts)
git add packages/workflows/src/event-emitter.ts packages/workflows/src/event-emitter.test.ts packages/server/src/adapters/web/workflow-bridge.ts packages/server/src/adapters/web/workflow-bridge.test.ts packages/server/src/adapters/web/dashboard-event-poller.test.ts packages/adapters/src/chat/slack/workflow-bridge.ts
git commit -m "feat(server): treat interaction_resolved as an Ask refetch trigger"
```

---

### Task 8: Hydrate-when-running without a second resume CAS with TDD

**Files:**

- Modify: `packages/workflows/src/executor.ts`
- Modify: `packages/workflows/src/executor.test.ts`

- [ ] **Step 1: Write RED tests in the existing hydrate suite.**

- Zero completed nodes plus answered pending and no remaining pending is eligible.
- `hydrateResumableRun` on an already-running Ask-continue candidate does not call `store.resumeWorkflowRun`.
- `hydrateResumableRun` on a paused candidate with remaining pending throws `AskHumanStillPendingError` and does not call `resumeWorkflowRun`.
- Existing interactive-loop zero-completed resume still calls `resumeWorkflowRun`.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/workflows && bun test src/executor.test.ts)
```

- [ ] **Step 3: Implement inspect/hydrate branches using `store.listPendingInteractions`.**

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/workflows && bun test src/executor.test.ts)
git add packages/workflows/src/executor.ts packages/workflows/src/executor.test.ts
git commit -m "feat(workflows): hydrate running Ask resumes without a second CAS"
```

---

### Task 9: Re-enter asking nodes with resumeInteractions with TDD

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`

- [ ] **Step 1: Write RED tests beside the Story 6.2 AskHuman suite.**

Cases:

- After hydrate, a node with no `node_completed` and one answered row calls `sendQuery` with `resumeInteractions: [{ tool_use_id, payload, declined: false }]`, `forkSession: false`, and `resumeSessionId` equal to `provider_session_id`.
- The prompt argument is the original node prompt, not a string containing the answer sentinel.
- Decline maps to `{ payload: 'declined', declined: true }`.
- Two answered rows on one node are passed in `created_at` then `id` order.
- A throw from `sendQuery` during that re-entry writes `node_failed`, logs `workflow.ask_resume_failed` without the sentinel, and leaves the pending row `answered`.
- Conflicting `provider_session_id` values fail the node and keep the answers.
- A later DAG node that was not asking is not given `resumeInteractions`.

Loop nodes must cover the same `resumeInteractions` plumbing on the iteration `sendQuery` call.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/workflows && bun test src/dag-executor.test.ts)
```

- [ ] **Step 3: Implement loading and option overrides in both `executeNodeInternal` and the loop sendQuery path.**

Treat Ask re-entry failures as non-retryable inside `runNodeRetryLoop`.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/workflows && bun test src/dag-executor.test.ts)
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git commit -m "feat(workflows): re-enter AskHuman nodes with provider-owned resumeInteractions"
```

---

### Task 10: Map Claude resumeInteractions to one user message with TDD

**Files:**

- Modify: `packages/providers/src/claude/provider.ts`
- Modify: `packages/providers/src/claude/provider.test.ts`

- [ ] **Step 1: Write RED tests.**

Spy `query` from `@anthropic-ai/claude-agent-sdk`.

Cases:

- With `resumeInteractions` and `resumeSessionId`, `query` receives `options.resume` equal to that session id, `forkSession` is not true, and `prompt` equals `buildClaudeAskResumePrompt(...)`.
- The executor-supplied prompt string is not the `query` prompt.
- `AskHuman` remains registered on `mcpServers`.
- Without `resumeInteractions`, existing resume-plus-fork behavior is unchanged.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/providers && bun test src/claude/provider.test.ts)
```

- [ ] **Step 3: Implement the mapping next to the existing `options.resume = resumeSessionId` block.**

Export `buildClaudeAskResumePrompt` from the provider file or a sibling `askhuman-resume.ts` if that keeps `provider.ts` smaller.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/providers && bun test src/claude/provider.test.ts)
git add packages/providers/src/claude/provider.ts packages/providers/src/claude/provider.test.ts
git commit -m "feat(providers): resume Claude AskHuman with one provider-owned user message"
```

---

### Task 11: Map Pi resumeInteractions to ToolResultMessage plus continue with TDD

**Files:**

- Modify: `packages/providers/src/community/pi/event-bridge.ts`
- Modify: `packages/providers/src/community/pi/provider.ts`
- Modify: `packages/providers/src/community/pi/provider.test.ts`

- [ ] **Step 1: Write RED tests.**

Cases:

- `resumeInteractions` plus a resolvable session calls `appendMessage` with `toolCallId` equal to `tool_use_id` before `createAgentSession`, then `session.agent.continue()`, and never `session.prompt`.
- Decline content text is `declined`.
- Missing session throws and does not call `SessionManager.create`.
- Duplicate append is skipped when the tail already has that `toolCallId`.
- Existing non-Ask resume still uses `prompt`.

- [ ] **Step 2: Run RED.**

```bash
(cd packages/providers && bun test src/community/pi/provider.test.ts)
```

- [ ] **Step 3: Thread a continue mode through `bridgeSession` and the provider.**

Do not change the Story 6.1 characterization test.

- [ ] **Step 4: GREEN, refactor, commit.**

```bash
(cd packages/providers && bun test src/community/pi/provider.test.ts && bun test src/community/pi/askhuman-resume.characterization.test.ts)
git add packages/providers/src/community/pi/event-bridge.ts packages/providers/src/community/pi/provider.ts packages/providers/src/community/pi/provider.test.ts
git commit -m "feat(providers): resume Pi AskHuman via ToolResultMessage and agent.continue"
```

---

### Task 12: Generate types, mark the story done, and validate

**Files:**

- Modify: `packages/web/src/lib/api.generated.d.ts` only via generator
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

- [ ] **Step 1: Regenerate OpenAPI types.**

Start the worktree server if needed, then from `packages/web` run `bun generate:types`.

Confirm `api.generated.d.ts` contains `/api/workflows/runs/{runId}/ask/{requestId}/answer` and `AskAnswerBody`.

- [ ] **Step 2: Run the focused suites from Tasks 1–11 plus:**

```bash
(cd packages/core && bun test src/handlers/command-handler.test.ts)
bun run type-check
bun run lint
```

- [ ] **Step 3: Run `bun run validate` from the repository root.**

Expected: exit 0.

- [ ] **Step 4: Set `6-3-answer-or-decline-the-ask-so-the-node-can-continue: done` and update `last_updated`.**

Do not mark 6.4–6.7 done.

```bash
git add packages/web/src/lib/api.generated.d.ts _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman answer story 6.3 done"
```

---

## Testing Strategy

### Tests to write

| Test file | Cases | Validates |
| --- | --- | --- |
| `packages/workflows/src/schemas/pending-interaction.test.ts` | union body, multi value, mixed reject | HTTP/engine contract |
| `packages/core/src/db/workflow-pending-interactions.test.ts` | CAS, 409, Other, last-pending resume, rollback, no-log, purge | persistence |
| `packages/core/src/db/workflows.test.ts` | cancel/fail purge same TX | terminal cleanup |
| `packages/core/src/workflows/store-adapter.test.ts` | new ports delegated | store ISP |
| `packages/core/src/operations/workflow-operations.test.ts` | starter-only, logging, resumeWorkflow branches | operations owner |
| `packages/server/src/routes/api.workflow-runs.test.ts` | 200/400/401/403/404/409, auto-resume gating | REST |
| `packages/workflows/src/event-emitter.test.ts` | id-only live event | emitter |
| `packages/server/src/adapters/web/workflow-bridge.test.ts` | refetch, no payload | SSE |
| `packages/workflows/src/executor.test.ts` | hydrate-when-running, still-pending throw | AD-2 |
| `packages/workflows/src/dag-executor.test.ts` | resumeInteractions, fail-node-keep-answer | continue |
| `packages/providers/src/claude/provider.test.ts` | one user message, no fork | AD-6 Claude |
| `packages/providers/src/community/pi/provider.test.ts` | append + continue, no fresh session | AD-6 Pi |

### Edge cases

- [ ] First-node Ask with zero `node_completed` still continues.
- [ ] Sibling pending Ask does not resume the run.
- [ ] Already resolved → 409 and first answer kept.
- [ ] Other with whitespace-only text is invalid.
- [ ] Permission row is not answerable on this POST.
- [ ] Cancel after pause purges leftovers and does not resume.
- [ ] Pi missing session fails the node and keeps the answer.
- [ ] Answer bodies never appear in logs.

## Validation Commands

```bash
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts && bun test src/ask-human.test.ts && bun test src/event-emitter.test.ts && bun test src/executor.test.ts && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts && bun test src/db/workflows.test.ts && bun test src/workflows/store-adapter.test.ts && bun test src/operations/workflow-operations.test.ts && bun test src/handlers/command-handler.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts && bun test src/adapters/web/workflow-bridge.test.ts && bun test src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/providers && bun test src/claude/provider.test.ts && bun test src/community/pi/provider.test.ts)
bun run type-check
bun run lint
bun run validate
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- [ ] `POST /api/workflows/runs/:runId/ask/:requestId/answer` accepts `{ answers: { questionId, value }[] }` or `{ decline: true }`.
- [ ] First write wins; already resolved returns 409.
- [ ] Only `workflow_runs.user_id` may mutate via `resolveAuthContext`.
- [ ] Decline stores `{ decline: true }` and resume payload `"declined"`; the agent decides node outcome.
- [ ] Other selected requires non-empty `value`.
- [ ] `workflow-operations` is the only Ask caller of `resumeWorkflowRun`, in the same transaction as the last pending CAS.
- [ ] The executor never resumes an Ask pause; hydrate-when-running re-enters every node with no `node_completed` and at least one answered pending row.
- [ ] `sendQuery` includes `resumeInteractions` in store order and does not stuff answers into the prompt.
- [ ] Claude uses one new user message and does not reissue AskHuman as the resume mechanism.
- [ ] Pi uses `ToolResultMessage` plus `session.agent.continue()`.
- [ ] `provider_session_id` on the pending row is the session source of truth.
- [ ] A resume that cannot re-enter fails the node and keeps the answer.
- [ ] `interaction_resolved` is written; SSE is a refetch trigger.
- [ ] `workflow.ask_resolved` and `workflow.ask_resume_failed` log without answer bodies.
- [ ] Wait is indefinite.
- [ ] Cancel or fail purges remaining pending rows.
- [ ] Sprint key `6-3-answer-or-decline-the-ask-so-the-node-can-continue` is `done`.
- [ ] `bun run validate` passes.

## NOT Building

- Ask cards, Submit enablement UI, teammate chrome, and composer HITL (Stories 6.5 and 6.6).
- Permission confirm POST and permission cards (Story 6.7).
- Per-node independent scheduling (Story 6.4 / NFR6).
- CLI `/workflow answer` or `manage_run` answer tools (NFR6).
- Claude SDK upgrade off `0.3.209`.
- Auto-timeout or default answers (NFR2).

## Open Questions

1. HTTP success status is not named in the HITL contract.
   Safe provisional default: `200` with `workflowRunActionResponseSchema`, matching approve/reject.

2. `value` type for multi-select is not named.
   Safe provisional default: `string` for `single`, `string[]` for `multi`.

3. Solo installs may have no `resolveAuthContext`.
   Safe provisional default: if web auth and the API gate are both off, allow the starter-row write and set `resolved_by` to `run.user_id`.

4. Whether admins can answer another user's Ask is not separately specified beyond FR6.
   Safe provisional default: no; only `workflow_runs.user_id`.

5. A pending `node_id` missing from the DAG on re-entry is not specified.
   Safe provisional default: log `workflow.ask_resume_failed`, skip that row, keep the answer, continue other nodes.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Double `resumeWorkflowRun` after operations CAS | High | Run stranded or 400 on `/workflow resume` | Hydrate-when-running skips CAS when status is already `running` |
| `forkSession: true` clones away the aborted Ask turn | High | Claude ignores the answer | Force `forkSession: false` when `resumeInteractions` is set |
| Pi `resumeFailed` starts a fresh session | High | Answers never injected | Throw when `resumeInteractions` is set and the session file is missing |
| Answer JSON logged | Med | Spec violation | Assert sentinels absent in pending and operations tests |
| First-node Ask has zero `node_completed` | High | inspect returns null | Treat answered pending as re-runnable state |

## Completion Gate

Story 6.3 is complete only when every acceptance criterion above is true, the focused tests exist and pass, `bun run validate` passes, and the sprint key is `done`.
If any part is incomplete, leave the sprint key `in-progress` and do not close GitHub issue 88.
