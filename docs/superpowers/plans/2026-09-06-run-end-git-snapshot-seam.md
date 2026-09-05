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

**Source Contracts:** `_bmad-output/specs/spec-archon-source-control/SPEC.md` CAP-8, `_bmad-output/specs/spec-archon-source-control/brownfield.md` Durable capture, and `_bmad-output/planning-artifacts/architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` AD-8.

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
- Run every command block from the repository root; package-scoped commands use a subshell so later commands remain rooted correctly.

---

## File Map

- Modify `packages/workflows/src/deps.ts` to add `GitSnapshotContext` and optional `WorkflowDeps.onRunEndGitSnapshot`.
- Modify `packages/workflows/src/executor.ts` to call the hook fail-open from `executeWorkflow`'s keep-awake `finally` after the existing running-status backstop.
- Modify `packages/workflows/src/executor.test.ts` to cover terminal invokes, nonterminal and pre-DAG skips, missing rows and hooks, hook and lookup failures, successful and failed backstops, named events, and log privacy.
- Modify `packages/workflows/src/subrun.test.ts` to prove a terminal child snapshots before it resumes a parent that shares its checkout.
- Create `packages/core/src/workflows/git-snapshot.ts` as the stable writer entry point whose v1 behavior is a no-op.
- Create `packages/core/src/workflows/git-snapshot.test.ts` for missing paths, checkout-gone, no-write, repeat-call idempotence, named skip logs, and log privacy.
- Modify `packages/core/src/workflows/store-adapter.ts` to inject `captureRunEndGitSnapshot` from `createWorkflowDeps()`.
- Modify `packages/core/src/workflows/store-adapter.test.ts` to assert the hook is callable.
- Modify `packages/core/package.json` so `git-snapshot.test.ts` runs in its own `bun test` invocation.
- Modify `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` only after the code tasks pass.

Do not modify `packages/server/src/routes/api.ts`, `migrations/000_combined.sql`, `packages/core/src/db/adapters/sqlite.ts`, `packages/web/`, or `packages/git/`.

## Patterns to Mirror

**Optional `WorkflowDeps` injection** lives in `packages/workflows/src/deps.ts` after `usageRecorder`.
`getUserAiPrefs` is optional on the engine interface and always supplied by `createWorkflowDeps()`.

**Fail-open optional work** lives in `packages/workflows/src/executor.ts` around `resolveBotGitHubToken`: catch, log `workflow.*_failed`, continue.

**Run-end placement** is the keep-awake `try`/`finally` in `executeWorkflow` (`packages/workflows/src/executor.ts`).
`keepAwake.release()` is the first `finally` statement.
The zombie-run backstop then flips leftover `running` rows to failed.
The git-snapshot hook runs after a successful backstop transition so a leftover `running` row is observed as `failed`.
If the backstop write fails and the row remains `running`, the hook is skipped rather than inventing a terminal state.

**Core sibling module** is `packages/core/src/workflows/usage-recorder.ts`: it uses `createLogger` and is wired only through `createWorkflowDeps()`.

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
  onRunEndGitSnapshot?: (context: GitSnapshotContext) => Promise<void>;
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
The hook implementation may throw so the executor can apply this one fail-open boundary and emit the required failure event.

Log events (no paths):

- Engine start: `workflow.git_snapshot_started` with `{ workflowRunId, status }`
- Engine success: `workflow.git_snapshot_completed` with `{ workflowRunId, status }`
- Engine failure: `workflow.git_snapshot_failed` with a fixed, stack-free, path-free `err` marker, `workflowRunId`, and optional `status`; never serialize or inspect the caught value
- Core skip: `git_snapshot.capture_skipped` with `{ workflowRunId, reason }` where `reason` is `'missing_working_path'`, `'checkout_gone'`, or `'v1_noop'`; the `'v1_noop'` payload also includes `status`

### v1 no-op writer

`captureRunEndGitSnapshot(context)` in `@archon/core`:

