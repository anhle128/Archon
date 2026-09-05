# Node Transcript From Logs (Legacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the legacy run screen Logs tab, an operator can click an unmerged node-run row and inspect that agent node's own chronological `text` / `tool` / `status` transcript, including after the node has completed.

**Architecture:** Persist per-node transcript rows in additive table `remote_agent_workflow_node_messages`.
The executor appends through `IWorkflowStore`.
`GET /api/workflows/runs/:runId/nodes/:nodeId/messages` is the only room read.
`GET /api/workflows/runs/:runId` keeps using `projectLatestEffectiveNodeStates` and always embeds `pending_interactions: []` with no pending table.
The Logs tab becomes a node-run list plus one per-node room.
The Graph tab is unchanged.

**Tech Stack:** Bun, strict TypeScript, Zod via `@hono/zod-openapi`, OpenAPIHono, React 19, bun:test, Pino via `createLogger` from `@archon/paths`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md` Story 5.1.

**Source Contracts:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-1/CAP-2/FR11, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md` Reads, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md` Surfaces, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-3/AD-7/AD-8.

**Issue:** [#81](https://github.com/anhle128/Archon/issues/81)

## Global Constraints

- Story 5.1 is inspect-only: no Ask card, no empty card slot, no awaiting / "waiting on you" chrome, no `awaiting` node status, no `node_awaiting` / `interaction_resolved` events, and no `remote_agent_pending_interactions` table.
- Do not change workflow YAML, `NativeTool.handler`, CLI/chat/`manage_run`, or `/console`.
- Do not add `packages/web/src/lib/run-graph/` (Story 5.3).
- Do not change Graph-tab layout or replace Logs with a graph.
- `remote_agent_messages` stays the merged/chat path and is not node-tagged.
- Transcript `status` rows are lifecycle notes only, never Ask cards.
- Canonical `nodeMessageSchema` and `pendingInteractionSchema` live in `packages/workflows/src/schemas/`.
- Server route schemas import or `.extend` those engine schemas; they do not fork them.
- Web consumes `api.generated.d.ts` types only and must not import `@archon/workflows`.
- GET `nodeStates` already come from `projectLatestEffectiveNodeStates` in `packages/server/src/routes/api.ts` (`projectApiWorkflowNodeStates`).
- Legacy must not rebuild lifecycle from raw events via `buildDagNodeStatesFromEvents`.
- Loop/route enrichment from events may remain after the server `nodeStates` base.
- Additive-only schema on both dialects.
- New table indexes and `COMMENT ON COLUMN` go in the trailing section of `migrations/000_combined.sql`.
- `COMMENT ON TABLE` may sit next to the `CREATE TABLE` body, matching `remote_agent_workflow_envs`.
- SQLite new tables go in `createSchema()` only, not `migrateColumns()`.
- `bun run check:schema-upgrades` is required when PostgreSQL is reachable.
- Do not use `any`.
- Do not run `bun test` from the repository root.
- Run package tests from that package directory.
- Run every command block from the repository root; package-scoped commands use a subshell so later commands remain rooted correctly.
- Never log transcript `text`, tool `input`, or tool `output`.
- `createWorkflowEvent` remains fire-and-forget and non-throwing; transcript append is awaited in stream order and fail-open at the executor helper boundary.

---

## File Map

- Create `packages/workflows/src/schemas/node-message.ts` for `nodeMessageSchema` and payload unions.
- Create `packages/workflows/src/schemas/pending-interaction.ts` for `pendingInteractionSchema` used only as the GET-run embed type.
- Modify `packages/workflows/src/schemas/index.ts` to re-export both.
- Create `packages/workflows/src/schemas/node-message.test.ts` and `packages/workflows/src/schemas/pending-interaction.test.ts`.
- Modify `packages/workflows/src/store.ts` to add `IWorkflowNodeMessageStore` and extend `IWorkflowStore`.
- Create `packages/workflows/src/node-transcript.ts` and `packages/workflows/src/node-transcript.test.ts`.
- Modify `packages/workflows/src/dag-executor.ts` to record agent-node transcripts in `executeNodeInternal` and `executeLoopNode`.
- Modify `packages/workflows/src/dag-executor.test.ts`, `executor.test.ts`, `executor-preamble.test.ts`, `script-node-deps.test.ts`, and `subrun.test.ts` so every concrete `IWorkflowStore` mock implements the new methods.
- Modify `packages/workflows/package.json` so the new schema/helper tests run in an existing non-conflicting `bun test` invocation.
- Modify `migrations/000_combined.sql` to add table 22 and trailing column comments.
- Modify `packages/core/src/db/adapters/sqlite.ts` `createSchema()` to mirror the table and unique constraint.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` `MIN_NON_AUTH_COLUMNS` from 162 to 169.
- Create `packages/core/src/schemas/workflow-node-message.ts` and `packages/core/src/schemas/workflow-node-message.test.ts`.
- Modify `packages/core/src/schemas/index.ts` to re-export the row schema.
- Create `packages/core/src/db/workflow-node-messages.ts` and `packages/core/src/db/workflow-node-messages.test.ts`.
- Modify `packages/core/src/db/index.ts` to export the new module.
- Modify `packages/core/src/workflows/store-adapter.ts` to wire store ports.
- Modify `packages/core/src/workflows/store-adapter.test.ts` to mock the new db module and list the new required methods.
- Modify `packages/core/package.json` so `workflow-node-messages.test.ts` is its own `bun test` invocation.
- Run `bun run generate:bundled-schema` after the SQL change.
- Modify `AGENTS.md` table inventory from 21 application tables to 22.
- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` for GET messages and `pending_interactions`.
- Modify `packages/server/src/routes/api.ts` for the new GET and the GET-run embed.
- Modify every `packages/server/src/routes/api.*.test.ts` that imports `registerApiRoutes` so it mocks `@archon/core/db/workflow-node-messages` before loading `./api`.
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` to cover both routes.
- Modify `packages/web/src/lib/api.generated.d.ts` and `packages/web/src/lib/api.ts`.
- Create `packages/web/src/lib/get-workflow-node-messages.test.ts`.
- Create `packages/web/src/components/workflows/build-log-rows.ts` and `build-log-rows.test.ts`.
- Create `packages/web/src/components/workflows/NodeRoom.tsx` and `NodeRoom.test.tsx`.
- Modify `packages/web/src/components/workflows/WorkflowExecution.tsx` Logs tab only.
- Modify `packages/web/src/components/workflows/WorkflowExecution.test.tsx` to drop event-lifecycle fallback.
- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after the code tasks pass.

Do not modify `packages/web/src/experiments/console/`, `packages/web/src/lib/run-graph/`, `pauseWorkflowRun`, `WORKFLOW_EVENT_TYPES`, or `nodeStateSchema`.

Do not add `awaiting` to `workflowNodeStateSchema`.

## Patterns to Mirror

**Engine Zod in `packages/workflows/src/schemas/`** is the source of truth.
Import `z` from `@hono/zod-openapi`.
Derive types with `z.infer<typeof schema>`.
Server imports the engine schema and adds `.openapi('Name')`.
Core row schemas in `packages/core/src/schemas/` parse dialect timestamps with `z.union([z.date(), z.string()])`.

**Narrow store capability** follows `IWorkflowEnvOverlayStore` in `packages/workflows/src/store.ts:204-211`: a small interface that `IWorkflowStore` extends.

**New application table** follows `remote_agent_workflow_envs`:
Postgres `CREATE TABLE` after Table 21 and before `-- Indexes and column comments` (`migrations/000_combined.sql:721-737`).
SQLite `CREATE TABLE IF NOT EXISTS` at the end of `createSchema()` (`packages/core/src/db/adapters/sqlite.ts:1063-1075`).
Unique constraint lives in the `CREATE TABLE` body.
`COMMENT ON COLUMN` lives in the trailing Postgres section.

**Fail-open observability** follows `createWorkflowEvent` logging: catch, log `{ workflowRunId, nodeId, error, errorType }` plus `err`, never serialize payload bodies.

**Nested GET** follows `GET /api/workflows/runs/{runId}/nodes/{nodeId}/retry/preview` (`packages/server/src/routes/api.ts:1284-1302`, `retryWorkflowNodeParamsSchema`, `registerOpenApiRoute`).

