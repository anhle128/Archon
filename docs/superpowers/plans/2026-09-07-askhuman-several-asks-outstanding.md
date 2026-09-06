# Keep Several Asks Outstanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Track each checkbox in order, and do not combine RED, GREEN, REFACTOR, or commit steps.

**Goal:** Keep several AskHuman interactions outstanding on one paused run without a second scheduler, so two asking nodes or two Asks on one node stay independent, run-level awaiting input clears only on the last pending row in that run, and a child-run Ask is answered on the child.

**Architecture:** Reuse the existing run-level pause.
A second persist is success while the run is already `paused`.
Each asking node tears down only its own `sendQuery`.
In-flight siblings may finish because `shouldContinueStreamingForStatus('paused')` is true.
`runLayers` must not start the next DAG layer.
`resolvePendingInteraction` resumes only when `remaining_pending === 0` for that run.
`projectLatestEffectiveNodeStates` keeps a node `awaiting` while any pending row remains for `(run_id, node_id)`.
Pending rows for a `workflow:` child live on the child `run_id`.
The parent follows existing `pauseParentOnChild` behavior.
Do not add per-node scheduling or a new run status.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite and PostgreSQL, OpenAPIHono, Bun Test, Claude Agent SDK `0.3.209`, and Pi `0.80.6`.

**Spec:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md`, Story 6.4.

**Approved design inputs:** `_bmad-output/specs/spec-workflow-run-view-hitl/SPEC.md` CAP-5, `_bmad-output/specs/spec-workflow-run-view-hitl/hitl-contract.md`, `_bmad-output/specs/spec-workflow-run-view-hitl/brownfield.md`, `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-05/ARCHITECTURE-SPINE.md` AD-1, AD-2, and AD-8, and Stories 6.2 and 6.3.

**Issue:** https://github.com/anhle128/Archon/issues/89

## Global Constraints

- Stories 6.1, 6.2, and 6.3 are complete prerequisites.
- Preserve their characterization coverage.
- Do not add a second scheduler, a per-node run status, or mixed `running` plus `awaiting` run status.
- Run status stays `paused` while any `status = 'pending'` interaction exists on that run.
- `awaiting` is a node/UI projection only.
- Ask pause must not write `metadata.approval`.
- Do not write `node_completed` for an asking node.
- In-flight siblings may finish their current turn.
- The next DAG layer must not start until the run is `running` again.
- A node stays `awaiting` until every pending row for `(workflow_run_id, node_id)` is resolved.
- Run chrome "awaiting input" equals `status === 'paused'` AND `count(pending) > 0` on that same run.
- That formula clears only when the last pending row in the run is resolved.
- `count(pending)` includes every `status = 'pending'` row, including `kind: permission`.
- Child Ask pending rows live on the child `run_id`.
- The operator answers the child, not the parent.
- The parent follows existing `workflow:` child-paused behavior (`pauseParentOnChild`).
- Fan-out children that pause remain cancelled by existing `#2180` behavior.
- Per-node independent scheduling is out of scope.
- Do not implement Ask cards, teammate copy, composer HITL, or Permission confirmation.
- Those belong to Stories 6.5, 6.6, and 6.7.
- Do not add CLI, chat, or `manage_run` answer UX.
- Do not add a workflow YAML field or parse assistant prose as an Ask.
- `NativeTool.handler` remains `(input, context?) => Promise<string>`.
- `pendingInteractionSchema` remains canonical in `packages/workflows/src/schemas/pending-interaction.ts`.
- The executor must not call `resumeWorkflowRun` for an Ask pause.
- `workflow-operations` remains the only Ask-resume owner, and only when persistence reports `resumed: true`.
- Claude stays pinned to `0.3.209`.
- Pi stays on lockfile `0.80.6`.
- Do not use `any`.
- Do not run unscoped `bun test` from the repository root.
- Run focused tests from the package directory.
- Each behavior slice follows RED, observed expected failure or characterization miss, minimal GREEN, explicit REFACTOR, focused GREEN, and commit.
- If a new characterization test is already green against current production code, do not change production code in that task.
- Keep each full Markdown sentence in this plan on its own physical line.

## Verified Repository Baseline

- `insertPendingInteraction` already accepts `running` or `paused` and rejects terminal statuses at `packages/core/src/db/workflow-pending-interactions.ts`.
- `packages/core/src/db/workflow-pending-interactions.test.ts` already covers a second insert on an already-paused run.
- `pauseWorkflowRun` without `approvalContext` is already idempotent when the run is `paused` at `packages/core/src/db/workflows.ts`.
- `resolvePendingInteraction` already resumes only when `remaining_pending === 0`.
- The same file already tests a sibling pending row on the **same** node.
- `shouldContinueStreamingForStatus('paused')` is already `true` at `packages/workflows/src/dag-executor.ts`.
- `pauseOnAskHuman` already calls `pauseWorkflowRun(runId)` with no approval context.
- An asking node already returns `{ state: 'pending' }` and does not write `node_completed`.
- `runLayers` already returns `'pending'` when any node in the layer is pending, and it also stops between layers when status is not `running`.
- Hydrate already re-enters every unfinished node that has answered Ask rows, including two sibling nodes, in `executeDagWorkflow -- AskHuman resume re-entry`.
- `projectLatestEffectiveNodeStates` already overlays pending rows to `awaiting` and ignores `interaction_resolved` as completion.
- GET `/api/workflows/runs/:runId` already embeds `pending_interactions` and projects `awaiting`.
- POST answer already skips auto-dispatch when `remaining_pending > 0`.
- `InMemoryStore.pauseWorkflowRun` in `packages/workflows/src/subrun.test.ts` currently writes `metadata.approval` even when `approvalContext` is omitted.
- There is no DAG-layer test where two in-flight agent nodes each persist an Ask.
- There is no projector test where one of two pending rows on the same node is answered.
- There is no GET test where two nodes are independently `awaiting`.
- There is no child-run test that pending rows live on the child `run_id`.
- `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` currently has merge-conflict markers on `last_updated`.
- Story key `6-4-keep-several-asks-outstanding-without-a-second-scheduler` is `backlog`.

## File Map

### Modify for projection

- Modify `packages/workflows/src/retry-state.test.ts` for remaining-pending overlay on one node and independent sibling nodes.
- Modify `packages/workflows/src/retry-state.ts` only if those tests fail.