1. If `context.workingPath` is null or empty, log `git_snapshot.capture_skipped` with `reason: 'missing_working_path'` and return.
2. If `existsSync(context.workingPath)` is false, log `git_snapshot.capture_skipped` with `reason: 'checkout_gone'` and return.
3. Otherwise log `git_snapshot.capture_skipped` with `reason: 'v1_noop'` and the terminal status, then return.
4. Never create files or directories under `context.outputRoot`.
5. Never call git.

A later writer must replace step 3 with an idempotent temp+rename write under `context.outputRoot` and must still no-op when `outputRoot` is null or the checkout is gone.
The snapshot filename and wire format remain intentionally undecided until the later build story.

---

### Task 1: Add the engine hook and invoke it fail-open at run-end

**Files:**

- Modify: `packages/workflows/src/deps.ts`
- Modify: `packages/workflows/src/executor.ts`
- Test: `packages/workflows/src/executor.test.ts`
- Test: `packages/workflows/src/subrun.test.ts`

**Interfaces:**

- Consumes: `WorkflowRun.working_path`, `WorkflowRun.output_root`, `WorkflowRun.status`, existing `executeWorkflow` finally backstop.
- Produces: `GitSnapshotTerminalStatus`, `GitSnapshotContext`, `WorkflowDeps.onRunEndGitSnapshot`, and file-local `invokeRunEndGitSnapshot(deps, runId)`.

- [ ] **Step 1: Write the failing executor tests**

Append this describe to `packages/workflows/src/executor.test.ts` immediately after the existing `describe('finally backstop')` block and before `describe('telemetry wiring')`.
Do not change production types first; the test-local context shape keeps the red test runnable before `WorkflowDeps` owns the hook.

