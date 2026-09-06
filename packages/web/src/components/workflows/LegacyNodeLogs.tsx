/**
 * Logs-only composition: selectable unmerged node-run list plus one transcript room.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  getWorkflowNodeMessages,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';

import { buildLogRows, type LogRow } from './build-log-rows';
import { NodeRunList } from './NodeRunList';
import { NodeTranscriptPane } from './NodeTranscriptPane';

export interface LegacyNodeLogsProps {
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
  onSelectNode: (nodeId: string | null) => void;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
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
        <NodeTranscriptPane
          runId={runId}
          row={selectedRow}
          isLive={isLive}
          loadMessages={loadMessages}
        />
        {roomFooter}
      </div>
    </div>
  );
}
