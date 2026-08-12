/**
 * Supervisor loop for plannotator_gate nodes.
 *
 * Pauses the run, spawns `plannotator annotate --gate --json --persist-session`,
 * and maps child decisions (or external approve/reject/abandon) onto gate
 * resolution. Stays in-process while the durable gate is paused so rework can
 * iterate without a second executor process.
 *
 * Resume-after-approve: standard gate approve leaves status `paused`, and the
 * DAG between-layer check stops when status !== `running`. After recording
 * approval (or observing an external one), this supervisor calls
 * `resumeWorkflowRun` before returning so the in-process `runLayers` call
 * continues. Resume is idempotent when another surface already flipped the run
 * to `running`.
 */
import { createLogger } from '@archon/paths';
import type { ApprovalContext, WorkflowRun } from './schemas/workflow-run';
import type { IWorkflowStore, WorkflowEventType } from './store';
import {
  buildAnnotateArgv,
  parseDocumentPathFromNodeOutput,
  parsePlannotatorGateDecisionJson,
  resolvePlannotatorBinary,
} from './plannotator-gate';

const log = createLogger('workflow.plannotator-gate');

export interface AnnotateChildHandle {
  wait: () => Promise<{ exitCode: number; stdout: string }>;
  kill: () => void;
}

/** One audit event written atomically with a gate resolution (CAS). */
export interface GateResolutionEvent {
  event_type: WorkflowEventType;
  step_name: string;
  data: Record<string, unknown>;
}

/**
 * Atomic gate resolution — wrap core `resolveApprovalGate` in production.
 * Returns `{ won: true }` only for the caller that stamped the open gate.
 */
export type ResolveGateFn = (input: {
  metadata: Record<string, unknown>;
  events: GateResolutionEvent[];
}) => Promise<{ won: boolean }>;

export interface PlannotatorGateSupervisorDeps {
  runId: string;
  nodeId: string;
  cwd: string;
  initialDocumentPath: string;
  captureResponse: boolean;
  reworkPromptTemplate: string;
  message: string;
  store: IWorkflowStore;
  /** Spawn rework AI; must return path string (contract B) on success */
  runReworkAgent: (args: {
    prompt: string;
    documentPath: string;
    annotations: string;
  }) => Promise<string>;
  /**
   * Atomic approval CAS (preferred: core resolveApprovalGate).
   * When omitted, a store read/check/write fallback is used — inject CAS for
   * multi-surface installs.
   */
  resolveGate?: ResolveGateFn;
  /** Injectable for tests; default uses Bun.spawn + resolvePlannotatorBinary */
  spawnAnnotate?: (documentPath: string) => Promise<AnnotateChildHandle>;
  pollIntervalMs?: number;
}

interface Exit {
  exitCode: number;
  stdout: string;
}
type Phase = NonNullable<ApprovalContext['phase']>;
type GateOutcome = 'continue' | 'approved' | 'rejected';

