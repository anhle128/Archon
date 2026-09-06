# Pause a Run When the Agent Asks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a structured AskHuman pending row, pause the run without writing `metadata.approval`, project `awaiting`, and reject unsupported `allowed_tools: [AskHuman]` before a turn.

**Architecture:** `@archon/workflows` owns the `AskHuman` NativeTool.
The handler inserts `remote_agent_pending_interactions` and `node_awaiting` in one transaction, then throws `AskHumanAwaitingError`.
Claude and Pi wrappers abort the in-flight query and reject `sendQuery` with that same class instead of stringifying it as a tool result.
`pauseWorkflowRun` becomes optional-approval and idempotent for Ask so the declared-gate slot stays untouched.
Story 6.3 owns answer POST, CAS resume, and `resumeInteractions`.
Stories 6.5 and 6.6 own Ask cards.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi` (providers converters import `zod` directly), SQLite/PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.2.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md`, `_bmad-output/implementation-artifacts/workflow-run-view-hitl/6-1-askhuman-resume-spike.md`.

**Issue:** https://github.com/anhle128/Archon/issues/87

## Global Constraints

- Story 6.2 persists and pauses only.
- Do not implement `resolvePendingInteraction`, answer POST, `resumeInteractions`, provider resume mappers, Ask cards, awaiting chrome, or permission POST.
- Do not write `metadata.approval` on Ask pause.
- Do not add a run status `awaiting`.
- Do not write `node_completed` for an asking node.
- Do not classify assistant prose as an ask.
- Do not wrap Claude `AskUserQuestion`.
- Do not inject `AskHuman` from the chat orchestrator.
- Do not add a workflow YAML field for AskHuman.
- `NativeTool.handler` remains `Promise<string>`.
- `pendingInteractionSchema` stays the single row shape in `packages/workflows/src/schemas/pending-interaction.ts`.
- Server routes import or `.extend` that schema and do not fork it.
- `node_awaiting` is written in the same `withTransaction` as the pending insert through `insertWorkflowEvent`, never through fire-and-forget `createWorkflowEvent`.
- Schema changes are additive-only and mirrored in `migrations/000_combined.sql` and `SqliteAdapter.createSchema`.
- Put PostgreSQL column comments in the trailing Indexes and column comments section.
- Do not add a redundant standalone index.
- The unique constraint on `(workflow_run_id, tool_use_id)` is the covering lookup.
- Regenerated files must come from their generators: `bun run generate:bundled-schema`, `bun run generate:capability-matrix`, and `packages/web` `generate:types`.
- Do not use `any`.
- Import engine Zod from `@hono/zod-openapi`.
- Claude converters remain a documented `zod` direct-import exception.
- Add every new `mock.module()` test file as its own `bun test <file>` process.
- Do not run an unscoped `bun test` from the repository root.
- Run focused tests from the package directory.
- Finish with `bun run validate` from the repository root.
- Keep each RED test in place, observe the expected failure, add only the minimal production behavior, observe GREEN, then run an explicit REFACTOR step while those tests remain green, then commit.
- Keep each full Markdown sentence on its own physical line in this plan.

---

## Verified Repository Baseline

- `pendingInteractionSchema` already exists at `packages/workflows/src/schemas/pending-interaction.ts` and types the empty GET-run embed from Story 5.1.
- `GET /api/workflows/runs/:runId` currently hardcodes `pending_interactions: []` in `packages/server/src/routes/api.ts`.
- `IWorkflowStore.pauseWorkflowRun` requires `ApprovalContext` and `packages/core/src/db/workflows.ts` always json-merges `metadata.approval`.
- `pauseWorkflowRun` updates only `WHERE status = 'running'` and throws on a zero-row match.
- `createWorkflowEvent` is fire-and-forget.
- Transactional event writes use `insertWorkflowEvent` inside `withTransaction`.
- `WORKFLOW_EVENT_TYPES` does not include `node_awaiting` or `interaction_resolved`.
- `nodeStateSchema`, `workflowStepStatusSchema`, and server `workflowNodeStateSchema.status` are `pending|running|completed|failed|skipped`.
- `projectLatestEffectiveNodeStates` in `packages/workflows/src/retry-state.ts` ignores unknown event types and does not read pending rows.
- `NativeTool.handler` is `(input) => Promise<string>` with no context argument.
- Claude `buildArchonMcpServer` and Pi `buildPiNativeToolDefinitions` await the handler with no try/catch, so a throw becomes a tool error inside the agent loop.
- Converters accept only a flat object of string / string-enum / boolean fields.
- `dag-executor` never sets `SendQueryOptions.nativeTools`.
- Chat orchestrator injects only `manage_run` when `capabilities.nativeTools` is true.
- `ProviderCapabilities` has no `askHuman` field.
- Claude and Pi have `nativeTools: true`.
- Codex, Grok, OpenCode, Copilot, OMP, QoderCLI, and e2e-fake have `nativeTools: false`.
- Load-time `allowed_tools` checks are warnings, never start-blocking errors.
- Application table 22 is `remote_agent_workflow_node_messages`.
- SQLite parity floor is `MIN_NON_AUTH_COLUMNS = 169`.
- Story 6.1 confirmed Claude `0.3.209` host-abort plus one provider-owned user message, and Pi durable `appendMessage` then `session.agent.continue()`.
- Story 6.3, not this story, implements that resume protocol.

## File Map

### Engine contracts

- Modify `packages/workflows/src/schemas/workflow-run.ts` to add `awaiting` to `workflowStepStatusSchema` and `nodeStateSchema`.
- Modify `packages/workflows/src/schemas/pending-interaction.ts` to add `insertPendingInteractionSchema`.
- Modify `packages/workflows/src/schemas/pending-interaction.test.ts` for the insert schema.
- Modify `packages/workflows/src/store.ts` to add `node_awaiting` and `interaction_resolved`, optionalize `pauseWorkflowRun`, and compose `IWorkflowPendingInteractionStore`.
- Modify `packages/workflows/src/retry-state.ts` so the projector maps `node_awaiting` or pending rows to `awaiting` and ignores `interaction_resolved` as completion.
- Modify `packages/workflows/src/retry-state.test.ts` for those projector rules.
- Create `packages/workflows/src/ask-human.ts` for the NativeTool, input schema, and persist-then-throw handler.
- Create `packages/workflows/src/ask-human.test.ts` for handler behavior.
- Modify `packages/workflows/src/dag-executor.ts` to inject AskHuman, catch branded errors, Ask-pause, and CAP-7 preflight.
- Modify `packages/workflows/src/dag-executor.test.ts` for inject, pause, no `node_completed`, no-starter fail, and CAP-7.
- Modify `packages/workflows/src/executor.test.ts`, `executor-preamble.test.ts`, `script-node-deps.test.ts`, and `subrun.test.ts` so store doubles satisfy the new ports.
- Modify `packages/workflows/package.json` to run `src/ask-human.test.ts` in its own `bun test` invocation.

### Persistence

