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
 * approval (or observing an external one), this supervisor atomically claims
 * paused→running only while its approved gate identity still matches. A lost
 * claim returns superseded so only the winning executor continues `runLayers`.
 */
import { createLogger } from '@archon/paths';
import type { ApprovalContext, WorkflowRun } from './schemas/workflow-run';
import type { IWorkflowStore } from './store';
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

export interface PlannotatorGateSupervisorDeps {
  runId: string;
  nodeId: string;
  gateId: string;
  cwd: string;
  initialDocumentPath: string;
  captureResponse: boolean;
  message: string;
  store: IWorkflowStore;
  /** Spawn rework AI; must return path string (contract B) on success */
  runReworkAgent: (args: { documentPath: string; annotations: string }) => Promise<string>;
  /** Injectable for tests; default uses Bun.spawn + resolvePlannotatorBinary */
  spawnAnnotate?: (documentPath: string) => Promise<AnnotateChildHandle>;
  pollIntervalMs?: number;
}

interface Exit {
  exitCode: number;
  stdout: string;
}
type Phase = NonNullable<ApprovalContext['phase']>;
type GateOutcome = 'continue' | 'approved' | 'rejected' | 'superseded';

export type PlannotatorGateSupervisorResult =
  | { kind: 'approved'; output: string }
  | { kind: 'superseded' };