### Modify for persistence

- Modify `packages/core/src/db/workflow-pending-interactions.test.ts` for last-pending-in-run across two node ids.
- Modify `packages/core/src/db/workflow-pending-interactions.ts` only if those tests fail.

### Modify for executor concurrency

- Modify `packages/workflows/src/dag-executor.test.ts` for two in-flight Asks, two Asks on one node, sibling streaming, and no next-layer start.
- Modify `packages/workflows/src/dag-executor.ts` only if those tests fail, except the streaming-status comment which this plan updates in Task 4's REFACTOR.

### Modify for the sub-run store and child Ask

- Modify `packages/workflows/src/subrun.test.ts` so `InMemoryStore.pauseWorkflowRun` omits `metadata.approval` when `approvalContext` is omitted, and so a child Ask persists on the child run.

### Modify for HTTP contract

- Modify `packages/server/src/routes/api.workflow-runs.test.ts` for independent pending rows, the awaiting-input formula, parent/child embed isolation, and parent answer 404.
- Modify `packages/server/src/routes/api.ts` only if those tests fail.

### Modify at completion

- Modify `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml` only after every validation gate passes.
- Resolve the existing `last_updated` conflict by writing one new timestamp, not by stacking both sides.

## Authoritative Contracts

### Concurrent persist and tear-down

Two in-flight agent nodes in one topological layer may each call `AskHuman`.
Each handler inserts its own pending row keyed by `(workflow_run_id, tool_use_id)`.
Each wrapper aborts **that** node's `sendQuery` and rejects with `AskHumanAwaitingError`.
`pauseOnAskHuman` then calls `pauseWorkflowRun(runId)` with no approval argument.
The first Ask flips `running` to `paused`.
The second Ask must succeed because already-paused Ask pause is idempotent.
The second node must not fail.
`node_completed` must not be written for either asking node.

### Same-node dual Ask

One node may persist two pending rows in one turn when two `AskHuman` tool uses run before `sendQuery` rejects.
Both rows share `node_id` and `provider_session_id` and differ in `tool_use_id`.
Answering one row leaves the node `awaiting` while the other row is `pending`.
Hydrate later maps both answered rows in `created_at ASC, id ASC` order, which Story 6.3 already covers.

### Streaming siblings and next layer

`shouldContinueStreamingForStatus` remains:

```ts
export function shouldContinueStreamingForStatus(status: string | null): boolean {
  return status === 'running' || status === 'paused';
}
```

A non-asking sibling in the same layer may finish its current `sendQuery` and may write `node_completed`.
A later layer must not start.
Do not keep the run `running` so a sibling can enter a new layer.

### Last-clears

`resolvePendingInteraction` counts remaining rows with `status = 'pending'` on that `workflow_run_id` only.
If the count is greater than zero, `resumed` is false and run status stays `paused`.
If the count is zero, the paused-ask resume CAS runs in the same transaction.
`answerAskHuman` must not call `resumeWorkflowRun`.
HTTP auto-dispatch happens only when `resumed === true`.

### Node awaiting

`projectLatestEffectiveNodeStates(events, pending)` overlay:

```ts
for (const row of pending ?? []) {
  if (row.status !== 'pending') continue;
  // force that node_id to awaiting
}
```

`interaction_resolved` does not complete the node.
A node with a remaining pending row is `awaiting`.
A node whose last pending row was answered still stays `awaiting` from `node_awaiting` until hydrate re-enters it and later writes `node_completed`.

### Run chrome formula

Surfaces compute awaiting input from GET run:

```ts
const awaitingInput =
  run.status === 'paused' &&
  pending_interactions.some(row => row.status === 'pending');
```

Do not add a new GET field.
Do not add run status `awaiting`.
Story 6.5 owns warning chrome and copy.
This story owns the data that makes that formula true and false.

### Child Ask

`createAskHumanTool({ store, workflowRunId, nodeId })` receives the executing run id.
A `workflow:` child therefore inserts on the child `run_id`.
GET parent lists only parent rows.
GET child lists child rows.
POST `/api/workflows/runs/{parentId}/ask/{childToolUseId}/answer` returns 404.
POST on the child run id is the answer path from Story 6.3.
Parent pause uses existing `pauseParentOnChild`, which still writes `ApprovalContext` of type `child_workflow`.
Do not invent a second parent scheduler.

## NOT Building

- Ask cards, Submit/Decline controls, teammate copy, and composer HITL.
- Permission confirmation POST and permission cards.
- Per-node independent scheduling while the run stays `running`.
- Fan-out child Ask as a supported concurrent-gate case.
- Changing `pauseParentOnChild` copy away from `/workflow approve` in this story.
- CLI, chat, or `manage_run` answer commands.
- Schema migrations, SDK upgrades, YAML fields, and prose-as-ask detection.

---

## Task 1: Projector keeps a node awaiting until every pending row for that node is gone

**Files:**
- Modify: `packages/workflows/src/retry-state.test.ts`
- Modify only if RED stays red: `packages/workflows/src/retry-state.ts`
- Test: `packages/workflows/src/retry-state.test.ts`

**Interfaces:**
- Consumes: `projectLatestEffectiveNodeStates(events, pending?: readonly { node_id: string; status: string }[])`
- Produces: unchanged `Map<string, RetryNodeProjection>` whose `state` is `'awaiting'` while any pending row remains for that `node_id`

- [ ] **Step 1: Write the failing tests**

Append these tests after `answered pending rows do not overlay awaiting` in `packages/workflows/src/retry-state.test.ts`:

```ts
test('keeps a node awaiting while any pending row remains for that node', () => {
  const states = projectLatestEffectiveNodeStates(
    [
      { event_type: 'node_started', step_name: 'review', data: {} },
      {
        event_type: 'node_awaiting',
        step_name: 'review',
        data: { node_id: 'review', tool_use_id: 'toolu_1' },
      },
      {
        event_type: 'interaction_resolved',
        step_name: 'review',
        data: { node_id: 'review', tool_use_id: 'toolu_1' },
      },
    ],
    [
      { node_id: 'review', status: 'answered' },
      { node_id: 'review', status: 'pending' },
    ]
  );
  expect(states.get('review')?.state).toBe('awaiting');
});

test('projects two sibling asking nodes independently', () => {
  const states = projectLatestEffectiveNodeStates(
    [
      { event_type: 'node_started', step_name: 'alpha', data: {} },
      { event_type: 'node_started', step_name: 'beta', data: {} },
      {
        event_type: 'node_awaiting',
        step_name: 'alpha',
        data: { node_id: 'alpha', tool_use_id: 'toolu_alpha' },
      },
      {
        event_type: 'node_awaiting',
        step_name: 'beta',
        data: { node_id: 'beta', tool_use_id: 'toolu_beta' },
      },
      {
        event_type: 'interaction_resolved',
        step_name: 'alpha',
        data: { node_id: 'alpha', tool_use_id: 'toolu_alpha' },
      },
    ],
    [
      { node_id: 'alpha', status: 'answered' },
      { node_id: 'beta', status: 'pending' },
    ]
  );
  expect(states.get('alpha')?.state).toBe('awaiting');
  expect(states.get('beta')?.state).toBe('awaiting');
});

test('a pending permission row also forces awaiting', () => {
  const states = projectLatestEffectiveNodeStates(
    [{ event_type: 'node_started', step_name: 'review', data: {} }],
    [{ node_id: 'review', status: 'pending' }]
  );
  expect(states.get('review')?.state).toBe('awaiting');
});
```

- [ ] **Step 2: Run test to verify it fails or characterize**

Run: `cd packages/workflows && bun test src/retry-state.test.ts`
Expected: the new tests fail if overlay ignores remaining pending rows.
If they pass against current overlay plus `node_awaiting` persistence, record that as characterization and do not edit `retry-state.ts`.

- [ ] **Step 3: Write minimal implementation**

If RED, keep the pending overlay loop that sets `state: 'awaiting'` for every `status === 'pending'` row and continue to ignore `interaction_resolved`.
Do not complete a node when one of several pending rows is answered.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/workflows && bun test src/retry-state.test.ts`
Expected: PASS, including the older `node_awaiting` and overlay tests.

- [ ] **Step 5: Refactor**

Keep the overlay loop as a single pass.
Do not add a helper that 6.5 console cannot import.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/retry-state.test.ts packages/workflows/src/retry-state.ts
git commit -m "test(workflows): keep a node awaiting until every Ask on it is resolved"
```

---

## Task 2: Persistence resumes only the last pending row in the run

**Files:**
- Modify: `packages/core/src/db/workflow-pending-interactions.test.ts`
- Modify only if RED stays red: `packages/core/src/db/workflow-pending-interactions.ts`
- Test: `packages/core/src/db/workflow-pending-interactions.test.ts`

**Interfaces:**
- Consumes: `resolvePendingInteraction(input: ResolvePendingInteractionInput): Promise<ResolvePendingInteractionResult>`
- Produces: `{ resumed: boolean; remaining_pending: number }` where `resumed` is true only when no `status = 'pending'` row remains on that `workflow_run_id`

- [ ] **Step 1: Write the failing tests**

Append after `does not resume while a sibling interaction is pending`:

```ts
test('does not resume while a pending Ask remains on another node', async () => {
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'alpha',
    tool_use_id: 'toolu_alpha',
    envelope: mixedEnvelope,
  });
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'beta',
    tool_use_id: 'toolu_beta',
    envelope: mixedEnvelope,
  });
  await pauseRun();

  const first = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_alpha' })
  );
  expect(first.resumed).toBe(false);
  expect(first.remaining_pending).toBe(1);
  expect(await runStatus()).toBe('paused');

  const listed = await listPendingInteractions('run-1');
  const byNode = Object.fromEntries(listed.map(row => [row.node_id, row.status]));
  expect(byNode).toEqual({ alpha: 'answered', beta: 'pending' });
});

test('resumes when the last pending Ask in the run is on a different node', async () => {
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'alpha',
    tool_use_id: 'toolu_alpha',
    envelope: mixedEnvelope,
  });
  await insertPendingInteraction({
    ...baseInput,
    node_id: 'beta',
    tool_use_id: 'toolu_beta',
    envelope: mixedEnvelope,
  });
  await pauseRun();

  await resolvePendingInteraction(resolveInput({ tool_use_id: 'toolu_alpha' }));
  const last = await resolvePendingInteraction(
    resolveInput({ tool_use_id: 'toolu_beta' })
  );
  expect(last.resumed).toBe(true);
  expect(last.remaining_pending).toBe(0);
  expect(await runStatus()).toBe('running');
});
```

- [ ] **Step 2: Run test to verify it fails or characterize**

Run: `cd packages/core && bun test src/db/workflow-pending-interactions.test.ts`
Expected: FAIL only if remaining count is scoped to `node_id` instead of `workflow_run_id`.
Current SQL counts `WHERE workflow_run_id = $1 AND status = 'pending'`, so this should characterize green.

- [ ] **Step 3: Write minimal implementation**

If RED, keep the remaining-pending query on `workflow_run_id` only.
Do not add a node-scoped resume.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/db/workflow-pending-interactions.test.ts`
Expected: PASS, including the existing same-node sibling test.

- [ ] **Step 5: Refactor**

Do not extract a second resume path.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/workflow-pending-interactions.test.ts packages/core/src/db/workflow-pending-interactions.ts
git commit -m "test(core): resume an Ask pause only after the last pending row in the run"
```

---

## Task 3: Sub-run store Ask pause must not stamp approval

**Files:**
- Modify: `packages/workflows/src/subrun.test.ts`
- Test: `packages/workflows/src/subrun.test.ts`

**Interfaces:**
- Consumes: `IWorkflowStore.pauseWorkflowRun(id: string, approvalContext?: ApprovalContext, extraMetadata?: Record<string, unknown>): Promise<void>`
- Produces: `InMemoryStore` matches production Ask pause: status `paused`, `metadata.approval` unchanged when `approvalContext` is omitted

- [ ] **Step 1: Write the failing test**

Add this test in `describe('workflow: sub-run e2e (#2121 Phase 2)')` before the child Ask test in Task 7, using the existing `InMemoryStore`:

```ts
it('Ask pause without approvalContext does not write metadata.approval', async () => {
  const store = new InMemoryStore();
  const run = await store.createWorkflowRun({
    workflow_name: 'ask-pause-store',
    conversation_id: 'conv-db',
    user_message: 'go',
    working_path: cwd,
  });
  await store.pauseWorkflowRun(run.id);
  const paused = await store.getWorkflowRun(run.id);
  expect(paused?.status).toBe('paused');
  expect(paused?.metadata.approval).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/workflows && bun test src/subrun.test.ts`