- Modify `migrations/000_combined.sql` to add application table 23 and trailing column comments.
- Modify `packages/core/src/db/adapters/sqlite.ts` to mirror the table in `createSchema`.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` to raise the parity floor to 181 and assert the fresh schema.
- Modify `packages/core/src/db/bundled-schema.generated.ts` only through `bun run generate:bundled-schema`.
- Modify `AGENTS.md` to document 23 application tables and Better Auth tables 24 through 27.
- Create `packages/core/src/schemas/pending-interaction.ts` as the core row-schema alias.
- Modify `packages/core/src/schemas/index.ts` to export that alias.
- Create `packages/core/src/db/workflow-pending-interactions.ts` for insert, list, no-starter, and same-transaction `node_awaiting`.
- Create `packages/core/src/db/workflow-pending-interactions.test.ts` as its own mock-isolated shard.
- Modify `packages/core/src/db/index.ts` to add namespaced and direct exports.
- Modify `packages/core/src/db/workflows.ts` so Ask pause omits `metadata.approval` and is idempotent when already paused.
- Modify `packages/core/src/db/workflows.test.ts` for those pause behaviors.
- Modify `packages/core/src/workflows/store-adapter.ts` to implement the new ports and pass optional approval through.
- Modify `packages/core/src/workflows/store-adapter.test.ts` for the new required methods.
- Modify `packages/core/package.json` to run `workflow-pending-interactions.test.ts` in its own invocation.

### Providers

- Modify `packages/providers/src/types.ts` to add `AskHumanAwaitingError`, `AskHumanNoStarterError`, optional `NativeToolHandlerContext`, and `sessionIdSink`.
- Modify `packages/providers/src/claude/native-tools.ts` to convert AskHuman `questions[]` and reject branded errors out of `sendQuery`.
- Modify `packages/providers/src/claude/native-tools.test.ts` for nested schema and branded-error reject.
- Modify `packages/providers/src/claude/provider.ts` to wire the branded-error abort path and write `sessionIdSink`.
- Modify `packages/providers/src/community/pi/native-tools.ts` with the same converter and reject rules.
- Modify `packages/providers/src/community/pi/native-tools.test.ts` for the same cases.
- Modify `packages/providers/src/community/pi/provider.ts` to reject branded errors and write `sessionIdSink`.
- Modify every `capabilities.ts` under `packages/providers/src/` so `askHuman` is a required `ProviderCapabilities` field and is true only for Claude and Pi.
- Modify capability object literals in provider tests that type-check against `ProviderCapabilities`.
- Modify `scripts/generate-capability-matrix.ts` to add the `askHuman` axis.
- Modify `packages/docs-web/src/content/docs/reference/provider-capabilities.md` only through `bun run generate:capability-matrix`.

### HTTP, SSE, chat

- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` to add `awaiting` to `workflowNodeStateSchema.status`.
- Modify `packages/server/src/routes/api.ts` to list pending rows and pass them into the projector.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` to mock the new DB module and cover embed, awaiting, and empty messages.
- Modify `packages/server/src/adapters/web/workflow-bridge.ts` and `dashboard-event-poller.ts` so `node_awaiting` is a refetch trigger without an envelope.
- Modify `packages/server/src/adapters/web/dashboard-event-poller.test.ts` and `workflow-bridge.test.ts` for that mapping.
- Modify `packages/workflows/src/event-emitter.ts` to add a live `node_awaiting` event with `runId` and `nodeId` only.
- Modify `packages/core/src/orchestrator/orchestrator-agent.test.ts` so chat still injects only `manage_run`.
- Regenerate `packages/web/src/lib/api.generated.d.ts` from a live server after the OpenAPI status enum changes.

### Completion tracking

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after all validation passes.

## Authoritative Contracts

### Pending table

PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS remote_agent_pending_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  tool_use_id VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('ask', 'permission')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'answered', 'purged')),
  envelope JSONB NOT NULL,
  answer JSONB,
  provider_session_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  CONSTRAINT uq_pending_interactions_run_tool_use
    UNIQUE (workflow_run_id, tool_use_id)
);
```

SQLite uses TEXT for ids, json columns, and timestamps, keeps the same checks and named unique constraint, and uses `ON DELETE CASCADE`.
The store supplies a dialect-generated id.
`tool_use_id` is unique per run and is the Ask `request_id`.
Do not add a second index.

### Store ports

```ts
export interface InsertPendingInteractionInput {
  workflow_run_id: string;
  node_id: string;
  tool_use_id: string;
  kind: 'ask' | 'permission';
  envelope: Record<string, unknown>;
  provider_session_id: string;
}

export interface IWorkflowPendingInteractionStore {
  insertPendingInteraction(input: InsertPendingInteractionInput): Promise<PendingInteraction>;
  listPendingInteractions(workflowRunId: string): Promise<PendingInteraction[]>;
}

pauseWorkflowRun(
  id: string,
  approvalContext?: ApprovalContext,
  extraMetadata?: Record<string, unknown>
): Promise<void>;
```

`insertPendingInteraction` must, in one `withTransaction`:

1. `SELECT user_id, status FROM remote_agent_workflow_runs WHERE id = $1` with the same dialect lock as `rowLockClause()` in `packages/core/src/db/workflows.ts` (` FOR UPDATE` on PostgreSQL, empty on SQLite).
2. Throw `AskHumanNoStarterError` if `user_id` is null, without inserting.
3. Insert the row with `status = 'pending'`, `answer = null`, `resolved_at = null`, `resolved_by = null`.
4. `insertWorkflowEvent` with `event_type: 'node_awaiting'`, `step_name: node_id`, and `data: { node_id, tool_use_id, kind }` only.
5. Return the inserted row.

`listPendingInteractions` returns every row for the run ordered by `created_at` ascending, then `id` ascending.
Do not add `resolvePendingInteraction`.

### Ask pause

When `approvalContext` is provided, keep today's gate write, including explicit-null approval subfields and `WHERE status = 'running'`.
When `approvalContext` is omitted, set `status = 'paused'` and do not json-merge `metadata.approval` or any other metadata.
If that UPDATE matches zero rows and the current status is `paused`, return success.
If that UPDATE matches zero rows and the status is anything else, throw the existing not-running error.
Do not emit `approval_pending` for Ask.

### Projector

`RetryNodeProjection.state` uses `NodeState`, which now includes `awaiting`.
Do not add `awaiting` to `nodeOutputSchema`.
An asking node still returns `{ state: 'completed', output }` so the between-layer paused check halts the DAG, matching `executeApprovalNode`.

```ts
projectLatestEffectiveNodeStates(
  events: readonly RetryProjectionEvent[],
  pending?: readonly { node_id: string; status: string }[]
): Map<string, RetryNodeProjection>
```

Event rules in order:

- Existing retry/start/completed/failed/skipped rules stay.
- `node_awaiting` sets `state: 'awaiting'` and does not write output.
- `interaction_resolved` does not change state and never completes the node.

After events, every `pending` row with `status === 'pending'` forces that `node_id` to `awaiting` if the event state is not already `failed` or `skipped`.
`GET` run passes `listPendingInteractions` into this overlay.
`settleApiWorkflowNodeStatesForRunStatus` must not rewrite `awaiting` on a paused run.

### AskHuman tool

Name is `AskHuman`.
Claude MCP remains `mcp__archon__AskHuman` because `ARCHON_TOOL_SERVER` is `archon`.

```ts
export const ASK_HUMAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Ordered structured questions for the run starter.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};
```

Description is exactly: `Ask the run starter one or more structured questions. Call this tool instead of asking in prose. Wait after calling; do not guess the answer.`

Handler algorithm:

1. Validate `questions` as a non-empty array of the fields above.
2. Invalid input throws a normal `Error`, which remains a tool error.
3. `toolUseId` comes from `NativeToolHandlerContext.toolUseId`.
4. `provider_session_id` comes from `context.sessionId` or `sessionIdSink.current`.
5. Missing `toolUseId` or empty session id throws a normal `Error`.
6. Call `insertPendingInteraction` with `kind: 'ask'` and `envelope: { questions }`.
7. Log `workflow.ask_pending` with `workflowRunId`, `nodeId`, `toolUseId`, and `kind` only.
8. Throw `AskHumanAwaitingError`.

