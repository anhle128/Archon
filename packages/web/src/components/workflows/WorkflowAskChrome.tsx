import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import {
  countPendingAsks,
  firstAwaitingNodeId,
  isAskAwaitingRun,
  isAskHumanUnsupportedError,
} from './awaiting-chrome';

export interface WorkflowAskChromeProps {
  status: WorkflowRunStatus;
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string) => void;
  onRequestGraphView: () => void;
}

export function WorkflowAskChrome({
  status,
  pendingInteractions,
  nodeStates,
  runError,
  onSelectAwaitingNode,
  onRequestGraphView,
}: WorkflowAskChromeProps): React.ReactElement | null {
  if (status === 'failed' && isAskHumanUnsupportedError(runError)) {
    return (
      <div
        role="alert"
        className="rounded-md border border-error bg-error/10 px-3 py-2 text-sm text-error"
      >
        {runError}
      </div>
    );
  }

  if (!isAskAwaitingRun(status, pendingInteractions)) {
    return null;
  }

  const handleClick = (): void => {
    const nodeId = firstAwaitingNodeId(nodeStates);
    if (nodeId === null) {
      return;
    }
    onRequestGraphView();
    onSelectAwaitingNode(nodeId);
  };

  return (
    <button
      type="button"
      aria-live="polite"
      className="rounded-full border border-warning bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
      onClick={handleClick}
    >
      {`Awaiting input (${countPendingAsks(pendingInteractions)})`}
    </button>
  );
}
