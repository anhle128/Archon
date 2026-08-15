# Archon Approval Gate Callbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Archon enqueue signed external callbacks only when a human approval gate is ready, with the workflow trigger message and a direct review URL.

**Architecture:** Add an event-type allowlist to each workflow provider binding and apply it before outbox insertion.
The workflow engine records gate-ready events after durable pause transitions, while the core store adapter enriches approval payloads with `user_message` and the correct review URL.
The existing outbox, HMAC signer, dispatcher, and retry loop remain unchanged.

**Tech Stack:** Bun, strict TypeScript, Zod through `@hono/zod-openapi`, SQLite, PostgreSQL, and Bun Test.

**Companion Plan:** Complete [the Hermes consumer plan](2026-08-15-hermes-archon-approval-notifications.md) before the live bridge validation.

## Global Constraints

- Use [the approved design](../specs/2026-08-15-archon-hermes-approval-gate-notification-design.md) as the source of truth.
- Send external callbacks for `approval`, `interactive_loop`, `writeback`, and `plannotator_gate` only.
- Do not send an approval callback for `child_workflow` because the child run owns the human gate.
- Keep all internal workflow audit events, even when a provider binding filters the corresponding external event.
- Keep existing bindings backward compatible by treating an empty event allowlist as "allow all."
- Use `--event-types`; do not reuse the existing boolean `--events` option.
- Keep the database change additive in SQLite and PostgreSQL.
- Give every new non-null database column a default.
- Never edit `packages/core/src/db/bundled-schema.generated.ts` by hand.
- Regenerate the bundled schema with `bun run generate:bundled-schema`.
- Derive TypeScript types from Zod schemas and do not add `any`.
- Keep the callback best-effort so notification persistence cannot fail the workflow.
- Do not add delivery retry, durable webhook receipt, or Hermes agent behavior in this plan.
- Run package tests from their package directory.
- Run `bun run validate` from the repository root before final handoff.

---

## File Map

- Modify `packages/core/src/schemas/workflow-event.ts` to define the external workflow event type schema once.
- Modify `packages/core/src/schemas/index.ts` to export the new schema and derived type.
- Modify `packages/core/src/events/workflow-event-envelope.ts` to consume the shared event type and require the approved gate payload fields.
- Modify `packages/core/src/schemas/workflow-provider-binding.ts` to expose a typed `event_types` array.
- Modify `packages/core/src/db/provider-bindings.ts` to normalize JSON text and persist binding allowlists.
- Modify `migrations/000_combined.sql` to add the PostgreSQL binding column and convergence `ALTER TABLE` statement.
- Modify `packages/core/src/db/adapters/sqlite.ts` to add the same column to new and existing SQLite databases.
- Regenerate `packages/core/src/db/bundled-schema.generated.ts` through the repository generator.
- Modify `packages/cli/src/cli.ts` to parse `--event-types` and pass it to the provider-binding command.
- Modify `packages/cli/src/commands/provider-binding.ts` to validate the comma-separated allowlist.
- Modify `packages/core/src/workflows/store-adapter.ts` to filter events and enrich approval payloads.
- Modify `packages/workflows/src/dag-executor.ts` to record standard, interactive, and writeback gate-ready events after durable pauses.
- Modify `packages/workflows/src/plannotator-gate-supervisor.ts` to record a gate-ready event after the live review URL is stored.
- Modify `.env.example` and `packages/docs-web/src/content/docs/reference/configuration.md` to document `ARCHON_PUBLIC_URL`.
- Modify the adjacent test files listed in each task.

### Task 1: Persist a Typed Provider-Binding Event Allowlist

**Files:**