Expected: FAIL because current `InMemoryStore.pauseWorkflowRun` always assigns `approval: { ...approvalContext, resolved: null }`.

- [ ] **Step 3: Write minimal implementation**

Replace `InMemoryStore.pauseWorkflowRun` with:

```ts
pauseWorkflowRun: IWorkflowStore['pauseWorkflowRun'] = (id, approvalContext, extraMetadata) => {
  const r = this.runs.get(id);
  if (r) {
    r.status = 'paused';
    if (approvalContext !== undefined) {
      r.metadata = {
        ...r.metadata,
        approval: { ...approvalContext, resolved: null },
        ...(extraMetadata ?? {}),
      };
    }
  }
  return Promise.resolve();
};
```

Do not start throwing on a second approval pause.
That would change the existing `#2180` characterization limitation documented in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/workflows && bun test src/subrun.test.ts`
Expected: PASS, including existing child-paused approval tests that pass `approvalContext`.

- [ ] **Step 5: Refactor**

Keep the production comment in `pauseWorkflowRun` in `workflows.ts` as the source of truth.
Do not share `InMemoryStore` with `dag-executor.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/subrun.test.ts
git commit -m "fix(workflows): omit approval metadata on Ask pause in the sub-run store"
```

---

## Task 4: Two in-flight Asks share one paused run without failing the second node

**Files:**
- Modify: `packages/workflows/src/dag-executor.test.ts`
- Modify: `packages/workflows/src/dag-executor.ts` (comment only unless tests fail)
- Test: `packages/workflows/src/dag-executor.test.ts`

**Interfaces:**
- Consumes: `pauseOnAskHuman` → `pauseWorkflowRun(runId)` with no approval; `shouldContinueStreamingForStatus`; asking node result `{ state: 'pending' }`
- Produces: two persisted Asks, two torn-down `sendQuery` calls, no `node_completed` for asking nodes, no next-layer start

- [ ] **Step 1: Write the failing tests**

In `describe('executeDagWorkflow -- AskHuman pause')`, reuse `askQuestions`, `storedEventTypes`, and `invokeInjectedAskHuman`.
Add these helpers next to `wireAskPause`:

```ts
function wireIdempotentAskPause(store: IWorkflowStore): void {
  let status: 'running' | 'paused' = 'running';
  store.getWorkflowRunStatus = mock(async () => status);
  store.pauseWorkflowRun = mock(async (_id: string, approvalContext?: unknown) => {
    if (approvalContext !== undefined) {
      if (status !== 'running') {
        throw new Error('Workflow run not found or not in running state');
      }
      status = 'paused';
      return;
    }
    if (status === 'running' || status === 'paused') {
      status = 'paused';
      return;
    }
    throw new Error('Workflow run not found or not in running state');
  });
}