/** Run until the gate is approved; throws on cancel / hard rework failure. */
export async function runPlannotatorGateSupervisor(
  deps: PlannotatorGateSupervisorDeps
): Promise<{ output: string }> {
  const pollMs = deps.pollIntervalMs ?? 250;
  const spawn =
    deps.spawnAnnotate ??
    ((p: string): Promise<AnnotateChildHandle> => defaultSpawnAnnotate(p, deps.cwd));
  const resolveGate: ResolveGateFn =
    deps.resolveGate ?? ((input): Promise<{ won: boolean }> => fallbackResolveGate(deps, input));

  let documentPath = deps.initialDocumentPath;
  let child: AnnotateChildHandle | null = null;
  let childDone: Promise<Exit> | null = null;
  let childResult: Exit | undefined;
  let phase: Phase = 'waiting_decision';

  await deps.store.pauseWorkflowRun(deps.runId, {
    type: 'plannotator_gate',
    nodeId: deps.nodeId,
    message: deps.message,
    captureResponse: deps.captureResponse,
    document: documentPath,
    phase: 'waiting_decision',
    resolved: null,
  });

  const dropChild = (): void => {
    killChild(child);
    child = null;
    childDone = null;
    childResult = undefined;
  };

  try {
    while (true) {
      const early = await checkResolved(deps);
      if (early === 'approved') {
        dropChild();
        return await completeApproved(deps);
      }
      if (early === 'rejected') {
        dropChild();
        throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
      }

      const run = await requireRun(deps.store, deps.runId);
      assertNotTerminal(run);
      const approval = readApproval(run);

      // review-open (or equivalent) flips phase back to opening while idle.
      if (phase === 'idle' && approval?.phase === 'opening') phase = 'opening';

      if (!child && phase !== 'idle') {
        const open = await setPhase(deps, documentPath, 'opening');
        if (open === 'approved') {
          dropChild();
          return await completeApproved(deps);
        }
        if (open === 'rejected') {
          dropChild();
          throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
        }
        child = await spawn(documentPath);
        childResult = undefined;
        childDone = child.wait().then(r => {
          childResult = r;
          return r;
        });
        childDone.catch(() => undefined);
        phase = 'waiting_decision';
        const waiting = await setPhase(deps, documentPath, 'waiting_decision');
        if (waiting === 'approved') {
          dropChild();
          return await completeApproved(deps);
        }
        if (waiting === 'rejected') {
          dropChild();
          throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
        }
      }

      if (child && childDone) {
        await Promise.race([childDone, sleep(pollMs)]);

        const mid = await checkResolved(deps);
        if (mid === 'approved') {
          dropChild();
          return await completeApproved(deps);
        }
        if (mid === 'rejected') {
          dropChild();
          throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
        }
        if (childResult === undefined) continue;

        const exited = childResult;
        dropChild();

        let decision;
        try {
          decision = parsePlannotatorGateDecisionJson(exited.stdout);
        } catch (err) {
          log.warn(
            {
              workflowRunId: deps.runId,
              nodeId: deps.nodeId,
              exitCode: exited.exitCode,
              error: (err as Error).message,
            },
            'plannotator_gate.decision_parse_failed'
          );
          phase = 'idle';
          const idleOut = await setPhase(deps, documentPath, 'idle');
          if (idleOut === 'approved') return await completeApproved(deps);
          if (idleOut === 'rejected') {
            throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
          }
          continue;
        }

        if (decision.kind === 'approved') {
          await recordApproval(deps, resolveGate, decision.feedback);
          // CAS win or external approve → complete. External reject/cancel must not complete.
          const afterRecord = await checkResolved(deps);
          if (afterRecord === 'rejected') {
            throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
          }
          return await completeApproved(deps);
        }

        if (decision.kind === 'annotated') {
          phase = 'reworking';
          const reworkPhase = await setPhase(deps, documentPath, 'reworking');
          if (reworkPhase === 'approved') return await completeApproved(deps);
          if (reworkPhase === 'rejected') {
            throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
          }

          const prompt = deps.reworkPromptTemplate
            .split('$REVIEW_DOCUMENT')
            .join(documentPath)
            .split('$REVIEW_ANNOTATIONS')
            .join(decision.feedback);

          try {
            const raw = await deps.runReworkAgent({
              prompt,
              documentPath,
              annotations: decision.feedback,
            });
            // External approve may have won during rework — prefer that over new path.
            const afterRework = await checkResolved(deps);
            if (afterRework === 'approved') return await completeApproved(deps);
            if (afterRework === 'rejected') {
              throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
            }
            documentPath = parseDocumentPathFromNodeOutput(raw);
          } catch (err) {
            const afterFail = await checkResolved(deps);
            if (afterFail === 'approved') return await completeApproved(deps);
            if (afterFail === 'rejected') {
              throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
            }
            // Stay paused; do not approve. Surface controlled error to the node.
            // External approve may land during setPhase — honor that outcome.
            phase = 'idle';
            const idleAfterFail = await setPhase(deps, documentPath, 'idle');
            if (idleAfterFail === 'approved') return await completeApproved(deps);
            if (idleAfterFail === 'rejected') {
              throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
            }
            throw err instanceof Error
              ? err
              : new Error(`plannotator gate rework failed: ${String(err)}`);
          }

          phase = 'waiting_decision';
          const next = await setPhase(deps, documentPath, 'waiting_decision');
          if (next === 'approved') return await completeApproved(deps);
          if (next === 'rejected') {
            throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
          }
          continue;
        }

        // stock dismissed (Close without --persist-session)
        phase = 'idle';
        const dismissed = await setPhase(deps, documentPath, 'idle');
        if (dismissed === 'approved') return await completeApproved(deps);
        if (dismissed === 'rejected') {
          throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
        }
        continue;
      }

      await sleep(pollMs);
    }
  } catch (err) {
    dropChild();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function checkResolved(deps: PlannotatorGateSupervisorDeps): Promise<GateOutcome> {
  const run = await requireRun(deps.store, deps.runId);
  assertNotTerminal(run);
  const approval = readApproval(run);
  if (approval?.resolved === 'approved') return 'approved';
  if (approval?.resolved === 'rejected') return 'rejected';
  return 'continue';
}

async function completeApproved(deps: PlannotatorGateSupervisorDeps): Promise<{ output: string }> {
  const run = await requireRun(deps.store, deps.runId);
  const approval = readApproval(run);
  const output = await readApprovedOutput(deps, approval);
  await resumeAfterGate(deps);
  return { output };
}

/**
 * Resume is best-effort: another surface (CLI/web auto-resume) may already have
 * flipped the run to `running`. Never convert a won approve into a failed node.
 */
async function resumeAfterGate(deps: PlannotatorGateSupervisorDeps): Promise<void> {
  const status = await deps.store.getWorkflowRunStatus(deps.runId);
  if (status === 'running') return;
  try {
    await deps.store.resumeWorkflowRun(deps.runId);
  } catch (err) {
    const again = await deps.store.getWorkflowRunStatus(deps.runId);
    if (again === 'running') return;
    throw err;
  }
}

/**
 * Phase/document patch. Never writes when the gate is already resolved, and
 * never stamps `resolved: null` (would clear a concurrent approve on deep-merge
 * dialects). Re-reads after write so a concurrent stamp wins.
 */
async function setPhase(
  deps: PlannotatorGateSupervisorDeps,
  document: string,
  phase: Phase
): Promise<GateOutcome> {
  const run = await requireRun(deps.store, deps.runId);
  assertNotTerminal(run);
  const current = readApproval(run);
  if (current?.resolved === 'approved') return 'approved';
  if (current?.resolved === 'rejected') return 'rejected';

  // Omit `resolved` entirely on phase-only writes so deep-merge dialects keep a
  // concurrent stamp; never write resolved:null (would clear an external approve).
  const next: ApprovalContext = {
    type: 'plannotator_gate',
    nodeId: deps.nodeId,
    message: current?.message ?? deps.message,
    captureResponse: current?.captureResponse ?? deps.captureResponse,
    document,
    phase,
  };

  await deps.store.updateWorkflowRun(deps.runId, {
    metadata: { approval: next },
  });

  return checkResolved(deps);
}

async function recordApproval(
  deps: PlannotatorGateSupervisorDeps,
  resolveGate: ResolveGateFn,
  feedback: string
): Promise<void> {
  const run = await requireRun(deps.store, deps.runId);
  const approval = readApproval(run);
  if (approval?.resolved === 'approved' || approval?.resolved === 'rejected') {
    return; // external already won — single complete
  }

  const approvalComment = feedback.trim().length > 0 ? feedback : 'Approved';
  const nodeOutput = deps.captureResponse ? approvalComment : '';
  const base = approval ?? {
    type: 'plannotator_gate' as const,
    nodeId: deps.nodeId,
    message: deps.message,
    captureResponse: deps.captureResponse,
  };

  await resolveGate({
    metadata: {
      approval: {
        ...base,
        resolved: 'approved',
        type: 'plannotator_gate',
        nodeId: deps.nodeId,
      },
      approval_response: 'approved',
      rejection_reason: '',
      rejection_count: 0,
    },
    events: [
      {
        event_type: 'node_completed',
        step_name: deps.nodeId,
        data: { node_output: nodeOutput, approval_decision: 'approved' },
      },
      {
        event_type: 'approval_received',
        step_name: deps.nodeId,
        data: { decision: 'approved', comment: approvalComment },
      },
    ],
  });
  // won or lost: caller completes via completeApproved either way
}

/** Best-effort fallback when deps.resolveGate is not injected (single-writer only). */
async function fallbackResolveGate(
  deps: PlannotatorGateSupervisorDeps,
  input: { metadata: Record<string, unknown>; events: GateResolutionEvent[] }
): Promise<{ won: boolean }> {
  const run = await requireRun(deps.store, deps.runId);
  const approval = readApproval(run);
  if (approval?.resolved === 'approved' || approval?.resolved === 'rejected') {
    return { won: false };
  }
  await deps.store.updateWorkflowRun(deps.runId, { metadata: input.metadata });
  for (const event of input.events) {
    await deps.store.createWorkflowEvent({
      workflow_run_id: deps.runId,
      event_type: event.event_type,
      step_name: event.step_name,
      data: event.data,
    });
  }
  return { won: true };
}

async function defaultSpawnAnnotate(
  documentPath: string,
  cwd: string
): Promise<AnnotateChildHandle> {
  const proc = Bun.spawn([resolvePlannotatorBinary(), ...buildAnnotateArgv(documentPath)], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    wait: async () => ({
      exitCode: await proc.exited,
      stdout: proc.stdout ? await new Response(proc.stdout).text() : '',
    }),
    kill: (): void => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    },
  };
}

function killChild(child: AnnotateChildHandle | null): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requireRun(store: IWorkflowStore, runId: string): Promise<WorkflowRun> {
  const run = await store.getWorkflowRun(runId);
  if (!run) throw new Error(`plannotator gate: workflow run '${runId}' not found`);
  return run;
}

function assertNotTerminal(run: WorkflowRun): void {
  if (run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed') {
    throw new Error(`plannotator gate aborted: run '${run.id}' is ${run.status}`);
  }
}

function readApproval(run: WorkflowRun): ApprovalContext | undefined {
  const raw = run.metadata.approval;
  if (typeof raw !== 'object' || raw === null) return undefined;
  return raw as ApprovalContext;
}

async function readApprovedOutput(
  deps: PlannotatorGateSupervisorDeps,
  approval: ApprovalContext | undefined
): Promise<string> {
  const snapshot = await deps.store.getDagResumeSnapshot(deps.runId);
  if (snapshot.completedNodeOutputs.has(deps.nodeId)) {
    return snapshot.completedNodeOutputs.get(deps.nodeId) ?? '';
  }
  return approval?.captureResponse === true ? 'Approved' : '';
}