- Modify: `packages/core/src/schemas/workflow-event.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Modify: `packages/core/src/events/workflow-event-envelope.ts`
- Modify: `packages/core/src/schemas/workflow-provider-binding.ts`
- Modify: `packages/core/src/db/provider-bindings.ts`
- Modify: `migrations/000_combined.sql`
- Modify: `packages/core/src/db/adapters/sqlite.ts`
- Generate: `packages/core/src/db/bundled-schema.generated.ts`
- Test: `packages/core/src/schemas/workflow-provider-binding.test.ts`
- Test: `packages/core/src/db/provider-bindings.test.ts`
- Test: `packages/core/src/db/adapters/sqlite.test.ts`
- Test: `packages/core/src/db/provider-bindings-bundled-schema.test.ts`

**Interfaces:**

- Consumes: The current external event vocabulary from `workflow-event-envelope.ts`.
- Produces: `externalWorkflowEventTypeSchema`, `ExternalWorkflowEventType`, `WorkflowProviderBinding.event_types`, and optional `eventTypes` inputs on `createBinding()` and `updateBinding()`.

- [ ] **Step 1: Write failing schema and database tests**

Add the allowlist to every binding-row fixture and add focused validation tests.

```ts
const row = {
  id: 'wpb-1',
  provider: 'archon',
  name: 'workflow-engine-primary',
  codebase_id: 'cb-1',
  event_route: 'https://hermes.example/events/workflow-engine',
  event_types: ['workflow.approval.requested'],
  state: 'active',
  binding_version: 1,
  created_at: '2026-07-11T11:48:27.000Z',
  updated_at: '2026-07-11T11:48:27.000Z',
};

expect(workflowProviderBindingSchema.parse(row).event_types).toEqual([
  'workflow.approval.requested',
]);

expect(() =>
  workflowProviderBindingSchema.parse({
    ...row,
    event_types: ['workflow.unknown'],
  })
).toThrow();
```

In `provider-bindings.test.ts`, make the raw database fixture use JSON text and verify create and update parameters.

```ts
function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wpb-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events/workflow-engine',
    event_types: '["workflow.approval.requested"]',
    state: 'active',
    binding_version: 1,
    created_at: '2026-07-11T11:48:27.000Z',
    updated_at: '2026-07-11T11:48:27.000Z',
    ...overrides,
  };
}

expect(result?.event_types).toEqual(['workflow.approval.requested']);
expect(params).toContain('["workflow.approval.requested"]');
```

Add a SQLite convergence assertion that a pre-existing binding table gains `event_types` and that its existing row receives the default `[]`.

```ts
const cols = raw_pragma(dbPath, 'remote_agent_workflow_provider_bindings');
expect(cols).toContain('event_types');
const rows = await db.query<{ event_types: string }>(
  'SELECT event_types FROM remote_agent_workflow_provider_bindings WHERE id = $1',
  ['wpb-legacy']
);
expect(rows.rows[0]?.event_types).toBe('[]');
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/schemas/workflow-provider-binding.test.ts src/db/provider-bindings.test.ts src/db/adapters/sqlite.test.ts src/db/provider-bindings-bundled-schema.test.ts
```

Expected: FAIL because the event schema and binding column do not exist.

- [ ] **Step 3: Define the shared external event type schema**

Move the runtime vocabulary to `packages/core/src/schemas/workflow-event.ts`.

```ts
export const externalWorkflowEventTypeSchema = z.enum([
  'workflow.run.started',
  'workflow.run.completed',
  'workflow.run.failed',
  'workflow.approval.requested',
  'workflow.delivery.failed',
  'workflow.artifact.recorded',
]);

export type ExternalWorkflowEventType = z.infer<typeof externalWorkflowEventTypeSchema>;
```

Export both names from `packages/core/src/schemas/index.ts`.
Import the derived type into `workflow-event-envelope.ts` and remove its hand-written union.

- [ ] **Step 4: Add the typed field to the binding schema and normalize database rows**

Add the array to `workflowProviderBindingSchema`.

```ts
import { externalWorkflowEventTypeSchema } from './workflow-event';

