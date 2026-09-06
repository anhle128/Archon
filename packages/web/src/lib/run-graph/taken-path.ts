import type { NodeState } from './types';

export function isOnPath(state: NodeState | undefined): boolean {
  switch (state) {
    case 'running':
    case 'completed':
    case 'failed':
    case 'awaiting':
      return true;
    case 'pending':
    case 'skipped':
    case undefined:
      return false;
  }
}

export function isEdgeTaken(targetState: NodeState | undefined): boolean {
  return isOnPath(targetState);
}
