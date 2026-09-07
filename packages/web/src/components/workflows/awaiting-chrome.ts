import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

const ASK_HUMAN_UNSUPPORTED_PREFIX = 'AskHuman is not supported by provider';

export function countPendingAsks(pending: readonly PendingInteraction[]): number {
  let count = 0;
  for (const interaction of pending) {
    if (interaction.kind === 'ask' && interaction.status === 'pending') {
      count += 1;
    }
  }
  return count;
}

export function isAskAwaitingRun(
  status: WorkflowRunStatus,
  pending: readonly PendingInteraction[]
): boolean {
  return status === 'paused' && countPendingAsks(pending) > 0;
}

export function firstAwaitingNodeId(nodes: readonly WorkflowNodeStateResponse[]): string | null {
  for (const node of nodes) {
    if (node.status === 'awaiting') {
      return node.nodeId;
    }
  }
  return null;
}

export function isAskHumanUnsupportedError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(ASK_HUMAN_UNSUPPORTED_PREFIX);
}

export function nodeStatusLabel(status: WorkflowNodeStateResponse['status']): string {
  return status === 'awaiting' ? 'waiting on you' : status;
}