async function invokeAsk(
  options: SendQueryOptions | undefined,
  toolUseId: string,
  sessionId: string
): Promise<void> {
  const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
  if (!ask) throw new Error('AskHuman was not injected');
  await ask.handler({ questions: askQuestions }, { toolUseId, sessionId });
}
```

Add tests:

```ts
it('persists a second sibling Ask after the run is already paused without completing either node', async () => {
  mockSendQueryDag.mockImplementation(async function* (
    prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    const text = String(prompt);
    if (text.includes('ask alpha')) {
      await invokeAsk(options, 'toolu_alpha', 'sess-alpha');
    }
    if (text.includes('ask beta')) {
      await invokeAsk(options, 'toolu_beta', 'sess-beta');
    }
  });

  const store = createMockStore();
  wireIdempotentAskPause(store);
  const inserted: Array<{ node_id: string; tool_use_id: string }> = [];
  store.insertPendingInteraction = mock(async input => {
    inserted.push({ node_id: input.node_id, tool_use_id: input.tool_use_id });
    return {
      ...input,
      id: `pending-${inserted.length}`,
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
    };
  });

  await executeDagWorkflow(
    createMockDeps(store),
    createMockPlatform(),
    'conv-dag',
    testDir,
    {
      name: 'ask-siblings',
      nodes: [
        { id: 'alpha', prompt: 'ask alpha', allowed_tools: ['AskHuman'] },
        { id: 'beta', prompt: 'ask beta', allowed_tools: ['AskHuman'] },
        { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
      ],
    },
    makeWorkflowRun('ask-sibling-run'),
    'claude',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );

  expect(inserted).toEqual(
    expect.arrayContaining([
      { node_id: 'alpha', tool_use_id: 'toolu_alpha' },
      { node_id: 'beta', tool_use_id: 'toolu_beta' },
    ])
  );
  expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(2);
  expect(
    (store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls.every(
      call => call.length === 1 || call[1] === undefined
    )
  ).toBe(true);
  expect(store.failWorkflowRun).not.toHaveBeenCalled();
  const types = storedEventTypes(store);
  expect(types).not.toContain('node_completed');
  expect(types).not.toContain('node_failed');
  expect(mockSendQueryDag.mock.calls.length).toBe(2);
});

it('lets a non-asking sibling finish streaming while the asking node stays incomplete', async () => {
  mockSendQueryDag.mockImplementation(async function* (
    prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    if (String(prompt).includes('ask alpha')) {
      await invokeAsk(options, 'toolu_alpha', 'sess-alpha');
    }
    yield { type: 'assistant', content: 'beta finished' };
    yield { type: 'result', sessionId: 'sess-beta' };
  });

  const store = createMockStore();
  wireIdempotentAskPause(store);

  await executeDagWorkflow(
    createMockDeps(store),
    createMockPlatform(),
    'conv-dag',
    testDir,
    {
      name: 'ask-stream-sibling',
      nodes: [
        { id: 'alpha', prompt: 'ask alpha', allowed_tools: ['AskHuman'] },
        { id: 'beta', prompt: 'finish beta' },
        { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
      ],
    },
    makeWorkflowRun('ask-stream-run'),
    'claude',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );

  const types = storedEventTypes(store);
  expect(types.filter(type => type === 'node_completed')).toEqual(['node_completed']);
  const completed = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls
    .map(call => call[0] as { event_type: string; step_name?: string })
    .filter(event => event.event_type === 'node_completed')
    .map(event => event.step_name);
  expect(completed).toEqual(['beta']);
  expect(mockSendQueryDag.mock.calls.length).toBe(2);
  expect(store.completeWorkflowRun).not.toHaveBeenCalled();
});

it('persists two AskHuman tool uses on one node before tearing down sendQuery', async () => {
  mockSendQueryDag.mockImplementation(async function* (
    _prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    const first = invokeAsk(options, 'toolu_a', 'sess-shared');
    const second = invokeAsk(options, 'toolu_b', 'sess-shared');
    await Promise.allSettled([first, second]);
  });

  const store = createMockStore();
  wireIdempotentAskPause(store);
  const toolUseIds: string[] = [];
  store.insertPendingInteraction = mock(async input => {
    toolUseIds.push(input.tool_use_id);
    return {
      ...input,
      id: `pending-${toolUseIds.length}`,
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
    };
  });

  await executeDagWorkflow(
    createMockDeps(store),
    createMockPlatform(),
    'conv-dag',
    testDir,
    {
      name: 'ask-dual',
      nodes: [{ id: 'review', prompt: 'ask twice', allowed_tools: ['AskHuman'] }],
    },
    makeWorkflowRun('ask-dual-run'),
    'claude',
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    minimalConfig
  );

  expect(toolUseIds.sort()).toEqual(['toolu_a', 'toolu_b']);
  expect(storedEventTypes(store)).not.toContain('node_completed');
  expect(store.failWorkflowRun).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails or characterize**

Run: `cd packages/workflows && bun test src/dag-executor.test.ts`
Expected: FAIL if the second `pauseWorkflowRun` throws, if either asking node writes `node_completed`, if `after` starts, or if dual-insert is dropped when the first handler throws.
If current production already satisfies these, keep the tests and skip executor edits.

- [ ] **Step 3: Write minimal implementation**

If RED, keep these production rules:
- `pauseOnAskHuman` calls `pauseWorkflowRun(runId)` with no approval.
- Asking catch returns `{ state: 'pending' }` without `createWorkflowEvent({ event_type: 'node_completed' })`.
- `shouldContinueStreamingForStatus` continues on `paused`.
- `runLayers` returns `'pending'` when `layerHadPending` is true and does not execute the next layer.

Do not add a per-node scheduler.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/workflows && bun test src/dag-executor.test.ts`
Expected: PASS, including existing single-node Ask pause and resume re-entry tests.

- [ ] **Step 5: Refactor**

Update the `shouldContinueStreamingForStatus` comment so it names AskHuman as well as a concurrent approval node.
Do not change the function body unless a test requires it.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/dag-executor.test.ts packages/workflows/src/dag-executor.ts
git commit -m "test(workflows): keep several in-flight Asks on one paused run"
```

---

## Task 5: GET run embeds independent Asks and the awaiting-input formula

**Files:**
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify only if RED stays red: `packages/server/src/routes/api.ts`
- Test: `packages/server/src/routes/api.workflow-runs.test.ts`

**Interfaces:**
- Consumes: GET `/api/workflows/runs/:runId` `{ run.status, pending_interactions, nodeStates }`
- Produces: unchanged embed; clients compute `awaitingInput = status === 'paused' && pending_interactions.some(row => row.status === 'pending')`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('GET /api/workflows/runs/:runId')` after `projects awaiting from a pending row on a paused run without rewriting to paused or running`:

```ts
test('embeds two pending Asks as independent rows and projects both nodes awaiting', async () => {
  mockGetWorkflowRun.mockImplementationOnce(async () => ({
    ...MOCK_RUNNING_RUN,
    status: 'paused',
  }));
  mockListWorkflowEvents.mockImplementationOnce(async () => [
    {
      id: 'evt-alpha-start',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'alpha',
      data: { node_id: 'alpha', provider: 'claude' },
      created_at: NOW,
    },
    {
      id: 'evt-beta-start',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'beta',
      data: { node_id: 'beta', provider: 'claude' },
      created_at: NOW,
    },
  ]);
  mockGetConversationById.mockImplementationOnce(async () => ({
    id: 'conv-uuid-1',
    platform_conversation_id: 'web-conv-abc',
  }));
  mockListPendingInteractions.mockImplementationOnce(async () => [
    {
      id: 'pend-alpha',
      workflow_run_id: 'run-uuid-1',
      node_id: 'alpha',
      tool_use_id: 'toolu_alpha',
      kind: 'ask',
      status: 'pending',
      envelope: { questions: [{ prompt: 'Alpha?' }] },
      answer: null,
      provider_session_id: 'sess-alpha',
      created_at: '2026-09-06T00:00:00.000Z',
      resolved_at: null,
      resolved_by: null,
    },
    {
      id: 'pend-beta',
      workflow_run_id: 'run-uuid-1',
      node_id: 'beta',
      tool_use_id: 'toolu_beta',
      kind: 'ask',
      status: 'pending',
      envelope: { questions: [{ prompt: 'Beta?' }] },
      answer: null,
      provider_session_id: 'sess-beta',
      created_at: '2026-09-06T00:00:01.000Z',
      resolved_at: null,
      resolved_by: null,
    },
  ]);

  const { app } = makeApp();
  const response = await app.request('/api/workflows/runs/run-uuid-1');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    run: { status: string };
    pending_interactions: Array<{ node_id: string; tool_use_id: string; status: string }>;
    nodeStates: Array<{ nodeId: string; status: string }>;
  };
  expect(body.run.status).toBe('paused');
  expect(body.pending_interactions.map(row => row.tool_use_id).sort()).toEqual([
    'toolu_alpha',
    'toolu_beta',
  ]);
  const awaitingInput =
    body.run.status === 'paused' &&
    body.pending_interactions.some(row => row.status === 'pending');
  expect(awaitingInput).toBe(true);
  expect(body.nodeStates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: 'alpha', status: 'awaiting' }),
      expect.objectContaining({ nodeId: 'beta', status: 'awaiting' }),
    ])
  );
});

