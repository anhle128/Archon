/**
 * Unit tests for the plannotator_gate supervisor loop.
 * Uses injectable spawn + in-memory store — no real plannotator binary.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { ApprovalContext, WorkflowRun } from './schemas/workflow-run';
import type { IWorkflowStore } from './store';
import {
  runPlannotatorGateSupervisor,
  type AnnotateChildHandle,
  type PlannotatorGateSupervisorDeps,
} from './plannotator-gate-supervisor';

// ---------------------------------------------------------------------------
// In-memory store (mirrors subrun FakeStore patterns used by gate tests)
// ---------------------------------------------------------------------------

type StoredEvent = {
  workflow_run_id: string;
  event_type: string;
  step_name?: string;
  data?: Record<string, unknown>;
};

class FakeGateStore implements Pick<
  IWorkflowStore,
  | 'getWorkflowRun'
  | 'pauseWorkflowRun'
  | 'updateWorkflowRun'
  | 'resumeWorkflowRun'
  | 'createWorkflowEvent'
  | 'getDagResumeSnapshot'
  | 'getWorkflowRunStatus'
> {
  run: WorkflowRun;
  events: StoredEvent[] = [];

  constructor(runId: string) {
    this.run = {
      id: runId,
      workflow_name: 'test-wf',
      conversation_id: 'conv-1',
      parent_conversation_id: null,
      codebase_id: null,
      status: 'running',
      user_message: 'go',
      metadata: {},
      started_at: new Date(),
      completed_at: null,
      last_activity_at: new Date(),
      working_path: '/tmp/proj',
      user_id: null,
      parent_run_id: null,
      output_root: null,
    };
  }

  getWorkflowRun = (id: string): Promise<WorkflowRun | null> =>
    Promise.resolve(id === this.run.id ? structuredClone(this.run) : null);

  getWorkflowRunStatus = (id: string): Promise<WorkflowRun['status'] | null> =>
    Promise.resolve(id === this.run.id ? this.run.status : null);

  pauseWorkflowRun: IWorkflowStore['pauseWorkflowRun'] = (id, approvalContext) => {
    if (id !== this.run.id) return Promise.resolve();
    this.run.status = 'paused';
    this.run.metadata = {
      ...this.run.metadata,
      approval: { ...approvalContext, resolved: null },
    };
    return Promise.resolve();
  };

  updateWorkflowRun: IWorkflowStore['updateWorkflowRun'] = (id, updates) => {
    if (id !== this.run.id) return Promise.resolve();
    if (updates.status !== undefined) this.run.status = updates.status;
    if (updates.metadata !== undefined) {
      // Shallow top-level merge; nested `approval` objects replace wholesale
      // when callers pass a full approval snapshot (matches Postgres || merge).
      this.run.metadata = { ...this.run.metadata, ...updates.metadata };
    }
    return Promise.resolve();
  };

  resumeWorkflowRun = (id: string): Promise<WorkflowRun> => {
    if (id !== this.run.id) throw new Error(`no run ${id}`);
    this.run.status = 'running';
    return Promise.resolve(structuredClone(this.run));
  };

  createWorkflowEvent: IWorkflowStore['createWorkflowEvent'] = data => {
    this.events.push({
      workflow_run_id: data.workflow_run_id,
      event_type: data.event_type,
      step_name: data.step_name,
      data: data.data,
    });
    return Promise.resolve();
  };

  getDagResumeSnapshot: IWorkflowStore['getDagResumeSnapshot'] = workflowRunId => {
    const completedNodeOutputs = new Map<string, string>();
    for (const e of this.events) {
      if (
        e.workflow_run_id === workflowRunId &&
        e.event_type === 'node_completed' &&
        typeof e.step_name === 'string'
      ) {
        completedNodeOutputs.set(e.step_name, String(e.data?.node_output ?? ''));
      }
    }
    return Promise.resolve({ completedNodeOutputs, tokens: { input: 0, output: 0 } });
  };

  /** Mimic external approveWorkflow: stamp resolved + node_completed; stay paused. */
  externalApprove(comment = 'Approved'): void {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (!approval?.nodeId) throw new Error('no approval context');
    const nodeOutput = approval.captureResponse === true ? comment : '';
    this.run.metadata = {
      ...this.run.metadata,
      approval: { ...approval, resolved: 'approved' },
      approval_response: 'approved',
    };
    this.events.push({
      workflow_run_id: this.run.id,
      event_type: 'node_completed',
      step_name: approval.nodeId,
      data: { node_output: nodeOutput, approval_decision: 'approved' },
    });
    this.events.push({
      workflow_run_id: this.run.id,
      event_type: 'approval_received',
      step_name: approval.nodeId,
      data: { decision: 'approved', comment },
    });
  }

  asStore(): IWorkflowStore {
    return this as unknown as IWorkflowStore;
  }
}

