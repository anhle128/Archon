# Confirm a Permission by Envelope Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.
> Track each checkbox in order, and do not combine RED, GREEN, REFACTOR, or commit steps.

**Goal:** Let the authenticated run starter confirm one pending `kind: permission` row exactly once through `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` with `{ intent: string }`, where `callId` is `tool_use_id`.

**Architecture:** Story 6.7 ships the split Permission confirm type-contract on the same `pending_interaction` envelope that Story 6.2 and Story 6.3 already persist.
`confirmPermission` in `packages/core/src/operations/workflow-operations.ts` is the only application-level Permission-confirm owner.
Its single persistence call is a new `confirmPendingPermission` helper in `packages/core/src/db/workflow-pending-interactions.ts`.
That helper reuses the existing lock, first-write CAS, last-pending `resumeWorkflowRunInTransaction(..., 'paused-ask')`, and identifier-only `interaction_resolved` event path already used by `resolvePendingInteraction`.
Ask answer stays Ask-only: `resolvePendingInteraction` continues to reject `kind !== 'ask'` with `kind_not_ask`.
Permission confirm stays Permission-only: `confirmPendingPermission` rejects `kind !== 'permission'` with `kind_not_permission`.
The executor, Claude provider, Pi provider, AskHuman tool, and both UI surfaces do not gain a live permission-activation source or variant cards.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite and PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, and Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.7.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` (Permission envelope/type-contract only; variant cards and live activation are non-goals), `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md` (POST `{ intent }`, `callId` ≡ `tool_use_id`), `_bmad-output/specs/spec-workflow-run-view-hitl/.memlog.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-7, AD-8, and AD-9, and `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` FR9, FR11, and NFR9.

**Issue:** https://github.com/anhle128/Archon/issues/92

**Depends on:** Story 6.3 `6-3-answer-or-decline-the-ask-so-the-node-can-continue` is `done`.

## Global Constraints

- Story 6.1, Story 6.2, and Story 6.3 are complete prerequisites, and this plan must preserve their characterization coverage.
- The Permission confirm route is `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm`, where `callId` is `tool_use_id`.
- The route must use `registerOpenApiRoute(createRoute(...), handler)`.
- Server route schemas must import and decorate engine schemas instead of copying them.
- Only the identity in `workflow_runs.user_id` may confirm, and an admin is not an override.
- A request without a resolved identity is `401` even when the installation API gate is disabled.
- First write wins, and a second confirm returns `409` without changing the original `answer`.
- The stored answer is `{ intent: string }` and must never appear in logs, events, SSE payloads, or error messages.
- `intent` is an opaque non-empty string, not an allow/deny enum and not a variant-card vocabulary.
- The Permission envelope remains an opaque JSON object and is not semantically validated in this story.
- `resolvePendingInteraction` remains Ask-only and must keep rejecting permission rows with `kind_not_ask`.
- `confirmPendingPermission` must reject Ask rows with `kind_not_permission`.
- Last-pending resume stays inside the persistence transaction via existing `resumeWorkflowRunInTransaction(..., 'paused-ask')`.
- Do not rename `'paused-ask'` in this story.
- The executor must not call `resumeWorkflowRun` for a Permission confirm.
- `mapAnsweredAskResume` in `packages/workflows/src/dag-executor.ts` must keep ignoring answered permission rows.
- `interaction_resolved` remains an identifier-only refetch signal and must not carry `envelope`, `answer`, or `intent`.
- Run status remains `paused` or `running`, and no `awaiting` run status is added.
- The wait remains indefinite, with no timeout, auto-confirm, or default intent.
- `NativeTool.handler` remains `(input, context?) => Promise<string>`.
- `pendingInteractionSchema` remains the canonical row schema in `packages/workflows/src/schemas/pending-interaction.ts`.
- `Claude` must stay pinned to `0.3.209`.
- Pi must stay on lockfile version `0.80.6`.
- No `any` type is permitted.
- Every added or changed `mock.module()` factory must expose all runtime exports imported by the module under test.
- Adding `confirmPendingPermission` to `packages/core/src/db/workflow-pending-interactions.ts` requires updating every `mock.module` factory of that module in the same change.
- Each test file that uses `mock.module()` must run in its package's existing isolated process.
- Do not run unscoped `bun test` from the repository root.
- Do not add migrations, because Story 6.2 already shipped `kind: permission` on `remote_agent_pending_interactions`.
- Do not modify `packages/core/src/schemas/pending-interaction.ts`, `packages/core/src/schemas/index.ts`, `packages/core/src/db/index.ts`, or `packages/core/src/handlers/command-handler.ts`.
- Do not add `confirmPendingPermission` to `IWorkflowPendingInteractionStore` or `IWorkflowStore`.
- Do not implement variant permission cards, live permission activation, PreToolUse defer, `AskUserQuestion`, Claude `canUseTool` permission prompts, or a producer that inserts `kind: permission` outside tests.
- Do not modify `packages/web/src/components/workflows/WorkflowExecution.tsx` or any file under `packages/web/src/experiments/console/` except generated OpenAPI types.
- Do not add CLI, chat, or `manage_run` confirm commands.
- Do not add a workflow YAML field or parse assistant prose as a permission.
- Each behavior slice must follow RED, observed expected failure, minimal GREEN, explicit REFACTOR, focused GREEN, and commit.
- Each full Markdown sentence in this plan must remain on its own physical line.