**Logs tab shell** already splits left `DagNodeProgress` and right `logsPanel` in `packages/web/src/components/workflows/WorkflowExecution.tsx:805-816`.
Replace the Logs-tab left list with `buildLogRows` output and the Logs-tab right panel with `NodeRoom`.
Leave Graph-tab `logsPanel` on `WorkflowLogs`.

**Real SQLite db tests** follow `packages/core/src/db/workflow-envs.test.ts`: `mock.module('./connection')` + in-memory `SqliteAdapter`, own `bun test` shard.

**mock.module pollution:** adding a new `@archon/core/db/workflow-node-messages` module requires a factory in every test file that imports `registerApiRoutes` from `./api`.
`workflow-node-messages.test.ts` must be its own `bun test` invocation because it `mock.module('./connection')`.

## Authoritative Contracts

### 1. Transcript table

```sql
CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id VARCHAR(255) NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_node_messages_run_node_seq UNIQUE (workflow_run_id, node_id, seq)
);
```

SQLite mirrors with `TEXT` ids (`lower(hex(randomblob(16)))`), `TEXT` timestamps (`datetime('now')`), `TEXT` payload default `'{}'`, and `ON DELETE CASCADE`.

`node_id` is the persisted executor `stepName` (`stepNamePrefix + node.id`), the same id GET run `nodeStates[].nodeId` already uses.

Store assigns `seq` as `MAX(seq)+1` per `(workflow_run_id, node_id)` inside `withTransaction()`.
On unique-violation of `uq_workflow_node_messages_run_node_seq`, retry the MAX+INSERT once inside the same function (do not invent a second lock table).

### 2. Message payloads

```ts
kind: 'text'    payload: { text: string }
kind: 'tool'    payload: { name: string; id: string; input?: unknown; output?: unknown }
kind: 'status'  payload: { state: string; detail?: string }
```

Allowed `status.state` values written in this story: `started`, `completed`, `failed`, `iteration_started`, `iteration_completed`, `iteration_failed`.
Unknown `status.state` strings are valid in the schema so later stories can add notes without a migration.
`status` is never an Ask card.

### 3. Store ports

```ts
export interface WorkflowNodeMessage {
  id: string;
  workflow_run_id: string;
  node_id: string;
  seq: number;
  kind: 'text' | 'tool' | 'status';
  payload: NodeMessagePayload;
  created_at: Date | string;
}

export interface AppendNodeMessageInput {
  workflow_run_id: string;
  node_id: string;
  kind: 'text' | 'tool' | 'status';
  payload: NodeMessagePayload;
}

export interface IWorkflowNodeMessageStore {
  appendNodeMessage(input: AppendNodeMessageInput): Promise<WorkflowNodeMessage>;
  listNodeMessages(workflowRunId: string, nodeId: string): Promise<WorkflowNodeMessage[]>;
  setNodeToolOutput(input: {
    workflow_run_id: string;
    node_id: string;
    tool_id: string;
    output: unknown;
  }): Promise<void>;
}

export interface IWorkflowStore extends IRunTreeStore, IWorkflowEnvOverlayStore, IWorkflowNodeMessageStore {
  // existing methods unchanged
}
```

`listNodeMessages` returns `seq ASC`.
`setNodeToolOutput` updates `payload.output` on the existing `kind='tool'` row whose `payload.id` matches; missing row is a no-op.
Core parses payload JSON through `nodeMessageSchema` and throws `WorkflowNodeMessageCorruptRowError` (id-only log) on corrupt rows.

### 4. Executor recording

Record only on agent turns: `command` / `prompt` / `loop` inside `executeNodeInternal` (`packages/workflows/src/dag-executor.ts:1737`) and `executeLoopNode` (`packages/workflows/src/dag-executor.ts:4715`).
Do not write transcript rows for `bash` / `script` / `approval` / `plannotator_gate` / `workflow` / `route_loop` / `loop_group` containers in this story.
Body agent nodes inside a `loop_group` still record because they enter `executeNodeInternal`.

Helper `recordNodeTranscript(store, input)` awaits `appendNodeMessage`, catches every error, logs `workflow.node_message_append_failed`, and does not rethrow.

Helper `recordNodeToolOutput(store, input)` awaits `setNodeToolOutput`, catches every error, logs `workflow.node_message_tool_output_failed`, and does not rethrow.

Write:

1. `status started` immediately after `node_started` persist (`dag-executor.ts:1775-1798` and the loop-node equivalent at `4762-4782`), using the same `stepName`.
2. `text` once per assistant chunk that is sent to the platform (`streamingMode === 'stream' || msg.flush`) at `dag-executor.ts:2054-2073`, and once when the batch buffer is flushed at `dag-executor.ts:2829-2835`.
3. `tool` on `msg.type === 'tool'` with `{ name: msg.toolName, id: toolCallId, input: msg.toolInput }` after `toolCallId` is assigned (`dag-executor.ts:2074-2155`).
4. `setNodeToolOutput` on `msg.type === 'tool_result'` with that tool id and `msg.toolOutput` (`dag-executor.ts:2156-2197`).
5. `status completed` or `status failed` with `detail` equal to the node error string after the matching lifecycle event persist (`dag-executor.ts:2924-3023`).
6. On `loop:` iterations, `status iteration_started` / `iteration_completed` / `iteration_failed` with `detail` equal to `String(iteration)` using the loop node's `stepName` (started persist is `dag-executor.ts:5016-5029`).

Do not put answers or Ask envelopes in transcript rows.
Do not record empty assistant `content`.
Mirror the same six writes in `executeLoopNode`'s stream loop (`dag-executor.ts:5197+`).

### 5. HTTP

`GET /api/workflows/runs/{runId}` response adds `pending_interactions: z.array(pendingInteractionSchema)` and always returns `[]`.
Do not read a pending table.

`GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages` returns `{ messages }` ordered by `seq`.
404 when the run does not exist.
200 with `messages: []` when the run exists and the node has no rows.
400 when `runId` or `nodeId` is empty (OpenAPI `z.string().min(1)` on params).
No new ACL.

Wire messages:

```ts
{
  id: string;
  seq: number;
  kind: 'text' | 'tool' | 'status';
  payload: NodeMessagePayload;
  created_at: string; // ISO
}
```

### 6. Legacy Logs UI

Logs tab left list is unmerged node-run rows from server `nodeStates` plus one clickable row per `loop_iteration_*` event and per `node_routed` event.
A loop iteration row identity is `{ nodeId, iteration }`.
A route_loop iteration row identity is `{ nodeId, executionSeq }` from `data.execution_seq`.
Clicking a parent node or an iteration row opens the same GET messages URL for that `nodeId`.
The room renders `kind` items in `seq` order.
If an iteration is selected, scroll/focus the matching `status` item (`iteration_started` + `detail === String(iteration)`); if that marker is absent, show the full node transcript.
Completed nodes use the same GET; there is no live-only path.
Graph tab keeps today's merged `WorkflowLogs`.
Do not render `pending_interactions`.

### 7. Lifecycle projector

Do not add `awaiting` in this story.
Do not teach `projectLatestEffectiveNodeStates` new event types.
`buildWorkflowDagNodeStates` must use server `nodeStates` only for lifecycle (`pending|running|completed|failed|skipped`).
If `nodeStates` is missing, use `[]`, never `buildDagNodeStatesFromEvents`.
Keep `enrichDagNodesWithLoopIterations`, `enrichDagNodesWithRouteDecisions`, and `enrichDagNodesWithLoopProgress`.

---

## Open Questions

### Q1. Should `pendingInteractionSchema` exist before the pending table?

**Provisional default:** Yes.
GET run must embed `pending_interactions: []` with a real OpenAPI item type.
The schema is data-only and does not create a table or store port.
Story 6.2 will persist rows of that shape.

### Q2. How are loop / route_loop iterations their own Logs rows if `seq` is per DAG `node_id`?

**Provisional default:** Messages stay keyed by DAG `stepName`.
The Logs list materializes iteration rows from existing `loop_iteration_*` and `node_routed` events.
Clicking an iteration opens that node's full transcript and focuses the iteration marker.
Do not add an `iteration` column.

### Q3. Graph-tab right panel?

**Provisional default:** Leave merged `WorkflowLogs`.
Story 5.3 is the graph door into the same room.

### Q4. Tool output: second row or in-place update?

**Provisional default:** In-place `setNodeToolOutput` on `payload.id`.
One tool card in the room gains `output` when the tool finishes.
Architecture lists `appendNodeMessage` / `listNodeMessages`; `setNodeToolOutput` is the implementation of `payload.output`.