export const workflowProviderBindingSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  codebase_id: z.string(),
  event_route: z.string(),
  event_types: z.array(externalWorkflowEventTypeSchema),
  state: workflowProviderBindingStateSchema,
  binding_version: z.number(),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
});
```

Normalize only the JSON-text field before the existing Zod parse.

```ts
function normalizeBindingRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('event_types' in row)) return row;
  const eventTypes = (row as { event_types?: unknown }).event_types;
  if (typeof eventTypes !== 'string') return row;
  try {
    return { ...row, event_types: JSON.parse(eventTypes) as unknown };
  } catch {
    return row;
  }
}
```

Pass `normalizeBindingRow(row)` to both public and secret-aware schema parsing.
An invalid JSON string must continue into the existing `BINDING_CORRUPT_ROW` path.

- [ ] **Step 5: Persist allowlists on create and update**

Extend both inputs with the shared derived type.

```ts
eventTypes?: readonly ExternalWorkflowEventType[];
```

On create, insert `event_types` and serialize the input.

```ts
JSON.stringify(input.eventTypes ?? [])
```

On update, preserve the stored value when `eventTypes` is omitted.

```sql
event_types = COALESCE($3, event_types),
signing_secret = COALESCE($4, signing_secret)
```

Pass `input.eventTypes === undefined ? null : JSON.stringify(input.eventTypes)` for the event-types parameter.

- [ ] **Step 6: Add the additive database column in both dialects**

Add this column to the PostgreSQL create-table body and add a convergence statement for existing databases.

```sql
event_types     TEXT NOT NULL DEFAULT '[]',
```

```sql
ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS event_types TEXT NOT NULL DEFAULT '[]';
```

Add the same column to the SQLite create-table body.
Extend `migrateColumns()` with this exact statement when the column is absent.

```sql
ALTER TABLE remote_agent_workflow_provider_bindings
ADD COLUMN event_types TEXT NOT NULL DEFAULT '[]'
```

- [ ] **Step 7: Regenerate the bundled PostgreSQL schema**

Run:

```bash
bun run generate:bundled-schema
bun run check:bundled-schema
```

Expected: both commands exit with code 0.

- [ ] **Step 8: Run the focused tests**

Run:

```bash
cd packages/core
bun test src/schemas/workflow-provider-binding.test.ts src/db/provider-bindings.test.ts src/db/adapters/sqlite.test.ts src/db/provider-bindings-bundled-schema.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the binding storage change**

```bash
git add packages/core/src/schemas/workflow-event.ts packages/core/src/schemas/index.ts packages/core/src/events/workflow-event-envelope.ts packages/core/src/schemas/workflow-provider-binding.ts packages/core/src/db/provider-bindings.ts migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/bundled-schema.generated.ts packages/core/src/schemas/workflow-provider-binding.test.ts packages/core/src/db/provider-bindings.test.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/provider-bindings-bundled-schema.test.ts
git commit -m "feat(core): filter workflow events by provider binding"
```

### Task 2: Add `--event-types` to Provider-Binding Create and Update

**Files:**

- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/provider-binding.ts`
- Test: `packages/cli/src/commands/provider-binding.test.ts`
- Test: `packages/cli/src/commands/provider-binding.e2e.test.ts`

**Interfaces:**

- Consumes: `externalWorkflowEventTypeSchema`, `ExternalWorkflowEventType`, `createBinding({ eventTypes })`, and `updateBinding({ eventTypes })` from Task 1.
- Produces: The CLI option `--event-types workflow.approval.requested` for binding create and update.

- [ ] **Step 1: Write failing CLI tests**

Add a command test that verifies the parsed values reach the database layer.

```ts
await providerBindingCreateCommand(
  {
    provider: 'archon',
    name: 'workflow-engine-primary',
    projectRef: 'workflow-engine',
    route: 'https://hermes.example/webhooks/archon-workflow-engine',
    eventTypes: 'workflow.approval.requested',
  },
  { json: true, log: (line: string): void => logs.push(line) }
);