Never log envelope, question text, or answer bodies.

### Provider wrappers

```ts
export interface NativeToolHandlerContext {
  toolUseId?: string;
  sessionId?: string;
}

export class AskHumanAwaitingError extends Error {
  readonly name = 'AskHumanAwaitingError';
  constructor(
    readonly toolUseId: string,
    readonly nodeId: string,
    readonly workflowRunId: string
  ) {
    super(`AskHuman awaiting input for ${toolUseId}`);
  }
}

export class AskHumanNoStarterError extends Error {
  readonly name = 'AskHumanNoStarterError';
  constructor(readonly workflowRunId: string) {
    super(`AskHuman requires workflow_runs.user_id (run ${workflowRunId})`);
  }
}
```

`NativeTool.handler` is `(input: Record<string, unknown>, context?: NativeToolHandlerContext) => Promise<string>`.
Claude and Pi wrappers catch `AskHumanAwaitingError` and `AskHumanNoStarterError`, abort the in-flight query, and reject `sendQuery` with the same instance.
Other handler throws remain tool errors.
If Claude's MCP callback has no tool-use id, the wrapper generates `crypto.randomUUID()` and passes it as `toolUseId`.
Pi passes execute `_toolCallId`.
Providers copy every discovered SDK session id into `SendQueryOptions.sessionIdSink.current` before tool dispatch when possible.

Converters must accept, fail-fast otherwise:

- string
- string enum
- boolean
- array of strings
- array of objects whose fields are those types

Do not add `resumeInteractions` in this story.

### Executor

Inject `AskHuman` onto `command`, `prompt`, and `loop` sendQuery options when `getProviderCapabilities(provider).askHuman` is true.
Do not inject for bash, script, approval, plannotator_gate, workflow, route_loop, or loop_group containers.
Loop-group body command/prompt/loop nodes enter the existing executors and therefore receive the tool.
On `AskHumanAwaitingError`, call `pauseWorkflowRun(runId)` with no approval context, skip `node_completed` and `node_failed`, skip `approval_pending`, and return `{ state: 'completed', output: nodeOutputText }`.
On `AskHumanNoStarterError`, take the existing node-failed path and do not pause.
Do not resume.

### CAP-7

Before any node runs, walk every `command` / `prompt` / `loop` node, including nested `loop_group` bodies, using the same scope inheritance as `collectContainerIncompatibleProviders`.
If `allowed_tools` contains `AskHuman` or `mcp__archon__AskHuman` after stripping a `Name(specifier)` suffix, and the resolved provider has `askHuman === false`, throw before the first turn:

`AskHuman is not supported by provider '<id>'. Remove AskHuman from allowed_tools, or use claude or pi.`

The same workflow without that `allowed_tools` entry starts and has no Ask tool.
Do not fail identity-less CLI runs at start.

### SSE

`node_awaiting` maps to `workflow_status` with `status: 'paused'` and no `approval` field and no envelope.
Add `node_awaiting` to `DASHBOARD_SOURCE_EVENT_TYPES`.
Live emitter payload is `{ type: 'node_awaiting', runId, nodeId }` only.

---

## Open Questions With Binding Provisional Defaults

### Q1: How does Claude MCP supply `tool_use_id` to the in-process tool callback?

**Provisional default:** Pass the SDK tool-use id when the callback exposes it.
Otherwise generate `crypto.randomUUID()` in the Claude wrapper.
Pi always uses `_toolCallId`.
Story 6.3 Claude resume is a new user message and does not reissue AskHuman, so a generated request id is a valid pending-row identity on `0.3.209`.

### Q2: What if `provider_session_id` is still empty when AskHuman persists?

**Provisional default:** Fail persist with a normal `Error`, not `AskHumanAwaitingError`.
Do not write an empty session id.
Providers must copy session ids into `sessionIdSink` from the earliest SDK event that carries one.

### Q3: Does GET embed return answered and purged rows?

**Provisional default:** Return every row for the run ordered by `created_at`, then `id`.
The projector overlays only `status === 'pending'`.
Story 6.5 filters cards.

### Q4: Should Ask pause clear a leftover `metadata.approval` from an earlier gate in the same run?

**Provisional default:** Do not clear it.
Not writing the slot is the Story 6.2 rule.
Clearing would mutate declared-gate state.

### Q5: What if local PostgreSQL is unavailable?

**Provisional default:** Always run SQLite parity, migration-order, and bundled-schema checks.
Run `bun run check:schema-upgrades` when `DATABASE_URL` or `PGHOST` identifies a reachable PostgreSQL instance.
CI remains the required PostgreSQL upgrade gate.

### Q6: Does `allowed_tools: [mcp__archon__AskHuman]` also trip CAP-7?

**Provisional default:** Yes.
Treat both `AskHuman` and `mcp__archon__AskHuman` as explicit AskHuman names after specifier stripping.

---

### Task 1: Add `awaiting` to node status enums and the projector

**Files:**

- Modify: `packages/workflows/src/schemas/workflow-run.ts`.
- Modify: `packages/workflows/src/retry-state.ts`.
- Test: `packages/workflows/src/retry-state.test.ts`.

**Interfaces:**

- Consumes: current `projectLatestEffectiveNodeStates(events)` and `NodeState`.
- Produces: `NodeState` including `'awaiting'`; `projectLatestEffectiveNodeStates(events, pending?)`.

- [ ] **Step 1: Write the failing projector tests.**

Append to `packages/workflows/src/retry-state.test.ts`:

```ts
test('maps node_awaiting to awaiting without completing the node', () => {
  const states = projectLatestEffectiveNodeStates([
    { event_type: 'node_started', step_name: 'review', data: {} },
    { event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1', kind: 'ask' } },
  ]);
  expect(states.get('review')?.state).toBe('awaiting');
});

test('does not complete a node on interaction_resolved', () => {
  const states = projectLatestEffectiveNodeStates([
    { event_type: 'node_started', step_name: 'review', data: {} },
    { event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review' } },
    { event_type: 'interaction_resolved', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1' } },
  ]);
  expect(states.get('review')?.state).toBe('awaiting');
});

test('pending rows overlay awaiting onto a running node', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [{ node_id: 'review', status: 'pending' }]
  );
  expect(states.get('review')?.state).toBe('awaiting');
});

test('answered pending rows do not overlay awaiting', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [{ node_id: 'review', status: 'answered' }]
  );
  expect(states.get('review')?.state).toBe('running');
});

test('pending overlay does not replace failed or skipped', () => {
  const failed = projectLatestEffectiveNodeStates(
    [
      { event_type: 'node_started', step_name: 'review', data: {} },
      { event_type: 'node_failed', step_name: 'review', data: { error: 'boom' } },
    ],
    [{ node_id: 'review', status: 'pending' }]
  );
  expect(failed.get('review')?.state).toBe('failed');
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/retry-state.test.ts)
```

Expected: FAIL because `awaiting` is not a `NodeState` and the function does not take pending rows.

- [ ] **Step 3: Add `awaiting` and implement the projector rules.**

In `packages/workflows/src/schemas/workflow-run.ts` change both enums to:

```ts
export const workflowStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
]);

export const nodeStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
]);
```

