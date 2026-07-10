import type { DagNodeState, WorkflowRunStatus } from '@/lib/types';

export type WorkflowRetryRunIneligibility =
  | 'run-not-retryable'
  | 'cli-created'
  | 'missing-web-parent';

export interface WorkflowRetryRunContext {
  runId: string;
  status: WorkflowRunStatus;
  parentPlatformId: string | null;
  conversationPlatformId: string | null;
}

export interface RetryableNodeState {
  nodeId: string;
  status: DagNodeState['status'];
  retryEpoch?: number;
  latestRetryEpoch?: number;
  routeDecision?: Record<string, unknown> | null;
}

export type WorkflowNodeRetryActionState =
  | { kind: 'hidden' }
  | { kind: 'web'; runId: string; nodeId: string }
  | { kind: 'cli'; command: string }
  | { kind: 'route-loop-guidance'; sourceNodeId: string; command?: string };

export function buildRetryWorkflowNodePath(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/retry`;
}

export function buildCliRetryCommand(runId: string, nodeId: string): string {
  return `archon workflow retry-node ${runId} ${nodeId}`;
}

export function isRetryableFailedNode(node: RetryableNodeState): boolean {
  if (node.status !== 'failed') return false;
  if (node.retryEpoch === undefined || node.latestRetryEpoch === undefined) return true;
  return node.retryEpoch === node.latestRetryEpoch;
}

function isRetryableRunStatus(status: WorkflowRunStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}

export function getRouteLoopRetrySourceNodeId(node: RetryableNodeState): string | null {
  const routeDecision = node.routeDecision;
  if (!routeDecision) return null;

  const sourceNodeIds = routeDecision.sources;
  if (!Array.isArray(sourceNodeIds)) return null;

  const sourceNodeId = sourceNodeIds[0];
  return typeof sourceNodeId === 'string' && sourceNodeId.length > 0 ? sourceNodeId : null;
}

export function getWorkflowRetryRunIneligibility(
  run: WorkflowRetryRunContext
): WorkflowRetryRunIneligibility | null {
  if (!isRetryableRunStatus(run.status)) return 'run-not-retryable';
  if (!run.parentPlatformId) {
    return run.conversationPlatformId ? 'cli-created' : 'missing-web-parent';
  }
  return null;
}

export function getWorkflowNodeRetryActionState(
  run: WorkflowRetryRunContext,
  node: RetryableNodeState
): WorkflowNodeRetryActionState {
  const routeLoopSourceNodeId = getRouteLoopRetrySourceNodeId(node);
  if (isRetryableRunStatus(run.status) && routeLoopSourceNodeId) {
    const ineligible = getWorkflowRetryRunIneligibility(run);
    return {
      kind: 'route-loop-guidance',
      sourceNodeId: routeLoopSourceNodeId,
      ...(ineligible === 'cli-created'
        ? { command: buildCliRetryCommand(run.runId, routeLoopSourceNodeId) }
        : {}),
    };
  }

  if (!isRetryableFailedNode(node)) return { kind: 'hidden' };

  const ineligible = getWorkflowRetryRunIneligibility(run);
  if (ineligible === null) {
    return { kind: 'web', runId: run.runId, nodeId: node.nodeId };
  }
  if (ineligible === 'cli-created') {
    return { kind: 'cli', command: buildCliRetryCommand(run.runId, node.nodeId) };
  }
  return { kind: 'hidden' };
}

export function normalizeRetryWorkflowNodeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