## Verified Repository Baseline

- `packages/workflows/src/schemas/pending-interaction.ts` already accepts `kind: 'ask' | 'permission'` and already owns Ask answer plus `resolvePendingInteractionInputSchema`.
- `packages/core/src/db/workflow-pending-interactions.ts` already inserts either kind, lists in `created_at ASC, id ASC` order, and implements Ask-only `resolvePendingInteraction`.
- `resolvePendingInteraction` currently throws `PendingInteractionValidationError('kind_not_ask')` when `current.kind !== 'ask'`.
- `packages/core/src/db/workflow-pending-interactions.test.ts` already covers `rejects a permission row on the Ask endpoint`.
- `packages/core/src/db/workflow-resume-transition.ts` already exports `resumeWorkflowRunInTransaction` with `'paused-ask'` eligibility that matches only `status = 'paused'`.
- `packages/core/src/operations/workflow-operations.ts` already owns `answerAskHuman` with starter-only auth, post-commit `workflow.ask_resolved`, and identifier-only `interaction_resolved` emit.
- `POST /api/workflows/runs/{runId}/ask/{requestId}/answer` is already registered in `packages/server/src/routes/api.ts` with a pre-validation `401` middleware, `registerOpenApiRoute`, and `tryAutoResumeAfterGate(..., 'ask-answer', ...)`.
- `tryAutoResumeAfterGate` currently types `action` as `'approve' | 'reject' | 'review-open' | 'ask-answer'` and uses an `else` branch for Ask logs.
- `packages/workflows/src/dag-executor.ts` `mapAnsweredAskResume` already filters `row.kind === 'ask' && row.status === 'answered'`.
- `packages/workflows/src/dag-executor.test.ts` already covers `ignores answered Permission rows when mapping Ask resume`.
- `packages/workflows/src/executor.test.ts` already covers `rejects a still-pending Permission without claiming the run`.
- There is no Permission confirm schema, db helper, operation, or HTTP route.
- There is no live permission-activation source and no permission card component.
- The current worktree has no database schema change for Story 6.7.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` currently lists `6-7-confirm-a-permission-by-envelope-only: backlog` and may contain unresolved `last_updated` merge-conflict markers that must be cleaned when marking the story done.

## File Map

### Create

- Do not create a new package, table, or UI module.

### Modify for contracts

- Modify `packages/workflows/src/schemas/pending-interaction.ts` for `permissionConfirmBodySchema` and `confirmPendingPermissionInputSchema`.
- Modify `packages/workflows/src/schemas/pending-interaction.test.ts` for exact schema behavior.

### Modify for persistence

- Modify `packages/core/src/db/workflow-pending-interactions.ts` for `confirmPendingPermission`, `kind_not_permission`, and `blank_intent`.
- Modify `packages/core/src/db/workflow-pending-interactions.test.ts` for real-SQLite Permission confirm behavior.
- Modify every `mock.module` factory of `workflow-pending-interactions` so the new export is stubbed:
  - `packages/core/src/operations/workflow-operations.test.ts`
  - `packages/core/src/workflows/store-adapter.test.ts`
  - `packages/server/src/routes/api.workflow-runs.test.ts`
  - `packages/cli/src/commands/workflow.test.ts`
  - `packages/cli/src/commands/workflow-command-contract.test.ts`

### Modify for operations and HTTP

- Modify `packages/core/src/operations/workflow-operations.ts` and `packages/core/src/operations/workflow-operations.test.ts` for starter authorization, confirm ownership, and safe logs.
- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` for the OpenAPI request schema.
- Modify `packages/server/src/routes/api.ts` for the registered POST route, pre-validation `401` middleware, Permission auto-dispatch action, and error mapping.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` for HTTP status, auth, kind mismatch, and auto-dispatch behavior.

### Modify at completion

- Regenerate `packages/web/src/lib/api.generated.d.ts` only through the existing generator.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after every validation gate passes.

## Authoritative Contracts

### Request and response

The route is `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm`.

The engine-owned request schemas are:

```ts
export const permissionConfirmBodySchema = z
  .object({
    intent: z.string().min(1),
  })
  .strict();

export type PermissionConfirmBody = z.infer<typeof permissionConfirmBodySchema>;

export const confirmPendingPermissionInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    answer: permissionConfirmBodySchema,
    resolved_by: z.string().min(1),
  })
  .strict();

export type ConfirmPendingPermissionInput = z.infer<
  typeof confirmPendingPermissionInputSchema