```ts
type ExpectedGitSnapshotContext = {
  runId: string;
  workingPath: string | null;
  outputRoot: string | null;
  status: 'completed' | 'failed' | 'cancelled';
};

describe('run-end git snapshot seam', () => {
  beforeEach(() => {
    mockLogFn.mockClear();
    mockExecuteDagWorkflow.mockClear();
    mockExecuteDagWorkflow.mockImplementation(async (): Promise<string | undefined> => undefined);
  });

  function snapshotRun(status: WorkflowRun['status']): WorkflowRun {
    return makeRun({
      id: 'run-123',
      status,
      working_path: '/tmp/wt-secret',
      output_root: '/tmp/out-secret',
    });
  }

  function depsWithHook(
    hook: (context: ExpectedGitSnapshotContext) => Promise<void>,
    storeOverrides: Parameters<typeof makeStore>[0] = {}
  ) {
    const store = makeStore({
      getWorkflowRun: mock(async () => snapshotRun('completed')),
      getWorkflowRunStatus: mock(async () => 'completed' as const),
      ...storeOverrides,
    });
    return { store, deps: { ...makeDeps(store), onRunEndGitSnapshot: hook } };
  }

  function eventCalls(eventName: string): unknown[][] {
    return (mockLogFn.mock.calls as unknown[][]).filter(call => call[1] === eventName);
  }

  it('invokes the hook once with run row fields after a completed run', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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
    expect(eventCalls('workflow.git_snapshot_started')[0]?.[0]).toEqual({
      workflowRunId: 'run-123',
      status: 'completed',
    });
    expect(eventCalls('workflow.git_snapshot_completed')[0]?.[0]).toEqual({
      workflowRunId: 'run-123',
      status: 'completed',
    });
  });

  it('invokes the hook when the run failed', async () => {
    mockExecuteDagWorkflow.mockRejectedValueOnce(new Error('dag boom'));
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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

  it('does not invoke the hook when the refreshed run is pending', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
    const { deps } = depsWithHook(hook, {
      getWorkflowRun: mock(async () => snapshotRun('pending')),
      getWorkflowRunStatus: mock(async () => 'pending' as const),
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
    expect(hook).not.toHaveBeenCalled();
  });

  it('does not invoke the hook on a pre-DAG container-resume guard return', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
    const store = makeStore();
    const deps = { ...makeDeps(store), onRunEndGitSnapshot: hook };
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test message',
      'db-conv-1',
      { preCreatedRun: makeRun({ metadata: { isolation: 'container' } }) }
    );
    expect(result.success).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(eventCalls('workflow.git_snapshot_started')).toHaveLength(0);
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
    expect(eventCalls('workflow.git_snapshot_started')).toHaveLength(0);
  });

  it('still succeeds when the hook throws', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {
      throw new Error('snapshot exploded');
    });
    const failWorkflowRun = mock(async (): Promise<void> => {});
    const { deps } = depsWithHook(hook, { failWorkflowRun });
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
    const failed = eventCalls('workflow.git_snapshot_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.[0]).toMatchObject({
      workflowRunId: 'run-123',
      status: 'completed',
    });
    expect(eventCalls('workflow.git_snapshot_completed')).toHaveLength(0);
    expect(failWorkflowRun).not.toHaveBeenCalled();
  });

  it('preserves a successful result when the final row refresh throws', async () => {
    let readCount = 0;
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
    const failWorkflowRun = mock(async (): Promise<void> => {});
    const { deps } = depsWithHook(hook, {
      failWorkflowRun,
      getWorkflowRun: mock(async () => {
        readCount += 1;
        if (readCount === 1) return snapshotRun('completed');
        throw new Error('snapshot row read failed');
      }),
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
    expect(result.success).toBe(true);
    expect(hook).not.toHaveBeenCalled();
    expect(eventCalls('workflow.git_snapshot_failed')[0]?.[0]).toMatchObject({
      workflowRunId: 'run-123',
    });
    expect(failWorkflowRun).not.toHaveBeenCalled();
  });

  it('does not invoke the hook when the refreshed run row is missing', async () => {
    let readCount = 0;
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
    const { deps } = depsWithHook(hook, {
      getWorkflowRun: mock(async () => {
        readCount += 1;
        return readCount === 1 ? snapshotRun('completed') : null;
      }),
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
    expect(result.success).toBe(true);
    expect(hook).not.toHaveBeenCalled();
    expect(eventCalls('workflow.git_snapshot_started')).toHaveLength(0);
  });

  it('invokes the hook as failed after the running-status backstop', async () => {
    let status: 'running' | 'failed' = 'running';
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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

  it('does not invoke the hook when the running-status backstop write fails', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
    const store = makeStore({
      getWorkflowRunStatus: mock(async () => 'running' as const),
      failWorkflowRun: mock(async () => {
        throw new Error('status write failed');
      }),
      getWorkflowRun: mock(async () => snapshotRun('running')),
    });
    const deps = { ...makeDeps(store), onRunEndGitSnapshot: hook };
    const result = await executeWorkflow(
      deps,
      makePlatform(),
      'conv-1',
      '/tmp',
      makeWorkflow(),
      'test',
      'db-conv-1'
    );
    expect(result.success).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(eventCalls('workflow.git_snapshot_started')).toHaveLength(0);
  });

  it('does not log workingPath or outputRoot', async () => {
    const hook = mock(async (_context: ExpectedGitSnapshotContext): Promise<void> => {});
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
(cd packages/workflows && bun test src/executor.test.ts)
```

Expected: FAIL because the completed-run hook call count is `0` instead of `1`, and no `workflow.git_snapshot_*` events exist.
Confirm the failures are caused by the missing seam rather than fixture, import, or setup errors.

- [ ] **Step 3: Implement the run-end invoke**

In `packages/workflows/src/deps.ts`, place these exported types immediately above `WorkflowDeps`:

```ts
export type GitSnapshotTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface GitSnapshotContext {
  runId: string;
  workingPath: string | null;
  outputRoot: string | null;
  status: GitSnapshotTerminalStatus;
}
```

Append this property after `getUserAiPrefs` in `WorkflowDeps`:

```ts
  /**
   * Optional CAP-8 run-end git-snapshot hook.
   * The executor calls it only after DAG execution reaches a terminal status.
   * The executor catches and logs lookup or hook failures without changing the run result.
   * A future writer must be idempotent, use temp+rename under `outputRoot`, and never log paths, remotes, file contents, or secrets.
   */
  onRunEndGitSnapshot?: (context: GitSnapshotContext) => Promise<void>;
```

In `packages/workflows/src/executor.test.ts`, import `GitSnapshotContext` from `./deps`, replace every `ExpectedGitSnapshotContext` annotation with `GitSnapshotContext`, and delete the test-local type.

