/**
 * Shared Graph/Logs composition: one left navigation and one typed room.
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

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { buildLogRows, type LogRow } from './build-log-rows';
import { LegacyNodeRoom } from './LegacyNodeRoom';
import { NodeRunList } from './NodeRunList';
import { resolveGraphRoomRow } from './resolve-graph-room-row';

export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs';
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
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

export function LegacyGraphLogsPane({
  activeView,
  renderGraph,
  selectedNodeId,
  onSelectNode,
  runId,
  nodeStates,
  events,
  isLive,
  loadMessages,
  roomHeader,
  roomFooter,
  definitionNodes,
  definitionPending,
  runStatus,
  approval,
  onApprove,
  onReject,
}: LegacyGraphLogsPaneProps): React.ReactElement {
  const visibleNodeStates = useMemo(
    () => synthesizeLegacyLogNodeStates({ nodeStates, events, runStatus, approval }),
    [approval, events, nodeStates, runStatus]
  );
  const rows = useMemo(() => buildLogRows(visibleNodeStates, events), [events, visibleNodeStates]);
  const [selectedLogRowId, setSelectedLogRowId] = useState<string | null>(null);
  const explicitSelectedRow = rows.find(row => row.id === selectedLogRowId) ?? null;
  const selectedRow =
    explicitSelectedRow !== null && explicitSelectedRow.nodeId === selectedNodeId
      ? explicitSelectedRow
      : resolveGraphRoomRow({
          rows,
          nodeId: selectedNodeId,
          liveStatus: visibleNodeStates,
        });
  const previousRunId = useRef(runId);
  const previousSelectedNodeId = useRef(selectedNodeId);

  useEffect(() => {
    const runChanged = previousRunId.current !== runId;
    const selectedRowRemoved = selectedLogRowId !== null && explicitSelectedRow === null;
    previousRunId.current = runId;
    if (!runChanged && !selectedRowRemoved) return;
    setSelectedLogRowId(null);
    onSelectNode(null);
  }, [explicitSelectedRow, onSelectNode, runId, selectedLogRowId]);

  useEffect(() => {
    const previous = previousSelectedNodeId.current;
    previousSelectedNodeId.current = selectedNodeId;
    if (previous === selectedNodeId || selectedLogRowId === null) return;
    if (explicitSelectedRow !== null && explicitSelectedRow.nodeId === previous) {
      setSelectedLogRowId(null);
    }
  }, [explicitSelectedRow, selectedLogRowId, selectedNodeId]);

  const handleGraphNodeClick = (nodeId: string): void => {
    setSelectedLogRowId(null);
    onSelectNode(nodeId);
  };

  const handleLogRowSelect = (row: LogRow): void => {
    setSelectedLogRowId(row.id);
    onSelectNode(row.nodeId);
  };

  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
      <ResizablePanel defaultSize={60} minSize={30}>
        {activeView === 'graph' ? (
          <div className="h-full min-h-0">
            {renderGraph({ selectedNodeId, onNodeClick: handleGraphNodeClick })}
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-auto">
            <NodeRunList
              rows={rows}
              selectedRowId={selectedRow?.id ?? null}
              onSelect={handleLogRowSelect}
            />
          </div>
        )}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={40} minSize={20}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
