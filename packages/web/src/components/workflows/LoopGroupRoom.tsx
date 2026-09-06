import { RoomPlaceholder, RoomRegion } from './NodeRoom';
import type { LoopGroupChrome } from './select-room-data';

export interface LoopGroupRoomProps {
  nodeId: string;
  chrome: LoopGroupChrome;
}

export function LoopGroupRoom({ nodeId, chrome }: LoopGroupRoomProps): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-4 p-4">
        <h3 className="text-sm font-medium text-text-primary">Loop group</h3>
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase text-text-secondary">Body nodes</h4>
          {chrome.body.map(node => (
            <div key={node.qualifiedId} className="text-sm text-text-primary">
              <span className="font-mono">{node.id}</span>
              <span className="ml-2 text-text-secondary">
                {node.dependsOn.length === 0 ? 'Start' : `After ${node.dependsOn.join(', ')}`}
              </span>
            </div>
          ))}
        </div>
        {chrome.iterations.length === 0 ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          chrome.iterations.map(iteration => (
            <details
              key={iteration.iteration}
              open={iteration.iteration === chrome.selectedIteration}
              className="rounded border border-border bg-surface-elevated p-3"
            >
              <summary className="cursor-pointer text-sm text-text-primary">
                {'×' + String(iteration.iteration) + ' ' + iteration.status}
              </summary>
              <div className="mt-2 space-y-1">
                {iteration.body.map(node => (
                  <p key={node.qualifiedId} className="text-sm text-text-secondary">
                    <span className="font-mono text-text-primary">{node.qualifiedId}</span>{' '}
                    {node.status}
                  </p>
                ))}
              </div>
            </details>
          ))
        )}
      </div>
    </RoomRegion>
  );
}