In `packages/workflows/src/executor.ts`, add this helper immediately above `export async function executeWorkflow`.
Import `GitSnapshotContext` from `./deps` by extending the existing `WorkflowDeps` import.

```ts
function isGitSnapshotTerminalStatus(
  status: WorkflowRun['status']
): status is GitSnapshotContext['status'] {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

const safeGitSnapshotLogError = Object.freeze({
  type: 'GitSnapshotFailure',
  message: 'Run-end git snapshot failed; details redacted',
});

/**
 * CAP-8 run-end seam. Fail-open: never throw, never fail the run, never log paths.
 * Invoked only after the keep-awake finally backstop so a leftover running row
 * is marked failed before snapshot.
 */
async function invokeRunEndGitSnapshot(deps: WorkflowDeps, runId: string): Promise<void> {
  const hook = deps.onRunEndGitSnapshot;
  if (!hook) {
    return;
  }
  let run: WorkflowRun | null;
  try {
    run = await deps.store.getWorkflowRun(runId);
  } catch {
    getLog().error(
      { err: safeGitSnapshotLogError, workflowRunId: runId },
      'workflow.git_snapshot_failed'
    );
    return;
  }
  if (!run || !isGitSnapshotTerminalStatus(run.status)) {
    return;
  }
  const status = run.status;
  try {
    getLog().info({ workflowRunId: runId, status }, 'workflow.git_snapshot_started');
    await hook({
      runId,
      workingPath: run.working_path ?? null,
      outputRoot: run.output_root ?? null,
      status,
    });
    getLog().info({ workflowRunId: runId, status }, 'workflow.git_snapshot_completed');
  } catch {
    getLog().error(
      { err: safeGitSnapshotLogError, workflowRunId: runId, status },
      'workflow.git_snapshot_failed'
    );
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

If the terminal run is a child eligible for parent auto-resume, defer `maybeResumeParentRun()` until after `invokeRunEndGitSnapshot()` finishes. A shared-checkout parent can mutate the same working tree immediately on re-entry, so the child's snapshot boundary must occur first. Lock this ordering down in `packages/workflows/src/subrun.test.ts`.

Gotcha: `makeStore().getWorkflowRun` defaults to `status: 'completed'`.
Failed/cancelled/paused tests must override both `getWorkflowRun` and `getWorkflowRunStatus` so the backstop and the hook see the same status.

Gotcha: do not pass `workflowRun`, `cwd`, or the already-read `finalStatus` into the helper.
The post-backstop `getWorkflowRun` refresh is what observes a backstop transition and the durable `output_root` value.

Gotcha: do not put this call in `catch` only, or failed runs that return from `catch` would snapshot while completed runs that return from `try` would not.
`finally` covers both.

- [ ] **Step 4: Run the executor tests and confirm they pass**

Run:

```bash
(cd packages/workflows && bun test src/executor.test.ts)
```

Expected: PASS, including `finally backstop` and `run-end git snapshot seam`.

- [ ] **Step 5: Type-check the workflows package**

Run:

```bash
(cd packages/workflows && bun run type-check)
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

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
- Produces: `captureRunEndGitSnapshot(context: GitSnapshotContext): Promise<void>`.

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

import { captureRunEndGitSnapshot } from './git-snapshot';

function context(overrides: Partial<GitSnapshotContext> = {}): GitSnapshotContext {
  return {
    runId: 'run-1',
    workingPath: null,
    outputRoot: null,
    status: 'completed',
    ...overrides,
  };
}