### Q5. Non-agent node clicks in 5.1?

**Provisional default:** Still open `NodeRoom` for that `nodeId`.
Bash/script rooms are empty until Story 5.2.

### Q6. `check:schema-upgrades` without local Postgres?

**Provisional default:** Run it when `DATABASE_URL` or `PGHOST` is set.
Do not skip the SQL/parity/`generate:bundled-schema` work if Postgres is unavailable.
The story AC still names the upgrade check.

---

### Task 1: Engine transcript and pending-embed schemas

**Files:**

- Create: `packages/workflows/src/schemas/node-message.ts`
- Create: `packages/workflows/src/schemas/node-message.test.ts`
- Create: `packages/workflows/src/schemas/pending-interaction.ts`
- Create: `packages/workflows/src/schemas/pending-interaction.test.ts`
- Modify: `packages/workflows/src/schemas/index.ts`
- Modify: `packages/workflows/package.json`

**Interfaces:**

- Consumes: `@hono/zod-openapi` `z`, existing `z.infer` convention.
- Produces: `nodeMessageKindSchema`, `nodeMessageTextPayloadSchema`, `nodeMessageToolPayloadSchema`, `nodeMessageStatusPayloadSchema`, `nodeMessagePayloadSchema`, `nodeMessageSchema`, `pendingInteractionKindSchema`, `pendingInteractionStatusSchema`, `pendingInteractionSchema`, and inferred types.

- [ ] **Step 1: Write the failing schema tests**

Create `packages/workflows/src/schemas/node-message.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  nodeMessagePayloadSchema,
  nodeMessageSchema,
} from './node-message';

describe('nodeMessageSchema', () => {
  test('accepts text, tool, and status payloads', () => {
    expect(
      nodeMessageSchema.parse({
        id: 'm1',
        workflow_run_id: 'run-1',
        node_id: 'review',
        seq: 1,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: '2026-09-06T00:00:00.000Z',
      }).kind
    ).toBe('text');
    expect(
      nodeMessagePayloadSchema.parse({
        name: 'Read',
        id: 'tool-1',
        input: { path: 'a.ts' },
      })
    ).toEqual({ name: 'Read', id: 'tool-1', input: { path: 'a.ts' } });
    expect(nodeMessagePayloadSchema.parse({ state: 'started' })).toEqual({
      state: 'started',
    });
    expect(nodeMessagePayloadSchema.parse({ state: 'future_note', detail: 'x' })).toEqual({
      state: 'future_note',
      detail: 'x',
    });
  });

  test('rejects seq < 1, empty kind, and mismatched payload', () => {
    expect(
      nodeMessageSchema.safeParse({
        id: 'm1',
        workflow_run_id: 'run-1',
        node_id: 'review',
        seq: 0,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: '2026-09-06T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(nodeMessagePayloadSchema.safeParse({ text: 1 }).success).toBe(false);
    expect(nodeMessagePayloadSchema.safeParse({ name: 'Read' }).success).toBe(false);
  });
});
```

Create `packages/workflows/src/schemas/pending-interaction.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { pendingInteractionSchema } from './pending-interaction';

const valid = {
  id: 'p1',
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'toolu_1',
  kind: 'ask' as const,
  status: 'pending' as const,
  envelope: { questions: [] },
  answer: null,
  provider_session_id: 'sess-1',
  created_at: '2026-09-06T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

describe('pendingInteractionSchema', () => {
  test('accepts ask and permission envelopes', () => {
    expect(pendingInteractionSchema.parse(valid).kind).toBe('ask');
    expect(
      pendingInteractionSchema.parse({ ...valid, kind: 'permission', status: 'answered' }).kind
    ).toBe('permission');
  });

  test('rejects unknown kind/status', () => {
    expect(pendingInteractionSchema.safeParse({ ...valid, kind: 'card' }).success).toBe(false);
    expect(pendingInteractionSchema.safeParse({ ...valid, status: 'open' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts )
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Write minimal implementation**

`packages/workflows/src/schemas/node-message.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const nodeMessageKindSchema = z.enum(['text', 'tool', 'status']);

export const nodeMessageTextPayloadSchema = z
  .object({
    text: z.string(),
  })
  .strict();

export const nodeMessageToolPayloadSchema = z
  .object({
    name: z.string().min(1),
    id: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  })
  .strict();

export const nodeMessageStatusPayloadSchema = z
  .object({
    state: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();

export const nodeMessagePayloadSchema = z.union([
  nodeMessageTextPayloadSchema,
  nodeMessageToolPayloadSchema,
  nodeMessageStatusPayloadSchema,
]);

export const nodeMessageSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    seq: z.number().int().min(1),
    kind: nodeMessageKindSchema,
    payload: nodeMessagePayloadSchema,
    created_at: z.union([z.date(), z.string()]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'text' && !('text' in value.payload)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text kind requires text payload' });
    }
    if (value.kind === 'tool' && !('id' in value.payload)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tool kind requires tool payload' });
    }
    if (value.kind === 'status' && !('state' in value.payload)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'status kind requires status payload' });
    }
  });

export type NodeMessageKind = z.infer<typeof nodeMessageKindSchema>;
export type NodeMessagePayload = z.infer<typeof nodeMessagePayloadSchema>;
export type NodeMessage = z.infer<typeof nodeMessageSchema>;
```

`packages/workflows/src/schemas/pending-interaction.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const pendingInteractionKindSchema = z.enum(['ask', 'permission']);
export const pendingInteractionStatusSchema = z.enum(['pending', 'answered', 'purged']);

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    kind: pendingInteractionKindSchema,
    status: pendingInteractionStatusSchema,
    envelope: z.record(z.string(), z.unknown()),
    answer: z.record(z.string(), z.unknown()).nullable(),
    provider_session_id: z.string().nullable(),
    created_at: z.union([z.date(), z.string()]),
    resolved_at: z.union([z.date(), z.string()]).nullable(),
    resolved_by: z.string().nullable(),
  })
  .strict();

export type PendingInteractionKind = z.infer<typeof pendingInteractionKindSchema>;
export type PendingInteractionStatus = z.infer<typeof pendingInteractionStatusSchema>;
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;
```

Re-export both files from `packages/workflows/src/schemas/index.ts` after the usage-breakdown block.

Add the new test files to workflows `package.json` scripts.test shard 15 (the existing `bun test src/schemas.test.ts src/schemas/env-overlay.test.ts ...` invocation).

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

No refactor if the schemas already match the contracts above.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/schemas/node-message.ts \
  packages/workflows/src/schemas/node-message.test.ts \
  packages/workflows/src/schemas/pending-interaction.ts \
  packages/workflows/src/schemas/pending-interaction.test.ts \
  packages/workflows/src/schemas/index.ts \
  packages/workflows/package.json
git commit -m "feat(workflows): add node message and pending interaction schemas"
```

---

### Task 2: Additive `remote_agent_workflow_node_messages` schema

**Files:**