Do not add `awaiting` to `workflowRunStatusSchema` or `nodeOutputSchema`.
Change `RetryNodeProjection.state` from `NodeOutput['state']` to `NodeState`.
Implement the event and pending overlay rules in the authoritative contract.
Import `NodeState` from `./schemas`.
Do not treat `interaction_resolved` as completion.

- [ ] **Step 4: Re-run the projector tests.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/schemas/workflow-run.ts packages/workflows/src/retry-state.ts packages/workflows/src/retry-state.test.ts
git commit -m "feat(workflows): project awaiting from node_awaiting and pending rows"
```

---

### Task 2: Make Ask pause optional-approval and idempotent

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/core/src/db/workflows.ts`.
- Test: `packages/core/src/db/workflows.test.ts`.

**Interfaces:**

- Consumes: current required `pauseWorkflowRun(id, approvalContext, extraMetadata?)`.
- Produces: `pauseWorkflowRun(id, approvalContext?, extraMetadata?)`.

- [ ] **Step 1: Write the failing pause tests.**

Append inside `describe('pauseWorkflowRun')` in `packages/core/src/db/workflows.test.ts`:

```ts
test('Ask pause sets paused and does not write metadata.approval', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

  await pauseWorkflowRun('workflow-run-123');

  const [query, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  expect(query).toContain("status = 'paused'");
  expect(query).toContain("AND status = 'running'");
  expect(query).not.toContain('metadata');
  expect(params).toEqual(['workflow-run-123']);
});

test('Ask pause succeeds when the run is already paused', async () => {
  mockQuery
    .mockResolvedValueOnce(createQueryResult([], 0))
    .mockResolvedValueOnce(createQueryResult([{ status: 'paused' }], 1));

  await pauseWorkflowRun('workflow-run-123');
});

test('Ask pause still throws when the run is completed', async () => {
  mockQuery
    .mockResolvedValueOnce(createQueryResult([], 0))
    .mockResolvedValueOnce(createQueryResult([{ status: 'completed' }], 1));

  await expect(pauseWorkflowRun('workflow-run-123')).rejects.toThrow(
    'not found or not in running state'
  );
});

test('gate pause still writes metadata.approval', async () => {
  mockQuery.mockResolvedValueOnce(createQueryResult([], 1));

  await pauseWorkflowRun('workflow-run-123', {
    nodeId: 'review',
    message: 'Please review',
    type: 'approval',
  });

  const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
  const payload = JSON.parse(params[1] as string) as { approval: Record<string, unknown> };
  expect(payload.approval.nodeId).toBe('review');
  expect(payload.approval.resolved).toBeNull();
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/core && bun test src/db/workflows.test.ts)
```

Expected: FAIL because the second argument is required and every pause writes `metadata.approval`.

- [ ] **Step 3: Optionalize the port and implement Ask pause.**

Change `IWorkflowStore.pauseWorkflowRun` in `packages/workflows/src/store.ts` to `approvalContext?: ApprovalContext`.
In `packages/core/src/db/workflows.ts`, branch on `approvalContext === undefined` using the Ask pause contract.
Keep the existing approval json-merge path byte-for-byte when context is provided, including the current throw on zero rows without a paused fallback.

- [ ] **Step 4: Re-run the pause tests.**

Run the command from Step 2.

Expected: PASS, including the older gate tests.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts
git commit -m "feat(core): pause Ask runs without writing metadata.approval"
```

---

### Task 3: Add `remote_agent_pending_interactions` additively

**Files:**

- Modify: `migrations/000_combined.sql`.
- Modify: `packages/core/src/db/adapters/sqlite.ts`.
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`.
- Modify: `AGENTS.md`.
- Modify: `packages/core/src/db/bundled-schema.generated.ts` via generator only.

**Interfaces:**

- Consumes: table 22 `remote_agent_workflow_node_messages` placement.
- Produces: table 23 with 12 columns and unique `(workflow_run_id, tool_use_id)`.

- [ ] **Step 1: Write the failing fresh-schema test.**

Add beside the node-messages fresh-schema test in `packages/core/src/db/adapters/sqlite.test.ts`:

```ts
test('pending interactions table mirrors the Postgres contract', async () => {
  db = createTestDb();
  expect(raw_pragma(currentDbPath, 'remote_agent_pending_interactions').sort()).toEqual(
    [
      'answer',
      'created_at',
      'envelope',
      'id',
      'kind',
      'node_id',
      'provider_session_id',
      'resolved_at',
      'resolved_by',
      'status',
      'tool_use_id',
      'workflow_run_id',
    ].sort()
  );
  expect(getSchemaSQL()).toContain('uq_pending_interactions_run_tool_use');
  expect(getSchemaSQL()).toContain('remote_agent_pending_interactions');
});
```

Change `MIN_NON_AUTH_COLUMNS` from `169` to `181`.

- [ ] **Step 2: Run the schema tests and verify they fail.**

Run:

```bash
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts)
```

Expected: FAIL because the table does not exist and the parity floor is still 169.

- [ ] **Step 3: Add the table in both dialects.**

Update `migrations/000_combined.sql` header from 22 application tables to 23, listing `remote_agent_pending_interactions` as 23 and Better Auth as 24-27.
Place the PostgreSQL `CREATE TABLE` from the authoritative contract after `remote_agent_workflow_node_messages` and before `-- Indexes and column comments`.
Keep `COMMENT ON TABLE` beside the create.
Put every `COMMENT ON COLUMN` in the trailing section.
Do not add `CREATE INDEX`.

Mirror the table in `SqliteAdapter.createSchema` immediately after the node-messages table, using TEXT ids, TEXT json, TEXT timestamps, the same CHECKs, named unique constraint, and `ON DELETE CASCADE`.
Do not add the table to `migrateColumns`.

Update `AGENTS.md` so the application table count is 23, item 23 documents this table, and Better Auth tables are 24-27.

- [ ] **Step 4: Generate bundled schema and re-run schema tests.**

Run:

```bash
bun run generate:bundled-schema
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the schema tests from Step 4.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/bundled-schema.generated.ts AGENTS.md
git commit -m "feat(db): add remote_agent_pending_interactions"
```

---

### Task 4: Insert and list pending rows in the same transaction as `node_awaiting`

**Files:**

- Modify: `packages/workflows/src/schemas/pending-interaction.ts`.
- Modify: `packages/workflows/src/schemas/pending-interaction.test.ts`.
- Create: `packages/core/src/schemas/pending-interaction.ts`.
- Modify: `packages/core/src/schemas/index.ts`.
- Create: `packages/core/src/db/workflow-pending-interactions.ts`.
- Test: `packages/core/src/db/workflow-pending-interactions.test.ts`.
- Modify: `packages/core/src/db/index.ts`.
- Modify: `packages/core/package.json`.

**Interfaces:**

- Consumes: `pendingInteractionSchema`, `insertWorkflowEvent`, `AskHumanNoStarterError`.
- Produces: `insertPendingInteraction`, `listPendingInteractions`.

- [ ] **Step 1: Add insert schema tests first.**

Append to `packages/workflows/src/schemas/pending-interaction.test.ts`:

```ts
import { insertPendingInteractionSchema } from './pending-interaction';

test('insert schema omits store-assigned fields and defaults pending', () => {
  const parsed = insertPendingInteractionSchema.parse({
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    envelope: { questions: [] },
    provider_session_id: 'sess-1',
  });
  expect(parsed.kind).toBe('ask');
});

test('insert schema rejects empty provider_session_id', () => {
  expect(
    insertPendingInteractionSchema.safeParse({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions: [] },
      provider_session_id: '',
    }).success
  ).toBe(false);
});
```