test('keeps a node awaiting after one of two same-node Asks is answered', async () => {
  mockGetWorkflowRun.mockImplementationOnce(async () => ({
    ...MOCK_RUNNING_RUN,
    status: 'paused',
  }));
  mockListWorkflowEvents.mockImplementationOnce(async () => [
    {
      id: 'evt-review-start',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_started',
      step_index: null,
      step_name: 'review',
      data: { node_id: 'review', provider: 'claude' },
      created_at: NOW,
    },
    {
      id: 'evt-review-await',
      workflow_run_id: 'run-uuid-1',
      event_type: 'node_awaiting',
      step_index: null,
      step_name: 'review',
      data: { node_id: 'review', tool_use_id: 'toolu_1' },
      created_at: NOW,
    },
    {
      id: 'evt-review-resolved',
      workflow_run_id: 'run-uuid-1',
      event_type: 'interaction_resolved',
      step_index: null,
      step_name: 'review',
      data: { node_id: 'review', tool_use_id: 'toolu_1' },
      created_at: NOW,
    },
  ]);
  mockGetConversationById.mockImplementationOnce(async () => ({
    id: 'conv-uuid-1',
    platform_conversation_id: 'web-conv-abc',
  }));
  mockListPendingInteractions.mockImplementationOnce(async () => [
    {
      id: 'pend-done',
      workflow_run_id: 'run-uuid-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      status: 'answered',
      envelope: { questions: [{ prompt: 'First' }] },
      answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
      provider_session_id: 'sess-1',
      created_at: '2026-09-06T00:00:00.000Z',
      resolved_at: '2026-09-06T00:01:00.000Z',
      resolved_by: 'user-1',
    },
    {
      id: 'pend-open',
      workflow_run_id: 'run-uuid-1',
      node_id: 'review',
      tool_use_id: 'toolu_2',
      kind: 'ask',
      status: 'pending',
      envelope: { questions: [{ prompt: 'Second' }] },
      answer: null,
      provider_session_id: 'sess-1',
      created_at: '2026-09-06T00:00:01.000Z',
      resolved_at: null,
      resolved_by: null,
    },
  ]);

  const { app } = makeApp();
  const response = await app.request('/api/workflows/runs/run-uuid-1');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    run: { status: string };
    pending_interactions: Array<{ status: string }>;
    nodeStates: Array<{ nodeId: string; status: string }>;
  };
  expect(body.run.status).toBe('paused');
  expect(body.pending_interactions.some(row => row.status === 'pending')).toBe(true);
  expect(body.nodeStates).toEqual([
    expect.objectContaining({ nodeId: 'review', status: 'awaiting' }),
  ]);
});