// ---------------------------------------------------------------------------
// Controllable annotate child
// ---------------------------------------------------------------------------

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeChild(exit: {
  exitCode: number;
  stdout: string;
  /** Delay before exit resolves; 0 = immediate on wait */
  delayMs?: number;
}): AnnotateChildHandle & { killed: boolean; waitStarted: Promise<void> } {
  let killed = false;
  const waitGate = deferred<void>();
  const handle: AnnotateChildHandle & { killed: boolean; waitStarted: Promise<void> } = {
    killed: false,
    waitStarted: waitGate.promise,
    wait: async () => {
      waitGate.resolve();
      if (exit.delayMs && exit.delayMs > 0) {
        await Bun.sleep(exit.delayMs);
      }
      // If killed mid-flight before natural exit, still resolve (process died).
      if (killed) {
        return { exitCode: 1, stdout: '' };
      }
      return { exitCode: exit.exitCode, stdout: exit.stdout };
    },
    kill: () => {
      killed = true;
      handle.killed = true;
    },
  };
  return handle;
}

function baseDeps(
  store: FakeGateStore,
  overrides: Partial<PlannotatorGateSupervisorDeps> = {}
): PlannotatorGateSupervisorDeps {
  return {
    runId: store.run.id,
    nodeId: 'clarify-gate',
    cwd: '/tmp/proj',
    initialDocumentPath: '/tmp/proj/artifacts/plan.html',
    captureResponse: false,
    reworkPromptTemplate: 'Doc: $REVIEW_DOCUMENT\nNotes:\n$REVIEW_ANNOTATIONS',
    message: 'Review the plan',
    store: store.asStore(),
    runReworkAgent: mock(async () => '/tmp/proj/artifacts/plan-v2.html'),
    pollIntervalMs: 15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPlannotatorGateSupervisor', () => {
  test('child approved JSON records approval, resumes run, returns output', async () => {
    const store = new FakeGateStore('run-approve');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"LGTM"}',
    });
    const spawnAnnotate = mock(async () => child);

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate,
      })
    );

    expect(result.output).toBe('LGTM');
    expect(store.run.status).toBe('running');
    const approval = store.run.metadata.approval as ApprovalContext;
    expect(approval.resolved).toBe('approved');
    expect(approval.type).toBe('plannotator_gate');
    expect(spawnAnnotate).toHaveBeenCalledTimes(1);
    expect(spawnAnnotate).toHaveBeenCalledWith('/tmp/proj/artifacts/plan.html');
    const completed = store.events.find(e => e.event_type === 'node_completed');
    expect(completed?.data?.node_output).toBe('LGTM');
  });

  test('approved without captureResponse yields empty node output', async () => {
    const store = new FakeGateStore('run-no-capture');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"notes"}',
    });

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: false,
        spawnAnnotate: async () => child,
      })
    );

    expect(result.output).toBe('');
    const completed = store.events.find(e => e.event_type === 'node_completed');
    expect(completed?.data?.node_output).toBe('');
  });

  test('annotated then approved runs rework and re-spawns with new path', async () => {
    const store = new FakeGateStore('run-rework');
    const first = makeChild({
      exitCode: 0,
      stdout: '{"decision":"annotated","feedback":"fix the header"}',
    });
    const second = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"good"}',
    });
    const paths: string[] = [];
    const spawnAnnotate = mock(async (documentPath: string) => {
      paths.push(documentPath);
      return paths.length === 1 ? first : second;
    });
    const runReworkAgent = mock(
      async (args: { prompt: string; documentPath: string; annotations: string }) => {
        expect(args.annotations).toBe('fix the header');
        expect(args.documentPath).toBe('/tmp/proj/artifacts/plan.html');
        expect(args.prompt).toContain('/tmp/proj/artifacts/plan.html');
        expect(args.prompt).toContain('fix the header');
        return '/tmp/proj/artifacts/plan-v2.html\n';
      }
    );

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate,
        runReworkAgent,
      })
    );

    expect(result.output).toBe('good');
    expect(spawnAnnotate).toHaveBeenCalledTimes(2);
    expect(paths).toEqual(['/tmp/proj/artifacts/plan.html', '/tmp/proj/artifacts/plan-v2.html']);
    expect(runReworkAgent).toHaveBeenCalledTimes(1);
    const approval = store.run.metadata.approval as ApprovalContext;
    expect(approval.document).toBe('/tmp/proj/artifacts/plan-v2.html');
    expect(store.run.status).toBe('running');
  });

  test('external approve while child alive kills child and completes', async () => {
    const store = new FakeGateStore('run-external');
    // Child never exits on its own until killed.
    const child = makeChild({
      exitCode: 0,
      stdout: '',
      delayMs: 60_000,
    });
    const spawnAnnotate = mock(async () => child);

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate,
        pollIntervalMs: 10,
      })
    );

    // Wait until annotate is waiting, then stamp external approval.
    await child.waitStarted;
    // Give the supervisor one poll cycle after pause+spawn.
    await Bun.sleep(30);
    store.externalApprove('from-cli');

    const result = await supervisor;
    expect(result.output).toBe('from-cli');
    expect(child.killed).toBe(true);
    expect(store.run.status).toBe('running');
    // Must not double-write node_completed
    const completed = store.events.filter(e => e.event_type === 'node_completed');
    expect(completed).toHaveLength(1);
  });

  test('invalid rework path throws and leaves run paused', async () => {
    const store = new FakeGateStore('run-bad-rework');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"annotated","feedback":"redo"}',
    });
    const runReworkAgent = mock(async () => '   \n\n  ');

    await expect(
      runPlannotatorGateSupervisor(
        baseDeps(store, {
          spawnAnnotate: async () => child,
          runReworkAgent,
        })
      )
    ).rejects.toThrow(/document path|empty/i);

    expect(store.run.status).toBe('paused');
    const approval = store.run.metadata.approval as ApprovalContext;
    expect(approval.resolved).toBeNull();
    // No resume, no node_completed
    expect(store.events.some(e => e.event_type === 'node_completed')).toBe(false);
  });

  test('stock dismissed enters idle and external approve still completes', async () => {
    const store = new FakeGateStore('run-dismiss');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"dismissed"}',
    });
    let spawnCount = 0;
    const spawnAnnotate = mock(async () => {
      spawnCount += 1;
      // Only first spawn returns dismissed; should not re-spawn without review-open.
      return child;
    });

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate,
        pollIntervalMs: 10,
      })
    );

    await child.waitStarted;
    await Bun.sleep(40);
    // After dismiss, phase should be idle and still paused.
    expect(store.run.status).toBe('paused');
    const mid = store.run.metadata.approval as ApprovalContext;
    expect(mid.phase).toBe('idle');
    expect(spawnCount).toBe(1);

    store.externalApprove('ok-after-idle');
    const result = await supervisor;
    expect(result.output).toBe('ok-after-idle');
    expect(spawnCount).toBe(1); // no re-spawn
    expect(store.run.status).toBe('running');
  });

  test('cancelled run aborts supervisor and kills child', async () => {
    const store = new FakeGateStore('run-cancel');
    const child = makeChild({
      exitCode: 0,
      stdout: '',
      delayMs: 60_000,
    });

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        spawnAnnotate: async () => child,
        pollIntervalMs: 10,
      })
    );

    await child.waitStarted;
    await Bun.sleep(25);
    store.run.status = 'cancelled';

    await expect(supervisor).rejects.toThrow(/cancel/i);
    expect(child.killed).toBe(true);
  });
});