describe('captureRunEndGitSnapshot v1', () => {
  let outputRoot: string;
  let workingPaths: string[];

  function infoEventCalls(eventName: string): [Record<string, unknown>, string][] {
    const calls = mockLogger.info.mock.calls as unknown as [Record<string, unknown>, string][];
    return calls.filter(call => call[1] === eventName);
  }

  beforeEach(() => {
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    outputRoot = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-out-'));
    workingPaths = [];
  });

  afterEach(() => {
    for (const workingPath of workingPaths) {
      rmSync(workingPath, { recursive: true, force: true });
    }
    rmSync(outputRoot, { recursive: true, force: true });
  });

  function makeWorkingPath(): string {
    const workingPath = mkdtempSync(join(tmpdir(), 'archon-git-snapshot-wt-'));
    workingPaths.push(workingPath);
    return workingPath;
  }

  test('skips when workingPath is null', async () => {
    await captureRunEndGitSnapshot(context({ workingPath: null, outputRoot }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'missing_working_path' });
  });

  test('skips when workingPath is empty', async () => {
    await captureRunEndGitSnapshot(context({ workingPath: '', outputRoot }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'missing_working_path' });
  });

  test('skips when the checkout directory is gone', async () => {
    await captureRunEndGitSnapshot(
      context({ workingPath: join(outputRoot, 'no-such-checkout'), outputRoot })
    );
    expect(readdirSync(outputRoot)).toEqual([]);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({ workflowRunId: 'run-1', reason: 'checkout_gone' });
  });

  test('preserves checkout and output-root contents when the checkout exists', async () => {
    const workingPath = makeWorkingPath();
    writeFileSync(join(workingPath, 'README.md'), 'hello');
    writeFileSync(join(outputRoot, 'keep.txt'), 'keep');
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    expect(readdirSync(outputRoot)).toEqual(['keep.txt']);
    expect(readdirSync(workingPath)).toEqual(['README.md']);
    const skip = infoEventCalls('git_snapshot.capture_skipped')[0];
    expect(skip?.[0]).toEqual({
      workflowRunId: 'run-1',
      status: 'completed',
      reason: 'v1_noop',
    });
  });

  test('remains a no-op across repeated terminal calls', async () => {
    const workingPath = makeWorkingPath();
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot, status: 'failed' }));
    expect(readdirSync(outputRoot)).toEqual([]);
    const skips = infoEventCalls('git_snapshot.capture_skipped').filter(
      call => call[0].reason === 'v1_noop'
    );
    expect(skips).toHaveLength(2);
    expect(skips[0]?.[0]).toMatchObject({ status: 'completed' });
    expect(skips[1]?.[0]).toMatchObject({ status: 'failed' });
  });

  test('does not log workingPath or outputRoot', async () => {
    const workingPath = makeWorkingPath();
    await captureRunEndGitSnapshot(context({ workingPath, outputRoot }));
    const serialized = JSON.stringify([
      mockLogger.info.mock.calls,
      mockLogger.error.mock.calls,
      mockLogger.warn.mock.calls,
    ]);
    expect(serialized).not.toContain(workingPath);
    expect(serialized).not.toContain(outputRoot);
  });
});
```

Add `&& bun test src/workflows/git-snapshot.test.ts` to `packages/core/package.json` `scripts.test` immediately after `bun test src/workflows/usage-recorder.test.ts`.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```bash
(cd packages/core && bun test src/workflows/git-snapshot.test.ts)
```

Expected RED: FAIL because `./git-snapshot` does not exist yet.
Confirm that module resolution is the only setup error before continuing.

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
 * - let write errors reach the executor's fail-open logging boundary
 * - never log paths, remotes, file contents, or secrets
 * - not invent a second WorkflowDeps hook
 *
 * The snapshot filename and wire format are intentionally deferred.
 */
import { existsSync } from 'node:fs';
import { createLogger } from '@archon/paths';
import type { GitSnapshotContext } from '@archon/workflows/deps';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.git-snapshot');
  return cachedLog;
}

export async function captureRunEndGitSnapshot(context: GitSnapshotContext): Promise<void> {
  if (!context.workingPath) {
    getLog().info(
      { workflowRunId: context.runId, reason: 'missing_working_path' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  if (!existsSync(context.workingPath)) {
    getLog().info(
      { workflowRunId: context.runId, reason: 'checkout_gone' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  getLog().info(
    { workflowRunId: context.runId, status: context.status, reason: 'v1_noop' },
    'git_snapshot.capture_skipped'
  );
}
```

- [ ] **Step 4: Run the no-op tests and confirm they pass**

Run:

```bash
(cd packages/core && bun test src/workflows/git-snapshot.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Type-check the core package**

Run:

```bash
(cd packages/core && bun run type-check)
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

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