Define `insertPendingInteractionSchema` as a strict object with the `InsertPendingInteractionInput` fields and `z.infer`.
Export `InsertPendingInteractionInput` from that infer.

- [ ] **Step 2: Write failing DB tests in an isolated file.**

Create `packages/core/src/db/workflow-pending-interactions.test.ts` using the same `mock.module('./connection')` pattern as `workflow-node-messages.test.ts`.
Cover these behaviors with explicit SQL assertions:

1. No-starter: first SELECT returns `{ user_id: null }`, no INSERT, throws `AskHumanNoStarterError`.
2. Happy path: SELECT `{ user_id: 'user-1' }`, INSERT pending row, `insertWorkflowEvent` equivalent INSERT into `remote_agent_workflow_events` with `event_type = 'node_awaiting'` and data lacking envelope/answer, all inside `withTransaction`.
3. List orders by `created_at` ascending.
4. Unique violation on `(workflow_run_id, tool_use_id)` throws rather than updating.

- [ ] **Step 3: Run the new tests and verify they fail.**

Add this exact invocation to `packages/core/package.json` immediately after `bun test src/db/workflow-node-messages.test.ts`:

`&& bun test src/db/workflow-pending-interactions.test.ts`

Run:

```bash
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the DB module.**

Create `packages/core/src/db/workflow-pending-interactions.ts` implementing the insert transaction contract.
Add `AskHumanNoStarterError` and `AskHumanAwaitingError` to `packages/providers/src/types.ts` using the exact classes in Authoritative Contracts if they are not already present.
Import `AskHumanNoStarterError` from `@archon/providers/types`.
Lock the run row with the same dialect clause as `rowLockClause()` in `packages/core/src/db/workflows.ts`.
Alias the engine schema from `packages/core/src/schemas/pending-interaction.ts` as `export { pendingInteractionSchema, insertPendingInteractionSchema, type PendingInteraction, type InsertPendingInteractionInput } from '@archon/workflows/schemas/pending-interaction';`.
Export namespaced `workflowPendingInteractionDb` and direct functions from `packages/core/src/db/index.ts` beside the node-message exports.
Never log `envelope` or `answer`.

- [ ] **Step 5: Re-run the isolated DB tests.**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 6: Refactor while green.**

Do not add behavior.
Re-run the command from Step 3.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/workflows/src/schemas/pending-interaction.ts packages/workflows/src/schemas/pending-interaction.test.ts packages/core/src/schemas/pending-interaction.ts packages/core/src/schemas/index.ts packages/core/src/db/workflow-pending-interactions.ts packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/index.ts packages/core/package.json packages/providers/src/types.ts
git commit -m "feat(core): persist pending interactions with node_awaiting"
```

---

### Task 5: Expose pending ports on `IWorkflowStore`

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/core/src/workflows/store-adapter.ts`.
- Modify: `packages/core/src/workflows/store-adapter.test.ts`.
- Modify: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/workflows/src/executor.test.ts`.
- Modify: `packages/workflows/src/executor-preamble.test.ts`.
- Modify: `packages/workflows/src/script-node-deps.test.ts`.
- Modify: `packages/workflows/src/subrun.test.ts`.

**Interfaces:**

- Consumes: `insertPendingInteraction` and `listPendingInteractions`.
- Produces: `IWorkflowStore` extending `IWorkflowPendingInteractionStore`.

- [ ] **Step 1: Write the failing adapter test.**

In `packages/core/src/workflows/store-adapter.test.ts`, extend `requiredMethods` with `'insertPendingInteraction'` and `'listPendingInteractions'`.
Add a mock.module for `../db/workflow-pending-interactions` before the adapter import, matching the node-messages mock.

- [ ] **Step 2: Run the adapter test and verify it fails.**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

Expected: FAIL because `createWorkflowStore()` does not yet expose the methods.

- [ ] **Step 3: Add the narrow store capability and wire the adapter.**

In `packages/workflows/src/store.ts`:

```ts
export interface IWorkflowPendingInteractionStore {
  insertPendingInteraction(input: InsertPendingInteractionInput): Promise<PendingInteraction>;
  listPendingInteractions(workflowRunId: string): Promise<PendingInteraction[]>;
}
```

Extend `IWorkflowStore` with that interface beside `IWorkflowNodeMessageStore`.
Do not add `resolvePendingInteraction`.
Wire pass-throughs in `createWorkflowStore()`.
Add in-memory implementations to every typed `IWorkflowStore` double listed in Files.
`subrun.test.ts` `InMemoryStore` should store rows in an array and return them for the run.

- [ ] **Step 4: Re-run adapter and workflow store-double tests.**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
(cd packages/workflows && bun test src/executor.test.ts src/executor-preamble.test.ts src/script-node-deps.test.ts src/subrun.test.ts)
```

Expected: PASS, including TypeScript compile of the doubles.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 4.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/executor.test.ts packages/workflows/src/executor-preamble.test.ts packages/workflows/src/script-node-deps.test.ts packages/workflows/src/subrun.test.ts packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts
git commit -m "feat(workflows): add pending interaction store ports"
```

---

### Task 6: Embed pending rows on GET run and keep messages Ask-free

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts`.
- Modify: `packages/server/src/routes/api.ts`.
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`.
- Modify: `packages/web/src/lib/api.generated.d.ts` via generator only.

**Interfaces:**

- Consumes: `listPendingInteractions`, `projectLatestEffectiveNodeStates(events, pending)`.
- Produces: GET run `pending_interactions` from the table and `nodeStates[].status` including `awaiting`.

- [ ] **Step 1: Write the failing GET-run tests.**

In `packages/server/src/routes/api.workflow-runs.test.ts` add `mock.module('@archon/core/db/workflow-pending-interactions', () => ({ listPendingInteractions: mockListPendingInteractions }))`.
Replace the Story 5.1 test that expects a hardcoded empty array without a table with tests that:

1. Return listed rows through `pending_interactions`.
2. Project `awaiting` when events include `node_started` plus a pending row for that node.
3. Keep `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` free of Ask envelopes in `status` payloads.
4. Keep OpenAPI `pending_interactions` required and `WorkflowNodeState.status` enum including `awaiting`.

Add `awaiting` to `workflowNodeStateSchema.status` in the same task's implementation step, not by forking `pendingInteractionSchema`.

- [ ] **Step 2: Run the workflow-runs tests and verify the new cases fail.**

Run:

```bash
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
```

Expected: FAIL on embed contents and awaiting status.

- [ ] **Step 3: Implement GET-run wiring.**

Change `projectApiWorkflowNodeStates` to accept pending rows and pass `{ node_id, status }` into `projectLatestEffectiveNodeStates`.
Call `listPendingInteractions(runId)` in the GET-run handler and return those rows as `pending_interactions`.
Do not read pending data from transcript messages.
Do not rewrite `awaiting` in `settleApiWorkflowNodeStatesForRunStatus`.

- [ ] **Step 4: Re-run the route tests and regenerate web types.**

Run the command from Step 2.
Then start the server long enough to run `bun --filter @archon/web generate:types` against that live OpenAPI document.
Do not hand-edit `api.generated.d.ts`.