- Modify: `migrations/000_combined.sql`
- Modify: `packages/core/src/db/adapters/sqlite.ts`
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`
- Modify: `AGENTS.md`
- Generated: bundled schema via `bun run generate:bundled-schema`

**Interfaces:**

- Consumes: additive-only schema rule, table-21 placement.
- Produces: table 22 on both dialects, unique `(workflow_run_id, node_id, seq)`, cascade-delete with the run.

- [ ] **Step 1: Write the failing parity assertion**

In `packages/core/src/db/adapters/sqlite.test.ts`, change `MIN_NON_AUTH_COLUMNS` from `162` to `169`.
Add this test next to the `output_root` presence test (`sqlite.test.ts:1691`):

```ts
test('workflow_node_messages table present on a fresh SQLite schema and in the Postgres migration', () => {
  db = createTestDb();
  expect(raw_pragma(currentDbPath, 'remote_agent_workflow_node_messages')).toEqual(
    expect.arrayContaining([
      'id',
      'workflow_run_id',
      'node_id',
      'seq',
      'kind',
      'payload',
      'created_at',
    ])
  );
  expect(getSchemaSQL()).toContain('remote_agent_workflow_node_messages');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
( cd packages/core && bun test src/db/adapters/sqlite.test.ts )
```

Expected: FAIL on missing table and/or `MIN_NON_AUTH_COLUMNS` floor.

- [ ] **Step 3: Write minimal implementation**

In `migrations/000_combined.sql`:

1. Change the inventory header from `21 Application Tables` to `22 Application Tables`.
2. Insert `22. remote_agent_workflow_node_messages` after table 21.
3. Renumber auth tables to `23-26`.
4. Insert Table 22 `CREATE TABLE` + `COMMENT ON TABLE` immediately after the workflow_envs `COMMENT ON TABLE` (`migrations/000_combined.sql:736-737`) and before `-- Indexes and column comments`.
5. In the trailing section, add:

```sql
COMMENT ON COLUMN remote_agent_workflow_node_messages.workflow_run_id IS
  'Owning workflow run; cascade-deletes with the run.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.node_id IS
  'Executor stepName (stepNamePrefix + node.id); same id as GET run nodeStates[].nodeId.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.seq IS
  'Store-assigned monotonic sequence per (workflow_run_id, node_id), starting at 1.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.kind IS
  'text | tool | status. status rows are lifecycle notes, never Ask cards.';
COMMENT ON COLUMN remote_agent_workflow_node_messages.payload IS
  'Kind-specific JSON: text {text}; tool {name,id,input?,output?}; status {state,detail?}.';
```

Do not put `CREATE INDEX` or `COMMENT ON COLUMN` beside the table body.

In `packages/core/src/db/adapters/sqlite.ts` `createSchema()`, after the workflow_envs block (`sqlite.ts:1063-1075`) and before the closing `` `); ``:

```sql
CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_workflow_node_messages_run_node_seq UNIQUE (workflow_run_id, node_id, seq)
);
```

Update `AGENTS.md` Database Schema from 21 application tables to 22.
Add item 22 `workflow_node_messages` and shift Better Auth tables to 23–26.

Then:

```bash
bun run generate:bundled-schema
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts )
```

Expected: PASS.
If `DATABASE_URL` or `PGHOST` is set, also run `bun run check:schema-upgrades`.

- [ ] **Step 5: Refactor**

No refactor.

- [ ] **Step 6: Commit**

```bash
git add migrations/000_combined.sql \
  packages/core/src/db/adapters/sqlite.ts \
  packages/core/src/db/adapters/sqlite.test.ts \
  AGENTS.md
git add -u
git commit -m "feat(db): add remote_agent_workflow_node_messages table"
```

Include the generated bundled-schema file(s) that `generate:bundled-schema` modified.

---

### Task 3: Store ports and mock implementations

**Files:**

- Modify: `packages/workflows/src/store.ts`
- Create: `packages/workflows/src/node-transcript.ts`
- Create: `packages/workflows/src/node-transcript.test.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/src/executor.test.ts`
- Modify: `packages/workflows/src/executor-preamble.test.ts`
- Modify: `packages/workflows/src/script-node-deps.test.ts`
- Modify: `packages/workflows/src/subrun.test.ts`

**Interfaces:**

- Consumes: `NodeMessage` / `NodeMessagePayload` from `./schemas`.
- Produces: `IWorkflowNodeMessageStore` extended by `IWorkflowStore`.

- [ ] **Step 1: Write the failing type probe**

Create `packages/workflows/src/node-transcript.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { IWorkflowStore } from './store';

describe('IWorkflowNodeMessageStore', () => {
  test('IWorkflowStore requires append/list/setNodeToolOutput', () => {
    const store = {} as IWorkflowStore;
    expect(typeof store.appendNodeMessage).toBe('function');
    expect(typeof store.listNodeMessages).toBe('function');
    expect(typeof store.setNodeToolOutput).toBe('function');
  });
});
```

Do not implement production types first.
This test is a compile/type probe plus a runtime assertion that will fail until mocks and the interface exist.

- [ ] **Step 2: Run type-check to verify it fails**

```bash
( cd packages/workflows && bun x tsc --noEmit )
```

Expected: FAIL on missing methods on `IWorkflowStore` object literals in `createMockStore` / `makeStore` / `InMemoryStore`.

- [ ] **Step 3: Write minimal implementation**

In `packages/workflows/src/store.ts`, import `NodeMessage` / `NodeMessagePayload` types from `./schemas` after they are re-exported, and add:

```ts
export interface AppendNodeMessageInput {
  workflow_run_id: string;
  node_id: string;
  kind: 'text' | 'tool' | 'status';
  payload: NodeMessagePayload;
}

export interface IWorkflowNodeMessageStore {
  appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage>;
  listNodeMessages(workflowRunId: string, nodeId: string): Promise<NodeMessage[]>;
  setNodeToolOutput(input: {
    workflow_run_id: string;
    node_id: string;
    tool_id: string;
    output: unknown;
  }): Promise<void>;
}
```

Change `export interface IWorkflowStore extends IRunTreeStore, IWorkflowEnvOverlayStore` to also extend `IWorkflowNodeMessageStore`.

Add no-op/recording mocks to every typed `IWorkflowStore` factory:

- `packages/workflows/src/dag-executor.test.ts` `createMockStore` (after `deleteWorkflowNodeSessions`)
- `packages/workflows/src/executor.test.ts` `makeStore`
- `packages/workflows/src/executor-preamble.test.ts` `makeStore`
- `packages/workflows/src/script-node-deps.test.ts` `createMockStore`
- `packages/workflows/src/subrun.test.ts` `class InMemoryStore implements IWorkflowStore`

Use:

```ts
appendNodeMessage: mock(async (input: AppendNodeMessageInput) => ({
  id: 'msg-1',
  workflow_run_id: input.workflow_run_id,
  node_id: input.node_id,
  seq: 1,
  kind: input.kind,
  payload: input.payload,
  created_at: new Date(),
})),
listNodeMessages: mock(async () => []),
setNodeToolOutput: mock(async () => undefined),
```

In `subrun.test.ts` `InMemoryStore`, implement real in-memory append/list/set so later executor tests can keep using that store without throwing.

Leave `plannotator-gate-*.test.ts` alone; they cast `as unknown as IWorkflowStore`.

Replace the type-probe test body with a skipped placeholder until Task 6, or keep it compiling by not constructing `{} as IWorkflowStore`.
Preferred: delete the probe test in this step and leave `node-transcript.test.ts` empty of that assertion until Task 6 writes the helper tests.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/workflows && bun x tsc --noEmit && bun test src/executor-preamble.test.ts src/script-node-deps.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

No extra abstraction.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/store.ts \
  packages/workflows/src/dag-executor.test.ts \
  packages/workflows/src/executor.test.ts \
  packages/workflows/src/executor-preamble.test.ts \
  packages/workflows/src/script-node-deps.test.ts \
  packages/workflows/src/subrun.test.ts \
  packages/workflows/src/node-transcript.test.ts
git commit -m "feat(workflows): add node transcript store ports"
```

---

### Task 4: Core DB append/list/tool-output

**Files:**

- Create: `packages/core/src/schemas/workflow-node-message.ts`
- Create: `packages/core/src/schemas/workflow-node-message.test.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Create: `packages/core/src/db/workflow-node-messages.ts`
- Create: `packages/core/src/db/workflow-node-messages.test.ts`
- Modify: `packages/core/src/db/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: engine `nodeMessageSchema`, `getDatabase().withTransaction`, SQLite/Postgres JSON.
- Produces: `appendNodeMessage`, `listNodeMessages`, `setNodeToolOutput`, `WorkflowNodeMessageCorruptRowError`.

- [ ] **Step 1: Write the failing DB tests**

Create `packages/core/src/db/workflow-node-messages.test.ts` using the `workflow-envs.test.ts` pattern (`mock.module('@archon/paths')` + `mock.module('./connection')` + in-memory `SqliteAdapter`).
Own `bun test` segment.

Seed helper (SQLite `conversation_id` is NOT NULL):

```ts
async function insertRun(runId: string): Promise<void> {
  await db.query(
    `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
     VALUES ($1, $2, $3)`,
    ['conv-1', 'cli', 'cli-1']
  );
  await db.query(
    `INSERT INTO remote_agent_workflow_runs (id, conversation_id, workflow_name, user_message, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [runId, 'conv-1', 'wf', 'hi', 'running']
  );
}
```

Tests:

1. createSchema installed the table, unique constraint `uq_workflow_node_messages_run_node_seq`, and columns `id, workflow_run_id, node_id, seq, kind, payload, created_at`.
2. append assigns seq 1, 2, 3 per `(run, node)` and restarts seq at 1 for a different `node_id`.
3. list returns `seq ASC` and round-trips SQLite TEXT JSON payload.
4. cascade-delete with the run removes message rows.
5. `setNodeToolOutput` writes `payload.output` on the matching `payload.id` and is a no-op when missing.
6. corrupt payload throws `WorkflowNodeMessageCorruptRowError` and the logger payload has `id` but not the raw payload body.
7. unique race: two appends still produce distinct seq values (serialized `withTransaction`).

Create `packages/core/src/schemas/workflow-node-message.test.ts` that parses a row with `created_at` as both `Date` and ISO string.

- [ ] **Step 2: Run test to verify it fails**

```bash
( cd packages/core && bun test src/db/workflow-node-messages.test.ts )
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/schemas/workflow-node-message.ts` re-exports engine `nodeMessageSchema` as `workflowNodeMessageRowSchema`.
Parse store rows with that schema after `JSON.parse` of SQLite TEXT / Postgres JSONB `payload`.

`packages/core/src/db/workflow-node-messages.ts`:

- `WorkflowNodeMessageCorruptRowError` (id-only message; never include payload).
- `appendNodeMessage`: `withTransaction`; `SELECT COALESCE(MAX(seq), 0) AS m ...`; `INSERT ... RETURNING *` (SQLite: insert then select by id); parse row; on unique violation retry once.
- `listNodeMessages`: `SELECT ... ORDER BY seq ASC`; parse each row.
- `setNodeToolOutput`: inside `withTransaction`, load `kind='tool'` rows for that node, find `payload.id === tool_id`, write updated JSON; return if none.
- Postgres payload parameter: pass object or `JSON.stringify` according to existing JSONB helpers in sibling modules.
- SQLite payload: `JSON.stringify`.
- Log corrupt rows with `{ id, error, errorType }` only.

Export namespace + star from `packages/core/src/db/index.ts` next to `workflowEnvDb`.

Re-export the row schema from `packages/core/src/schemas/index.ts` after the WorkflowEnv block.

Add to `packages/core/package.json` scripts.test:

- `bun test src/db/workflow-node-messages.test.ts` as its own shard (after `src/db/workflow-envs.test.ts`).
- `bun test src/schemas/workflow-node-message.test.ts` next to `src/schemas/workflow-env.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/core && bun test src/db/workflow-node-messages.test.ts && bun test src/schemas/workflow-node-message.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

Keep SQL in this module; do not add a generic JSON blob helper.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/workflow-node-message.ts \
  packages/core/src/schemas/workflow-node-message.test.ts \
  packages/core/src/schemas/index.ts \
  packages/core/src/db/workflow-node-messages.ts \
  packages/core/src/db/workflow-node-messages.test.ts \
  packages/core/src/db/index.ts \
  packages/core/package.json
git commit -m "feat(core): persist workflow node transcript messages"
```

---

### Task 5: Wire `createWorkflowStore`

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Modify: `packages/core/src/workflows/store-adapter.test.ts`

**Interfaces:**

- Consumes: `appendNodeMessage` / `listNodeMessages` / `setNodeToolOutput` from `../db/workflow-node-messages`.
- Produces: those three methods on the object returned by `createWorkflowStore()`.

- [ ] **Step 1: Write the failing adapter test**

In `packages/core/src/workflows/store-adapter.test.ts`, add `mock.module('../db/workflow-node-messages', () => ({ ... }))` with three mocks **before** the adapter import (same file already mocks sibling db modules).

Add `'appendNodeMessage' | 'listNodeMessages' | 'setNodeToolOutput'` to `requiredMethods` (`store-adapter.test.ts:286-314`).

Then assert:

```ts
test('delegates appendNodeMessage to db', async () => {
  mockAppendNodeMessage.mockResolvedValueOnce({
    id: 'm1',
    workflow_run_id: 'run-1',
    node_id: 'n1',
    seq: 1,
    kind: 'text',
    payload: { text: 'hi' },
    created_at: new Date(),
  });
  const store = createWorkflowStore();
  await store.appendNodeMessage({
    workflow_run_id: 'run-1',
    node_id: 'n1',
    kind: 'text',
    payload: { text: 'hi' },
  });
  expect(mockAppendNodeMessage).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
( cd packages/core && bun test src/workflows/store-adapter.test.ts )
```

Expected: FAIL because `createWorkflowStore()` does not expose the methods.

- [ ] **Step 3: Write minimal implementation**

Import `* as workflowNodeMessageDb from '../db/workflow-node-messages'` in `store-adapter.ts` and add the three methods to the object returned by `createWorkflowStore()` (`store-adapter.ts:369-434`), next to the session methods.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/core && bun test src/workflows/store-adapter.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

No wrapper beyond pass-through.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workflows/store-adapter.ts \
  packages/core/src/workflows/store-adapter.test.ts
git commit -m "feat(core): wire node transcript ports on createWorkflowStore"
```

---

### Task 6: Executor appends agent-node transcripts

**Files:**

- Create: `packages/workflows/src/node-transcript.ts`
- Modify: `packages/workflows/src/node-transcript.test.ts`
- Modify: `packages/workflows/src/dag-executor.ts`
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/package.json`

**Interfaces:**

- Consumes: `IWorkflowStore.appendNodeMessage` / `setNodeToolOutput`, stream chunks in `executeNodeInternal` / `executeLoopNode`.
- Produces: `recordNodeTranscript`, `recordNodeToolOutput`.

- [ ] **Step 1: Write the failing helper and executor tests**

Replace `node-transcript.test.ts` with helper tests:

```ts
import { describe, expect, mock, test } from 'bun:test';
import { recordNodeTranscript, recordNodeToolOutput } from './node-transcript';

describe('recordNodeTranscript', () => {
  test('awaits appendNodeMessage and does not throw when it fails', async () => {
    const appendNodeMessage = mock(async () => {
      throw new Error('db down');
    });
    const store = { appendNodeMessage, setNodeToolOutput: mock(async () => undefined) };
    await recordNodeTranscript(store, {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'secret body' },
    });
    expect(appendNodeMessage).toHaveBeenCalledTimes(1);
  });
});
```

Spy the test logger (same `mock.module('@archon/paths')` pattern already used in `executor.test.ts`) and assert:

- event name `workflow.node_message_append_failed`
- payload includes `workflowRunId`, `nodeId`, `kind`, `error`, `errorType`, `err`
- payload stringification does not include `secret body`

Add a `describe('node transcript recording')` in `packages/workflows/src/dag-executor.test.ts` next to the existing tool-call tests (the `read_file` yield around line 3711).
Use `createMockStore()`, `createMockDeps(store)`, `executeDagWorkflow`, `createMockPlatform()`, `makeWorkflowRun()`, and a temp dir like `executeDagWorkflow -- tool restrictions`.

Cases:

1. Prompt node, stream mode, assistant + tool + tool_result + result → append kinds `status,text,tool,status` with states `started` then `completed`, tool payload `{ name, id, input }`, and `setNodeToolOutput` called with `toolOutput`.
2. Prompt node whose `appendNodeMessage` rejects → workflow still completes (`node_completed` event still persisted).
3. Bash node → `appendNodeMessage` not called.
4. Loop node with `until` completing on iteration 1 → includes `iteration_started` and `iteration_completed` status rows with `detail: '1'`.
5. Failed prompt node → final status `failed` with `detail` equal to the thrown error message.

Default platform streaming mode in these tests is whatever `createMockPlatform()` already uses; if it is `'batch'`, assert one text row from the batch flush instead of per-chunk.

- [ ] **Step 2: Run tests to verify they fail**

```bash
( cd packages/workflows && bun test src/node-transcript.test.ts && bun test src/dag-executor.test.ts )
```

Expected: helper import FAIL; then dag-executor recording assertions FAIL.

- [ ] **Step 3: Write minimal implementation**

`packages/workflows/src/node-transcript.ts`:

```ts
import { createLogger } from '@archon/paths';
import type { AppendNodeMessageInput, IWorkflowNodeMessageStore } from './store';

const log = createLogger('node-transcript');

export async function recordNodeTranscript(
  store: IWorkflowNodeMessageStore,
  input: AppendNodeMessageInput
): Promise<void> {
  try {
    await store.appendNodeMessage(input);
  } catch (err) {
    const error = err as Error;
    log.error(
      {
        err,
        workflowRunId: input.workflow_run_id,
        nodeId: input.node_id,
        kind: input.kind,
        error: error.message,
        errorType: error.constructor.name,
      },
      'workflow.node_message_append_failed'
    );
  }
}

export async function recordNodeToolOutput(
  store: IWorkflowNodeMessageStore,
  input: {
    workflow_run_id: string;
    node_id: string;
    tool_id: string;
    output: unknown;
  }
): Promise<void> {
  try {
    await store.setNodeToolOutput(input);
  } catch (err) {
    const error = err as Error;
    log.error(
      {
        err,
        workflowRunId: input.workflow_run_id,
        nodeId: input.node_id,
        error: error.message,
        errorType: error.constructor.name,
      },
      'workflow.node_message_tool_output_failed'
    );
  }
}
```

Call these helpers from `executeNodeInternal` and `executeLoopNode` at the six sites listed in Authoritative Contract 4.
Await them so `seq` matches stream order.
Do not await `createWorkflowEvent`.

Add `src/node-transcript.test.ts` to workflows `package.json` shard 24 (`bun test src/state-migration.test.ts src/dry-run.test.ts`) or a new trailing shard.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/workflows && bun test src/node-transcript.test.ts && bun test src/dag-executor.test.ts )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

If the six call sites duplicate object literals, keep the two helpers only; do not extract a stream-chunk dispatcher.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/node-transcript.ts \
  packages/workflows/src/node-transcript.test.ts \
  packages/workflows/src/dag-executor.ts \
  packages/workflows/src/dag-executor.test.ts \
  packages/workflows/package.json
git commit -m "feat(workflows): record agent node transcripts"
```

---

### Task 7: GET messages and GET-run `pending_interactions: []`

**Files:**

- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts`
- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify every `packages/server/src/routes/api.*.test.ts` that `import { registerApiRoutes } from './api'`

**Interfaces:**

- Consumes: engine `nodeMessageSchema` / `pendingInteractionSchema`, `workflowDb.getWorkflowRun`, `workflowNodeMessageDb.listNodeMessages`.
- Produces: `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages` and `pending_interactions: []` on GET run.

- [ ] **Step 1: Write the failing API tests and mocks**

Before importing `./api` in every file that calls `registerApiRoutes`, add:

```ts
mock.module('@archon/core/db/workflow-node-messages', () => ({
  listNodeMessages: mock(async () => []),
  appendNodeMessage: mock(async () => ({})),
  setNodeToolOutput: mock(async () => {}),
}));
```

Those files today are:

- `api.auth.test.ts`
- `api.codebases.test.ts`
- `api.conversations.test.ts`
- `api.health.test.ts`
- `api.messages.test.ts`
- `api.provider-keys.test.ts`
- `api.providers.test.ts`
- `api.usage.test.ts`
- `api.user-ai-prefs.test.ts`
- `api.workflow-envs.test.ts`
- `api.workflow-runs.test.ts`
- `api.workflows.test.ts`

In `api.workflow-runs.test.ts` use a named `mockListNodeMessages` so tests can override it.

Add tests:

1. GET run includes `pending_interactions: []` and does not call `listNodeMessages`.
2. GET `/api/workflows/runs/{runId}/nodes/{nodeId}/messages` 404 when `getWorkflowRun` returns null.
3. GET messages 200 `{ messages: [] }` when the run exists and list returns `[]`.
4. GET messages returns list rows mapped to `{ id, seq, kind, payload, created_at }` in seq order, with `Date` converted to ISO.
5. GET messages 400 when `nodeId` is empty (if the router still matches; otherwise OpenAPI min(1) on params — assert 400 on `runId`/`nodeId` blank via the same pattern as retry/preview).

Place the GET-run assertion next to the existing empty `nodeStates` test (`api.workflow-runs.test.ts` around the GET run describe at line 1628).

- [ ] **Step 2: Run test to verify it fails**

```bash
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
```

Expected: FAIL on missing `pending_interactions` and missing messages route (404/500).

- [ ] **Step 3: Write minimal implementation**

In `workflow.schemas.ts`:

```ts
import {
  nodeMessageKindSchema,
  nodeMessagePayloadSchema,
  pendingInteractionSchema as enginePendingInteractionSchema,
} from '@archon/workflows/schemas/pending-interaction';
```

Do not import payload from a forked local object.
If package subpath exports are file-based (`@archon/workflows/schemas/*`), import:

```ts
import { pendingInteractionSchema as enginePendingInteractionSchema } from '@archon/workflows/schemas/pending-interaction';
import { nodeMessageKindSchema, nodeMessagePayloadSchema } from '@archon/workflows/schemas/node-message';
```

```ts
export const pendingInteractionSchema = enginePendingInteractionSchema.openapi('PendingInteraction');

export const workflowNodeMessageSchema = z
  .object({
    id: z.string(),
    seq: z.number().int().min(1),
    kind: nodeMessageKindSchema,
    payload: nodeMessagePayloadSchema,
    created_at: z.string(),
  })
  .openapi('WorkflowNodeMessage');

export const workflowNodeMessagesParamsSchema = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .openapi('WorkflowNodeMessagesParams');

export const workflowNodeMessagesResponseSchema = z
  .object({
    messages: z.array(workflowNodeMessageSchema),
  })
  .openapi('WorkflowNodeMessagesResponse');
```

Add `pending_interactions: z.array(pendingInteractionSchema)` to `workflowRunDetailSchema`.

In `api.ts`:

1. Register `GET /api/workflows/runs/{runId}/nodes/{nodeId}/messages` **before** `GET /api/workflows/runs/{runId}` (same reason `by-worker` is registered first).
2. Handler: `getWorkflowRun`; 404 if missing; `listNodeMessages(runId, nodeId)`; map `created_at` with `created_at instanceof Date ? created_at.toISOString() : String(created_at)`.
3. GET run JSON adds `pending_interactions: []` next to `usage` (`api.ts:4926-4939`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
```

Expected: PASS.

Then run one other `api.*.test.ts` that imports `registerApiRoutes` (for example `api.conversations.test.ts`) to prove the new mock prevents real DB load.

- [ ] **Step 5: Refactor**

No extra service class.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/schemas/workflow.schemas.ts \
  packages/server/src/routes/api.ts \
  packages/server/src/routes/api.workflow-runs.test.ts \
  packages/server/src/routes/api.auth.test.ts \
  packages/server/src/routes/api.codebases.test.ts \
  packages/server/src/routes/api.conversations.test.ts \
  packages/server/src/routes/api.health.test.ts \
  packages/server/src/routes/api.messages.test.ts \
  packages/server/src/routes/api.provider-keys.test.ts \
  packages/server/src/routes/api.providers.test.ts \
  packages/server/src/routes/api.usage.test.ts \
  packages/server/src/routes/api.user-ai-prefs.test.ts \
  packages/server/src/routes/api.workflow-envs.test.ts \
  packages/server/src/routes/api.workflows.test.ts
git commit -m "feat(server): add node transcript GET and empty pending_interactions"
```

---

### Task 8: Web client types for the transcript GET

**Files:**

- Modify: `packages/web/src/lib/api.generated.d.ts`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/get-workflow-node-messages.test.ts`

**Interfaces:**

- Consumes: OpenAPI `WorkflowNodeMessagesResponse`, `PendingInteraction`, `WorkflowRunDetail`.
- Produces: `getWorkflowNodeMessages(runId, nodeId)`.

- [ ] **Step 1: Write the failing client test**

```ts
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const fetchJSON = mock(async () => ({ messages: [] }));

mock.module('./api', () => {
  // do not mock the whole module; instead test URL building by importing after fetch mock
});
```

Do not mock the whole `api` module.
`api.ts` uses `fetchJSON` internally; test by stubbing global `fetch`:

```ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { getWorkflowNodeMessages } from './api';

describe('getWorkflowNodeMessages', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/workflows/runs/run%2F1/nodes/n%201/messages');
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  test('encodes runId and nodeId onto the messages path', async () => {
    const result = await getWorkflowNodeMessages('run/1', 'n 1');
    expect(result.messages).toEqual([]);
  });
});
```

If `fetchJSON` does not use global `fetch`, match its real helper in `api.ts` (read `fetchJSON` at the top of that file and stub the same transport).

- [ ] **Step 2: Run test to verify it fails**

```bash
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts )
```

Expected: FAIL because `getWorkflowNodeMessages` does not exist.

- [ ] **Step 3: Write minimal implementation**

Hand-edit `packages/web/src/lib/api.generated.d.ts` (server is not required to be running for this story):

1. Add `PendingInteraction`, `WorkflowNodeMessage`, and `WorkflowNodeMessagesResponse` to `components.schemas`.
2. Add `pending_interactions: components['schemas']['PendingInteraction'][]` to `WorkflowRunDetail`.
3. Add path `/api/workflows/runs/{runId}/nodes/{nodeId}/messages` GET 200 content schema `WorkflowNodeMessagesResponse`.

In `packages/web/src/lib/api.ts` after `getWorkflowRun`:

```ts
export async function getWorkflowNodeMessages(
  runId: string,
  nodeId: string
): Promise<components['schemas']['WorkflowNodeMessagesResponse']> {
  return fetchJSON(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/messages`
  );
}
```

If a server is already running on 3090, `bun --filter @archon/web generate:types` may replace the hand-edit; keep the same shapes.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts && bun x tsc --noEmit )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

No extra wrapper type.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/api.generated.d.ts \
  packages/web/src/lib/api.ts \
  packages/web/src/lib/get-workflow-node-messages.test.ts
git commit -m "feat(web): add getWorkflowNodeMessages client"
```

---

### Task 9: Legacy Logs list and agent room

**Files:**

- Create: `packages/web/src/components/workflows/build-log-rows.ts`
- Create: `packages/web/src/components/workflows/build-log-rows.test.ts`
- Create: `packages/web/src/components/workflows/NodeRoom.tsx`
- Create: `packages/web/src/components/workflows/NodeRoom.test.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.tsx`
- Modify: `packages/web/src/components/workflows/WorkflowExecution.test.tsx`

**Interfaces:**

- Consumes: server `nodeStates` + events, `getWorkflowNodeMessages`.
- Produces: unmerged Logs rows, `NodeRoom` item list keyed by `kind`.

- [ ] **Step 1: Write the failing UI tests**

`build-log-rows.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildLogRows } from './build-log-rows';
import type { WorkflowEventResponse } from '@/lib/api';

function event(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'e1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildLogRows', () => {
  test('emits one row per nodeState plus loop and route iterations', () => {
    const rows = buildLogRows(
      [{ nodeId: 'loop-node', name: 'Loop', status: 'completed', retryEpoch: 0 }],
      [
        event({
          id: 'i1',
          event_type: 'loop_iteration_started',
          step_name: 'loop-node',
          data: { iteration: 1, maxIterations: 2 },
        }),
        event({
          id: 'r1',
          event_type: 'node_routed',
          step_name: 'loop-node',
          data: { execution_seq: 4, to: 'fix' },
        }),
      ]
    );
    expect(rows.map(r => r.key)).toEqual([
      'node:loop-node',
      'loop:loop-node:1',
      'route:loop-node:4',
    ]);
    expect(rows[1]).toMatchObject({ kind: 'loop_iteration', nodeId: 'loop-node', iteration: 1 });
    expect(rows[2]).toMatchObject({ kind: 'route_iteration', nodeId: 'loop-node', executionSeq: 4 });
  });

  test('does not merge conversation messages into the list', () => {
    const rows = buildLogRows(
      [{ nodeId: 'a', name: 'A', status: 'running', retryEpoch: 0 }],
      []
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('node');
  });
});
```

`NodeRoom.test.tsx` (pure helpers, matching `WorkflowLogs.test.tsx`):

Export `focusMessageId(messages, selection)` and `hasAskChrome(messages)` from `NodeRoom.tsx`.

```ts
test('focuses iteration_started status with matching detail', () => {
  const id = focusMessageId(
    [
      { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: 't' },
      {
        id: 'm2',
        seq: 2,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '2' },
        created_at: 't',
      },
    ],
    { nodeId: 'loop-node', iteration: 2 }
  );
  expect(id).toBe('m2');
});

test('does not treat status rows as Ask cards', () => {
  expect(
    hasAskChrome([
      { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: 't' },
    ])
  ).toBe(false);
});
```

In `WorkflowExecution.test.tsx`, replace the two `buildWorkflowDagNodeStates(undefined, ...)` lifecycle tests:

- `projects node_routed events as completed route-loop decisions` may still add a route node via `enrichDagNodesWithRouteDecisions`; keep that enrichment.
- `preserves runtime AI metadata from node_started event fallback` must become: missing `nodeStates` does not invent a lifecycle row from `node_started` / `node_completed`.

```ts
test('does not rebuild lifecycle from events when nodeStates is missing', () => {
  const nodes = buildWorkflowDagNodeStates(undefined, [
    workflowEvent({
      id: 'event-start',
      event_type: 'node_started',
      step_name: 'create-story',
      data: { provider: 'codex', model: 'gpt-5.5' },
    }),
    workflowEvent({
      id: 'event-complete',
      event_type: 'node_completed',
      step_name: 'create-story',
      data: { duration_ms: 1200 },
    }),
  ]);
  expect(nodes.find(n => n.nodeId === 'create-story')).toBeUndefined();
});
```

Keep the loop-iteration enrichment test that passes explicit `nodeStates`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRoom.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
```

Expected: FAIL on missing modules and the old fallback test.

- [ ] **Step 3: Write minimal implementation**

`build-log-rows.ts` returns:

```ts
export type LogRow =
  | { key: string; kind: 'node'; nodeId: string; name: string; status: string }
  | {
      key: string;
      kind: 'loop_iteration';
      nodeId: string;
      iteration: number;
      status: string;
    }
  | {
      key: string;
      kind: 'route_iteration';
      nodeId: string;
      executionSeq: number;
      status: string;
    };

export type LogRowSelection = {
  nodeId: string;
  iteration?: number;
  executionSeq?: number;
};
```

`buildLogRows(nodeStates, events)`:

1. One `kind: 'node'` row per `nodeStates` entry, in given order.
2. For each `loop_iteration_started` / `completed` / `failed` event with `step_name` and numeric `data.iteration`, upsert a loop row keyed `loop:${nodeId}:${iteration}` (later events update `status`).
3. For each `node_routed` with numeric `data.execution_seq`, emit `route:${nodeId}:${executionSeq}`.
4. Do not read conversation messages.

`NodeRoom.tsx`:

- Props: `runId`, `selection: LogRowSelection | null`.
- If `selection` is null, render an empty-state string, not Ask chrome.
- `useEffect` calls `getWorkflowNodeMessages(runId, selection.nodeId)` when `runId`/`nodeId` change.
- Render items in `seq` order: `text` as prose, `tool` as a card with `name` / `id` / optional input / optional output, `status` as a muted lifecycle note (`state` + optional `detail`).
- `data-message-id={message.id}` on each item so tests/focus can find them.
- `hasAskChrome` always returns false in this story.
- Do not read `pending_interactions`.
- Do not show "waiting on you".

In `WorkflowExecution.tsx`:

1. Change `buildWorkflowDagNodeStates` base to `(nodeStates ?? []).map(toDagNodeState)`.
2. Delete the `buildDagNodeStatesFromEvents` call site from that function (the helper may remain unused; delete it if nothing else imports it).
3. Logs tab (`renderBody` else branch, `WorkflowExecution.tsx:805-816`): left list maps `buildLogRows(workflow.dagNodes mapped back or original nodeStates + events, events)` instead of `DagNodeProgress` if flattening is easier from events + query `nodeStates`.
   Use `queryData?.nodeStates` plus `queryData?.events` rather than already-enriched `workflow.dagNodes` so iteration rows come from events.
4. Logs-tab right panel is `<NodeRoom runId={runId} selection={logSelection} />`, not `logsPanel`.
5. Graph tab still uses `logsPanel` / `WorkflowLogs` and `handleNodeClick(nodeId: string)`.
6. Do not render Ask chrome.

Keep `DagNodeProgress.tsx` on disk; Logs tab may stop using it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
( cd packages/web && bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRoom.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
```

Expected: PASS.

- [ ] **Step 5: Refactor**

Delete `buildDagNodeStatesFromEvents` if it has no remaining callers.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/workflows/build-log-rows.ts \
  packages/web/src/components/workflows/build-log-rows.test.ts \
  packages/web/src/components/workflows/NodeRoom.tsx \
  packages/web/src/components/workflows/NodeRoom.test.tsx \
  packages/web/src/components/workflows/WorkflowExecution.tsx \
  packages/web/src/components/workflows/WorkflowExecution.test.tsx
git commit -m "feat(web): open per-node transcript from legacy Logs"
```

---

### Task 10: Sprint status and story validation

**Files:**

- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

- [ ] **Step 1: Run the story validation commands**

```bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts src/node-transcript.test.ts && bun test src/dag-executor.test.ts )
( cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts && bun test src/db/workflow-node-messages.test.ts && bun test src/schemas/workflow-node-message.test.ts && bun test src/workflows/store-adapter.test.ts )
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRoom.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/workflows && bun x tsc --noEmit )
( cd packages/core && bun x tsc --noEmit )
( cd packages/server && bun x tsc --noEmit )
( cd packages/web && bun x tsc --noEmit )
```

If `DATABASE_URL` or `PGHOST` is set:

```bash
bun run check:schema-upgrades
```

- [ ] **Step 2: Confirm the commands pass**

Expected: all focused tests PASS.
GET run fixtures include `pending_interactions: []`.
No test asserts Ask chrome or `awaiting`.

- [ ] **Step 3: Update sprint status**

Set:

```yaml
  epic-5: in-progress
  5-1-open-a-nodes-own-transcript-from-logs-legacy: done
```

Update `last_updated` to the implementation date.

- [ ] **Step 4: Re-read Story 5.1 acceptance criteria and confirm each is covered**

- Unmerged Logs rows including loop / route_loop iterations: Task 9.
- Click command/prompt/loop → GET messages room: Tasks 6, 7, 9.
- Extensible `kind` list, no Ask card / empty slot / awaiting chrome: Task 9.
- Completed node replays the same GET: Tasks 6, 7, 9.
- Table on SQLite and Postgres, store-assigned seq, cascade-delete: Tasks 2, 4.
- Executor appends text/tool/status; status is not an Ask card: Task 6.
- `remote_agent_messages` untagged: no edits to messages table.
- Indexes/column comments trailing; `check:schema-upgrades` in validation: Tasks 2, 10.
- GET run `nodeStates` from projector (already true) and `pending_interactions: []` with no pending table: Task 7.
- UI does not render cards from that array: Task 9.

- [ ] **Step 5: Commit**

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark story 5.1 done in sprint status"
```

---

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
|-----------|-----------|-----------|
| `packages/workflows/src/schemas/node-message.test.ts` | text/tool/status accept; seq/kind reject | AD-3 payload contract |
| `packages/workflows/src/schemas/pending-interaction.test.ts` | ask/permission accept; unknown kind reject | AD-1 embed type |
| `packages/core/src/db/adapters/sqlite.test.ts` | MIN_NON_AUTH_COLUMNS 169; table presence | AD-8 parity |
| `packages/core/src/db/workflow-node-messages.test.ts` | seq, list order, cascade, tool output, corrupt row | store assignment |
| `packages/core/src/workflows/store-adapter.test.ts` | required methods + delegate | IWorkflowStore wiring |
| `packages/workflows/src/node-transcript.test.ts` | fail-open, no body in logs | observability |
| `packages/workflows/src/dag-executor.test.ts` | prompt/tool/loop/bash/fail paths | executor recording |
| `packages/server/src/routes/api.workflow-runs.test.ts` | GET messages 200/404/empty; pending [] | FR11 |
| `packages/web/src/lib/get-workflow-node-messages.test.ts` | URL encoding | client |
| `packages/web/src/components/workflows/build-log-rows.test.ts` | unmerged node + iteration rows | CAP-1 Logs |
| `packages/web/src/components/workflows/NodeRoom.test.tsx` | seq render, no Ask chrome, iteration focus | CAP-2 room |
| `packages/web/src/components/workflows/WorkflowExecution.test.tsx` | no event-lifecycle fallback | AD-7 |

### Edge Cases Checklist

- [ ] Missing `nodeStates` does not rebuild lifecycle from `node_started`.
- [ ] Empty node transcript returns `[]`, not 404.
- [ ] Missing run returns 404 on GET messages.
- [ ] Unique seq race retries once.
- [ ] Corrupt payload fails closed with id-only logs.
- [ ] Bash/script nodes do not append transcript rows.
- [ ] Loop iteration click focuses marker or shows full transcript.
- [ ] Graph tab still shows merged `WorkflowLogs`.
- [ ] `pending_interactions` is always `[]` and is not rendered.
- [ ] Append failure does not fail the node.

---

## Validation Commands

```bash
( cd packages/workflows && bun test src/schemas/node-message.test.ts src/schemas/pending-interaction.test.ts src/node-transcript.test.ts && bun test src/dag-executor.test.ts )
( cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts && bun test src/db/workflow-node-messages.test.ts && bun test src/schemas/workflow-node-message.test.ts && bun test src/workflows/store-adapter.test.ts )
( cd packages/server && bun test src/routes/api.workflow-runs.test.ts )
( cd packages/web && bun test src/lib/get-workflow-node-messages.test.ts src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRoom.test.tsx src/components/workflows/WorkflowExecution.test.tsx )
( cd packages/workflows && bun x tsc --noEmit )
( cd packages/core && bun x tsc --noEmit )
( cd packages/server && bun x tsc --noEmit )
( cd packages/web && bun x tsc --noEmit )
```

Optional when Postgres is reachable:

```bash
bun run check:schema-upgrades
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- Legacy Logs tab shows unmerged node-run rows; a loop iteration and a `route_loop` `node_routed` attempt are their own clickable rows; the list is not `WorkflowLogs`' merged conversation stream.
- Clicking a `command` / `prompt` / `loop` row opens `NodeRoom` populated from `GET /api/workflows/runs/:runId/nodes/:nodeId/messages` in store `seq` order.
- The room is an extensible item list keyed by `kind` (`text` / `tool` / `status`), not a prose-only dump and not an AskCard placeholder.
- There is no Ask card, empty card slot, or awaiting / "waiting on you" chrome.
- A completed agent node replays the same GET transcript; there is no live-only path.
- `remote_agent_workflow_node_messages` exists on SQLite and Postgres, cascade-deletes with the run, and uses store-assigned `seq` per `(run_id, node_id)`.
- The executor appends `text` / `tool` / `status` for agent nodes; `status` is lifecycle notes only.
- `remote_agent_messages` is not node-tagged.
- GET `/api/workflows/runs/:runId` `nodeStates` still come from `projectLatestEffectiveNodeStates`.
- GET run includes `pending_interactions: []` with no `remote_agent_pending_interactions` table.
- The UI does not render cards from `pending_interactions`.
- Legacy does not rebuild lifecycle from raw events via `buildDagNodeStatesFromEvents`.
- Column comments live in the trailing migration section.
- Focused package tests and type-checks listed above pass.
- `sprint-status.yaml` entry `5-1-open-a-nodes-own-transcript-from-logs-legacy` is `done`.

## NOT Building

- AskHuman tool, pending table, `awaiting` node status, answer POST, SSE `node_awaiting` / `interaction_resolved`.
- Console `/console` inspect (Story 5.5).
- `packages/web/src/lib/run-graph/` (Story 5.3).
- Per-type rooms for bash/script/gates/child/controller (Story 5.2).
- Chat timeline click (Story 5.4).
- Graph-tab replacement of Logs.
- YAML authoring changes, CLI/chat/`manage_run` answer UX, `NativeTool.handler` return type.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| New db module loaded by `api.ts` opens a real database in unrelated server tests | High | High | Mock `@archon/core/db/workflow-node-messages` in every `registerApiRoutes` test before importing `./api` |
| `MIN_NON_AUTH_COLUMNS` floor hides parser drift if set wrong | Low | High | Raise 162 → 169 exactly (7 new columns) and add an explicit table-presence test |
| Concurrent appends duplicate seq | Med | Med | Unique constraint plus one retry inside `withTransaction` |
| Recording every assistant chunk duplicates batch flush | Med | Med | Record at send time only (stream/flush or batch flush) |
| Graph tab accidentally loses merged logs | Med | Med | Change only the Logs-tab branch; leave `logsPanel` on Graph |

## Manual verification

If a web server is already running for this worktree, open a completed run, switch to Logs, click a `prompt` node, and confirm the right panel shows that node's `text`/`tool`/`status` items rather than the merged conversation stream.
Do not treat that as a substitute for the automated tests above.