/** Run until the gate is approved; throws on cancel / hard rework failure. */
export async function runPlannotatorGateSupervisor(
  deps: PlannotatorGateSupervisorDeps
): Promise<PlannotatorGateSupervisorResult> {
  const pollMs = deps.pollIntervalMs ?? 250;
  const spawn =
    deps.spawnAnnotate ??
    ((p: string): Promise<AnnotateChildHandle> => defaultSpawnAnnotate(p, deps.cwd));

  let documentPath = deps.initialDocumentPath;
  let child: AnnotateChildHandle | null = null;
  let childDone: Promise<Exit> | null = null;
  let childResult: Exit | undefined;
  let phase: Phase = 'waiting_decision';

  await deps.store.pauseWorkflowRun(deps.runId, {
    type: 'plannotator_gate',
    nodeId: deps.nodeId,
    gateId: deps.gateId,
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
      const earlyResult = await finishGateOutcome(deps, early);
      if (earlyResult) {
        dropChild();
        return earlyResult;
      }

      const run = await requireRun(deps.store, deps.runId);
      assertNotTerminal(run);
      const approval = readApproval(run);

      // review-open (or equivalent) flips phase back to opening while idle.
      if (phase === 'idle' && approval?.phase === 'opening') phase = 'opening';

      if (!child && phase !== 'idle') {
        const open = await setPhase(deps, documentPath, 'opening');
        const openResult = await finishGateOutcome(deps, open);
        if (openResult) {
          dropChild();
          return openResult;
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
        const waitingResult = await finishGateOutcome(deps, waiting);
        if (waitingResult) {
          dropChild();
          return waitingResult;
        }
      }

      if (child && childDone) {
        await Promise.race([childDone, sleep(pollMs)]);

        const mid = await checkResolved(deps);
        const midResult = await finishGateOutcome(deps, mid);
        if (midResult) {
          dropChild();
          return midResult;
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
          const idleResult = await finishGateOutcome(deps, idleOut);
          if (idleResult) return idleResult;
          continue;
        }

        if (decision.kind === 'approved') {
          const recorded = await recordApproval(deps, decision.feedback);
          const recordedResult = await finishGateOutcome(deps, recorded);
          if (recordedResult) return recordedResult;
          throw new Error(`plannotator gate '${deps.nodeId}' approval was not recorded`);
        }

        if (decision.kind === 'annotated') {
          phase = 'reworking';
          const reworkPhase = await setPhase(deps, documentPath, 'reworking');
          const reworkResult = await finishGateOutcome(deps, reworkPhase);
          if (reworkResult) return reworkResult;

          try {
            const raw = await deps.runReworkAgent({
              documentPath,
              annotations: decision.feedback,
            });
            // External approve may have won during rework — prefer that over new path.
            const afterRework = await checkResolved(deps);
            const afterReworkResult = await finishGateOutcome(deps, afterRework);
            if (afterReworkResult) return afterReworkResult;
            documentPath = parseDocumentPathFromNodeOutput(raw);
          } catch (err) {
            const afterFail = await checkResolved(deps);
            const afterFailResult = await finishGateOutcome(deps, afterFail);
            if (afterFailResult) return afterFailResult;
            // Stay paused; do not approve. Surface controlled error to the node.
            // External approve may land during setPhase — honor that outcome.
            phase = 'idle';
            const idleAfterFail = await setPhase(deps, documentPath, 'idle');
            const idleAfterFailResult = await finishGateOutcome(deps, idleAfterFail);
            if (idleAfterFailResult) return idleAfterFailResult;
            throw err instanceof Error
              ? err
              : new Error(`plannotator gate rework failed: ${String(err)}`);
          }

          phase = 'waiting_decision';
          const next = await setPhase(deps, documentPath, 'waiting_decision');
          const nextResult = await finishGateOutcome(deps, next);
          if (nextResult) return nextResult;
          continue;
        }

        // stock dismissed (Close without --persist-session)
        phase = 'idle';
        const dismissed = await setPhase(deps, documentPath, 'idle');
        const dismissedResult = await finishGateOutcome(deps, dismissed);
        if (dismissedResult) return dismissedResult;
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
  if (!approval || !ownsGate(deps, approval)) return 'superseded';
  if (approval?.resolved === 'approved') return 'approved';
  if (approval?.resolved === 'rejected') return 'rejected';
  return 'continue';
}

async function finishGateOutcome(
  deps: PlannotatorGateSupervisorDeps,
  outcome: GateOutcome
): Promise<PlannotatorGateSupervisorResult | undefined> {
  if (outcome === 'continue') return undefined;
  if (outcome === 'superseded') return { kind: 'superseded' };
  if (outcome === 'rejected') {
    throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
  }
  return completeApproved(deps);
}

async function completeApproved(
  deps: PlannotatorGateSupervisorDeps
): Promise<PlannotatorGateSupervisorResult> {
  const run = await requireRun(deps.store, deps.runId);
  const approval = readApproval(run);
  if (!ownsGate(deps, approval)) return { kind: 'superseded' };
  const output = await readApprovedOutput(deps, approval);
  const { resumed } = await deps.store.resumeApprovedGate(deps.runId, {
    nodeId: deps.nodeId,
    gateId: deps.gateId,
  });
  if (!resumed) return { kind: 'superseded' };
  return { kind: 'approved', output };
}

async function setPhase(
  deps: PlannotatorGateSupervisorDeps,
  document: string,
  phase: Phase
): Promise<GateOutcome> {
  const result = await deps.store.transitionPlannotatorGate({
    runId: deps.runId,
    nodeId: deps.nodeId,
    expectedGateId: deps.gateId,
    document,
    phase,
  });
  if (result.outcome === 'updated') return 'continue';
  if (result.outcome === 'resolved') return result.resolved;
  if (result.outcome === 'superseded') return 'superseded';
  throw new Error(`plannotator gate aborted: run '${deps.runId}' is ${result.status}`);
}

async function recordApproval(
  deps: PlannotatorGateSupervisorDeps,
  feedback: string
): Promise<GateOutcome> {
  const run = await requireRun(deps.store, deps.runId);
  assertNotTerminal(run);
  const approval = readApproval(run);
  if (!approval || !ownsGate(deps, approval)) return 'superseded';
  if (approval.resolved === 'approved') return 'approved';
  if (approval.resolved === 'rejected') return 'rejected';
  const approvalComment = feedback.trim().length > 0 ? feedback : 'Approved';
  const nodeOutput = deps.captureResponse ? approvalComment : '';
  const { resolved } = await deps.store.resolveApprovalGate(
    deps.runId,
    { nodeId: deps.nodeId, gateId: deps.gateId },
    {
      approval: {
        ...approval,
        resolved: 'approved',
        type: 'plannotator_gate',
        nodeId: deps.nodeId,
        gateId: deps.gateId,
      },
      approval_response: 'approved',
      rejection_reason: '',
      rejection_count: 0,
    },
    [
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
    ]
  );
  return resolved ? 'approved' : checkResolved(deps);
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

function ownsGate(
  deps: PlannotatorGateSupervisorDeps,
  approval: ApprovalContext | undefined
): boolean {
  return approval?.nodeId === deps.nodeId && approval.gateId === deps.gateId;
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