>;
```

Reuse `resolvePendingInteractionResultSchema` and `ResolvePendingInteractionResult` as the persistence result.

The sample valid body is `{ intent: 'allow-once' }`.

The route returns `200` with `workflowRunActionResponseSchema` after a winning write.

The route returns `400` for invalid JSON, a missing `intent`, a non-string `intent`, an empty `intent`, a whitespace-only `intent`, unknown keys, an Ask answer body, or `kind !== 'permission'`.

The route returns `401` when `resolveAuthContext` returns no requester.

The route returns `403` when the requester id differs from `workflow_runs.user_id`, including for an admin.

The route returns `404` when the run or `(runId, callId)` row is missing.

The route returns `409` when the row is not pending or the run is not yet paused.

The route returns `500` for an unexpected operation or database error.

The operation succeeds before auto-dispatch, so a failed auto-dispatch is logged and the HTTP write still returns `200`.

### Stored answer and event payload

The stored answer is exactly `{ intent: string }` as submitted, without trimming, after the trimmed value has been proven non-empty.

The persisted `interaction_resolved` event data is:

```ts
{
  node_id: string;
  tool_use_id: string;
  kind: 'permission';
  resumed: boolean;
}
```

The event must not contain `intent`, `answer`, `envelope`, `declined`, or `purged`.

### Persistence function

```ts
export async function confirmPendingPermission(
  input: ConfirmPendingPermissionInput
): Promise<ResolvePendingInteractionResult>;
```

`PendingInteractionValidationCode` gains `'kind_not_permission' | 'blank_intent'` and keeps every existing Ask code.

`confirmPendingPermission` owns one `withTransaction` and performs these actions in order:

1. Shape-parse the input with `confirmPendingPermissionInputSchema.safeParse` and convert failure to `PendingInteractionValidationError('invalid_body')` without serializing the input.
2. If `answer.intent.trim()` is empty, throw `PendingInteractionValidationError('blank_intent')` before opening the transaction.
3. Lock the run row with `FOR UPDATE` on PostgreSQL and the existing SQLite transaction semantics.
4. Throw `PendingInteractionNotFoundError` when the run is missing.
5. Lock the interaction selected by `workflow_run_id` and `tool_use_id`.
6. Throw `PendingInteractionNotFoundError` when the interaction is missing.
7. Throw `PendingInteractionAlreadyResolvedError` when its status is not `pending`.
8. Throw `PendingInteractionRunNotPausedError` when the run is not `paused`.
9. Throw `PendingInteractionValidationError('kind_not_permission')` when `current.kind !== 'permission'`.
10. Compare-and-swap the row from `pending` to `answered` while setting `answer` to `JSON.stringify(answer)`, `resolved_at`, and `resolved_by`.
11. Treat a zero-row update as `PendingInteractionAlreadyResolvedError`.
12. Count remaining `pending` rows for the whole run.
13. Invoke `resumeWorkflowRunInTransaction(..., 'paused-ask')` only when the count is zero.
14. Require the resume CAS to win or throw a safe conflict that rolls the row update back.
15. Insert `interaction_resolved` with `step_name = node_id` and the identifier-only permission payload after the resume result is known.
16. Re-read and parse the resolved interaction.
17. Return the canonical result.

Do not validate `envelope` keys, tool names, or intent vocabulary.

The call chain `confirmPermission -> confirmPendingPermission -> resumeWorkflowRunInTransaction` is the only Permission-resume path.

The executor and route must never invoke the query-scoped primitive.

### Authorization and operation result

```ts
export class PermissionRunNotFoundError extends Error {}
export class PermissionAuthenticationRequiredError extends Error {}
export class PermissionForbiddenError extends Error {}

export interface ConfirmPermissionInput {
  runId: string;
  callId: string;
  body: PermissionConfirmBody;
  actorUserId: string | undefined;
}

export interface ConfirmPermissionResult {
  run: WorkflowRun;
  interaction: PendingInteraction;
  resumed: boolean;
  remainingPending: number;
}

