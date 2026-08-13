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
// In-memory store (CAS-aware; models gate resolve + phase-merge safety)
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
  | 'resumeApprovedGate'
  | 'createWorkflowEvent'
  | 'getDagResumeSnapshot'
  | 'getWorkflowRunStatus'
  | 'resolveApprovalGate'
  | 'transitionPlannotatorGate'
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
      this.run.metadata = { ...this.run.metadata, ...updates.metadata };
    }
    return Promise.resolve();
  };

  resumeWorkflowRun = (id: string): Promise<WorkflowRun> => {
    if (id !== this.run.id) throw new Error(`no run ${id}`);
    // Mirror real resume CAS: only paused/failed are resumable.
    if (this.run.status !== 'paused' && this.run.status !== 'failed') {
      throw new Error(
        `Workflow run is not resumable (id: ${id}, status: ${this.run.status}). ` +
          'It may have already been resumed, completed, or cancelled.'
      );
    }
    this.run.status = 'running';
    return Promise.resolve(structuredClone(this.run));
  };

  resumeApprovedGate: IWorkflowStore['resumeApprovedGate'] = (id, expected) => {
    if (id !== this.run.id || this.run.status !== 'paused')
      return Promise.resolve({ resumed: false });
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (
      approval?.resolved !== 'approved' ||
      approval.nodeId !== expected.nodeId ||
      (expected.gateId !== undefined && approval.gateId !== expected.gateId)
    ) {
      return Promise.resolve({ resumed: false });
    }
    this.run.status = 'running';
    return Promise.resolve({ resumed: true });
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

  resolveApprovalGate: IWorkflowStore['resolveApprovalGate'] = async (
    id,
    expected,
    metadata,
    events
  ) => {
    if (id !== this.run.id || this.run.status !== 'paused') return { resolved: false };
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (
      approval?.resolved != null ||
      approval?.nodeId !== expected.nodeId ||
      (expected.gateId !== undefined && approval.gateId !== expected.gateId)
    ) {
      return { resolved: false };
    }
    this.run.metadata = { ...this.run.metadata, ...metadata };
    for (const event of events) {
      this.events.push({
        workflow_run_id: this.run.id,
        event_type: event.event_type,
        step_name: event.step_name,
        data: event.data,
      });
    }
    return { resolved: true };
  };

  transitionPlannotatorGate: IWorkflowStore['transitionPlannotatorGate'] = async input => {
    if (input.runId !== this.run.id) throw new Error(`no run ${input.runId}`);
    if (this.run.status !== 'paused') return { outcome: 'stopped', status: this.run.status };
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (
      approval?.type !== 'plannotator_gate' ||
      approval.nodeId !== input.nodeId ||
      approval.gateId !== input.expectedGateId
    ) {
      return { outcome: 'superseded' };
    }
    if (approval.resolved != null) {
      return { outcome: 'resolved', resolved: approval.resolved };
    }
    const next: ApprovalContext = {
      ...approval,
      gateId: input.nextGateId ?? input.expectedGateId,
      document: input.document,
      phase: input.phase,
    };
    this.run.metadata = { ...this.run.metadata, approval: next };
    return { outcome: 'updated', approval: next };
  };

  /** Mimic external approveWorkflow via the same CAS. */
  externalApprove(comment = 'Approved'): boolean {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (!approval?.nodeId) throw new Error('no approval context');
    if (approval.resolved === 'approved' || approval.resolved === 'rejected') return false;
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
    return true;
  }

  /** Mimic external rejectWorkflow: stamp resolved=rejected; stay paused. */
  externalReject(reason = 'Rejected'): boolean {
    const approval = this.run.metadata.approval as ApprovalContext | undefined;
    if (!approval?.nodeId) throw new Error('no approval context');
    if (approval.resolved === 'approved' || approval.resolved === 'rejected') return false;
    this.run.metadata = {
      ...this.run.metadata,
      approval: { ...approval, resolved: 'rejected' },
      approval_response: 'rejected',
      rejection_reason: reason,
    };
    this.events.push({
      workflow_run_id: this.run.id,
      event_type: 'approval_received',
      step_name: approval.nodeId,
      data: { decision: 'rejected', comment: reason },
    });
    return true;
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
    message: 'Review the plan',
    gateId: 'gate-a',
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
      stdout: '{"decision":"annotated","feedback":"keep $REVIEW_DOCUMENT and $REVIEW_ANNOTATIONS"}',
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
    const runReworkAgent = mock(async (args: { documentPath: string; annotations: string }) => {
      expect(args).toEqual({
        documentPath: '/tmp/proj/artifacts/plan.html',
        annotations: 'keep $REVIEW_DOCUMENT and $REVIEW_ANNOTATIONS',
      });
      return '/tmp/proj/artifacts/plan-v2.html\n';
    });

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

    await child.waitStarted;
    await Bun.sleep(30);
    store.externalApprove('from-cli');

    const result = await supervisor;
    expect(result.output).toBe('from-cli');
    expect(child.killed).toBe(true);
    expect(store.run.status).toBe('running');
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
    expect(store.run.status).toBe('paused');
    const mid = store.run.metadata.approval as ApprovalContext;
    expect(mid.phase).toBe('idle');
    expect(spawnCount).toBe(1);

    store.externalApprove('ok-after-idle');
    const result = await supervisor;
    expect(result.output).toBe('ok-after-idle');
    expect(spawnCount).toBe(1);
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

  test('review-open rotation supersedes the old live supervisor', async () => {
    const store = new FakeGateStore('run-rotated-live');
    const child = makeChild({ exitCode: 0, stdout: '', delayMs: 60_000 });
    const resumeWorkflowRun = mock(store.resumeWorkflowRun);
    store.resumeWorkflowRun = resumeWorkflowRun;

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, { spawnAnnotate: async () => child, pollIntervalMs: 10 })
    );

    await child.waitStarted;
    const approval = store.run.metadata.approval as ApprovalContext;
    store.run.metadata = {
      ...store.run.metadata,
      approval: { ...approval, gateId: 'gate-b', phase: 'opening' },
    };
    store.run.status = 'running';

    await expect(supervisor).resolves.toEqual({ kind: 'superseded' });
    expect(child.killed).toBe(true);
    expect(store.events.some(event => event.event_type === 'node_completed')).toBe(false);
    expect(resumeWorkflowRun).not.toHaveBeenCalled();
  });

  test('old child approval loses resolution after gate rotation', async () => {
    const store = new FakeGateStore('run-rotated-approval');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"stale"}',
    });
    const originalResolve = store.resolveApprovalGate;
    store.resolveApprovalGate = async (id, expected, metadata, events) => {
      const approval = store.run.metadata.approval as ApprovalContext;
      store.run.metadata = {
        ...store.run.metadata,
        approval: { ...approval, gateId: 'gate-b', phase: 'opening' },
      };
      return originalResolve(id, expected, metadata, events);
    };

    await expect(
      runPlannotatorGateSupervisor(baseDeps(store, { spawnAnnotate: async () => child }))
    ).resolves.toEqual({ kind: 'superseded' });
    expect(store.events.some(event => event.event_type === 'node_completed')).toBe(false);
  });

  test('approval survives a concurrent phase transition', async () => {
    const store = new FakeGateStore('run-phase-vs-approval');
    const child = makeChild({ exitCode: 0, stdout: '', delayMs: 60_000 });
    const originalTransition = store.transitionPlannotatorGate;
    let raced = false;
    store.transitionPlannotatorGate = async input => {
      if (!raced && input.phase === 'waiting_decision') {
        raced = true;
        store.externalApprove('won-the-race');
      }
      return originalTransition(input);
    };

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, { captureResponse: true, spawnAnnotate: async () => child })
    );

    expect(result).toEqual({ kind: 'approved', output: 'won-the-race' });
    expect((store.run.metadata.approval as ApprovalContext).resolved).toBe('approved');
    expect(store.events.filter(event => event.event_type === 'node_completed')).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Concurrency / race coverage (fix round 1)
  // ---------------------------------------------------------------------------

  test('external approve during rework wins; phase updates do not wipe resolved', async () => {
    const store = new FakeGateStore('run-mid-rework-approve');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"annotated","feedback":"nits"}',
    });
    const rework = deferred<string>();
    let reworkStarted = false;
    const reworkStartedGate = deferred<void>();

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate: async () => child,
        runReworkAgent: async () => {
          reworkStarted = true;
          reworkStartedGate.resolve();
          return rework.promise;
        },
        pollIntervalMs: 10,
      })
    );

    await reworkStartedGate.promise;
    expect(reworkStarted).toBe(true);
    // External approve while rework agent is in flight.
    expect(store.externalApprove('from-cli-mid-rework')).toBe(true);
    // Rework eventually returns a new path — must not re-open the gate.
    rework.resolve('/tmp/proj/artifacts/plan-v2.html');

    const result = await supervisor;
    expect(result.output).toBe('from-cli-mid-rework');
    const approval = store.run.metadata.approval as ApprovalContext;
    expect(approval.resolved).toBe('approved');
    const completed = store.events.filter(e => e.event_type === 'node_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.data?.node_output).toBe('from-cli-mid-rework');
    expect(store.run.status).toBe('running');
  });

  test('rework failure after external approve still completes (does not throw)', async () => {
    const store = new FakeGateStore('run-rework-fail-after-approve');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"annotated","feedback":"nits"}',
    });
    const rework = deferred<string>();
    const reworkStartedGate = deferred<void>();

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate: async () => child,
        runReworkAgent: async () => {
          reworkStartedGate.resolve();
          return rework.promise;
        },
        pollIntervalMs: 10,
      })
    );

    await reworkStartedGate.promise;
    store.externalApprove('approved-before-rework-error');
    // Rework fails with empty path after external already won.
    rework.resolve('   \n');

    const result = await supervisor;
    expect(result.output).toBe('approved-before-rework-error');
    expect(store.run.status).toBe('running');
    expect(store.events.filter(e => e.event_type === 'node_completed')).toHaveLength(1);
  });

  test('child approve CAS loses to external — single node_completed', async () => {
    const store = new FakeGateStore('run-double-approve');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"from-child"}',
    });

    const originalResolve = store.resolveApprovalGate;
    store.resolveApprovalGate = async (id, expected, metadata, events) => {
      // External wins first (simulates concurrent approveWorkflow).
      store.externalApprove('from-external');
      return originalResolve(id, expected, metadata, events);
    };

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate: async () => child,
      })
    );

    // External comment wins; child CAS lost.
    expect(result.output).toBe('from-external');
    expect(store.events.filter(e => e.event_type === 'node_completed')).toHaveLength(1);
    expect(store.run.status).toBe('running');
  });

  test('child approve CAS loses to external reject — aborts, does not complete', async () => {
    const store = new FakeGateStore('run-child-approve-vs-reject');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"approved","feedback":"from-child"}',
    });

    const originalResolve = store.resolveApprovalGate;
    store.resolveApprovalGate = async (id, expected, metadata, events) => {
      // Concurrent reject wins the open gate before child CAS.
      store.externalReject('nope');
      return originalResolve(id, expected, metadata, events);
    };

    await expect(
      runPlannotatorGateSupervisor(
        baseDeps(store, {
          captureResponse: true,
          spawnAnnotate: async () => child,
        })
      )
    ).rejects.toThrow(/rejected/i);

    const approval = store.run.metadata.approval as ApprovalContext;
    expect(approval.resolved).toBe('rejected');
    // Reject path does not write node_completed.
    expect(store.events.some(e => e.event_type === 'node_completed')).toBe(false);
    // Must not have resumed as a successful approve.
    expect(store.run.status).toBe('paused');
  });

  test('rework fail: external approve during idle setPhase still completes', async () => {
    const store = new FakeGateStore('run-rework-fail-setphase-approve');
    const child = makeChild({
      exitCode: 0,
      stdout: '{"decision":"annotated","feedback":"nits"}',
    });

    const originalTransition = store.transitionPlannotatorGate;
    store.transitionPlannotatorGate = async input => {
      if (input.phase === 'idle') {
        store.externalApprove('approved-during-idle-phase');
      }
      return originalTransition(input);
    };

    const result = await runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate: async () => child,
        runReworkAgent: async () => {
          throw new Error('rework agent crashed');
        },
        pollIntervalMs: 10,
      })
    );

    expect(result.output).toBe('approved-during-idle-phase');
    expect(store.run.status).toBe('running');
    expect(store.events.filter(e => e.event_type === 'node_completed')).toHaveLength(1);
  });

  test('ownership rotation after snapshot prevents stale resume', async () => {
    const store = new FakeGateStore('run-already-running');
    const child = makeChild({
      exitCode: 0,
      stdout: '',
      delayMs: 60_000,
    });

    const supervisor = runPlannotatorGateSupervisor(
      baseDeps(store, {
        captureResponse: true,
        spawnAnnotate: async () => child,
        pollIntervalMs: 10,
      })
    );

    await child.waitStarted;
    await Bun.sleep(25);
    store.externalApprove('cli-approved');
    const originalSnapshot = store.getDagResumeSnapshot;
    store.getDagResumeSnapshot = async runId => {
      const snapshot = await originalSnapshot(runId);
      const approval = store.run.metadata.approval as ApprovalContext;
      store.run.metadata = {
        ...store.run.metadata,
        approval: { ...approval, gateId: 'gate-b', phase: 'opening', resolved: null },
      };
      return snapshot;
    };

    const result = await supervisor;
    expect(result).toEqual({ kind: 'superseded' });
    expect(store.run.status).toBe('paused');
    expect(child.killed).toBe(true);
  });
});
