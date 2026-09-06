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
import { readApprovalContext, type WebApprovalContext } from '@/lib/approval-context';
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

function isSelectablePauseContext(context: WebApprovalContext): boolean {
  return (
    context.type === undefined ||
    context.type === 'approval' ||
    context.type === 'plannotator_gate' ||
    context.type === 'child_workflow'
  );
}

function isSelectableApprovalEvent(event: WorkflowEventResponse): boolean {
  if (event.event_type !== 'approval_requested') return false;
  const gateType = event.data.gateType;
  return gateType === 'approval' || gateType === 'plannotator_gate';
}

function syntheticStatusFromEvent(
  event: WorkflowEventResponse
): WorkflowNodeStateResponse['status'] | null {
  if (event.event_type === 'loop_iteration_started') return 'running';
  if (event.event_type === 'loop_iteration_completed') return 'completed';
  if (event.event_type === 'loop_iteration_failed') return 'failed';
  if (isSelectableApprovalEvent(event)) return 'running';
  return null;
}

function eventNodeId(event: WorkflowEventResponse): string | null {
  if (typeof event.step_name === 'string' && event.step_name.length > 0) {
    return event.step_name;
  }
  const nodeId = event.data.nodeId;
  if (typeof nodeId === 'string' && nodeId.length > 0) return nodeId;
  return null;
}

function synthesizeLegacyLogNodeStates(input: {
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
}): readonly WorkflowNodeStateResponse[] {
  const seen = new Set(input.nodeStates.map(state => state.nodeId));
  const next: WorkflowNodeStateResponse[] = [...input.nodeStates];

  // Some control-flow pauses do not persist node_started, so the server
  // projection has no nodeState until the gate or group resolves.
  const addSynthetic = (nodeId: string, status: WorkflowNodeStateResponse['status']): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    next.push({ nodeId, name: nodeId, status, retryEpoch: 0 });
  };

  for (const event of input.events) {
    const status = syntheticStatusFromEvent(event);
    if (status === null) continue;
    const nodeId = eventNodeId(event);
    if (nodeId !== null) addSynthetic(nodeId, status);
  }

  const context = readApprovalContext(input.approval);
  if (input.runStatus === 'paused' && context !== null && isSelectablePauseContext(context)) {
    addSynthetic(context.nodeId, 'running');
  }

  return next.length === input.nodeStates.length ? input.nodeStates : next;
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
  const visibleNodeStates = useMemo(
    () => synthesizeLegacyLogNodeStates({ nodeStates, events, runStatus, approval }),
    [approval, events, nodeStates, runStatus]
  );
  const rows = useMemo(() => buildLogRows(visibleNodeStates, events), [events, visibleNodeStates]);
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