test('awaiting-input formula is false when a paused run has no pending rows', async () => {
  mockGetWorkflowRun.mockImplementationOnce(async () => ({
    ...MOCK_RUNNING_RUN,
    status: 'paused',
  }));
  mockListWorkflowEvents.mockImplementationOnce(async () => []);
  mockGetConversationById.mockImplementationOnce(async () => ({
    id: 'conv-uuid-1',
    platform_conversation_id: 'web-conv-abc',
  }));
  mockListPendingInteractions.mockImplementationOnce(async () => []);

  const { app } = makeApp();
  const response = await app.request('/api/workflows/runs/run-uuid-1');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    run: { status: string };
    pending_interactions: Array<{ status: string }>;
  };
  const awaitingInput =
    body.run.status === 'paused' &&
    body.pending_interactions.some(row => row.status === 'pending');
  expect(awaitingInput).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails or characterize**

Run: `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`
Expected: FAIL only if GET lists one row, rewrites `awaiting` on paused runs, or completes a node on `interaction_resolved`.
Current `projectApiWorkflowNodeStates` plus pending overlay should characterize green.

- [ ] **Step 3: Write minimal implementation**

If RED, keep GET passing `pendingInteractions` into `projectLatestEffectiveNodeStates`.
Do not add an `awaitingInput` response field.
Do not let `settleApiWorkflowNodeStatesForRunStatus` rewrite `awaiting` on a paused run.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`
Expected: PASS, including the existing single-pending awaiting test and the intermediate-answer no-dispatch test.

- [ ] **Step 5: Refactor**

Do not introduce a shared React helper.
Leave copy and warning tokens to Story 6.5.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/api.workflow-runs.test.ts packages/server/src/routes/api.ts
git commit -m "test(server): embed independent outstanding Asks without a second scheduler field"
```

---

## Task 6: Child-run Asks live on the child run id

**Files:**
- Modify: `packages/workflows/src/subrun.test.ts`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify production files only if RED stays red
- Test: `packages/workflows/src/subrun.test.ts` and `packages/server/src/routes/api.workflow-runs.test.ts`

**Interfaces:**
- Consumes: `createAskHumanTool({ workflowRunId })` on the executing run; GET/POST keyed by `runId`; `pauseParentOnChild` for parent pause
- Produces: pending rows with `workflow_run_id === child.id`; parent GET embed empty; parent POST for the child `tool_use_id` returns 404

- [ ] **Step 1: Write the failing tests**

In `packages/workflows/src/subrun.test.ts`, add:

```ts
it('persists a child Ask on the child run and pauses the parent with existing child-paused behavior', async () => {
  await writeWorkflow(
    'child-ask',
    `
name: child-ask
description: child that asks
nodes:
  - id: work
    prompt: "ask the starter"
`
  );
  await writeWorkflow(
    'parent-ask',
    `
name: parent-ask
description: parent blocked on child ask
nodes:
  - id: sub
    workflow: child-ask
`
  );

  const store = new InMemoryStore();
  const askQuestions = [
    {
      id: 'q1',
      prompt: 'Ship it?',
      selection: 'single' as const,
      options: ['yes', 'no'],
      allowOther: false,
    },
  ];
  const provider = {
    ...makeProvider(),
    sendQuery: mock(async function* (
      prompt: string,
      _cwd: string,
      _resume?: string,
      options?: { nativeTools?: Array<{ name: string; handler: Function }> }
    ) {
      if (String(prompt).includes('ask the starter')) {
        const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
        if (!ask) throw new Error('AskHuman was not injected on the child');
        await ask.handler(
          { questions: askQuestions },
          { toolUseId: 'toolu_child', sessionId: 'sess-child' }
        );
      }
      yield { type: 'assistant', content: 'ai-output' };
      yield { type: 'result', sessionId: 'sess', cost: 0.01, tokens: { input: 7, output: 3 } };
    }),
  };
  const deps = {
    ...makeDeps(store),
    getAgentProvider: mock(() => provider) as unknown as WorkflowDeps['getAgentProvider'],
  };

  const parent = await discover('parent-ask');
  const result = await executeWorkflow(
    deps,
    makePlatform(),
    'conv-plat',
    cwd,
    parent,
    'the-goal',
    'conv-db'
  );

  expect(result.success).toBe(true);
  const parentRun = [...store.runs.values()].find(run => run.workflow_name === 'parent-ask');
  const childRun = [...store.runs.values()].find(run => run.workflow_name === 'child-ask');
  expect(parentRun?.status).toBe('paused');
  expect(childRun?.status).toBe('paused');
  expect(childRun?.parent_run_id).toBe(parentRun?.id);
  expect(childRun?.metadata.approval).toBeUndefined();
  expect(
    (parentRun?.metadata.approval as { type?: string; childRunId?: string } | undefined)?.type
  ).toBe('child_workflow');
  expect(
    (parentRun?.metadata.approval as { childRunId?: string } | undefined)?.childRunId
  ).toBe(childRun?.id);

  const childPending = await store.listPendingInteractions(childRun!.id);
  const parentPending = await store.listPendingInteractions(parentRun!.id);
  expect(childPending).toHaveLength(1);
  expect(childPending[0]?.tool_use_id).toBe('toolu_child');
  expect(childPending[0]?.workflow_run_id).toBe(childRun!.id);
  expect(parentPending).toEqual([]);
  expect(
    store.events.some(
      event =>
        event.workflow_run_id === childRun!.id &&
        event.event_type === 'node_completed' &&
        event.step_name === 'work'
    )
  ).toBe(false);
  expect(
    store.events.some(
      event =>
        event.workflow_run_id === parentRun!.id &&
        event.event_type === 'node_completed' &&
        event.step_name === 'sub'
    )
  ).toBe(false);
});
```

In `packages/server/src/routes/api.workflow-runs.test.ts`, add:

```ts
test('GET parent does not embed a child Ask pending row', async () => {
  const childRow = {
    id: 'pend-child',
    workflow_run_id: 'child-run-1',
    node_id: 'work',
    tool_use_id: 'toolu_child',
    kind: 'ask' as const,
    status: 'pending' as const,
    envelope: { questions: [{ prompt: 'Child?' }] },
    answer: null,
    provider_session_id: 'sess-child',
    created_at: '2026-09-06T00:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };
  mockListPendingInteractions.mockImplementation(async (id: string) =>
    id === 'child-run-1' ? [childRow] : []
  );
  mockListWorkflowEvents.mockImplementation(async () => []);
  mockGetConversationById.mockImplementation(async () => ({
    id: 'conv-uuid-1',
    platform_conversation_id: 'web-conv-abc',
  }));
  mockGetWorkflowRun.mockImplementation(async (id: string) => ({
    ...MOCK_RUNNING_RUN,
    id,
    status: 'paused',
    parent_run_id: id === 'child-run-1' ? 'parent-run-1' : null,
  }));

  const { app } = makeApp();
  const parentResponse = await app.request('/api/workflows/runs/parent-run-1');
  const childResponse = await app.request('/api/workflows/runs/child-run-1');
  expect(parentResponse.status).toBe(200);
  expect(childResponse.status).toBe(200);
  const parentBody = (await parentResponse.json()) as {
    pending_interactions: Array<{ tool_use_id: string }>;
  };
  const childBody = (await childResponse.json()) as {
    pending_interactions: Array<{ tool_use_id: string; workflow_run_id: string }>;
  };
  expect(parentBody.pending_interactions).toEqual([]);
  expect(childBody.pending_interactions).toEqual([
    expect.objectContaining({ tool_use_id: 'toolu_child', workflow_run_id: 'child-run-1' }),
  ]);
});

test('POST answer on the parent run id for a child tool_use_id returns 404', async () => {
  mockGetWorkflowRun.mockResolvedValue(
    mockAskPausedRun({ id: 'parent-run-1', parent_conversation_id: 'parent-conv-uuid' })
  );
  mockResolvePendingInteraction.mockImplementation(async () => {
    const { PendingInteractionNotFoundError } = await import(
      '@archon/core/db/workflow-pending-interactions'
    );
    throw new PendingInteractionNotFoundError('parent-run-1', 'toolu_child');
  });

  const { app } = makeApp();
  const response = await app.request('/api/workflows/runs/parent-run-1/ask/toolu_child/answer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Archon-User': ASK_STARTER_USER_ID,
    },
    body: JSON.stringify(ASK_ANSWER_BODY),
  });
  expect(response.status).toBe(404);
});
```

If `PendingInteractionNotFoundError` is already imported or the existing 404 helper maps that class, reuse the existing 404 mock from the answer-route suite instead of a dynamic import.
Match the file's current 404 test exactly.

- [ ] **Step 2: Run tests to verify they fail or characterize**

Run: `cd packages/workflows && bun test src/subrun.test.ts`
Run: `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`
Expected: sub-run test FAIL if AskHuman is not injected on the child, if pending rows land on the parent, or if child Ask pause writes approval.
HTTP tests should characterize green because list and resolve are keyed by `runId`.

- [ ] **Step 3: Write minimal implementation**

If the child Ask is missing because `makeProvider().getCapabilities()` is used instead of the registry, do not change `nativeToolsForAskHuman`.
It already uses `getProviderCapabilities(provider)` for `'claude'`.
If insert uses the parent id, keep passing `workflowRun.id` from the executing child into `createAskHumanTool`.
Do not add a parent-side pending row.
Do not change `pauseParentOnChild` beyond existing child-paused behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/workflows && bun test src/subrun.test.ts`
Run: `cd packages/server && bun test src/routes/api.workflow-runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor**

Keep parent approval-slot copy as existing child-paused behavior.
Do not special-case Ask in `pauseParentOnChild` in this story.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/subrun.test.ts packages/server/src/routes/api.workflow-runs.test.ts
git commit -m "test(workflows): persist child Asks on the child run id"
```

---

## Task 7: Validation, sprint status, and issue close gate

**Files:**
- Modify: `_bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml`

**Interfaces:**
- Consumes: every focused test from Tasks 1–6
- Produces: `6-4-keep-several-asks-outstanding-without-a-second-scheduler: done`

- [ ] **Step 1: Run focused tests**

```bash
cd packages/workflows && bun test src/retry-state.test.ts
cd packages/workflows && bun test src/dag-executor.test.ts
cd packages/workflows && bun test src/subrun.test.ts
cd packages/core && bun test src/db/workflow-pending-interactions.test.ts
cd packages/core && bun test src/db/workflows.test.ts
cd packages/core && bun test src/operations/workflow-operations.test.ts
cd packages/server && bun test src/routes/api.workflow-runs.test.ts
```

Expected: PASS.
`workflows.test.ts` must still include `Ask pause succeeds when the run is already paused`.

- [ ] **Step 2: Run package and repo gates**

```bash
bun run type-check
bun run lint
bun run validate
```

Run those from the repository root.
Do not run unscoped `bun test` from the repository root.
Expected: exit 0.

- [ ] **Step 3: Update sprint status**

The sprint file currently has merge-conflict markers on `last_updated`.
Resolve by writing a single new timestamp, not `@ours` stacked with `@theirs`.
Set:

```yaml
last_updated: "<implementation local timestamp>"
development_status:
  6-4-keep-several-asks-outstanding-without-a-second-scheduler: done
```

Leave `6-5`, `6-6`, and `6-7` as `backlog`.
Do not mark `epic-6` done.

- [ ] **Step 4: Commit sprint status only after gates pass**

```bash
git add _bmad-output/implementation-artifacts/workflow-run-view-hitl/sprint-status.yaml
git commit -m "chore: mark AskHuman several-asks story 6.4 done"
```

If any gate fails, leave the sprint key unchanged and do not close issue 89.

---

## Testing Strategy

### Tests to Write

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `packages/workflows/src/retry-state.test.ts` | Remaining pending on one node; independent sibling nodes; permission pending overlay | FR5 node awaiting |
| `packages/core/src/db/workflow-pending-interactions.test.ts` | Remaining pending on another node; last pending in the run resumes | FR5 last-clears |
| `packages/workflows/src/dag-executor.test.ts` | Two in-flight Asks; dual Ask on one node; sibling streaming; no next layer | FR5 concurrency, NFR6 |
| `packages/workflows/src/subrun.test.ts` | Ask pause omits approval; child pending on child run | FR10, AD-1 |
| `packages/server/src/routes/api.workflow-runs.test.ts` | Independent GET rows; awaiting-input formula; parent/child isolation; parent 404 | FR5, FR10, AD-8 |

### Edge Cases Checklist

- [ ] Second Ask persist succeeds while the run is already paused.
- [ ] Second Ask pause does not pass `ApprovalContext`.
- [ ] Asking nodes never receive `node_completed`.
- [ ] A non-asking sibling may write `node_completed`.
- [ ] Downstream layers do not start.
- [ ] Answering one of two same-node Asks leaves the node `awaiting`.
- [ ] Answering one of two sibling-node Asks leaves the run `paused`.
- [ ] Answering the last pending row in the run resumes once.
- [ ] Intermediate HTTP answers do not auto-dispatch.
- [ ] Child pending rows are absent from GET parent.
- [ ] Parent answer for a child `tool_use_id` is 404.
- [ ] Fan-out paused children remain out of scope.
- [ ] No timeout or auto-default exists.

## Validation Commands

From the repository root, after the focused package commands in Task 7:

```bash
bun run type-check
bun run lint
bun run validate
```

Do not run `bun test` from the repository root.

## Acceptance Criteria

- [ ] Two in-flight agent nodes can each persist an Ask after the run is already paused, and neither asking node is failed for that reason.
- [ ] Each asking node tears down only its own `sendQuery`.
- [ ] In-flight siblings may finish streaming via `shouldContinueStreamingForStatus('paused')`.
- [ ] The next DAG layer does not start.
- [ ] `node_completed` is not written for an asking node.
- [ ] Two pending Asks on the same node keep that node `awaiting` until every pending row for `(run_id, node_id)` is resolved.
- [ ] Run chrome awaiting input equals `paused` AND `count(pending) > 0` on that run, and it clears only when the last pending row in the run is resolved.
- [ ] Child Ask pending rows live on the child `run_id`.
- [ ] The parent follows existing child-paused behavior.
- [ ] The operator answers the child, not the parent.
- [ ] Per-node independent scheduling is not implemented.
- [ ] No Ask cards, Permission POST, YAML field, CLI answer path, or new run status is added.
- [ ] Focused tests plus `bun run validate` pass.
- [ ] Sprint key `6-4-keep-several-asks-outstanding-without-a-second-scheduler` is `done` only after those gates pass.

## Open Questions

1. Parent blocked-on-child copy still tells the operator to `/workflow approve <childRunId>`.
Safe provisional default: keep existing `pauseParentOnChild` copy and approval slot because Story 6.4 requires existing child-paused behavior, and Story 6.5 owns Ask chrome.

2. A fan-out child that pauses at Ask is still cancelled by existing `#2180` autonomous-child policy.
Safe provisional default: leave fan-out unchanged; only a single `workflow:` child is in scope.

3. Should GET grow an `awaitingInput` boolean for Story 6.5?
Safe provisional default: no.
Surfaces compute `status === 'paused' && pending_interactions.some(row => row.status === 'pending')` from the existing embed so the OpenAPI contract stays stable.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A production-like pause mock hides a second-Ask failure | Med | High | Task 4 uses an idempotent no-approval pause mock that throws if approval is passed while paused |
| `InMemoryStore` keeps stamping approval on Ask pause | High | Med | Task 3 fails until omitted `approvalContext` leaves metadata untouched |
| Remaining-pending count is accidentally node-scoped | Low | High | Task 2 uses two node ids on one run |
| Child Ask rows leak onto the parent GET embed | Med | High | Task 6 asserts parent list empty and parent POST 404 |
| A sibling finishing is mistaken for per-node scheduling | Med | High | Task 4 allows `node_completed` only for the non-asking sibling and forbids the next layer |
| Sprint file merge conflict is stacked | High | Low | Task 7 writes one new `last_updated` timestamp |

## Completion Gate

Story 6.4 is complete only when every acceptance criterion is satisfied, every focused test passes in its isolated package process, `bun run validate` exits zero, and the sprint key is `done`.

If any gate fails, leave the sprint key unchanged and do not close issue 89.