export async function confirmPermission(
  input: ConfirmPermissionInput
): Promise<ConfirmPermissionResult>;
```

`PermissionAuthenticationRequiredError` uses message `Authentication required`.

`PermissionForbiddenError` uses message `Not allowed to confirm permission for run ${runId}`.

`PermissionRunNotFoundError` uses message `Workflow run not found: ${runId}`.

The operation loads the run, requires `actorUserId`, requires a non-null matching `run.user_id`, calls the persistence CAS once, logs once after commit, emits once after commit, and returns the pre-resolution run for transport routing.

Duplicate the six-line starter assertion used by `answerAskHuman` with the Permission error classes.
Do not rename or reuse `AskHumanForbiddenError` on this route.

The winning log is exactly `workflow.permission_resolved` with `workflowRunId`, `nodeId`, `toolUseId`, and `resumed`.

The log must not receive `body`, `answer`, `envelope`, `intent`, or a raw serialized error.

The live emit is `{ type: 'interaction_resolved', runId, nodeId, resumed }` and is identical to the Ask emit shape.

### HTTP route

Register this OpenAPI route next to the Ask answer route:

```ts
const confirmPermissionRoute = createRoute({
  method: 'post',
  path: '/api/workflows/runs/{runId}/permissions/{callId}/confirm',
  tags: ['Workflows'],
  summary: 'Confirm a pending permission interaction',
  request: {
    params: z.object({
      runId: z.string().min(1),
      callId: z.string().min(1),
    }),
    body: {
      content: {
        'application/json': { schema: permissionConfirmRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: workflowRunActionResponseSchema },
      },
      description: 'Permission confirm accepted',
    },
    400: jsonError('Invalid permission confirm'),
    401: jsonError('Authentication required'),
    403: jsonError('Forbidden'),
    404: jsonError('Not found'),
    409: jsonError('Conflict'),
    500: jsonError('Server error'),
  },
});
```

`permissionConfirmRequestSchema` is `permissionConfirmBodySchema.openapi('PermissionConfirmBody')` in `packages/server/src/routes/schemas/workflow.schemas.ts`.

Enforce auth before OpenAPI body validation:

```ts
app.use('/api/workflows/runs/:runId/permissions/:callId/confirm', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const requester = await resolveAuthContext(c);
  if (!requester) return apiError(c, 401, 'Authentication required');
  return next();
});
```

Map errors exactly as the Ask route does, substituting Permission operation errors and `Failed to confirm permission` for the unexpected `500`.

When `resumed` is false, return `{ success: true, message: \`Permission confirm accepted: ${result.run.workflow_name}. Other interactions remain.\` }` and do not dispatch.

When `resumed` is true, call `tryAutoResumeAfterGate(result.run, 'permission-confirm', requester.userId)`.

When auto-resume succeeds, the message is `Permission confirm accepted: ${workflow_name}. Resuming workflow.`

When auto-resume is skipped, the message includes `archon workflow resume ${runId}`.

Unexpected handler failures log `{ err, runId, callId }` as `api.workflow_permission_confirm_failed` and must not log `intent`.

### Auto-continue after the POST

Widen `tryAutoResumeAfterGate` `action` to `'approve' | 'reject' | 'review-open' | 'ask-answer' | 'permission-confirm'`.

Replace the current Ask `else` branch with an explicit `action === 'ask-answer'` branch so Permission cannot inherit Ask log names.

The Permission log names are `api.workflow_permission_confirm_auto_resume_dispatched`, `api.workflow_permission_confirm_auto_resume_failed`, `api.workflow_permission_confirm_auto_resume_skipped_non_web_parent`, and `api.workflow_permission_confirm_auto_resume_skipped_no_platform_conv`.

A non-web or absent parent returns `200` after logging the skip.

Do not change executor hydrate or `mapAnsweredAskResume` in this story.
A permission-only first-node run may therefore fail auto-dispatch after the row is already answered; HTTP still returns `200` and the failure is logged.

## Implementation Order

Execute Tasks 1 through 5 in numeric order.
Do not start Task 3 before Task 2 is green, because operations call the new db helper.
Do not start Task 4 before Task 3 is green, because the route calls `confirmPermission`.
Do not start Task 5 before Task 4 is green.
Update sprint status only after every Task 5 gate passes.

### Task 1: Add the Permission confirm schemas

**Files:**

- Modify `packages/workflows/src/schemas/pending-interaction.test.ts`.
- Modify `packages/workflows/src/schemas/pending-interaction.ts`.

- [ ] **Step 1: Write the RED schema tests.**

Add tests named `accepts a non-empty intent object`, `rejects empty intent and unknown keys`, `rejects mixed Ask fields on a permission body`, and `derives a strict confirm input that reuses the resolve result schema`.

Use `{ intent: 'allow-once' }` as the valid sample.

Assert `permissionConfirmBodySchema.safeParse({ intent: '' }).success` is false.

Assert `permissionConfirmBodySchema.safeParse({ intent: 'allow-once', extra: true }).success` is false.

Assert `permissionConfirmBodySchema.safeParse({ intent: 'allow-once', decline: true }).success` is false.

Assert `permissionConfirmBodySchema.safeParse({ answers: [{ questionId: 'q1', value: 'yes' }] }).success` is false.

Assert `confirmPendingPermissionInputSchema.parse({ workflow_run_id: 'run-1', tool_use_id: 'tool-1', answer: { intent: 'allow-once' }, resolved_by: 'user-1' })` succeeds.

Assert an extra key on that input fails.

- [ ] **Step 2: Run the schema test and observe RED.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
```

Expected failure: `permissionConfirmBodySchema` and `confirmPendingPermissionInputSchema` are absent, rather than a fixture, syntax, or test-harness failure.

- [ ] **Step 3: Add the minimal schemas and inferred types.**

Import `z` only from `@hono/zod-openapi`.

Use `z.infer` for every schema type.

Keep `askAnswerBodySchema` and `resolvePendingInteractionInputSchema` byte-for-byte.

Do not add an intent enum.

Do not add a permission envelope schema.

- [ ] **Step 4: Run GREEN and then refactor names and comments without changing behavior.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
```

Expected result: the file passes.

- [ ] **Step 5: Commit the contract slice.**

```bash
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts
git commit -m "feat(workflows): define permission confirm envelope contract"
```

### Task 2: Implement the atomic Permission confirm CAS

**Files:**

- Modify `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Modify `packages/core/src/db/workflow-pending-interactions.ts`.
- Modify `packages/core/src/operations/workflow-operations.test.ts`.
- Modify `packages/core/src/workflows/store-adapter.test.ts`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify `packages/cli/src/commands/workflow.test.ts`.
- Modify `packages/cli/src/commands/workflow-command-contract.test.ts`.

- [ ] **Step 1: Write the first RED real-SQLite confirm test.**

Add helper `insertPausedPermission` that inserts `kind: 'permission'`, `envelope: {}`, `tool_use_id: 'toolu_perm_1'`, then pauses the run.

Name the test `resolves one pending Permission, writes an id-only event, and resumes the last pending row atomically`.

Confirm with `{ intent: SENTINEL_INTENT }` where `SENTINEL_INTENT` is `DO_NOT_LOG_INTENT`.

Assert the resolved row status is `answered`, `answer` equals `{ intent: SENTINEL_INTENT }`, `resolved_by` is `user-1`, `remaining_pending` is `0`, `resumed` is `true`, and the run status is `running`.

Assert the `interaction_resolved` event equals `{ node_id: 'review', tool_use_id: 'toolu_perm_1', kind: 'permission', resumed: true }`.

Assert the event and `errorLogs` do not contain `SENTINEL_INTENT`.

- [ ] **Step 2: Run the pending-interaction test and observe RED.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
```

Expected failure: `confirmPendingPermission` is absent.

- [ ] **Step 3: Implement the minimal winning confirm path and stub the new export in every mock factory.**

Add `confirmPendingPermission` with the transaction order in Authoritative Contracts.

Add `'kind_not_permission' | 'blank_intent'` to `PendingInteractionValidationCode`.

In every listed `mock.module('...workflow-pending-interactions')` factory, add `confirmPendingPermission: mockConfirmPendingPermission` that resolves `{ interaction: { id: 'pi-perm-1' }, resumed: false, remaining_pending: 1 }` unless a test overrides it.

Do not add the helper to `IWorkflowStore`.

Do not change `resolvePendingInteraction` behavior.

- [ ] **Step 4: Run GREEN for the first slice.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
```

Expected result: the new test passes and every existing Ask resolve test still passes.

- [ ] **Step 5: Add RED edge-case tests one at a time.**

Add tests named `keeps the first intent and reports already-resolved on a second write`, `does not resume while a sibling Ask is pending`, `resumes when the last remaining row is a Permission and an Ask is already answered`, `rolls back the confirm when the interaction-resolved event insert fails`, `rolls back the confirm when the paused-run resume CAS cannot win`, `rejects a confirm before the run reaches paused`, `rejects an Ask row on the Permission helper`, `rejects whitespace-only intent as blank_intent`, `redacts a confirm sentinel from errors and logs`, and `purges a pending Permission row without writing intent`.

After adding each named test, run the same test file, confirm the intended assertion fails, add the smallest behavior, and rerun before adding the next test.

`does not resume while a sibling Ask is pending` must insert one permission and one Ask, confirm the permission, and leave the run `paused` with `remaining_pending === 1`.

`resumes when the last remaining row is a Permission and an Ask is already answered` must answer the Ask first, then confirm the permission, then assert `resumed === true` and run status `running`.

`rejects an Ask row on the Permission helper` must call `confirmPendingPermission` against an Ask row and expect `kind_not_permission` without consuming the row.

`rejects whitespace-only intent as blank_intent` must use `{ intent: '   ' }` and leave the row pending.

`purges a pending Permission row without writing intent` must insert a paused permission, call `purgePendingInteractionsInTransaction(..., 'cancelled')`, and assert status `purged`, null `answer`, and a purge event with `kind: 'permission'` and no intent.

Keep the existing Ask test `rejects a permission row on the Ask endpoint` unchanged and green.

- [ ] **Step 6: Refactor the shared lock, CAS, remaining-count, resume, and event-insert body into a file-private helper while all tests remain green.**

The helper must stay in `workflow-pending-interactions.ts` and must not be exported.

`resolvePendingInteraction` and `confirmPendingPermission` must both call it.

Ask event payloads must still include `declined`.

Permission event payloads must still omit `declined`.

- [ ] **Step 7: Run the complete focused persistence gate and the mock-factory consumers.**

```bash
cd packages/core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/db/workflows.resume-cas.integration.test.ts
bun test src/workflows/store-adapter.test.ts
bun test src/operations/workflow-operations.test.ts
cd ../cli
bun test src/commands/workflow.test.ts
bun test src/commands/workflow-command-contract.test.ts
```

Expected result: every command exits zero.

- [ ] **Step 8: Commit the atomic confirm slice.**

```bash
git add packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/operations/workflow-operations.test.ts packages/core/src/workflows/store-adapter.test.ts packages/server/src/routes/api.workflow-runs.test.ts packages/cli/src/commands/workflow.test.ts packages/cli/src/commands/workflow-command-contract.test.ts
git commit -m "feat(core): confirm permission rows with atomic resume"
```

### Task 3: Own Permission confirm in workflow operations

**Files:**

- Modify `packages/core/src/operations/workflow-operations.test.ts`.
- Modify `packages/core/src/operations/workflow-operations.ts`.

- [ ] **Step 1: Write the RED operation tests.**

Add `describe('confirmPermission')` beside `describe('answerAskHuman')`.

Add tests named `requires an authenticated actor`, `rejects a different starter even when that actor is admin upstream`, `rejects an unowned run`, `passes the matching starter as resolved_by`, `throws PermissionRunNotFoundError when the run is missing`, `logs and emits only after persistence resolves and omits intent sentinels`, and `propagates typed persistence errors without remapping`.

The confirm body is `{ intent: INTENT_SENTINEL }` with `INTENT_SENTINEL` equal to `DO_NOT_LOG_INTENT`.

`passes the matching starter as resolved_by` must assert `mockConfirmPendingPermission` was called with `{ workflow_run_id: 'run-1', tool_use_id: 'tool-1', answer: { intent: INTENT_SENTINEL }, resolved_by: starterId }`.

The success log assertion is `workflow.permission_resolved` with `{ workflowRunId, nodeId, toolUseId, resumed }` and without `intent` or `declined`.

The emit assertion is `{ type: 'interaction_resolved', runId: 'run-1', nodeId: 'ask-node', resumed: true }`.

Auth failures must not call `mockConfirmPendingPermission`.

- [ ] **Step 2: Run the operations test and observe RED.**

```bash
cd packages/core
bun test src/operations/workflow-operations.test.ts
```

Expected failure: `confirmPermission` is absent.

- [ ] **Step 3: Add the minimal operation, error classes, and import.**

Import `PermissionConfirmBody` from `@archon/workflows/schemas/pending-interaction`.

Call `confirmPendingPermission` exactly once after starter authorization.

Log and emit only after that call resolves.

Do not call `resumeWorkflowRun`.

Do not change `answerAskHuman` messages or log names.

- [ ] **Step 4: Run GREEN and then refactor duplicated lookup if both loaders share the same getWorkflowRun plus typed not-found mapping.**

```bash
cd packages/core
bun test src/operations/workflow-operations.test.ts
```

Expected result: Ask and Permission describes both pass.

If extracting a shared run loader, keep Ask error class names and messages unchanged.

- [ ] **Step 5: Commit the operation slice.**

```bash
git add packages/core/src/operations/workflow-operations.ts packages/core/src/operations/workflow-operations.test.ts
git commit -m "feat(core): authorize starter-only permission confirm"
```

### Task 4: Register the Permission confirm HTTP route

**Files:**

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify `packages/server/src/routes/api.ts`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts`.

- [ ] **Step 1: Write the RED HTTP tests.**

Add `describe('POST /api/workflows/runs/:runId/permissions/:callId/confirm')` immediately after the Ask answer describe.

Reuse the Ask fixtures' style with `PERM_STARTER_USER_ID = 'user-starter-1'`, `PERM_CALL_ID = 'toolu_perm_1'`, and `PERM_CONFIRM_BODY = { intent: 'allow-once' }`.

Add tests named `returns 200 and confirms the pending Permission with the authenticated starter id`, `returns 401 when no authenticated requester is present`, `returns 401 before body validation when no authenticated requester is present`, `returns 401 before run lookup when no authenticated requester is present`, `returns 403 when the requester is not the run starter, including admins`, `returns 404 when the run is missing`, `returns 404 when the call id is missing`, `returns 409 when the interaction is already resolved`, `returns 409 when the run is not paused`, `returns 400 for an empty intent`, `returns 400 for a mixed intent-and-decline body`, `returns 400 when the row kind is ask`, `returns 500 for an unexpected operation error`, `dispatches /workflow resume once with the actor id for a last-pending web run`, `does not auto-dispatch an intermediate confirm`, and `returns 200 and skips dispatch for a non-web parent`.

`returns 401 before body validation when no authenticated requester is present` must POST `{ intent: '' }` without `X-Archon-User` and expect `401` without calling persist.

`returns 400 when the row kind is ask` must make `mockConfirmPendingPermission` reject `new PendingInteractionValidationError('kind_not_permission')` and expect `400`.

Widen the local `PendingInteractionValidationCode` union in this test file with `'kind_not_permission' | 'blank_intent'`.

`dispatches /workflow resume once with the actor id for a last-pending web run` must assert `mockHandleMessage` received `'/workflow resume run-perm-1'` and `extraContext.userId === PERM_STARTER_USER_ID`.

- [ ] **Step 2: Run the workflow-runs test and observe RED.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

Expected failure: the new describe cannot hit a registered Permission confirm route, rather than a mock-factory or import error.

- [ ] **Step 3: Add the OpenAPI schema, route, auth middleware, error mapping, and Permission auto-resume action.**

Import `permissionConfirmBodySchema` in `workflow.schemas.ts`.

Import `confirmPermission` and the three Permission error classes in `api.ts`.

Import `permissionConfirmRequestSchema`.

Extend `tryAutoResumeAfterGate` as specified in Authoritative Contracts.

Keep Ask auto-resume log names unchanged.

- [ ] **Step 4: Run GREEN for the HTTP file, including the existing Ask describe.**

```bash
cd packages/server
bun test src/routes/api.workflow-runs.test.ts
```

Expected result: Ask answer tests and Permission confirm tests both pass.

- [ ] **Step 5: Refactor duplicated 401 middleware and error mapping only if both routes can share helpers without changing Ask status codes or messages.**

Rerun the same test file after any refactor.

- [ ] **Step 6: Commit the HTTP slice.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "feat(server): add permission confirm envelope route"
```

### Task 5: Regenerate types, prove non-goals, validate, and mark Story 6.7 done

**Files:**

- Regenerate `packages/web/src/lib/api.generated.d.ts`.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.

- [ ] **Step 1: Run the characterization tests that prove this story does not activate Permission resume injection or UI cards.**

```bash
cd packages/workflows
bun test src/schemas/pending-interaction.test.ts
bun test src/dag-executor.test.ts
bun test src/executor.test.ts
cd ../core
bun test src/db/workflow-pending-interactions.test.ts
bun test src/operations/workflow-operations.test.ts
cd ../server
bun test src/routes/api.workflow-runs.test.ts
```

Expected result: `ignores answered Permission rows when mapping Ask resume` still passes, `rejects a still-pending Permission without claiming the run` still passes, and the new confirm tests pass.

- [ ] **Step 2: Prove no live activation source or permission card shipped.**

```bash
git diff --name-only origin/dev
```

Expected result: the diff does not include `packages/web/src/components/workflows/WorkflowExecution.tsx`, any `packages/web/src/experiments/console/` file except `packages/web/src/lib/api.generated.d.ts`, `packages/workflows/src/ask-human.ts`, `packages/providers/src/claude/provider.ts`, or `packages/providers/src/community/pi/provider.ts`.

- [ ] **Step 3: Regenerate OpenAPI types from a live server.**

`packages/web/package.json` `generate:types` reads `http://localhost:3090/api/openapi.json`.

If port 3090 is free, start the server with `PORT=3090 bun run dev:server` from the repository root, wait until it listens, then run:

```bash
bun --filter @archon/web generate:types
```

If port 3090 is occupied, start the worktree server as usual, read the logged port, and run `bunx openapi-typescript http://127.0.0.1:<port>/api/openapi.json -o packages/web/src/lib/api.generated.d.ts`.

Inspect the generated file for `PermissionConfirmBody` and `/api/workflows/runs/{runId}/permissions/{callId}/confirm`.

Stop the server started for generation.

Do not hand-edit `api.generated.d.ts`.

- [ ] **Step 4: Run repository validation from the repository root.**

```bash
bun run validate
```

Expected result: every command exits zero with no ESLint warnings.

- [ ] **Step 5: Confirm no migration files or dependency versions changed.**

```bash
git diff --name-only origin/dev | rg "^(migrations/|packages/core/src/db/adapters/sqlite.ts|package.json|bun.lock)$" && exit 1 || true
```

Expected result: no matching changed path.

- [ ] **Step 6: Mark only Story 6.7 done after validation passes.**

Set `6-7-confirm-a-permission-by-envelope-only: done`.

If `sprint-status.yaml` still has merge-conflict markers on `last_updated`, keep a single current timestamp and delete the conflict markers.

Leave Stories 6.4 through 6.6 unchanged.

- [ ] **Step 7: Commit generated types and story status.**

```bash
git add packages/web/src/lib/api.generated.d.ts _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark permission confirm story 6.7 done"
```

- [ ] **Step 8: Record the final evidence before closing issue 92.**

```bash
git status --short
git log --oneline --max-count=12
```

The worktree must be clean, the focused test commands and `bun run validate` must be recorded in the implementation handoff, and issue 92 must remain open until those results are available.

## Testing Strategy

| Layer | Test file | Required evidence |
| --- | --- | --- |
| Contract | `packages/workflows/src/schemas/pending-interaction.test.ts` | Strict `{ intent }`, rejected extras, confirm input shape |
| Persistence | `packages/core/src/db/workflow-pending-interactions.test.ts` | Real-SQLite CAS, first-write, last-pending resume, rollback, kind mismatch, blank intent, purge, safe logs |
| Resume regression | `packages/core/src/db/workflows.resume-cas.integration.test.ts` | Public resume semantics unchanged |
| Store mocks | `packages/core/src/workflows/store-adapter.test.ts` | New db export is stubbed and adapter tests still pass |
| Operation | `packages/core/src/operations/workflow-operations.test.ts` | Starter-only ownership, safe logging, event emission |
| HTTP | `packages/server/src/routes/api.workflow-runs.test.ts` | `200/400/401/403/404/409/500` and auto-dispatch gating |
| DAG characterization | `packages/workflows/src/dag-executor.test.ts` | Answered permission is omitted from `resumeInteractions` |
| Hydrate characterization | `packages/workflows/src/executor.test.ts` | Pending permission still blocks inspect |
| CLI mocks | `packages/cli/src/commands/workflow.test.ts` and `workflow-command-contract.test.ts` | New db export does not open a real database |

## Acceptance Criteria

- [ ] `POST /api/workflows/runs/{runId}/permissions/{callId}/confirm` accepts exactly `{ intent: string }` with `callId` equal to `tool_use_id`.
- [ ] Only the authenticated `workflow_runs.user_id` can confirm.
- [ ] Missing identity returns `401` and a different identity returns `403`.
- [ ] A second confirm returns `409` and preserves the first `{ intent }`.
- [ ] A request received before the run reaches `paused` returns `409` without consuming the confirm.
- [ ] Confirming an Ask row returns `400` with `kind_not_permission` and leaves the Ask pending.
- [ ] Answering a permission row through the Ask helper still returns `kind_not_ask`.
- [ ] Empty and whitespace-only `intent` values return `400`.
- [ ] The confirm row, audit event, and last-pending resume commit atomically.
- [ ] An intermediate confirm leaves the run paused and does not auto-dispatch.
- [ ] The last confirm moves the run to running exactly once and auto-dispatches only for a web parent.
- [ ] `interaction_resolved` is persisted with `kind: 'permission'` and no intent.
- [ ] Logs, events, SSE, and errors never include `intent`.
- [ ] No variant permission card ships.
- [ ] No live permission-activation source ships.
- [ ] UIs are not required to render a permission card.
- [ ] No database migration, dependency bump, YAML field, CLI confirm path, or chat confirm path is added.
- [ ] The generated OpenAPI types contain the new route and `PermissionConfirmBody`.
- [ ] `bun run validate` passes.
- [ ] The Story 6.7 sprint key is `done` only after validation passes.

## Not Building

- Variant permission cards and teammate chrome belong to a later story after a live activation source exists.
- A live permission-activation source, PreToolUse defer, Claude `canUseTool` prompts, and `AskUserQuestion` wrapping are out of scope.
- Ask cards, Submit controls, and composer HITL belong to Stories 6.5 and 6.6.
- Per-node independent scheduling belongs to Story 6.4.
- CLI, Slack, Telegram, Discord, GitHub, and `manage_run` confirm UX are out of scope.
- Executor permission resume injection is out of scope.
- Assistant-prose detection is prohibited.
- A new workflow authoring field is prohibited.
- A new run status is prohibited.
- An SDK upgrade is out of scope.

## Open Questions

1. The approved HITL contract types `intent` as `string` and does not name allow/deny variants.
Safe provisional default: treat `intent` as an opaque non-empty string and do not introduce an enum, because variant cards are explicitly out of scope.

2. The approved HITL contract does not say whether whitespace-only `intent` is valid.
Safe provisional default: reject trimmed-empty intent as `blank_intent` mapped to HTTP `400`, matching Ask Other text.

3. AD-1 says engine writes go through `IWorkflowStore`, but `answerAskHuman` already calls the db helper directly and the engine never confirms a permission.
Safe provisional default: do not add `confirmPendingPermission` to `IWorkflowStore`; operations call the core db helper directly.

4. A permission-only first-node pause has no answered Ask, so existing hydrate still returns null and auto-dispatch can fail after the CAS has already moved the run to `running`.
Safe provisional default: keep executor hydrate unchanged, log the failed auto-dispatch, and still return HTTP `200`, because this story has no live producer of permission-only pauses.

5. The approved contract does not name success HTTP status or body.
Safe provisional default: return `200` with `workflowRunActionResponseSchema`, matching the Ask answer route.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Confirm accidentally uses the Ask resolve helper | Permission rows stay pending or Ask validation runs against `{}` | Separate `confirmPendingPermission` and keep `kind_not_ask` / `kind_not_permission` tests |
| A new db export is omitted from a `mock.module` factory | CLI or HTTP tests open a real SQLite file and time out | Update all five factories in the same Task 2 commit |
| Permission inherits Ask auto-resume log names | Ops cannot grep the confirm path | Replace the `else` Ask branch with an explicit action match |
| Intent leaks into events or logs | Sensitive tool input reaches audit trails | Identifier-only event payload and sentinel assertions |
| Last-pending confirm double-resumes | Public `resumeWorkflowRun` fights the in-transaction CAS | Route must not call `resumeWorkflowRun`; only auto-dispatch `/workflow resume` after commit |
| UI or provider files change while shipping the envelope | Scope expands into deferred variant cards | Task 5 name-only diff gate |

## Completion Gate

Story 6.7 is complete only when every acceptance criterion is satisfied, every focused test passes in its isolated package process, `bun run validate` exits zero, generated API types are current, and the sprint key is `done`.

If any gate fails, leave the sprint key unchanged and do not close issue 92.
