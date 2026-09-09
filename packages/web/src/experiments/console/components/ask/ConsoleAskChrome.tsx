import type { Run } from '../../primitives/run';
import type { PendingInteraction, WorkflowNodeState } from '../../skills/runs';

import {
  countPendingAsks,
  firstPendingAskAwaitingInteraction,
  isAskAwaitingRun,
  isAskHumanUnsupportedError,
} from './awaiting-chrome';

export interface ConsoleAskChromeProps {
  status: Run['status'];
  pendingInteractions: readonly PendingInteraction[];
  nodeStates: readonly WorkflowNodeState[];
  runError: string | null;
  onSelectAwaitingNode: (nodeId: string, interaction: PendingInteraction) => void;
  onRequestGraphView: () => void;
}

export function ConsoleAskChrome({
  status,
  pendingInteractions,
  nodeStates,
  runError,
  onSelectAwaitingNode,
  onRequestGraphView,
}: ConsoleAskChromeProps): React.ReactElement | null {
  if (status === 'failed' && isAskHumanUnsupportedError(runError)) {
    return (
      <div
        role="alert"
        className="mx-6 mt-3 w-fit rounded-md border border-error bg-error/10 px-3 py-2 text-sm text-error"
      >
        {runError}
      </div>
    );
  }

  if (!isAskAwaitingRun(status, pendingInteractions)) {
    return null;
  }

  const handleClick = (): void => {
    const interaction = firstPendingAskAwaitingInteraction({
      pending: pendingInteractions,
      nodes: nodeStates,
    });
    if (interaction === null) {
      return;
    }
    onRequestGraphView();
    onSelectAwaitingNode(interaction.node_id, interaction);
  };

  return (
    <button
      type="button"
      aria-live="polite"
      className="mx-6 mt-3 w-fit rounded-full border border-warning bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
      onClick={handleClick}
    >
      {`Awaiting input (${countPendingAsks(pendingInteractions)})`}
    </button>
  );
}