- Consumes: `captureRunEndGitSnapshot`.
- Produces: a callable `createWorkflowDeps().onRunEndGitSnapshot` dependency.

- [ ] **Step 1: Write the failing wiring test**

In `packages/core/src/workflows/store-adapter.test.ts`, inside `describe('createWorkflowDeps')` after the existing `usageRecorder` assertion test, add:

```ts
  test('exposes the run-end git-snapshot hook', () => {
    const deps = createWorkflowDeps();
    expect(typeof deps.onRunEndGitSnapshot).toBe('function');
  });
```

- [ ] **Step 2: Run the wiring test and confirm it fails**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

Expected: FAIL because `onRunEndGitSnapshot` is undefined.

- [ ] **Step 3: Wire the hook**

In `packages/core/src/workflows/store-adapter.ts`:

```ts
import { captureRunEndGitSnapshot } from './git-snapshot';
```

Inside `createWorkflowDeps()`'s returned object, after `getUserAiPrefs`, add:

```ts
    onRunEndGitSnapshot: captureRunEndGitSnapshot,
```

Do not wrap the writer in another function or try/catch here.
The executor owns the one fail-open boundary and the `workflow.git_snapshot_failed` event.

- [ ] **Step 4: Re-run the wiring test and confirm it passes**

Run:

```bash
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

Expected: PASS.

- [ ] **Step 5: Type-check the core package**

Run:

```bash
(cd packages/core && bun run type-check)
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Confirm the committed scope did not expand beyond the seam**

Run:

```bash
git diff --name-only "$(git merge-base HEAD dev)" HEAD -- packages/server packages/web packages/git migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts
```

Expected: no output.
If any path is printed, remove that out-of-scope change before continuing.
The focused core test is the executable proof that `captureRunEndGitSnapshot` creates no snapshot files.

- [ ] **Step 2: Run focused package tests**

```bash
(cd packages/workflows && bun test src/executor.test.ts)
(cd packages/core && bun test src/workflows/git-snapshot.test.ts)
(cd packages/core && bun test src/workflows/store-adapter.test.ts)
```

Expected: PASS.

- [ ] **Step 3: Type-check the two packages**

