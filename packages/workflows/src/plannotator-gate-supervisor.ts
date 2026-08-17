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
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ApprovalContext, WorkflowRun } from './schemas/workflow-run';
import type { IWorkflowStore } from './store';
import {
  buildAnnotateArgv,
  buildPlannotatorSpawnArgv,
  parseDocumentPathFromNodeOutput,
  parsePlannotatorGateDecisionJson,
  resolvePlannotatorBinary,
} from './plannotator-gate';

const log = createLogger('workflow.plannotator-gate');

export interface AnnotateChildHandle {
  reviewUrl?: Promise<string>;
  wait: () => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    resultFilePayload: string | undefined;
    resultFileError?: string;
    resultFileCleanupError?: string;
  }>;
  kill: () => void;
}

export interface PlannotatorGateSupervisorDeps {
  runId: string;
  nodeId: string;
  stepName: string;
  gateId: string;
  cwd: string;
  artifactsDir: string;
  initialDocumentPath: string;
  captureResponse: boolean;
  message: string;
  store: IWorkflowStore;
  /** Spawn rework AI; must return path string (contract B) on success */
  runReworkAgent: (args: { documentPath: string; annotations: string }) => Promise<string>;
  /** Injectable for tests; default uses Bun.spawn + resolvePlannotatorBinary */
  spawnAnnotate?: (documentPath: string, resultFilePath: string) => Promise<AnnotateChildHandle>;
  pollIntervalMs?: number;
}

interface Exit {
  exitCode: number;
  stdout: string;
  stderr: string;
  resultFilePayload: string | undefined;
  resultFileError?: string;
  resultFileCleanupError?: string;
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
    ((documentPath: string, resultFilePath: string): Promise<AnnotateChildHandle> =>
      defaultSpawnAnnotate(documentPath, resultFilePath, deps.cwd));

  let documentPath = deps.initialDocumentPath;
  let child: AnnotateChildHandle | null = null;
  let childDone: Promise<Exit> | null = null;
  let childResult: Exit | undefined;
  let phase: Phase = 'waiting_decision';
  let attempt = 0;