expect(mockCreateBinding).toHaveBeenCalledWith(
  expect.objectContaining({ eventTypes: ['workflow.approval.requested'] })
);
```

Add an invalid-value test.

```ts
const exitCode = await providerBindingCreateCommand(
  {
    provider: 'archon',
    name: 'workflow-engine-primary',
    projectRef: 'workflow-engine',
    route: 'https://hermes.example/webhooks/archon-workflow-engine',
    eventTypes: 'workflow.unknown',
  },
  { json: true, log: (line: string): void => logs.push(line) }
);

expect(exitCode).toBe(64);
expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({
  success: false,
  error: {
    code: 'MALFORMED_REQUEST',
    details: { fieldErrors: [{ path: '/eventTypes', code: 'invalid' }] },
  },
});
```

Add a subprocess E2E test that passes `--event-types workflow.approval.requested` and assert that the command does not reject the option.
Add a second E2E case with `--event-types --json` and assert that `--json` remains a flag and the response reports `/eventTypes` as invalid.

- [ ] **Step 2: Run the CLI tests and verify they fail**

Run:

```bash
cd packages/cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts
```

Expected: FAIL because the argument is not passed or validated.

- [ ] **Step 3: Parse the new global string option**

Add the option next to `project-ref` and `route` in `packages/cli/src/cli.ts`.

```ts
'event-types': { type: 'string' },
```

Add `--event-types` to the `stringOptions` set in `normalizeProviderBindingArgs()` so a missing value cannot consume `--json` or another flag.

Pass it through the provider-binding argument object.

```ts
eventTypes: values['event-types'] as string | undefined,
```

- [ ] **Step 4: Validate the comma-separated event list**

Import the shared schema and derived type.

```ts
import {
  externalWorkflowEventTypeSchema,
  type ExternalWorkflowEventType,
} from '@archon/core/schemas/workflow-event';
```

Extend `BindingArgs` and `ValidatedArgs` with `eventTypes`.
Add this parser beside the existing normalization helpers.

```ts
function parseEventTypes(value: string | undefined): ExternalWorkflowEventType[] | null | undefined {
  if (value === undefined) return undefined;
  const values = value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
  if (values.length === 0) return null;
  const parsed: ExternalWorkflowEventType[] = [];
  for (const item of values) {
    const result = externalWorkflowEventTypeSchema.safeParse(item);
    if (!result.success) return null;
    if (!parsed.includes(result.data)) parsed.push(result.data);
  }
  return parsed;
}
```

In `validateAndExtract()`, append `{ path: '/eventTypes', code: 'invalid' }` when the parser returns `null`.
Return the parsed array from `ValidatedArgs` when it is present.
Pass `validated.eventTypes` to both `createBinding()` and `updateBinding()`.

- [ ] **Step 5: Run the focused CLI tests**

Run:

```bash
cd packages/cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the CLI change**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/provider-binding.ts packages/cli/src/commands/provider-binding.test.ts packages/cli/src/commands/provider-binding.e2e.test.ts
git commit -m "feat(cli): configure provider binding event types"
```

### Task 3: Filter Disallowed Events Before Outbox Insertion

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Test: `packages/core/src/workflows/store-adapter.test.ts`
- Test: `packages/core/src/events/binding-router.test.ts`

**Interfaces:**

- Consumes: `EventRouteResolution.binding.event_types` from Task 1.
- Produces: Approval-only bindings that do not create outbox rows for start, completion, failure, delivery, or artifact events when route resolution finds that binding.

- [ ] **Step 1: Write failing allowlist tests**

Update binding fixtures to contain `event_types: []`.
Add a blocked-event test.

```ts
mockGetWorkflowRun.mockResolvedValueOnce(workflowRunRow());
mockResolveEventRoute.mockResolvedValueOnce({
  routable: true,
  codebase: codebaseRow(),
  binding: bindingRow({ event_types: ['workflow.approval.requested'] }),
  route: 'https://hermes.example/events',
  secret: 'test-secret',
});