Expected: route tests PASS and generated `WorkflowNodeState` status includes `awaiting`.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the route tests from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-runs.test.ts packages/web/src/lib/api.generated.d.ts
git commit -m "feat(server): embed pending interactions and awaiting node state"
```

---

### Task 7: Make `node_awaiting` a refetch trigger

**Files:**

- Modify: `packages/workflows/src/store.ts`.
- Modify: `packages/workflows/src/event-emitter.ts`.
- Modify: `packages/server/src/adapters/web/workflow-bridge.ts`.
- Test: `packages/server/src/adapters/web/dashboard-event-poller.test.ts`.
- Modify: `packages/server/src/adapters/web/workflow-bridge.test.ts` if live mapping is tested there.

**Interfaces:**

- Consumes: `WORKFLOW_EVENT_TYPES`, `DASHBOARD_SOURCE_EVENT_TYPES`, `mapWorkflowEventRow`.
- Produces: `node_awaiting` and `interaction_resolved` event type names; SSE refetch without envelope.

- [ ] **Step 1: Write the failing SSE mapping test.**

In `packages/server/src/adapters/web/dashboard-event-poller.test.ts`:

```ts
test('node_awaiting → workflow_status paused without approval payload', () => {
  const e = JSON.parse(
    mapWorkflowEventRow(
      row({ event_type: 'node_awaiting', step_name: 'review', data: { node_id: 'review', tool_use_id: 'toolu_1', kind: 'ask' } })
    ) as string
  );
  expect(e).toMatchObject({ type: 'workflow_status', runId: 'r1', status: 'paused' });
  expect(e.approval).toBeUndefined();
  expect(e.envelope).toBeUndefined();
  expect(e.questions).toBeUndefined();
});
```

- [ ] **Step 2: Run the poller tests and verify they fail.**

Run:

```bash
(cd packages/server && bun test src/adapters/web/dashboard-event-poller.test.ts)
```

Expected: FAIL because `node_awaiting` is unmapped.

- [ ] **Step 3: Add event types and mapping.**

Append `'node_awaiting'` and `'interaction_resolved'` to `WORKFLOW_EVENT_TYPES`.
Add live emitter event `{ type: 'node_awaiting'; runId: string; nodeId: string }`.
Do not put `node_awaiting` in `ROW_WORKFLOW_STATUS` because that map cannot express `paused`.
Add a special case in `mapWorkflowEventRow` beside `approval_requested` that emits `workflow_status` with `status: 'paused'` and omits `approval`, `envelope`, and `questions`.
Append `'node_awaiting'` to `DASHBOARD_SOURCE_EVENT_TYPES`.
Do not map a card payload.
Do not map `interaction_resolved` beyond allowing the type name.

- [ ] **Step 4: Re-run the poller tests.**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/store.ts packages/workflows/src/event-emitter.ts packages/server/src/adapters/web/workflow-bridge.ts packages/server/src/adapters/web/dashboard-event-poller.test.ts packages/server/src/adapters/web/workflow-bridge.test.ts
git commit -m "feat(server): treat node_awaiting as an SSE refetch trigger"
```

---

### Task 8: Reject branded Ask errors and convert `questions[]`

**Files:**

- Modify: `packages/providers/src/types.ts`.
- Modify: `packages/providers/src/claude/native-tools.ts`.
- Test: `packages/providers/src/claude/native-tools.test.ts`.
- Modify: `packages/providers/src/claude/provider.ts`.
- Modify: `packages/providers/src/community/pi/native-tools.ts`.
- Test: `packages/providers/src/community/pi/native-tools.test.ts`.
- Modify: `packages/providers/src/community/pi/provider.ts`.

**Interfaces:**

- Consumes: current flat converters and uncaught handler throws.
- Produces: nested AskHuman schema conversion, `NativeToolHandlerContext`, `sessionIdSink`, branded `sendQuery` reject.

- [ ] **Step 1: Write failing converter and branded-error tests.**

Use this AskHuman schema fixture in both native-tools test files:

```ts
const ASK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};
```

Add tests:

1. `buildArchonMcpServer` / `buildPiNativeToolDefinitions` accepts `ASK_SCHEMA`.
2. Number fields still throw `/unsupported type/`.
3. A handler that throws `AskHumanAwaitingError` causes the wrapper execute/tool callback to reject with the same instance rather than returning `{ content: [{ type: 'text', text: ... }] }`.

For test 3, export a small helper if that is the only way to invoke the wrapped handler without the SDK.
Otherwise invoke the mapped tool execute/callback directly if the SDK `tool()` returns a callable.

- [ ] **Step 2: Run the native-tools tests and verify they fail.**

Run:

```bash
(cd packages/providers && bun test src/claude/native-tools.test.ts)
(cd packages/providers && bun test src/community/pi/native-tools.test.ts)
```

Expected: FAIL on nested schema and branded-error stringifying.

- [ ] **Step 3: Implement types, converters, and reject path.**

Add to `packages/providers/src/types.ts`:

- `AskHumanAwaitingError` and `AskHumanNoStarterError` as specified, or keep the Task 4 definitions if they already exist.
- `NativeToolHandlerContext`.
- `handler: (input: Record<string, unknown>, context?: NativeToolHandlerContext) => Promise<string>`.
- `sessionIdSink?: { current?: string }` on `SendQueryOptions`.
Do not add `askHuman` to `ProviderCapabilities` in this task.

Extend both converters to accept array-of-strings and array-of-objects whose fields are string, string-enum, boolean, or array-of-strings.
In both wrappers:

```ts
try {
  const text = await spec.handler(args as Record<string, unknown>, {
    toolUseId,
    sessionId: sessionIdSink?.current,
  });
  return { content: [{ type: 'text', text }] };
} catch (err) {
  if (err instanceof AskHumanAwaitingError || err instanceof AskHumanNoStarterError) {
    throw err;
  }
  throw err;
}
```

Claude `sendQuery` must abort the query abort controller when those classes escape the MCP callback and rethrow them out of the generator.
Pi `sendQuery` must let those classes reject the generator rather than converting them to tool-result text.
Copy SDK session ids into `sessionIdSink.current` when first seen.
If Claude's callback has no tool-use id, pass `crypto.randomUUID()`.
Pi passes `_toolCallId`.
Keep `manage_run` on `Promise<string>` with an ignored second argument.

- [ ] **Step 4: Re-run native-tools tests.**

Run the commands from Step 2.

Expected: PASS.
Existing flat manage_run converter tests still PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/claude/native-tools.ts packages/providers/src/claude/native-tools.test.ts packages/providers/src/claude/provider.ts packages/providers/src/community/pi/native-tools.ts packages/providers/src/community/pi/native-tools.test.ts packages/providers/src/community/pi/provider.ts
git commit -m "feat(providers): reject AskHuman awaiting errors without stringifying"
```

---

### Task 9: Add the `askHuman` capability axis

**Files:**

- Modify: `packages/providers/src/types.ts` to add `askHuman: boolean` on `ProviderCapabilities`.
- Modify: every `packages/providers/src/**/capabilities.ts`.
- Modify: provider tests that construct `ProviderCapabilities` literals.
- Modify: `scripts/generate-capability-matrix.ts`.
- Modify: `packages/docs-web/src/content/docs/reference/provider-capabilities.md` via generator only.

**Interfaces:**

- Consumes: `ProviderCapabilities` without `askHuman`.
- Produces: `askHuman: true` only for Claude and Pi.

- [ ] **Step 1: Add the field and verify the matrix totality guard fails.**

Add `askHuman: boolean` to `ProviderCapabilities` in `packages/providers/src/types.ts` and do not yet add `AXES` or capability object fields.

Run:

```bash
bun run check:capability-matrix
```

Expected: FAIL because `askHuman` is missing from `AXES` or from provider objects.

- [ ] **Step 2: Set the flags and add the axis.**

Set `askHuman: true` in `packages/providers/src/claude/capabilities.ts` and `packages/providers/src/community/pi/capabilities.ts`.
Set `askHuman: false` in Codex, Grok, OpenCode, Copilot, OMP, QoderCLI, and e2e-fake capabilities.
Add `{ key: 'askHuman', label: 'AskHuman mid-turn questions' }` to `AXES`.
Update every test literal that is typed as `ProviderCapabilities`, including `observability.test.ts` and `registry.test.ts`.

- [ ] **Step 3: Regenerate the matrix and re-check.**

Run:

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
```

