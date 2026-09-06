/**
 * Logs-only composition: selectable unmerged node-run list plus one typed room.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  getWorkflowNodeMessages,
  type DagNode,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import { buildLogRows, type LogRow } from './build-log-rows';
import { LegacyNodeRoom } from './LegacyNodeRoom';
import { NodeRunList } from './NodeRunList';

export interface LegacyNodeLogsProps {
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  onSelectNode: (nodeId: string | null) => void;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function LegacyNodeLogs({
  runId,
  nodeStates,
  events,
  isLive,
  loadMessages,
  onSelectNode,
  roomHeader,
  roomFooter,
  definitionNodes,
  definitionPending,
  runStatus,
  approval,
  onApprove,
  onReject,
}: LegacyNodeLogsProps): React.ReactElement {
  const rows = useMemo(() => buildLogRows(nodeStates, events), [nodeStates, events]);
  const [selectedLogRowId, setSelectedLogRowId] = useState<string | null>(null);
  const selectedRow = rows.find(row => row.id === selectedLogRowId) ?? null;
  const previousRunId = useRef(runId);

  useEffect(() => {
    const runChanged = previousRunId.current !== runId;
    const selectedRowRemoved = selectedLogRowId !== null && selectedRow === null;
    previousRunId.current = runId;
    if (!runChanged && !selectedRowRemoved) return;
    setSelectedLogRowId(null);
    onSelectNode(null);
  }, [onSelectNode, runId, selectedLogRowId, selectedRow]);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <div className="w-64 border-r border-border overflow-auto">
        <NodeRunList
          rows={rows}
          selectedRowId={selectedLogRowId}
          onSelect={(row: LogRow): void => {
            setSelectedLogRowId(row.id);
            onSelectNode(row.nodeId);
          }}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-full">
        {roomHeader}
        <LegacyNodeRoom
          runId={runId}
          row={selectedRow}
          isLive={isLive}
          loadMessages={loadMessages}
          definitionNodes={definitionNodes}
          definitionPending={definitionPending}
          events={events}
          runStatus={runStatus}
          approval={approval}
          onApprove={onApprove}
          onReject={onReject}
        />
        {roomFooter}
      </div>
    </div>
  );
}
