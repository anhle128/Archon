import type { StdoutView } from './select-room-data';
import { RoomPlaceholder, RoomRegion } from './NodeRoom';

export function StdoutRoom({
  nodeId,
  stdout,
}: {
  nodeId: string;
  stdout: StdoutView;
}): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-text-secondary">Status: {stdout.status}</p>
        {stdout.truncated && (
          <p className="text-xs text-warning">
            {stdout.originalBytes === null
              ? 'Output truncated'
              : `Output truncated from ${String(stdout.originalBytes)} bytes`}
          </p>
        )}
        {stdout.failedDetail && <p className="text-sm text-error">{stdout.failedDetail}</p>}
        {stdout.text === null ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-sm text-text-primary">
            {stdout.text}
          </pre>
        )}
        {stdout.exitCode === 0 && <p className="text-xs text-text-secondary">Exit status: 0</p>}
      </div>
    </RoomRegion>
  );
}