Expected: PASS, with Claude and Pi true and every other provider false.

- [ ] **Step 4: Refactor while green.**

Do not add behavior.
Re-run `bun run check:capability-matrix`.
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/types.ts packages/providers/src/claude/capabilities.ts packages/providers/src/community/pi/capabilities.ts packages/providers/src/codex/capabilities.ts packages/providers/src/grok/capabilities.ts packages/providers/src/community/opencode/capabilities.ts packages/providers/src/community/copilot/capabilities.ts packages/providers/src/community/omp/capabilities.ts packages/providers/src/community/qodercli/capabilities.ts packages/providers/src/e2e-fake/capabilities.ts scripts/generate-capability-matrix.ts packages/docs-web/src/content/docs/reference/provider-capabilities.md
git add packages/providers/src/observability.test.ts packages/providers/src/registry.test.ts packages/providers/src/claude/provider.test.ts packages/providers/src/codex/provider.test.ts packages/providers/src/community/pi/provider.test.ts
git commit -m "feat(providers): add askHuman capability axis"
```

---

### Task 10: Inject AskHuman, persist, throw, and pause without completing the node

**Files:**

- Create: `packages/workflows/src/ask-human.ts`.
- Test: `packages/workflows/src/ask-human.test.ts`.
- Modify: `packages/workflows/src/dag-executor.ts`.
- Test: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/workflows/package.json`.

**Interfaces:**

- Consumes: `insertPendingInteraction`, branded errors, `pauseWorkflowRun(id)`, `capabilities.askHuman`.
- Produces: workflow-owned `AskHuman` NativeTool injected on command/prompt/loop.

- [ ] **Step 1: Write failing AskHuman handler tests.**

Create `packages/workflows/src/ask-human.test.ts`:

```ts
import { describe, expect, test, mock } from 'bun:test';
import { AskHumanAwaitingError, AskHumanNoStarterError } from '@archon/providers/types';
import { createAskHumanTool, ASK_HUMAN_INPUT_SCHEMA } from './ask-human';
import type { IWorkflowStore } from './store';

const questions = [
  {
    id: 'q1',
    prompt: 'Ship it?',
    selection: 'single' as const,
    options: ['yes', 'no'],
    allowOther: false,
  },
];

function store(overrides: Partial<IWorkflowStore> = {}): IWorkflowStore {
  return {
    insertPendingInteraction: mock(async input => ({
      id: 'pending-1',
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      ...input,
    })),
    listPendingInteractions: mock(async () => []),
    ...overrides,
  } as IWorkflowStore;
}

describe('AskHuman tool', () => {
  test('persists envelope without answer then throws AskHumanAwaitingError', async () => {
    const s = store();
    const tool = createAskHumanTool({
      store: s,
      workflowRunId: 'run-1',
      nodeId: 'review',
    });
    await expect(
      tool.handler({ questions }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })
    ).rejects.toBeInstanceOf(AskHumanAwaitingError);
    expect(s.insertPendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions },
      provider_session_id: 'sess-1',
    });
  });

  test('does not stringify invalid questions as awaiting', async () => {
    const s = store();
    const tool = createAskHumanTool({ store: s, workflowRunId: 'run-1', nodeId: 'review' });
    await expect(tool.handler({ questions: 'nope' }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    expect(s.insertPendingInteraction).not.toHaveBeenCalled();
  });
});
```

Add `&& bun test src/ask-human.test.ts` to `packages/workflows/package.json` immediately after `bun test src/node-transcript.test.ts`.

- [ ] **Step 2: Run the handler tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/ask-human.test.ts)
```

Expected: FAIL because `ask-human.ts` does not exist.

- [ ] **Step 3: Implement `createAskHumanTool`.**

Create `packages/workflows/src/ask-human.ts` with `ASK_HUMAN_INPUT_SCHEMA`, name `AskHuman`, the exact description in the authoritative contract, and the persist-then-throw algorithm.
If `insertPendingInteraction` throws `AskHumanNoStarterError`, rethrow it unchanged.
Log `workflow.ask_pending` with ids only.

- [ ] **Step 4: Write failing executor tests, then implement injection.**

In `packages/workflows/src/dag-executor.test.ts` add tests that use a `sendQuery` mock which calls `options.nativeTools[0].handler` with valid questions and the context `{ toolUseId: 'toolu_1', sessionId: 'sess-1' }`, then ends without a result if the handler throws:

1. Claude command node: `insertPendingInteraction` called, `pauseWorkflowRun` called with only the run id, no `node_completed` event, no `approval` context, node return state `completed`.
2. Codex command node: `nativeTools` is undefined/empty.
3. `AskHumanNoStarterError` from insert: node fails, `pauseWorkflowRun` not called.
4. Loop node on Pi: same pause-without-approval behavior as (1).

Implement a helper in `dag-executor.ts` that, when `getProviderCapabilities(provider).askHuman` is true, sets:

```ts
sessionIdSink: { current: resumeSessionId },
nativeTools: [
  createAskHumanTool({ store: deps.store, workflowRunId: workflowRun.id, nodeId: stepName }),
],
```

Attach that helper on the command/prompt path in `executeNodeInternal` and the loop sendQuery path in `executeLoopNode`.
Catch `AskHumanAwaitingError` before the generic node-failed catch, pause without approval, emit live `node_awaiting` with runId and nodeId only, and return `{ state: 'completed', output: nodeOutputText }`.
Do not write `node_completed` or `node_failed` on that path.
Catch `AskHumanNoStarterError` with the existing failed path.

- [ ] **Step 5: Run handler and executor tests.**

Run:

```bash
(cd packages/workflows && bun test src/ask-human.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
```

Expected: PASS.
Fix any existing Claude option snapshots that break because `nativeTools` is now present by asserting AskHuman is included rather than deleting injection.

- [ ] **Step 6: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 5.
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/workflows/src/ask-human.ts packages/workflows/src/ask-human.test.ts packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/workflows/package.json
git commit -m "feat(workflows): persist AskHuman and pause without the approval slot"
```

---

### Task 11: Reject AskHuman on unsupported providers at run start and keep chat clean

**Files:**

- Modify: `packages/workflows/src/dag-executor.ts`.
- Modify: `packages/workflows/src/dag-executor.test.ts`.
- Modify: `packages/core/src/orchestrator/orchestrator-agent.test.ts`.

**Interfaces:**

- Consumes: `allowed_tools`, `capabilities.askHuman`, chat `nativeTools`.
- Produces: CAP-7 start throw; chat still injects only `manage_run`.

- [ ] **Step 1: Write failing CAP-7 and chat tests.**

Executor tests:

```ts
it('rejects Codex allowed_tools AskHuman before any sendQuery', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'codex',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await expect(
    executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'cap7-codex-ask',
        provider: 'codex',
        nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['AskHuman'] }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    )
  ).rejects.toThrow(/AskHuman is not supported by provider 'codex'/);
  expect(mockSendQueryDag.mock.calls.length).toBe(0);
});

it('starts the same Codex workflow when allowed_tools omits AskHuman', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'codex',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await executeDagWorkflow(
    mockDeps,
    createMockPlatform(),
    'conv-dag',
    testDir,
    {
      name: 'cap7-codex-ok',
      provider: 'codex',
      nodes: [{ id: 'review', prompt: 'no ask', allowed_tools: ['Read'] }],
    },
    makeWorkflowRun(),
    'codex',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );
  expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
  const optionsArg = mockSendQueryDag.mock.calls[0][3] as { nativeTools?: unknown };
  expect(optionsArg.nativeTools === undefined || (optionsArg.nativeTools as unknown[]).length === 0).toBe(true);
});

it('rejects mcp__archon__AskHuman on Grok at start', async () => {
  const mockDeps = createMockDeps();
  mockGetAgentProviderDag.mockImplementation(() => ({
    sendQuery: mockSendQueryDag,
    getType: () => 'grok',
    getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
  }));
  await expect(
    executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'cap7-grok-ask',
        provider: 'grok',
        nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['mcp__archon__AskHuman'] }],
      },
      makeWorkflowRun(),
      'grok',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    )
  ).rejects.toThrow(/AskHuman is not supported by provider 'grok'/);
  expect(mockSendQueryDag.mock.calls.length).toBe(0);
});
```

Follow existing dag-executor workflow fixtures for provider and `sendQuery` spies.
Place the preflight next to `collectContainerIncompatibleProviders`, before the first node, and always run it (not only for container exec).
Strip `Name(specifier)` the same way `validator.ts` strips permission-rule specifiers.

Chat test in `packages/core/src/orchestrator/orchestrator-agent.test.ts`, in the existing `nativeTools: true` Claude project-scoped fixture:

```ts
test('project-scoped nativeTools injects manage_run and not AskHuman', async () => {
  expect(requestOptions.nativeTools?.map((t: { name: string }) => t.name)).toEqual(['manage_run']);
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run:

```bash
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts)
```

Expected: FAIL on Codex AskHuman starting a turn.

- [ ] **Step 3: Implement CAP-7 preflight.**

Add `collectAskHumanUnsupportedProviders` that visits command/prompt/loop nodes and nested loop_group bodies.
Reuse `resolveNodeProviderForPreflight` and group scope inheritance.
If `allowed_tools` contains `AskHuman` or `mcp__archon__AskHuman` and `askHuman === false`, throw:

`AskHuman is not supported by provider '<id>'. Remove AskHuman from allowed_tools, or use claude or pi.`

Call it at the start of `executeWorkflow` / `runDag` before any node, beside the containerExec preflight.
Do not change load-time validator warnings into errors.
Do not add AskHuman to `orchestrator-agent.ts`.

- [ ] **Step 4: Re-run CAP-7 and chat tests.**

Run the commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Refactor while green.**

Do not add behavior.
Re-run the commands from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts packages/core/src/orchestrator/orchestrator-agent.test.ts
git commit -m "feat(workflows): reject AskHuman on providers that cannot ask"
```

