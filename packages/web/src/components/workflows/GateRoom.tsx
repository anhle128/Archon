import { useState } from 'react';

import { ConfirmRunActionDialog } from '@/components/dashboard/ConfirmRunActionDialog';

import { RoomRegion } from './NodeRoom';
import type { GateChrome } from './select-room-data';

export interface GateRoomProps {
  nodeId: string;
  chrome: GateChrome;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function GateRoom({
  nodeId,
  chrome,
  onApprove,
  onReject,
}: GateRoomProps): React.ReactElement {
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    setActionPending(true);
    try {
      await action();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        {chrome.showInactiveNotice && (
          <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
            <p className="text-sm text-text-secondary">Gate is not the active pause</p>
          </div>
        )}
        {chrome.decision !== null && (
          <p className="text-sm text-text-primary">
            {chrome.decision === 'approved' ? 'Approved' : 'Rejected'}
          </p>
        )}
        {chrome.canDecide && chrome.decision === null && (
          <p className="text-sm text-text-secondary">Waiting for approval</p>
        )}
        <p className="text-sm text-text-primary">{chrome.message}</p>
        {chrome.document !== null && (
          <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-sm text-text-primary">
            {chrome.document}
          </pre>
        )}
        {chrome.reviewUrl !== null && (
          <a
            href={chrome.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-primary underline decoration-primary/40 hover:decoration-primary"
          >
            Open Plannotator
          </a>
        )}
        {chrome.canDecide && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={actionPending}
              className="rounded-md px-2 py-1 text-xs text-success/80 hover:bg-success/10 hover:text-success disabled:opacity-50"
              onClick={(): void => {
                void runAction(onApprove);
              }}
            >
              Approve
            </button>
            <ConfirmRunActionDialog
              trigger={
                <button
                  type="button"
                  disabled={actionPending}
                  className="rounded-md px-2 py-1 text-xs text-error/80 hover:bg-error/10 hover:text-error disabled:opacity-50"
                >
                  Reject
                </button>
              }
              title="Reject workflow?"
              description={
                <>
                  Reject the paused workflow at gate <strong>{nodeId}</strong>. If the approval node
                  defines an on_reject prompt, it receives the optional reason.
                </>
              }
              confirmLabel="Reject"
              reasonInput={{
                label: 'Reason (optional)',
                placeholder: 'Why are you rejecting?',
              }}
              onConfirm={(reason): void => {
                void runAction(() => onReject(reason));
              }}
            />
          </div>
        )}
        {actionError !== null && (
          <p role="alert" className="text-sm text-error">
            {actionError}
          </p>
        )}
      </div>
    </RoomRegion>
  );
}
