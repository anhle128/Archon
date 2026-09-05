/**
 * Pre-isolation Workflow ENV overlay selection for orchestrator dispatch.
 *
 * Pure: no DB, isolation, or conversation mutation. Callers apply the result
 * after input/requirement gates and before validateAndResolveIsolation().
 */
import {
  applyEnvOverlay,
  cloneAppliedEnvOverlay,
  EnvOverlayError,
  parseStoredEnvOverlay,
  restoreEnvOverlayFromStored,
} from '@archon/workflows/env-overlay';
import type { AppliedEnvOverlay, EnvOverlayCandidate } from '@archon/workflows/schemas/env-overlay';
import type { WorkflowDefinition } from '@archon/workflows/schemas/workflow';

export interface DispatchEnvOverlayResult {
  /** Definition to execute (patched clone when an overlay applies). */
  readonly workflow: WorkflowDefinition;
  /**
   * Detached pending applied descriptor for executeWorkflow / background
   * pre-create. Undefined when the run is YAML-only.
   */
  readonly applied?: AppliedEnvOverlay;
  /**
   * Present when a continuation owns a prior selection and the request also
   * supplied a candidate — callers notify the user; the request is ignored.
   */
  readonly ignoredRequestEnv?: { readonly envId: string; readonly envName: string };
}

function assertCandidateWorkflowName(
  workflow: WorkflowDefinition,
  candidate: EnvOverlayCandidate
): void {
  if (candidate.workflowName !== workflow.name) {
    throw new EnvOverlayError(
      'workflow_mismatch',
      `ENV overlay workflow '${candidate.workflowName}' does not match definition '${workflow.name}'`
    );
  }
}

function appliedFromCandidate(
  candidate: EnvOverlayCandidate,
  appliedPatches: AppliedEnvOverlay['patches'],
  skippedNodeIds: readonly string[]
): AppliedEnvOverlay {
  return cloneAppliedEnvOverlay({
    envId: candidate.envId,
    envName: candidate.envName,
    workflowName: candidate.workflowName,
    patches: appliedPatches,
    skippedNodeIds: [...skippedNodeIds],
  });
}

/**
 * Fresh start: apply the request candidate, or return the original definition.
 * Missing top-level target ids are skipped (not errors).
 */
export function resolveFreshDispatchEnvOverlay(
  workflow: WorkflowDefinition,
  requestCandidate: EnvOverlayCandidate | undefined
): DispatchEnvOverlayResult {
  if (!requestCandidate) {
    return { workflow };
  }

  assertCandidateWorkflowName(workflow, requestCandidate);

  const result = applyEnvOverlay(workflow, requestCandidate.patches);
  return {
    workflow: result.workflow,
    applied: appliedFromCandidate(requestCandidate, result.appliedPatches, result.missingNodeIds),
  };
}

/**
 * Continuation: reapply the run-owned stored overlay only. A newly supplied
 * request candidate is ignored (caller may notify). Malformed stored snapshots
 * throw EnvOverlayError — callers must return before isolation.
 */
export function resolveContinuationDispatchEnvOverlay(
  workflow: WorkflowDefinition,
  storedRaw: unknown,
  requestCandidate: EnvOverlayCandidate | undefined
): DispatchEnvOverlayResult {
  const ignoredRequestEnv =
    requestCandidate !== undefined
      ? { envId: requestCandidate.envId, envName: requestCandidate.envName }
      : undefined;

  if (storedRaw === undefined || storedRaw === null) {
    return { workflow, ignoredRequestEnv };
  }

  const stored = parseStoredEnvOverlay(storedRaw);
  const restored = restoreEnvOverlayFromStored(workflow, stored);

  return {
    workflow: restored.workflow,
    // Frozen patches/skippedNodeIds — never refiltered from the request.
    applied: cloneAppliedEnvOverlay(restored.applied),
    ignoredRequestEnv,
  };
}

/** User-facing text for EnvOverlayError — codes only, never patch bodies. */
export function formatEnvOverlayDispatchMessage(err: EnvOverlayError): string {
  const node = err.nodeId ? ` (node '${err.nodeId}')` : '';
  const field = err.field ? ` field '${err.field}'` : '';
  return `Cannot apply workflow ENV${node}${field}: ${err.message} [${err.code}]`;
}
