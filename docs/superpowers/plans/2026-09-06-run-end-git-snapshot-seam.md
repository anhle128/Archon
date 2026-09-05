# Run-End Git Snapshot Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the CAP-8 run-end git-snapshot seam on `WorkflowDeps` and invoke it fail-open after a workflow run reaches a terminal status, without writing snapshot bytes in v1.

**Architecture:** `@archon/workflows` owns the injection type and the run-end call site only.
The engine never stats the checkout, never talks to git, and never writes under `output_root`.
`@archon/core` injects a v1 no-op through `createWorkflowDeps()` that no-ops when the checkout is gone and writes nothing when it still exists.
A later writer can fill that same hook with an idempotent temp+rename snapshot under `output_root` without a second injection point.

**Tech Stack:** Bun, strict TypeScript, Bun Test, Pino via `createLogger` from `@archon/paths`.

**Spec:** `_bmad-output/planning-artifacts/epics-source-control/epics.md` Story 3.1.
Also bind `FR9`, `NFR3`, `NFR4`, `NFR5`, SPEC CAP-8, brownfield Durable capture, and architecture spine AD-8.

**Issue:** [#80](https://github.com/anhle128/Archon/issues/80)

## Global Constraints

- Story 3.1 is a seam only: v1 must not persist name-status, diffs, `A`/`D` content, or `git log`.
- The locked trigger is run-end, not per-commit and not pause.
- `@archon/workflows` must not import `@archon/isolation` and must not add git I/O for this feature.
- The hook is optional on `WorkflowDeps` and is injected like other optional deps.
- A hook throw or write failure must be logged as `domain.action_state` and must not fail the run.
- Never log paths, remotes, file contents, or secrets.
- No new tables, process, env var, deployable, feature flag, or git-read HTTP route.
- The snapshot wire format stays a build-time decision and is not implemented here.
- v1 git-read APIs do not exist yet; do not add them.
- After this story, neither checkout nor snapshot exists for a reaped run, so future git routes still fall through to CAP-6.
- A future writer must be idempotent and must use temp+rename under the run's `output_root`.
- Do not use `any`.
- Do not run `bun test` from the repository root.
- Run package tests from that package directory.

---

## File Map

- Modify `packages/workflows/src/deps.ts` to add `GitSnapshotContext` and optional `WorkflowDeps.onRunEndGitSnapshot`.
- Modify `packages/workflows/src/executor.ts` to call the hook fail-open from `executeWorkflow`'s keep-awake `finally` after the existing running-status backstop.
- Modify `packages/workflows/src/executor.test.ts` to cover completed, failed, cancelled, paused, missing hook, thrown hook, backstop-then-failed, and no-path-in-logs.
- Create `packages/core/src/workflows/git-snapshot.ts` as the v1 no-op writer.
- Create `packages/core/src/workflows/git-snapshot.test.ts` for checkout-gone, no-write, idempotence, and fail-open logging.
- Modify `packages/core/src/workflows/store-adapter.ts` to inject the no-op from `createWorkflowDeps()`.
- Modify `packages/core/src/workflows/store-adapter.test.ts` to assert the hook is wired.
- Modify `packages/core/package.json` so `git-snapshot.test.ts` runs in its own `bun test` invocation.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after the code tasks pass.

Do not modify `packages/server/src/routes/api.ts`, `migrations/000_combined.sql`, SQLite schema, web UI, or `@archon/git`.

## Patterns to Mirror

**Optional `WorkflowDeps` injection** lives in `packages/workflows/src/deps.ts` after `usageRecorder`.
`getUserAiPrefs` is optional on the engine interface and always supplied by `createWorkflowDeps()`.

**Fail-open optional work** lives in `packages/workflows/src/executor.ts` around `resolveBotGitHubToken`: catch, log `workflow.*_failed`, continue.

**Run-end placement** is the keep-awake `try`/`finally` in `executeWorkflow` (`packages/workflows/src/executor.ts`).
`keepAwake.release()` is the first `finally` statement.
The zombie-run backstop then flips leftover `running` rows to failed.
The git-snapshot hook runs after that backstop so a backstop failure still has a terminal row.

**Core sibling module** is `packages/core/src/workflows/usage-recorder.ts`: `createLogger`, never throw into execution, wired only through `createWorkflowDeps()`.

**Executor tests** mock `@archon/paths`, `@archon/git`, `./dag-executor`, and use `makeStore()` / `makeDeps()` in `packages/workflows/src/executor.test.ts`.

## Authoritative Contracts

### Hook name and shape

```ts
export type GitSnapshotTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface GitSnapshotContext {
  runId: string;
  workingPath: string | null;
  outputRoot: string | null;
  status: GitSnapshotTerminalStatus;
}

export interface WorkflowDeps {
  // existing fields unchanged
  onRunEndGitSnapshot?: (ctx: GitSnapshotContext) => Promise<void>;
}
```

`workingPath` maps from `WorkflowRun.working_path`.
`outputRoot` maps from `WorkflowRun.output_root`.
Never pass `cwd` from `executeWorkflow` as a substitute for `working_path`.

### When the engine invokes the hook

Call `onRunEndGitSnapshot` only from `executeWorkflow`'s keep-awake `finally`, after the existing backstop, when all of these are true:

1. `deps.onRunEndGitSnapshot` is a function.
2. `workflowRun` exists.
3. `deps.store.getWorkflowRun(runId)` returns a row.
4. That row's `status` is `completed`, `failed`, or `cancelled`.

Do not invoke when status is `paused`, `running`, or `pending`.
Do not invoke on early returns that happen before `keepAwake.acquire()` (container-resume guard, concurrent-run guard, overlay fail-closed, artifacts-dir failure).
Those paths never entered the DAG execution window, so they are not CAP-8 run-end.

Child `workflow:` runs already call `executeWorkflow` themselves, so each child gets its own run-end invoke.
Do not invent parent-to-child snapshot inheritance.

Resume and `retry-node` re-enter `executeWorkflow`.
The v1 no-op is naturally idempotent.
JSDoc on the core writer must require a future writer to stay idempotent.

### Fail-open and logging

The engine helper must catch every error from `getWorkflowRun` and from the hook.
It must not rethrow.
It must not call `failWorkflowRun`.
It must not change the `WorkflowExecutionResult` already produced by the `try`/`catch`.

Log events (no paths):

- Engine start: `workflow.git_snapshot_started` with `{ workflowRunId, status }`
- Engine success: `workflow.git_snapshot_completed` with `{ workflowRunId, status }`
- Engine failure: `workflow.git_snapshot_failed` with `{ err, workflowRunId }` and optional `status`
- Core skip: `git_snapshot.capture_skipped` with `{ workflowRunId, reason }` where `reason` is `'missing_working_path'` or `'checkout_gone'`
- Core v1 success: `git_snapshot.capture_completed` with `{ workflowRunId, status, reason: 'noop' }`

### v1 no-op writer

`noopRunEndGitSnapshot(ctx)` in `@archon/core`:

1. If `ctx.workingPath` is null or empty, log `git_snapshot.capture_skipped` with `reason: 'missing_working_path'` and return.
2. If `existsSync(ctx.workingPath)` is false or throws, log `git_snapshot.capture_skipped` with `reason: 'checkout_gone'` and return.
3. Otherwise log `git_snapshot.capture_completed` with `reason: 'noop'` and return.
4. Never create files or directories under `ctx.outputRoot`.
5. Never call git.
6. Never throw.

A later writer must replace step 3 with an idempotent temp+rename write under `ctx.outputRoot` and must still no-op when `outputRoot` is null or the checkout is gone.
Provisional future directory, JSDoc only, not created in v1: `<outputRoot>/git-snapshot/`.

---

### Task 1: Add the engine hook and invoke it fail-open at run-end

**Files:**

- Modify: `packages/workflows/src/deps.ts`
- Modify: `packages/workflows/src/executor.ts`
- Test: `packages/workflows/src/executor.test.ts`

**Interfaces:**

- Consumes: `WorkflowRun.working_path`, `WorkflowRun.output_root`, `WorkflowRun.status`, existing `executeWorkflow` finally backstop.
- Produces: `GitSnapshotTerminalStatus`, `GitSnapshotContext`, `WorkflowDeps.onRunEndGitSnapshot`, and file-local `invokeRunEndGitSnapshot(deps, runId)`.

- [ ] **Step 1: Write the failing executor tests**

Add the types to `packages/workflows/src/deps.ts` first so the tests typecheck.
Do not call the hook yet.

Append this block after `getUserAiPrefs` in `WorkflowDeps`:

```ts
/**
 * Optional CAP-8 run-end git-snapshot hook.
 * The executor calls this after DAG execution reaches a terminal status.
 * Implementations must not throw; the executor also fail-opens if they do.
 * v1 writes nothing. A later writer must be idempotent and use temp+rename
 * under `outputRoot`. Never log paths, remotes, file contents, or secrets.
 */
onRunEndGitSnapshot?: (ctx: GitSnapshotContext) => Promise<void>;
```

Place these exported types above `WorkflowDeps`:

```ts
export type GitSnapshotTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface GitSnapshotContext {
  runId: string;
  workingPath: string | null;
  outputRoot: string | null;
  status: GitSnapshotTerminalStatus;
}
```

Then append this describe to `packages/workflows/src/executor.test.ts` immediately after the existing `describe('finally backstop')` block (after the current closing of that describe, before `describe('telemetry wiring')`).
Import `GitSnapshotContext` from `./deps` in the existing deps import.

```ts
describe('run-end git snapshot seam', () => {
  beforeEach(() => {
    mockLogFn.mockClear();
    mockExecuteDagWorkflow.mockClear();
    mockExecuteDagWorkflow.mockImplementation(async (): Promise<string | undefined> => undefined);
  });

  function snapshotRun(status: 'completed' | 'failed' | 'cancelled' | 'paused') {
    return makeRun({
      id: 'run-123',
      status,
      working_path: '/tmp/wt-secret',
      output_root: '/tmp/out-secret',
    });
  }

  function depsWithHook(
    hook: (ctx: GitSnapshotContext) => Promise<void>,
    storeOverrides: Parameters<typeof makeStore>[0] = {}
  ) {
    const store = makeStore({
      getWorkflowRun: mock(async () => snapshotRun('completed')),
      getWorkflowRunStatus: mock(async () => 'completed' as const),
      ...storeOverrides,
    });
    return { store, deps: { ...makeDeps(store), onRunEndGitSnapshot: hook } };
  }

  it('invokes the hook once with run row fields after a completed run', async () => {
    const hook = mock(async () => {});
    const { deps } = depsWithHook(hook);
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.success).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]).toEqual({
      runId: 'run-123',
      workingPath: '/tmp/wt-secret',
      outputRoot: '/tmp/out-secret',
      status: 'completed',
    });
  });

  it('invokes the hook when the run failed', async () => {
    mockExecuteDagWorkflow.mockRejectedValueOnce(new Error('dag boom'));
    const hook = mock(async () => {});
    const { deps } = depsWithHook(hook, {
      getWorkflowRun: mock(async () => snapshotRun('failed')),
      getWorkflowRunStatus: mock(async () => 'failed' as const),
    });
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.success).toBe(false);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]?.status).toBe('failed');
  });

  it('invokes the hook when the run was cancelled', async () => {
    const hook = mock(async () => {});
    const { deps } = depsWithHook(hook, {
      getWorkflowRun: mock(async () => snapshotRun('cancelled')),
      getWorkflowRunStatus: mock(async () => 'cancelled' as const),
    });
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.success).toBe(false);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]?.status).toBe('cancelled');
  });

  it('does not invoke the hook when the run paused', async () => {
    const hook = mock(async () => {});
    const { deps } = depsWithHook(hook, {
      getWorkflowRun: mock(async () => snapshotRun('paused')),
      getWorkflowRunStatus: mock(async () => 'paused' as const),
    });
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.paused).toBe(true);
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not invoke the hook when it is absent', async () => {
    const result = await executeWorkflow(
      makeDeps(),
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.success).toBe(true);
  });

  it('still succeeds when the hook throws', async () => {
    const hook = mock(async () => {
      throw new Error('snapshot exploded');
    });
    const { deps } = depsWithHook(hook);
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    expect(result.success).toBe(true);
    expect(result.workflowRunId).toBe('run-123');
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('invokes the hook as failed after the running-status backstop', async () => {
    let status: 'running' | 'failed' = 'running';
    const hook = mock(async () => {});
    const store = makeStore({
      getWorkflowRunStatus: mock(async () => status),
      failWorkflowRun: mock(async () => {
        status = 'failed';
      }),
      getWorkflowRun: mock(async () => snapshotRun(status)),
    });
    const deps = { ...makeDeps(store), onRunEndGitSnapshot: hook };
    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test',
      'db-conv-1'
    );
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]?.status).toBe('failed');
  });

  it('does not log workingPath or outputRoot', async () => {
    const hook = mock(async () => {});
    const { deps } = depsWithHook(hook);
    await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1'
    );
    const serialized = JSON.stringify(mockLogFn.mock.calls);
    expect(serialized).not.toContain('/tmp/wt-secret');
    expect(serialized).not.toContain('/tmp/out-secret');
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```bash
cd packages/workflows && bun test src/executor.test.ts
```

Expected: FAIL on `invokes the hook once with run row fields after a completed run` because `onRunEndGitSnapshot` is never called.
The paused, absent-hook, and log tests may already pass.

- [ ] **Step 3: Implement the run-end invoke**

In `packages/workflows/src/executor.ts`, add this helper immediately above `export async function executeWorkflow`.
Import `GitSnapshotContext` from `./deps` by extending the existing `WorkflowDeps` import.

```ts
function isGitSnapshotTerminalStatus(
  status: WorkflowRun['status']
): status is GitSnapshotContext['status'] {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * CAP-8 run-end seam. Fail-open: never throw, never fail the run, never log paths.
 * Invoked only after the keep-awake finally backstop so a leftover running row
 * is marked failed before snapshot.
 */
async function invokeRunEndGitSnapshot(deps: WorkflowDeps, runId: string): Promise<void> {
  if (!deps.onRunEndGitSnapshot) {
    return;
  }
  let run: WorkflowRun | null;
  try {
    run = await deps.store.getWorkflowRun(runId);
  } catch (err) {
    getLog().error({ err: err as Error, workflowRunId: runId }, 'workflow.git_snapshot_failed');
    return;
  }
  if (!run || !isGitSnapshotTerminalStatus(run.status)) {
    return;
  }
  const status = run.status;
  try {
    getLog().info({ workflowRunId: runId, status }, 'workflow.git_snapshot_started');
    await deps.onRunEndGitSnapshot({
      runId,
      workingPath: run.working_path ?? null,
      outputRoot: run.output_root ?? null,
      status,
    });
    getLog().info({ workflowRunId: runId, status }, 'workflow.git_snapshot_completed');
  } catch (err) {
    getLog().error({ err: err as Error, workflowRunId: runId, status }, 'workflow.git_snapshot_failed');
  }
}
```

Then replace the keep-awake `finally` body so the hook runs after the backstop, still inside `if (workflowRun)`:

```ts
  } finally {
    keepAwake.release();
    if (workflowRun) {
      const runId = workflowRun.id;
      const backstopStatus = await deps.store.getWorkflowRunStatus(runId).catch(() => null);
      if (backstopStatus === 'running') {
        getLog().warn({ workflowRunId: runId }, 'executor.backstop_triggered');
        await deps.store
          .failWorkflowRun(runId, 'Workflow exited without finalizing — see logs')
          .catch((err: unknown) => {
            getLog().error({ err, workflowRunId: runId }, 'executor.backstop_fail_failed');
          });
      }
      await invokeRunEndGitSnapshot(deps, runId);
    }
  }
```

Keep the existing comments above `keepAwake.release()` and the backstop.
Do not `stat` `working_path` in the engine.
Do not import `existsSync` for this feature even though `executor.ts` already imports it for other work.

Gotcha: `makeStore().getWorkflowRun` defaults to `status: 'completed'`.
Failed/cancelled/paused tests must override both `getWorkflowRun` and `getWorkflowRunStatus` so the backstop and the hook see the same status.

Gotcha: do not put this call in `catch` only, or failed runs that return from `catch` would snapshot while completed runs that return from `try` would not.
`finally` covers both.

- [ ] **Step 4: Run the executor tests and confirm they pass**

Run:

```bash
cd packages/workflows && bun test src/executor.test.ts
```

Expected: PASS, including `finally backstop` and `run-end git snapshot seam`.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/deps.ts packages/workflows/src/executor.ts packages/workflows/src/executor.test.ts
git commit -m "$(cat <<'EOF'
feat(workflows): add fail-open run-end git snapshot seam

CAP-8 v1 calls an optional WorkflowDeps hook after a run reaches a
terminal status. The engine does not write snapshot bytes.
EOF
)"
```

---

### Task 2: Add the v1 no-op git-snapshot writer

**Files:**

- Create: `packages/core/src/workflows/git-snapshot.ts`
- Create: `packages/core/src/workflows/git-snapshot.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

- Consumes: `GitSnapshotContext` from `@archon/workflows/deps`.
- Produces: `noopRunEndGitSnapshot(ctx: GitSnapshotContext): Promise<void>`.

- [ ] **Step 1: Write the failing no-op tests**

Create `packages/core/src/workflows/git-snapshot.test.ts`.
This file mocks `@archon/paths`, so it must run in its own `bun test` invocation (same isolation rule as `usage-recorder.test.ts`).

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockLogger } from '../test/mocks/logger';
import type { GitSnapshotContext } from '@archon/workflows/deps';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { noopRunEndGitSnapshot } from './git-snapshot';

function ctx(overrides: Partial<GitSnapshotContext> = {}): GitSnapshotContext {
  return {
    runId: 'run-1',
    workingPath: '/tmp/missing-checkout',
    outputRoot: '/tmp/missing-output-root',
    status: 'completed',
    ...overrides,
  };
}

describe('noopRunEndGitSnapshot', () => {
  let outputRoot: string;

  beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    outputRoot = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-out-'));
  });

  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
  });

  test('skips when workingPath is null', async () => {
    await noopRunEndGitSnapshot(ctx({ workingPath: null, outputRoot }));
    expect(readdirSync(outputRoot)).toEqual([]);
    expect(mockLogger.info.mock.calls.some(call => call[1] === 'git_snapshot.capture_skipped')).toBe(
      true
    );
  });

  test('skips when the checkout directory is gone', async () => {
    await noopRunEndGitSnapshot(
      ctx({ workingPath: join(outputRoot, 'no-such-checkout'), outputRoot })
    );
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = mockLogger.info.mock.calls.find(call => call[1] === 'git_snapshot.capture_skipped');
    expect(skip?.[0]).toMatchObject({ workflowRunId: 'run-1', reason: 'checkout_gone' });
  });

  test('writes no snapshot files when the checkout still exists', async () => {
    const workingPath = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-wt-'));
    try {
      writeFileSync(join(workingPath, 'README.md'), 'hello');
      await noopRunEndGitSnapshot(ctx({ workingPath, outputRoot }));
      await noopRunEndGitSnapshot(ctx({ workingPath, outputRoot, status: 'failed' }));
      expect(readdirSync(outputRoot)).toEqual([]);
      expect(readdirSync(workingPath)).toEqual(['README.md']);
      const completed = mockLogger.info.mock.calls.filter(
        call => call[1] === 'git_snapshot.capture_completed'
      );
      expect(completed).toHaveLength(2);
      expect(completed[0]?.[0]).toMatchObject({
        workflowRunId: 'run-1',
        status: 'completed',
        reason: 'noop',
      });
    } finally {
      rmSync(workingPath, { recursive: true, force: true });
    }
  });

  test('does not log workingPath or outputRoot', async () => {
    const workingPath = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-wt-'));
    try {
      await noopRunEndGitSnapshot(ctx({ workingPath, outputRoot }));
      const serialized = JSON.stringify([
        mockLogger.info.mock.calls,
        mockLogger.error.mock.calls,
        mockLogger.warn.mock.calls,
      ]);
      expect(serialized).not.toContain(workingPath);
      expect(serialized).not.toContain(outputRoot);
    } finally {
      rmSync(workingPath, { recursive: true, force: true });
    }
  });
});
```

Add `&& bun test src/workflows/git-snapshot.test.ts` to `packages/core/package.json` `scripts.test` immediately after `bun test src/workflows/usage-recorder.test.ts`.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```bash
cd packages/core && bun test src/workflows/git-snapshot.test.ts
```

Expected: FAIL with a module-not-found error for `./git-snapshot`.

- [ ] **Step 3: Write the no-op implementation**

Create `packages/core/src/workflows/git-snapshot.ts`:

```ts
/**
 * CAP-8 v1 git-snapshot writer.
 *
 * v1 writes nothing. The function exists so run-end has one injection point.
 * A later writer MUST:
 * - no-op when `workingPath` is null or the checkout is already gone
 * - no-op when `outputRoot` is null
 * - write only under `outputRoot` via a temp file plus atomic rename
 * - keep the write idempotent across resume and retry-node
 * - never throw into workflow execution
 * - never log paths, remotes, file contents, or secrets
 * - not invent a second WorkflowDeps hook
 *
 * Provisional future directory (not created in v1): `<outputRoot>/git-snapshot/`.
 */
import { existsSync } from 'node:fs';
import { createLogger } from '@archon/paths';
import type { GitSnapshotContext } from '@archon/workflows/deps';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.git-snapshot');
  return cachedLog;
}

function checkoutExists(workingPath: string): boolean {
  try {
    return existsSync(workingPath);
  } catch {
    return false;
  }
}

export async function noopRunEndGitSnapshot(ctx: GitSnapshotContext): Promise<void> {
  if (!ctx.workingPath) {
    getLog().info(
      { workflowRunId: ctx.runId, reason: 'missing_working_path' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  if (!checkoutExists(ctx.workingPath)) {
    getLog().info(
      { workflowRunId: ctx.runId, reason: 'checkout_gone' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  getLog().info(
    { workflowRunId: ctx.runId, status: ctx.status, reason: 'noop' },
    'git_snapshot.capture_completed'
  );
}
```

- [ ] **Step 4: Run the no-op tests and confirm they pass**

Run:

```bash
cd packages/core && bun test src/workflows/git-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workflows/git-snapshot.ts packages/core/src/workflows/git-snapshot.test.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): add v1 no-op CAP-8 git snapshot writer

The run-end hook can be injected without persisting name-status, diffs,
or git log. Checkout-gone and missing working_path are logged skips.
EOF
)"
```

---

### Task 3: Inject the no-op through createWorkflowDeps

**Files:**

- Modify: `packages/core/src/workflows/store-adapter.ts`
- Test: `packages/core/src/workflows/store-adapter.test.ts`

**Interfaces:**

- Consumes: `noopRunEndGitSnapshot`.
- Produces: `createWorkflowDeps().onRunEndGitSnapshot === noopRunEndGitSnapshot`.

- [ ] **Step 1: Write the failing wiring test**

In `packages/core/src/workflows/store-adapter.test.ts`, inside `describe('createWorkflowDeps')` after the existing `usageRecorder` assertion test, add:

```ts
  test('wires onRunEndGitSnapshot to the v1 no-op writer', async () => {
    const { noopRunEndGitSnapshot } = await import('./git-snapshot');
    const deps = createWorkflowDeps();
    expect(deps.onRunEndGitSnapshot).toBe(noopRunEndGitSnapshot);
  });
```

- [ ] **Step 2: Run the wiring test and confirm it fails**

Run:

```bash
cd packages/core && bun test src/workflows/store-adapter.test.ts
```

Expected: FAIL because `onRunEndGitSnapshot` is undefined.

- [ ] **Step 3: Wire the hook**

In `packages/core/src/workflows/store-adapter.ts`:

```ts
import { noopRunEndGitSnapshot } from './git-snapshot';
```

Inside `createWorkflowDeps()`'s returned object, after `getUserAiPrefs`, add:

```ts
    onRunEndGitSnapshot: noopRunEndGitSnapshot,
```

Do not wrap the no-op in another try/catch here.
The engine helper already fail-opens, and the no-op already does not throw.

- [ ] **Step 4: Re-run the wiring test and confirm it passes**

Run:

```bash
cd packages/core && bun test src/workflows/store-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(core): inject run-end git snapshot no-op into WorkflowDeps

createWorkflowDeps now supplies the CAP-8 seam used by executeWorkflow.
EOF
)"
```

---

### Task 4: Record story completion and run validation

**Files:**

- Modify: `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`

**Interfaces:**

- Consumes: passing Task 1–3 tests.
- Produces: sprint-status `3-1-add-the-run-end-git-snapshot-seam: done` and `epic-3: in-progress`.

- [ ] **Step 1: Confirm no git-read API or snapshot write landed**

Run:

```bash
cd packages/server && bun test src/routes 2>/dev/null | head -1
```

Do not add routes.
Confirm `packages/server/src/routes` still has no `/git/` path.
Confirm `noopRunEndGitSnapshot` still creates no files.

- [ ] **Step 2: Run focused package tests**

```bash
cd packages/workflows && bun test src/executor.test.ts
cd packages/core && bun test src/workflows/git-snapshot.test.ts
cd packages/core && bun test src/workflows/store-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 3: Type-check the two packages**

```bash
cd packages/workflows && bun run type-check
cd packages/core && bun run type-check
```

Expected: PASS.

- [ ] **Step 4: Update sprint status**

In `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml`, change:

```yaml
  epic-3: in-progress
  3-1-add-the-run-end-git-snapshot-seam: done
```

Keep `epic-3-retrospective: optional`.
Do not mark `epic-3` done until the retrospective decision is made outside this story.

- [ ] **Step 5: Run repository validate**

```bash
bun run validate
```

Expected: PASS.

- [ ] **Step 6: Commit sprint-status if validate passed**

```bash
git add _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml
git commit -m "$(cat <<'EOF'
chore(source-control): mark story 3.1 git-snapshot seam done
EOF
)"
```

---

## Testing Strategy

### Tests to write

| Test file | Cases | Validates |
| --- | --- | --- |
| `packages/workflows/src/executor.test.ts` | completed / failed / cancelled invoke; paused skip; absent hook; thrown hook; backstop-then-failed; no path logs | FR9 seam, NFR3, NFR5, run-end trigger |
| `packages/core/src/workflows/git-snapshot.test.ts` | null workingPath; checkout gone; existing checkout writes nothing twice; no path logs | v1 no-op write, checkout-gone, idempotence |
| `packages/core/src/workflows/store-adapter.test.ts` | `createWorkflowDeps()` wires the no-op | injection like other optional deps |

### Edge Cases Checklist

- [ ] Hook missing: run still succeeds.
- [ ] Hook throws: run still succeeds and is not marked failed by the hook.
- [ ] Status `paused`: hook is not called.
- [ ] Status leftover `running` at finally: backstop fails the run, then hook is called with `failed`.
- [ ] `working_path` null: core no-op skips and writes nothing.
- [ ] Checkout directory already gone: core no-op skips and writes nothing.
- [ ] Hook called twice (retry / second terminal pass): still no files under `output_root`.
- [ ] Child `workflow:` run: covered by each child `executeWorkflow` finally; no extra parent wiring.
- [ ] Logs never include `workingPath` or `outputRoot`.
- [ ] No `/git/` routes and no new tables.

---

## Validation Commands

1. `cd packages/workflows && bun test src/executor.test.ts`
2. `cd packages/core && bun test src/workflows/git-snapshot.test.ts`
3. `cd packages/core && bun test src/workflows/store-adapter.test.ts`
4. `cd packages/workflows && bun run type-check`
5. `cd packages/core && bun run type-check`
6. `bun run validate`

## Acceptance Criteria

- [ ] `WorkflowDeps` has optional `onRunEndGitSnapshot(ctx: GitSnapshotContext)`.
- [ ] `executeWorkflow` calls it at run-end from the keep-awake `finally` after the running-status backstop.
- [ ] v1 implementation writes no name-status, diffs, `A`/`D` content, or `git log`.
- [ ] Missing or vanished checkout no-ops.
- [ ] Hook/write failure is logged as `workflow.git_snapshot_failed` or `git_snapshot.capture_skipped` and does not fail the run.
- [ ] Paused runs do not invoke the hook.
- [ ] No new tables, process, env var, deployable, or git-read route.
- [ ] Snapshot wire format remains unimplemented.
- [ ] Future writer contract (idempotent temp+rename under `output_root`) is documented on the core module.
- [ ] Focused tests above pass.
- [ ] `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` entry `3-1-add-the-run-end-git-snapshot-seam` is `done`.

## Open Questions

Provisional defaults are locked for this plan.
Do not stop to ask; implement these defaults.

1. **Hook name.** Story says the name is owned by implementation.
   Default: `onRunEndGitSnapshot`.
   Rejected: `finalize`, because container write-back and loop completion already use that word.

2. **Paused runs.** CAP-8 is capture-before-teardown.
   Default: do not invoke on `paused`.
   The checkout is still the live source while the run can resume.

3. **Early returns before DAG start.** Container-resume guard, concurrent-run guard, overlay fail-closed, and artifacts-dir failure return before `keepAwake.acquire()`.
   Default: do not invoke there.
   Run-end means the DAG execution window ended.

4. **Future snapshot directory.** Wire format is a later build-time decision.
   Default JSDoc path, not created: `<outputRoot>/git-snapshot/`.

5. **Checkout existence check.** Architecture forbids git I/O in `@archon/workflows` for this feature.
   Default: `existsSync(workingPath)` only inside the core no-op.
   The engine passes the run row and does not stat.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mock `getWorkflowRun` stays `completed` on the throw path | High | Medium | Failed/cancelled tests override both status readers |
| Putting the hook in `catch` only misses successful runs | Medium | High | Call from `finally` after backstop |
| Engine stats the checkout and logs a path | Medium | High | No `existsSync` in the executor helper; log-payload tests |
| Someone implements the snapshot write in this story | Medium | High | Task 2 asserts `outputRoot` stays empty |
| `mock.module('@archon/paths')` pollutes other core tests | Medium | High | `git-snapshot.test.ts` gets its own `bun test` invocation |
| Backstop and hook race on status | Low | Medium | Hook re-reads the run row after `failWorkflowRun` |

## NOT Building

- Snapshot manifest JSON, name-status, diffs, `A`/`D` blobs, or `git log` capture.
- Git-read HTTP routes, CAP-6 envelopes, or Source Control UI.
- Per-commit checkpoints.
- Container overlay reads.
- New database columns or tables.
- Parent-run inheritance of a child snapshot.
- Invoking the hook from CLI cleanup or isolation destroy.
- Metrics beyond Pino logs.