  await deps.store.pauseWorkflowRun(deps.runId, {
    type: 'plannotator_gate',
    nodeId: deps.nodeId,
    gateId: deps.gateId,
    message: deps.message,
    captureResponse: deps.captureResponse,
    document: documentPath,
    phase: 'waiting_decision',
    reviewUrl: null,
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
        attempt += 1;
        const resultFilePath = join(
          deps.artifactsDir,
          'plannotator-gates',
          `gate-${encodeURIComponent(deps.gateId)}-attempt-${attempt}.json`
        );
        child = await spawn(documentPath, resultFilePath);
        childResult = undefined;
        childDone = child.wait().then(r => {
          childResult = r;
          return r;
        });
        childDone.catch(() => undefined);
        let reviewUrl: string | undefined;
        if (child.reviewUrl) {
          try {
            reviewUrl = await child.reviewUrl;
          } catch (err) {
            const duringOpening = await checkResolved(deps);
            const duringOpeningResult = await finishGateOutcome(deps, duringOpening);
            if (duringOpeningResult) {
              dropChild();
              return duringOpeningResult;
            }
            throw err;
          }
        }
        phase = 'waiting_decision';
        const waiting = await setPhase(deps, documentPath, 'waiting_decision', reviewUrl);
        const waitingResult = await finishGateOutcome(deps, waiting);
        if (waitingResult) {
          dropChild();
          return waitingResult;
        }
        if (reviewUrl !== undefined) {
          try {
            await deps.store.createWorkflowEvent({
              workflow_run_id: deps.runId,
              event_type: 'approval_requested',
              step_name: deps.stepName,
              data: {
                gateType: 'plannotator_gate',
                nodeId: deps.nodeId,
                message: deps.message,
                reviewUrl,
              },
            });
          } catch (err) {
            log.error(
              { err: err as Error, workflowRunId: deps.runId, nodeId: deps.nodeId },
              'plannotator_gate.approval_event_persist_failed'
            );
          }
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

        if (exited.exitCode !== 0) {
          throw processProtocolError(
            deps,
            exited,
            `plannotator annotate exited with code ${exited.exitCode}`
          );
        }
        if (exited.resultFileError !== undefined) {
          throw processProtocolError(
            deps,
            exited,
            `plannotator annotate result file could not be read: ${exited.resultFileError}`
          );
        }
        if (exited.resultFilePayload === undefined) {
          throw processProtocolError(deps, exited, 'plannotator annotate result file is missing');
        }

        let decision;
        try {
          decision = parsePlannotatorGateDecisionJson(exited.resultFilePayload);
        } catch (err) {
          throw processProtocolError(
            deps,
            exited,
            `plannotator annotate result file is invalid: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        if (exited.resultFileCleanupError !== undefined) {
          throw processProtocolError(
            deps,
            exited,
            `plannotator annotate result file cleanup failed: ${exited.resultFileCleanupError.trim().slice(0, 4096)}`
          );
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
  phase: Phase,
  reviewUrl?: string
): Promise<GateOutcome> {
  const result = await deps.store.transitionPlannotatorGate({
    runId: deps.runId,
    nodeId: deps.nodeId,
    expectedGateId: deps.gateId,
    document,
    phase,
    reviewUrl: reviewUrl ?? null,
  });
  if (result.outcome === 'updated') return 'continue';
  if (result.outcome === 'resolved') return result.resolved;
  if (result.outcome === 'superseded') return 'superseded';
  const run = await requireRun(deps.store, deps.runId);
  if (!ownsGate(deps, readApproval(run))) return 'superseded';
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
  resultFilePath: string,
  cwd: string
): Promise<AnnotateChildHandle> {
  await mkdir(dirname(resultFilePath), { recursive: true });
  const readyFilePath = `${resultFilePath}.ready`;
  await Promise.all([rm(resultFilePath, { force: true }), rm(readyFilePath, { force: true })]);
  const configuredBinary = resolvePlannotatorBinary();
  const binary = Bun.which(configuredBinary) ?? configuredBinary;
  const proc = Bun.spawn(
    buildPlannotatorSpawnArgv(binary, buildAnnotateArgv(documentPath, resultFilePath)),
    {
      cwd,
      env: { ...process.env, PLANNOTATOR_READY_FILE: readyFilePath },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const reviewUrl = waitForReviewUrl(readyFilePath, proc.exited);
  return {
    reviewUrl,
    wait: async (): Promise<Exit> => {
      const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve('');
      const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve('');
      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      let resultFilePayload: string | undefined;
      let resultFileError: string | undefined;
      let resultFileCleanupError: string | undefined;
      try {
        resultFilePayload = await readFile(resultFilePath, 'utf8');
      } catch (err) {
        if (!isMissingFileError(err)) {
          resultFileError = err instanceof Error ? err.message : String(err);
        }
      } finally {
        const cleanupErrors: string[] = [];
        await reviewUrl.catch(() => undefined);
        for (const path of [resultFilePath, readyFilePath]) {
          try {
            await rm(path, { force: true });
          } catch (err) {
            cleanupErrors.push(err instanceof Error ? err.message : String(err));
          }
        }
        resultFileCleanupError = cleanupErrors.length > 0 ? cleanupErrors.join('; ') : undefined;
      }
      return {
        exitCode,
        stdout,
        stderr,
        resultFilePayload,
        resultFileError,
        resultFileCleanupError,
      };
    },
    kill: (): void => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    },
  };
}

async function waitForReviewUrl(readyFilePath: string, exited: Promise<number>): Promise<string> {
  let processExited = false;
  void exited.then(
    () => {
      processExited = true;
    },
    () => {
      processExited = true;
    }
  );
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      return parseReviewUrl(await readFile(readyFilePath, 'utf8'));
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
    }
    if (processExited) {
      throw new Error('plannotator annotate exited before publishing its review URL');
    }
    if (Date.now() >= deadline) {
      throw new Error('plannotator annotate did not publish its review URL within 30 seconds');
    }
    await sleep(50);
  }
}

function parseReviewUrl(payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.trim());
  } catch {
    throw new Error('plannotator ready file is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('plannotator ready file must contain a JSON object');
  }
  const rawReviewUrl = (parsed as Record<string, unknown>).url;
  if (typeof rawReviewUrl !== 'string') {
    throw new Error('plannotator ready file does not contain a URL');
  }
  const reviewUrl = rawReviewUrl.trim();
  let url: URL;
  try {
    url = new URL(reviewUrl);
  } catch {
    throw new Error('plannotator ready file contains an invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('plannotator ready file URL must use HTTP or HTTPS');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('plannotator ready file URL must not include credentials');
  }
  return reviewUrl;
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function processProtocolError(
  deps: PlannotatorGateSupervisorDeps,
  exited: Exit,
  message: string
): Error {
  const stderr = exited.stderr.trim().slice(0, 4096);
  log.warn(
    {
      workflowRunId: deps.runId,
      nodeId: deps.nodeId,
      exitCode: exited.exitCode,
      error: message,
      ...(stderr ? { stderr } : {}),
    },
    'plannotator_gate.process_protocol_failed'
  );
  return new Error(`${message}${stderr ? `: ${stderr}` : ''}`);
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
