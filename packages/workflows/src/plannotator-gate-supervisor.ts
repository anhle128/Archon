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
 * continues without a second auto-resume process.
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
  /** Injectable for tests; default uses Bun.spawn + resolvePlannotatorBinary */
  spawnAnnotate?: (documentPath: string) => Promise<AnnotateChildHandle>;
  pollIntervalMs?: number;
}

interface Exit {
  exitCode: number;
  stdout: string;
}
type Phase = NonNullable<ApprovalContext['phase']>;

/** Run until the gate is approved; throws on cancel / hard rework failure. */
export async function runPlannotatorGateSupervisor(
  deps: PlannotatorGateSupervisorDeps
): Promise<{ output: string }> {
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
      const run = await requireRun(deps.store, deps.runId);
      assertNotTerminal(run);
      const approval = readApproval(run);

      if (approval?.resolved === 'approved') {
        dropChild();
        return await completeApproved(deps, approval);
      }
      if (approval?.resolved === 'rejected') {
        dropChild();
        throw new Error(`plannotator gate '${deps.nodeId}' was rejected`);
      }

      // review-open (or equivalent) flips phase back to opening while idle.
      if (phase === 'idle' && approval?.phase === 'opening') phase = 'opening';

      if (!child && phase !== 'idle') {
        await setPhase(deps, documentPath, 'opening');
        child = await spawn(documentPath);
        childResult = undefined;
        childDone = child.wait().then(r => {
          childResult = r;
          return r;
        });
        childDone.catch(() => undefined);
        phase = 'waiting_decision';
        await setPhase(deps, documentPath, 'waiting_decision');
      }

      if (child && childDone) {
        await Promise.race([childDone, sleep(pollMs)]);

        // Prefer external resolution over a concurrent child exit.
        const latest = await requireRun(deps.store, deps.runId);
        assertNotTerminal(latest);
        const latestApproval = readApproval(latest);
        if (latestApproval?.resolved === 'approved') {
          dropChild();
          return await completeApproved(deps, latestApproval);
        }
        if (latestApproval?.resolved === 'rejected') {
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
          await setPhase(deps, documentPath, 'idle');
          continue;
        }

        if (decision.kind === 'approved') {
          const output = await recordApproval(deps, decision.feedback);
          await deps.store.resumeWorkflowRun(deps.runId);
          return { output };
        }

        if (decision.kind === 'annotated') {
          phase = 'reworking';
          await setPhase(deps, documentPath, 'reworking');
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
            documentPath = parseDocumentPathFromNodeOutput(raw);
          } catch (err) {
            // Stay paused; do not approve. Surface controlled error to the node.
            phase = 'idle';
            await setPhase(deps, documentPath, 'idle');
            throw err instanceof Error
              ? err
              : new Error(`plannotator gate rework failed: ${String(err)}`);
          }
          phase = 'waiting_decision';
          await setPhase(deps, documentPath, 'waiting_decision');
          continue;
        }

        // stock dismissed (Close without --persist-session)
        phase = 'idle';
        await setPhase(deps, documentPath, 'idle');
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

async function completeApproved(
  deps: PlannotatorGateSupervisorDeps,
  approval: ApprovalContext
): Promise<{ output: string }> {
  const output = await readApprovedOutput(deps, approval);
  await deps.store.resumeWorkflowRun(deps.runId);
  return { output };
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

async function setPhase(
  deps: PlannotatorGateSupervisorDeps,
  document: string,
  phase: Phase
): Promise<void> {
  const run = await requireRun(deps.store, deps.runId);
  const current = readApproval(run) ?? {
    type: 'plannotator_gate' as const,
    nodeId: deps.nodeId,
    message: deps.message,
    captureResponse: deps.captureResponse,
    resolved: null,
  };
  await deps.store.updateWorkflowRun(deps.runId, {
    metadata: {
      approval: {
        ...current,
        document,
        phase,
        type: 'plannotator_gate',
        nodeId: deps.nodeId,
      },
    },
  });
}

async function readApprovedOutput(
  deps: PlannotatorGateSupervisorDeps,
  approval: ApprovalContext
): Promise<string> {
  const snapshot = await deps.store.getDagResumeSnapshot(deps.runId);
  if (snapshot.completedNodeOutputs.has(deps.nodeId)) {
    return snapshot.completedNodeOutputs.get(deps.nodeId) ?? '';
  }
  return approval.captureResponse === true ? 'Approved' : '';
}

/** Same resolution shape as standard approval approve; leaves status paused. */
async function recordApproval(
  deps: PlannotatorGateSupervisorDeps,
  feedback: string
): Promise<string> {
  const run = await requireRun(deps.store, deps.runId);
  const approval = readApproval(run);
  if (approval?.resolved === 'approved') return readApprovedOutput(deps, approval);

  const approvalComment = feedback.trim().length > 0 ? feedback : 'Approved';
  const nodeOutput = deps.captureResponse ? approvalComment : '';
  const base = approval ?? {
    type: 'plannotator_gate' as const,
    nodeId: deps.nodeId,
    message: deps.message,
    captureResponse: deps.captureResponse,
  };

  await deps.store.updateWorkflowRun(deps.runId, {
    metadata: {
      approval: { ...base, resolved: 'approved', type: 'plannotator_gate', nodeId: deps.nodeId },
      approval_response: 'approved',
      rejection_reason: '',
      rejection_count: 0,
    },
  });
  await deps.store.createWorkflowEvent({
    workflow_run_id: deps.runId,
    event_type: 'node_completed',
    step_name: deps.nodeId,
    data: { node_output: nodeOutput, approval_decision: 'approved' },
  });
  await deps.store.createWorkflowEvent({
    workflow_run_id: deps.runId,
    event_type: 'approval_received',
    step_name: deps.nodeId,
    data: { decision: 'approved', comment: approvalComment },
  });
  return nodeOutput;
}