await createWorkflowStore().enqueueExternalWorkflowEvent({
  workflow_run_id: 'run-1',
  event_type: 'workflow.run.started',
  occurred_at: '2026-08-15T00:00:00.000Z',
  payload: { state: 'running', startedAt: '2026-08-15T00:00:00.000Z' },
});

expect(mockEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
```

Add a matching-event test with a valid current approval payload and assert one outbox insert.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts src/events/binding-router.test.ts
```

Expected: FAIL because the start event is still enqueued.

- [ ] **Step 3: Apply the allowlist after successful route resolution**

Add a narrow helper in `store-adapter.ts`.

```ts
function bindingAllowsEvent(
  eventTypes: readonly ExternalWorkflowEventType[],
  eventType: ExternalWorkflowEventType
): boolean {
  return eventTypes.length === 0 || eventTypes.includes(eventType);
}
```

Import `externalWorkflowEventTypeSchema` and replace the existing hard-coded `EXTERNAL_EVENT_TYPES` set in `toExternalEventType()`.

```ts
function toExternalEventType(value: string): ExternalWorkflowEventType | null {
  const result = externalWorkflowEventTypeSchema.safeParse(value);
  return result.success ? result.data : null;
}
```

After `resolveEventRoute()` returns and before the routable or not-routable branch, stop on a disallowed type when the resolution contains a binding.

```ts
if (
  resolution.binding &&
  !bindingAllowsEvent(resolution.binding.event_types, eventType)
) {
  getLog().debug(
    { eventType, runId: run.id, bindingId: resolution.binding.id },
    'workflow_event_outbox_filtered_by_binding'
  );
  return;
}
```

Do not create a `not-routable` outbox row for this expected filter decision.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts src/events/binding-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the outbox filter**

```bash
git add packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/src/events/binding-router.test.ts
git commit -m "feat(core): honor workflow event binding allowlists"
```

### Task 4: Record Gate-Ready Events After Durable State Changes

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts`
- Modify: `packages/workflows/src/plannotator-gate-supervisor.ts`
- Test: `packages/workflows/src/dag-executor.test.ts`
- Test: `packages/workflows/src/plannotator-gate-supervisor.test.ts`

**Interfaces:**

- Consumes: `IWorkflowStore.createWorkflowEvent()` and the current durable pause and Plannotator transition methods.
- Produces: Internal `approval_requested` rows whose `data` contains `gateType`, `nodeId`, `message`, and the live `reviewUrl` when the gate is Plannotator.

- [ ] **Step 1: Write failing post-pause tests for standard and interactive gates**

In the existing approval and loop test sections, make the pause mock set a flag and assert the event sees the flag.

```ts
let pauseCommitted = false;
store.pauseWorkflowRun = mock(async (): Promise<void> => {
  pauseCommitted = true;
});
store.createWorkflowEvent = mock(async event => {
  if (event.event_type === 'approval_requested') {
    expect(pauseCommitted).toBe(true);
    expect(event.data).toMatchObject({
      gateType: 'approval',
      nodeId: 'review',
      message: 'Review the plan.',
    });
  }
});
```

Add the same assertion for `interactive_loop`, retaining its `iteration` and `completionSignaled` fields.
Add a lost-pause-CAS test that makes `pauseWorkflowRun` reject while `getWorkflowRunStatus` returns `cancelled`, then assert that no `approval_requested` event is written.

- [ ] **Step 2: Write failing writeback and Plannotator tests**

For writeback, assert this event after `pauseWorkflowRun` succeeds.

```ts
expect(store.createWorkflowEvent).toHaveBeenCalledWith({
  workflow_run_id: 'wb-run',
  event_type: 'approval_requested',
  step_name: '__writeback__',
  data: {
    gateType: 'writeback',
    nodeId: '__writeback__',
    message: expect.any(String),
  },
});
```

For Plannotator, give the fake child a live URL and assert exactly one ready event after the transition.

```ts
const child: AnnotateChildHandle = {
  reviewUrl: Promise.resolve('https://archon-host.example.ts.net:19432'),
  wait: () => decision.promise,
  kill: mock(() => undefined),
};

expect(store.events.filter(event => event.event_type === 'approval_requested')).toEqual([
  {
    workflow_run_id: 'run-1',
    event_type: 'approval_requested',
    step_name: 'review',
    data: {
      gateType: 'plannotator_gate',
      nodeId: 'review',
      message: 'Review the document.',
      reviewUrl: 'https://archon-host.example.ts.net:19432',
    },
  },
]);
```

- [ ] **Step 3: Run the workflow tests and verify they fail**

Run:

```bash
cd packages/workflows
bun test src/plannotator-gate-supervisor.test.ts
bun test src/dag-executor.test.ts
```

Expected: FAIL because events are currently written before standard pauses, and writeback and Plannotator do not write the approved event shape.

- [ ] **Step 4: Return the pause outcome from the shared helper**

Change `pauseGateRespectingExternalTransition()` to `Promise<boolean>`.
Return `false` when a legitimate external transition won the pause race.
Return `true` only after the pause succeeded and `approval_pending` was emitted.

```ts
async function pauseGateRespectingExternalTransition(
  deps: WorkflowDeps,
  runId: string,
  approvalContext: ApprovalContext
): Promise<boolean> {
  try {
    await deps.store.pauseWorkflowRun(runId, approvalContext);
  } catch (pauseErr) {
    const status = await deps.store.getWorkflowRunStatus(runId).catch(() => null);
    if (status === null || status === 'running') throw pauseErr;
    getLog().warn(
      { workflowRunId: runId, status, err: pauseErr as Error },
      'dag.gate_pause_skipped_external_transition'
    );
    return false;
  }
  getWorkflowEventEmitter().emit({
    type: 'approval_pending',
    runId,
    nodeId: approvalContext.nodeId,
    message: approvalContext.message,
  });
  return true;
}
```

Preserve the existing behavior that surfaces the original error when status cannot be read.
The final implementation can keep the existing nested `try` structure while returning the same boolean outcomes.

- [ ] **Step 5: Record standard, interactive, and writeback events after successful pauses**

Add one local helper in `dag-executor.ts` because four call sites need the same event shape.

```ts
type NotifiableApprovalGateType = 'approval' | 'interactive_loop' | 'writeback';

async function recordApprovalRequested(
  deps: WorkflowDeps,
  input: {
    runId: string;
    stepName: string;
    gateType: NotifiableApprovalGateType;
    nodeId: string;
    message: string;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await deps.store.createWorkflowEvent({
      workflow_run_id: input.runId,
      event_type: 'approval_requested',
      step_name: input.stepName,
      data: {
        gateType: input.gateType,
        nodeId: input.nodeId,
        message: input.message,
        ...input.data,
      },
    });
  } catch (err) {
    getLog().error(
      { err: err as Error, workflowRunId: input.runId, eventType: 'approval_requested' },
      'workflow.event_persist_failed'
    );
  }
}
```

Remove the current pre-pause `approval_requested` writes.
After each standard or interactive pause, call the helper only when the returned boolean is `true`.
After the fail-closed writeback pause succeeds, call the helper with `WRITEBACK_GATE_NODE_ID` and `gateType: 'writeback'`.

- [ ] **Step 6: Record Plannotator readiness after the URL transition**

After `setPhase(..., 'waiting_decision', reviewUrl)` returns `continue`, write the event only when `reviewUrl` exists.
Catch and log a store error so notification persistence cannot fail the Plannotator gate.

```ts
if (reviewUrl !== undefined) {
  try {
    await deps.store.createWorkflowEvent({
      workflow_run_id: deps.runId,
      event_type: 'approval_requested',
      step_name: deps.nodeId,
      data: {
        gateType: 'plannotator_gate',
        nodeId: deps.nodeId,
        message: deps.message,
        reviewUrl,
      },
    });
  } catch (err) {
    log.error(
      { err: err as Error, workflowRunId: deps.runId, nodeId: deps.nodeId },
      'plannotator_gate.approval_event_persist_failed'
    );
  }
}
```

Do not emit while the phase is `opening`, `reworking`, or `idle`.
Do not emit if an external decision wins before the waiting transition completes.

- [ ] **Step 7: Run the focused workflow tests**

Run:

```bash
cd packages/workflows
bun test src/plannotator-gate-supervisor.test.ts
bun test src/dag-executor.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the gate event timing change**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/plannotator-gate-supervisor.ts packages/workflows/src/plannotator-gate-supervisor.test.ts
git commit -m "feat(workflows): publish ready approval gates"
```

### Task 5: Enrich Approval Callbacks with User Prompt and Review URL

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/events/workflow-event-envelope.ts`
- Modify: `.env.example`
- Modify: `packages/docs-web/src/content/docs/reference/configuration.md`
- Test: `packages/core/src/workflows/store-adapter.test.ts`
- Test: `packages/core/src/events/workflow-event-envelope.test.ts`

**Interfaces:**

- Consumes: Gate event data from Task 4, `WorkflowRun.user_message`, `WorkflowRun.codebase_id`, and `ARCHON_PUBLIC_URL`.
- Produces: A validated `workflow.approval.requested` payload with `gateType`, `nodeId`, `message`, `userPrompt`, and `reviewUrl`.

- [ ] **Step 1: Write failing standard and Plannotator payload tests**

Add `user_message: 'Build the approved bridge.'` to the store-adapter workflow-run fixture.
Set and restore `process.env.ARCHON_PUBLIC_URL` in the test lifecycle.

For a standard approval, drive `store.createWorkflowEvent()` and inspect the queued envelope.

```ts
await store.createWorkflowEvent({
  workflow_run_id: 'run-1',
  event_type: 'approval_requested',
  step_name: 'review',
  data: {
    gateType: 'approval',
    nodeId: 'review',
    message: 'Review the plan.',
  },
});

expect(JSON.parse(insert.event_body as string)).toMatchObject({
  eventType: 'workflow.approval.requested',
  payload: {
    approval: {
      gateType: 'approval',
      nodeId: 'review',
      message: 'Review the plan.',
      userPrompt: 'Build the approved bridge.',
      reviewUrl: 'https://archon.example.ts.net/console/p/cb-1/r/run-1',
    },
  },
});
```

For Plannotator, pass `reviewUrl: 'https://archon-host.example.ts.net:19432'` in event data and assert that this value wins over `ARCHON_PUBLIC_URL`.
Add an envelope-schema test that rejects an approval payload missing `userPrompt` or `reviewUrl`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts src/events/workflow-event-envelope.test.ts
```

Expected: FAIL because the external payload is not enriched and the schema does not require the new fields.

- [ ] **Step 3: Require the approved payload fields in the envelope schema**

Extend only the approval payload schema.

```ts
const approvalGateTypeSchema = z.enum([
  'approval',
  'interactive_loop',
  'writeback',
  'plannotator_gate',
]);

const httpUrlSchema = z
  .string()
  .url()
  .refine(value => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  });