```bash
(cd packages/workflows && bun run type-check)
(cd packages/core && bun run type-check)
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

- [ ] **Step 5: Check the patch for whitespace errors**

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 6: Run repository validate**

```bash
bun run validate
```

Expected: PASS.

- [ ] **Step 7: Commit sprint-status if validate passed**

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
| `packages/workflows/src/executor.test.ts` | completed / failed / cancelled invoke; paused / absent / missing-row skip; hook and row-read failures; successful and failed backstops; named events; no path logs | FR9 seam, NFR3, NFR5, run-end trigger |
| `packages/workflows/src/subrun.test.ts` | gated child snapshots before recursive parent auto-resume on the shared checkout | per-run run-end boundary |
| `packages/core/src/workflows/git-snapshot.test.ts` | null / empty `workingPath`; checkout gone; existing checkout preserves both trees; repeated terminal calls; named skip reasons; no path logs | v1 no-op write, checkout-gone, idempotence, NFR5 |
| `packages/core/src/workflows/store-adapter.test.ts` | `createWorkflowDeps()` exposes a callable hook | injection like other optional deps |

### Edge Cases Checklist

- [ ] Hook missing: run still succeeds.
- [ ] Hook throws: run still succeeds and is not marked failed by the hook.
- [ ] Final run-row refresh throws: the existing result is preserved, the hook is skipped, and `workflow.git_snapshot_failed` is logged.
- [ ] Final run-row refresh returns null: the hook is skipped without a start event.
- [ ] Status `paused`: hook is not called.
- [ ] Status leftover `running` at finally: backstop fails the run, then hook is called with `failed`.
- [ ] Backstop status write fails and the row remains `running`: the hook is skipped.
- [ ] `working_path` null: core no-op skips and writes nothing.
- [ ] `working_path` empty: core no-op skips and writes nothing.
- [ ] Checkout directory already gone: core no-op skips and writes nothing.
- [ ] Hook called twice (retry / second terminal pass): still no files under `output_root`.
- [ ] Child `workflow:` run: covered by each child `executeWorkflow` finally; no extra parent wiring.
- [ ] Terminal child with parent auto-resume: child hook finishes before the parent can re-enter and mutate the shared checkout.
- [ ] Logs never include `workingPath` or `outputRoot`.
- [ ] No `/git/` routes and no new tables.

---

## Validation Commands

1. `(cd packages/workflows && bun test src/executor.test.ts)`
2. `(cd packages/workflows && bun test src/subrun.test.ts)`
3. `(cd packages/core && bun test src/workflows/git-snapshot.test.ts)`
4. `(cd packages/core && bun test src/workflows/store-adapter.test.ts)`
5. `(cd packages/workflows && bun run type-check)`
6. `(cd packages/core && bun run type-check)`
7. `git diff --name-only "$(git merge-base HEAD dev)" HEAD -- packages/server packages/web packages/git migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts` produces no output.
8. `git diff --check`
9. `bun run validate`

## Acceptance Criteria

- [ ] `WorkflowDeps` has optional `onRunEndGitSnapshot(context: GitSnapshotContext): Promise<void>`.
- [ ] `GitSnapshotContext` contains `runId`, `workingPath`, `outputRoot`, and only terminal `completed | failed | cancelled` status values, with the path fields mapped from the run row rather than `cwd`.
- [ ] `executeWorkflow` re-reads the run row and calls the hook from the keep-awake `finally` after the running-status backstop.
- [ ] A terminal child's hook completes before recursive parent auto-resume can mutate a shared checkout.
- [ ] `paused`, `pending`, missing, and still-`running` rows do not invoke the hook.
- [ ] Early returns before `keepAwake.acquire()` do not invoke the hook.
- [ ] v1 implementation writes no name-status, diffs, `A`/`D` content, or `git log`.
- [ ] Missing or vanished checkout logs `git_snapshot.capture_skipped` without paths and writes nothing.
- [ ] An existing checkout logs `git_snapshot.capture_skipped` with `reason: 'v1_noop'` and writes nothing.
- [ ] Hook success logs `workflow.git_snapshot_started` and `workflow.git_snapshot_completed` with only run ID and status.
- [ ] Hook or run-row lookup failure logs `workflow.git_snapshot_failed` and does not change the existing workflow result or lifecycle status.
- [ ] No new tables, process, env var, deployable, or git-read route.
- [ ] Snapshot wire format remains unimplemented.
- [ ] Future writer contract (idempotent temp+rename under `output_root`) is documented on the core module.
- [ ] Focused tests above pass.
- [ ] `_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml` entry `3-1-add-the-run-end-git-snapshot-seam` is `done`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mock `getWorkflowRun` stays `completed` on the throw path | High | Medium | Failed/cancelled tests override both status readers |
| Putting the hook in `catch` only misses successful runs | Medium | High | Call from `finally` after backstop |
| Engine stats the checkout and logs a path | Medium | High | No `existsSync` in the executor helper; log-payload tests |
| Someone implements the snapshot write in this story | Medium | High | Task 2 asserts `outputRoot` stays empty |
| `mock.module('@archon/paths')` pollutes other core tests | Medium | High | `git-snapshot.test.ts` gets its own `bun test` invocation |
| Backstop and hook race on status | Low | Medium | Hook re-reads the run row after `failWorkflowRun` |
| Parent auto-resume mutates a shared checkout before the child snapshot | Low | High | Defer parent re-entry until after the child's hook and cover the order in `subrun.test.ts` |
| A failed backstop leaves the row `running` | Low | High | Terminal guard skips the hook rather than inventing status; focused test locks this down |

## NOT Building

- Snapshot manifest JSON, name-status, diffs, `A`/`D` blobs, or `git log` capture.
- Git-read HTTP routes, CAP-6 envelopes, or Source Control UI.
- Per-commit checkpoints.
- Container overlay reads.
- New database columns or tables.
- Parent-run inheritance of a child snapshot.
- Invoking the hook from CLI cleanup or isolation destroy.
- Metrics beyond Pino logs.
