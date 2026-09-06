import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { getWorkflowNodeMessages } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

import { nodeStatusLabel } from './awaiting-chrome';
import type { LogRow } from './build-log-rows';
import { ChildWorkflowRoom } from './ChildWorkflowRoom';
import { GateRoom } from './GateRoom';
import { LoopGroupRoom } from './LoopGroupRoom';
import { NodeTranscriptPane } from './NodeTranscriptPane';
import { RoomPlaceholder, RoomRegion } from './NodeRoom';
import { RouteControllerRoom } from './RouteControllerRoom';
import { StdoutRoom } from './StdoutRoom';
import type { NodeBodyKind } from './resolve-room-kind';
import { resolveRoomKind } from './resolve-room-kind';
import {
  selectChildRun,
  selectGateChrome,
  selectLoopGroupChrome,
  selectNodeStdout,
  selectRouteDecision,
} from './select-room-data';

export interface LegacyNodeRoomProps {
  runId: string;
  row: LogRow | null;
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

const TYPE_LABELS: Record<NodeBodyKind, string> = {
  command: 'Command',
  prompt: 'Prompt',
  loop: 'Loop',
  bash: 'Bash',
  script: 'Script',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  workflow: 'Workflow',
  route_loop: 'Route loop',
  loop_group: 'Loop group',
  unknown: 'Agent',
};

const STATUS_COLORS: Record<LogRow['status'], string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  awaiting: 'bg-warning/20 text-warning',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};

function assertNever(value: never): never {
  throw new Error('Unhandled legacy room kind: ' + String(value));
}

export function LegacyNodeRoom({
  runId,
  row,
  isLive,
  loadMessages,
  definitionNodes,
  definitionPending,
  events,
  runStatus,
  approval,
  onApprove,
  onReject,
}: LegacyNodeRoomProps): React.ReactElement {
  if (row === null) return <RoomPlaceholder>Select a node</RoomPlaceholder>;

  const resolution = resolveRoomKind(row.nodeId, definitionNodes, events, approval);
  const waitingForDefinition =
    definitionPending &&
    resolution.definitionNode === null &&
    resolution.kind === 'agent' &&
    resolution.nodeType === 'unknown';

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{row.label}</h2>
      <span className="rounded bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
        {waitingForDefinition ? 'Loading' : TYPE_LABELS[resolution.nodeType]}
      </span>
      <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_COLORS[row.status])}>
        {nodeStatusLabel(row.status)}
      </span>
    </div>
  );

  let body: React.ReactElement;

  if (waitingForDefinition) {
    body = (
      <RoomRegion nodeId={row.nodeId}>
        <RoomPlaceholder>Loading node room</RoomPlaceholder>
      </RoomRegion>
    );
  } else {
    switch (resolution.kind) {
      case 'agent':
        body = (
          <NodeTranscriptPane runId={runId} row={row} isLive={isLive} loadMessages={loadMessages} />
        );
        break;
      case 'stdout':
        body = <StdoutRoom nodeId={row.nodeId} stdout={selectNodeStdout(events, row)} />;
        break;
      case 'gate':
        body = (
          <GateRoom
            nodeId={row.nodeId}
            chrome={selectGateChrome({
              definitionNode: resolution.definitionNode,
              events,
              row,
              approval,
              runStatus,
              gateType:
                resolution.nodeType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
            })}
            onApprove={onApprove}
            onReject={onReject}
          />
        );
        break;
      case 'workflow':
        body = (
          <ChildWorkflowRoom
            nodeId={row.nodeId}
            child={selectChildRun({ events, approval, row, runStatus })}
          />
        );
        break;
      case 'route_loop':
        body = (
          <RouteControllerRoom nodeId={row.nodeId} decision={selectRouteDecision(events, row)} />
        );
        break;
      case 'loop_group':
        body = (
          <LoopGroupRoom
            nodeId={row.nodeId}
            chrome={selectLoopGroupChrome({
              definitionNode: resolution.definitionNode,
              events,
              row,
            })}
          />
        );
        break;
      default:
        body = assertNever(resolution.kind);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {body}
    </div>
  );
}