```

Require `gateType`, `nodeId`, `message`, `userPrompt`, and `reviewUrl` inside `payload.approval` while preserving `.passthrough()` for existing fields.

- [ ] **Step 4: Build the callback review URL in the store adapter**

Add record and URL guards without introducing a new module.
Import the schema-derived `WorkflowRun` type from `@archon/workflows/schemas/workflow-run` for the enrichment input.

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireHttpUrl(value: string, source: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${source} must be a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${source} must use HTTP or HTTPS`);
  }
  return url;
}
```

Add an approval-only enrichment function.

```ts
function enrichApprovalPayload(
  eventType: ExternalWorkflowEventType,
  payload: Record<string, unknown>,
  run: Pick<WorkflowRun, 'id' | 'codebase_id' | 'user_message'>
): Record<string, unknown> {
  if (eventType !== 'workflow.approval.requested') return payload;
  if (!isRecord(payload.approval)) return payload;
  const approval = payload.approval;
  const gateType = approval.gateType;
  let reviewUrl: string;
  if (gateType === 'plannotator_gate') {
    if (typeof approval.reviewUrl !== 'string') {
      throw new Error('Plannotator approval event is missing reviewUrl');
    }
    reviewUrl = requireHttpUrl(approval.reviewUrl, 'Plannotator reviewUrl').toString();
  } else {
    if (!run.codebase_id) throw new Error('Approval event is missing codebase_id');
    const configured = process.env.ARCHON_PUBLIC_URL?.trim();
    if (!configured) throw new Error('ARCHON_PUBLIC_URL is required for approval callbacks');
    const url = requireHttpUrl(configured, 'ARCHON_PUBLIC_URL');
    url.pathname = `/console/p/${encodeURIComponent(run.codebase_id)}/r/${encodeURIComponent(run.id)}`;
    url.search = '';
    url.hash = '';
    reviewUrl = url.toString();
  }
  return {
    ...payload,
    approval: {
      ...approval,
      userPrompt: run.user_message,
      reviewUrl,
    },
  };
}
```

Call this function after the binding allowlist accepts the event and before `buildWorkflowEventEnvelope()` validates the payload.

- [ ] **Step 5: Document `ARCHON_PUBLIC_URL`**

Add this commented example near the server configuration in `.env.example`.

```dotenv
# Public Archon web origin used in approval callback links.
# Use the Tailscale-reachable origin when review devices share a tailnet.
# ARCHON_PUBLIC_URL=https://archon-host.example.ts.net
```

Add the same variable to the configuration reference.
State that it is required for non-Plannotator approval callback links and that Plannotator uses its live `reviewUrl`.

- [ ] **Step 6: Run focused core tests**

Run:

```bash
cd packages/core
bun test src/workflows/store-adapter.test.ts src/events/workflow-event-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package checks**