---

### Task 12: Validate the story and mark sprint status done

**Files:**

- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after the gate passes.

**Interfaces:**

- Consumes: every prior task.
- Produces: Story 6.2 sprint key `done`.

- [ ] **Step 1: Run focused package tests.**

```bash
(cd packages/workflows && bun test src/retry-state.test.ts)
(cd packages/workflows && bun test src/ask-human.test.ts)
(cd packages/workflows && bun test src/schemas/pending-interaction.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts)
(cd packages/core && bun test src/db/workflow-pending-interactions.test.ts)
(cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts)
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
(cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts)
(cd packages/providers && bun test src/claude/native-tools.test.ts)
(cd packages/providers && bun test src/community/pi/native-tools.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/server && bun test src/adapters/web/dashboard-event-poller.test.ts)
(cd packages/server && bun test src/adapters/web/workflow-bridge.test.ts)
```

Expected: all PASS.

- [ ] **Step 2: Run schema upgrade check when PostgreSQL is reachable.**

```bash
bun run check:schema-upgrades
```

If neither `DATABASE_URL` nor `PGHOST` identifies a reachable PostgreSQL, record that missing prerequisite and rely on CI.
Do not skip SQLite parity.

- [ ] **Step 3: Run full validate.**

```bash
bun run validate
```

Expected: PASS, including `check:bundled-schema` and `check:capability-matrix`.

- [ ] **Step 4: Confirm Story 6.2 acceptance criteria.**

- Table exists on SQLite and Postgres, additive, comments trailing.
- `pendingInteractionSchema` remains the server source.
- Columns match AD-1.
- Ports `insertPendingInteraction` and `listPendingInteractions` exist.
- Ask pause does not write `metadata.approval` and is idempotent when already paused.
- `awaiting` exists on node/step/server node-state enums.
- Run status stays `paused`.
- AskHuman injects on Claude/Pi command/prompt/loop with no YAML field.
- Handler persists then throws `AskHumanAwaitingError`.
- Wrappers reject `sendQuery` and do not stringify that class.
- Converters accept `questions[]`.
- `askHuman` is true only for Claude and Pi.
- `NativeTool.handler` is still `Promise<string>`.
- Chat orchestrator does not inject AskHuman.
- `AskUserQuestion` is not wrapped.
- GET run embeds pending rows and projects `awaiting`.
- `node_awaiting` is same-transaction as insert.
- SSE `node_awaiting` is a refetch trigger.
- Messages GET has no Ask cards in status rows.
- Persist fails when `user_id` is null without failing every identity-less start.
- `allowed_tools` naming AskHuman on Codex/Grok/OpenCode/Copilot is rejected before a turn.
- The same workflow without that entry starts with no Ask tool.
- `workflow.ask_pending` is logged without answer bodies.

- [ ] **Step 5: Mark sprint status done and commit.**

Set `6-2-pause-a-run-when-the-agent-asks-without-stealing-the-approval-slot: done` in `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`.
Update `last_updated`.
Do not mark later 6.x stories done.

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark workflow-run-view-hitl story 6.2 done"
```

---

## Acceptance Criteria

- [ ] Story 6.2 acceptance criteria in `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` are satisfied.
- [ ] Focused tests listed in Task 12 exist and pass.
- [ ] `bun run validate` passes.
- [ ] `6-2-pause-a-run-when-the-agent-asks-without-stealing-the-approval-slot` is `done` only after the criteria above pass.
- [ ] No Ask card, answer POST, or provider resume mapper shipped.

## Validation Commands

```bash
(cd packages/workflows && bun test src/retry-state.test.ts src/ask-human.test.ts src/schemas/pending-interaction.test.ts src/dag-executor.test.ts)
(cd packages/core && bun test src/db/workflows.test.ts src/db/workflow-pending-interactions.test.ts src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/workflows/store-adapter.test.ts src/orchestrator/orchestrator-agent.test.ts)
(cd packages/providers && bun test src/claude/native-tools.test.ts && bun test src/community/pi/native-tools.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts src/adapters/web/dashboard-event-poller.test.ts src/adapters/web/workflow-bridge.test.ts)
bun run generate:bundled-schema
bun run generate:capability-matrix
bun run check:schema-upgrades
bun run validate
```

Do not run `bun test` from the repository root.
