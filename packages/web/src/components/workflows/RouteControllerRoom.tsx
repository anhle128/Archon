import { RoomPlaceholder, RoomRegion } from './NodeRoom';
import type { RouteDecisionView } from './select-room-data';

export interface RouteControllerRoomProps {
  nodeId: string;
  decision: RouteDecisionView | null;
}

const FIELDS = [
  ['Outcome', 'outcome'],
  ['Target', 'to'],
  ['Condition', 'condition'],
  ['Condition result', 'conditionResult'],
  ['Attempt', 'attempt'],
  ['Execution', 'executionSeq'],
  ['Negative count', 'negativeCount'],
  ['Maximum iterations', 'maxIterations'],
] as const;

export function RouteControllerRoom({
  nodeId,
  decision,
}: RouteControllerRoomProps): React.ReactElement {
  return (
    <RoomRegion nodeId={nodeId}>
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium text-text-primary">Routing decision</h3>
        {decision === null ? (
          <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
        ) : (
          <dl className="space-y-2">
            {FIELDS.map(([label, key]) =>
              decision[key] === null ? null : (
                <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="font-mono text-text-primary">{decision[key]}</dd>
                </div>
              )
            )}
          </dl>
        )}
      </div>
    </RoomRegion>
  );
}