Run:

```bash
cd packages/core
bun run type-check
cd ../workflows
bun run type-check
cd ../cli
bun run type-check
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit the callback payload change**

```bash
git add packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/src/events/workflow-event-envelope.ts packages/core/src/events/workflow-event-envelope.test.ts .env.example packages/docs-web/src/content/docs/reference/configuration.md
git commit -m "feat(core): enrich approval callback payloads"
```

### Task 6: Validate the Complete Archon Producer

**Files:**

- Verify only: all files changed in Tasks 1 through 5.

**Interfaces:**

- Consumes: The binding allowlist, gate-ready event writers, approval payload enrichment, and current dispatcher.
- Produces: Evidence that Archon creates only the approved Hermes callback and preserves the rest of the repository checks.

- [ ] **Step 1: Run the complete focused regression set**

Run:

```bash
cd packages/core
bun test src/schemas/workflow-provider-binding.test.ts src/db/provider-bindings.test.ts src/db/adapters/sqlite.test.ts src/db/provider-bindings-bundled-schema.test.ts
bun test src/workflows/store-adapter.test.ts src/events/binding-router.test.ts src/events/workflow-event-envelope.test.ts
cd ../workflows
bun test src/plannotator-gate-supervisor.test.ts
bun test src/dag-executor.test.ts
cd ../cli
bun test src/commands/provider-binding.test.ts src/commands/provider-binding.e2e.test.ts
```

Expected: every command passes.

- [ ] **Step 2: Verify generated files and formatting**

Run from the repository root:

```bash
bun run check:bundled-schema
bun run format:check
```

Expected: both commands pass and no generated file is stale.

- [ ] **Step 3: Run the required repository validation**

Run from the repository root:

```bash
bun run validate
```

Expected: PASS with zero lint warnings, type errors, test failures, or generated-file drift.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
```

Expected: no uncommitted source changes and no whitespace errors.
