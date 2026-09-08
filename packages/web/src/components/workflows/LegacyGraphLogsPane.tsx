/**
 * Shared Graph/Logs/Chat composition: one left navigation and one typed room.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  PercentResizablePanel,
  ResizableHandle,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  getWorkflowNodeMessages,
  type AskAnswerBody,
  type ConversationResponse,
  type DagNode,
  type MessageResponse,
  type NodeExecution,
  type PendingInteraction,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import { readApprovalContext, type WebApprovalContext } from '@/lib/approval-context';
import { chooseExecutionForNode, roomOpenerId } from '@/lib/execution-room-model';
import { clampRoomRatio, roomPanelSizes } from '@/lib/room-split-layout';
import type { WorkflowRunStatus } from '@/lib/types';
import { useContainerSplitMode, type ContainerSplitMode } from '@/lib/use-container-split-mode';

import type { AskActionStateByRequest } from './ask-answer-controller';
import { buildChatTimeline, type ChatTimelineEntry } from './build-chat-timeline';

import { buildLogRows, type LogRow } from './build-log-rows';
import { ChatTimeline } from './ChatTimeline';
import { LegacyNodeRoom } from './LegacyNodeRoom';
import { NodeRunList } from './NodeRunList';
import { resolveGraphRoomRow } from './resolve-graph-room-row';
import { resolveRoomKind } from './resolve-room-kind';
import { resolveTimelineRoomRow } from './resolve-timeline-room-row';
import { RunChatComposer } from './RunChatComposer';
import { useStackedViewport } from './source-control/use-stacked-viewport';

export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs' | 'chat';
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  lastExplicitRowByNode?: Record<string, string>;
  onOpenRoom: (rowId: string, nodeId: string, openerId: string | null) => void;
  onCloseRoom: () => void;
  roomRatio: number;
  onRoomRatioChange: (ratio: number) => void;
  splitMode?: ContainerSplitMode;
  runId: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  nodeExecutions?: readonly NodeExecution[];
  loadMessages: typeof getWorkflowNodeMessages;
  parentPlatformId: string | null;
  loadParentMessages: (conversationId: string) => Promise<MessageResponse[]>;
  loadParentConversation: (conversationId: string) => Promise<ConversationResponse>;
  sendParentMessage: (
    conversationId: string,
    message: string
  ) => Promise<{ accepted: boolean; status: string }>;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
}

export function runChatMessagesRefetchInterval(status: WorkflowRunStatus): 3000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 3000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
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
  selectedLogRowId,
  lastExplicitRowByNode = {},
  onOpenRoom,
  onCloseRoom,
  roomRatio,
  onRoomRatioChange,
  splitMode: splitModeOverride,
  runId,
  nodeStates,
  events,
  nodeExecutions,
  loadMessages,
  parentPlatformId,
  loadParentMessages,
  loadParentConversation,
  sendParentMessage,
  roomHeader,
  roomFooter,
  definitionNodes,
  definitionPending,
  runStatus,
  approval,
  onApprove,
  onReject,
  pendingInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
}: LegacyGraphLogsPaneProps): React.ReactElement {
  const stacked = useStackedViewport();
  const paneRef = useRef<HTMLDivElement>(null);
  const measuredMode = useContainerSplitMode(paneRef);
  const mode = splitModeOverride ?? measuredMode;
  const visibleNodeStates = useMemo(
    () => synthesizeLegacyLogNodeStates({ nodeStates, events, runStatus, approval }),
    [approval, events, nodeStates, runStatus]
  );
  const rows = useMemo(
    () => buildLogRows(visibleNodeStates, events, nodeExecutions),
    [events, nodeExecutions, visibleNodeStates]
  );
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  const sendGeneration = useRef(0);
  const previousRunId = useRef(runId);
  const sizes = roomPanelSizes(roomRatio);
  const explicitSelectedRow =
    selectedLogRowId === null
      ? null
      : (rows.find(row => row.id === selectedLogRowId && row.nodeId === selectedNodeId) ?? null);
  const selectedRow =
    selectedNodeId === null
      ? null
      : explicitSelectedRow !== null
        ? explicitSelectedRow
        : resolveGraphRoomRow({
            rows,
            nodeId: selectedNodeId,
            liveStatus: visibleNodeStates,
          });
  const roomOpen = selectedRow !== null;

  const parentMessagesQuery = useQuery({
    queryKey: ['runChatMessages', parentPlatformId],
    enabled: activeView === 'chat' && parentPlatformId !== null,
    queryFn: async (): Promise<MessageResponse[]> => {
      if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
      return loadParentMessages(parentPlatformId);
    },
    retry: false,
    refetchInterval: runChatMessagesRefetchInterval(runStatus),
  });

  const parentConversationQuery = useQuery({
    queryKey: ['runChatConversation', parentPlatformId],
    enabled: activeView === 'chat' && parentPlatformId !== null,
    queryFn: async (): Promise<ConversationResponse> => {
      if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
      return loadParentConversation(parentPlatformId);
    },
    retry: false,
    staleTime: Infinity,
  });

  const composerDisabledReason =
    parentPlatformId === null
      ? 'Conversation unavailable.'
      : parentConversationQuery.fetchStatus === 'fetching' &&
          parentConversationQuery.data === undefined
        ? 'Loading conversation…'
        : parentConversationQuery.isError
          ? 'Unable to load conversation details.'
          : parentConversationQuery.data?.platform_type !== 'web'
            ? 'Continuing chats from other platforms in the Web UI is coming soon'
            : null;

  const chatEntries = useMemo(
    () =>
      buildChatTimeline({
        messages: parentMessagesQuery.data ?? [],
        events,
        nodeStates: visibleNodeStates,
        resolveNodeType: (nodeId: string) =>
          resolveRoomKind(nodeId, definitionNodes, events, approval).nodeType,
      }),
    [approval, definitionNodes, events, parentMessagesQuery.data, visibleNodeStates]
  );

  const parentMessagesError = parentMessagesQuery.isError
    ? parentMessagesQuery.error instanceof Error
      ? parentMessagesQuery.error.message
      : 'Failed to load conversation turns.'
    : null;

  useEffect(() => {
    if (previousRunId.current === runId) return;
    previousRunId.current = runId;
    sendGeneration.current += 1;
    setChatDraft('');
    setChatSending(false);
    setChatSendError(null);
    setSelectedTimelineEntryId(null);
  }, [runId]);

  useEffect(() => {
    if (selectedNodeId === null) setSelectedTimelineEntryId(null);
  }, [selectedNodeId]);

  const handleGraphNodeClick = (nodeId: string): void => {
    setSelectedTimelineEntryId(null);
    const lastExplicit = selectedNodeId === nodeId ? null : (lastExplicitRowByNode[nodeId] ?? null);
    const chosen = chooseExecutionForNode(rows, nodeId, lastExplicit);
    const row =
      chosen ??
      resolveGraphRoomRow({
        rows,
        nodeId,
        liveStatus: visibleNodeStates,
      });
    if (row === null) return;
    onOpenRoom(row.id, nodeId, roomOpenerId('legacy', 'graph', nodeId));
  };

  const handleLogRowSelect = (row: LogRow): void => {
    setSelectedTimelineEntryId(null);
    onOpenRoom(row.id, row.nodeId, roomOpenerId('legacy', 'log', row.id));
  };

  const handleNodeStatusSelect = (
    entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>
  ): void => {
    const row = resolveTimelineRoomRow({
      rows,
      entry,
      liveStatus: visibleNodeStates,
    });
    setSelectedTimelineEntryId(entry.id);
    onOpenRoom(row.id, row.nodeId, null);
  };

  const handleChatSubmit = (): void => {
    const message = chatDraft.trim();
    if (parentPlatformId === null || message.length === 0 || composerDisabledReason !== null) {
      return;
    }
    const generation = ++sendGeneration.current;
    setChatSending(true);
    setChatSendError(null);
    void sendParentMessage(parentPlatformId, message)
      .then((): void => {
        if (sendGeneration.current !== generation) return;
        setChatDraft('');
        void parentMessagesQuery.refetch();
      })
      .catch((error: unknown): void => {
        if (sendGeneration.current !== generation) return;
        setChatSendError(error instanceof Error ? error.message : 'Failed to send message.');
      })
      .finally((): void => {
        if (sendGeneration.current === generation) setChatSending(false);
      });
  };

  const leftPane =
    activeView === 'graph' ? (
      <div className="h-full min-h-0">
        {renderGraph({ selectedNodeId, onNodeClick: handleGraphNodeClick })}
      </div>
    ) : activeView === 'logs' ? (
      <div className="h-full min-h-0 overflow-auto">
        <NodeRunList
          rows={rows}
          selectedRowId={selectedRow?.id ?? null}
          onSelect={handleLogRowSelect}
        />
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <ChatTimeline
            entries={chatEntries}
            selectedEntryId={selectedTimelineEntryId}
            onSelectNodeStatus={handleNodeStatusSelect}
            loading={
              parentMessagesQuery.fetchStatus === 'fetching' &&
              parentMessagesQuery.data === undefined
            }
            error={parentMessagesError}
          />
        </div>
        <RunChatComposer
          value={chatDraft}
          onValueChange={setChatDraft}
          onSubmit={handleChatSubmit}
          sending={chatSending}
          disabledReason={composerDisabledReason}
          error={chatSendError}
        />
      </div>
    );

  const wrappedLeft = (
    <div
      id={mode === 'single' ? 'legacy-run-view' : undefined}
      hidden={mode === 'single' && roomOpen}
    >
      {leftPane}
    </div>
  );

  const roomPane = (
    <div
      data-testid="legacy-node-room"
      id={mode === 'single' ? 'legacy-run-room' : undefined}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <button type="button" onClick={onCloseRoom}>
        {mode === 'single' ? 'Back' : 'Close'}
      </button>
      {roomHeader}
      <LegacyNodeRoom
        runId={runId}
        row={selectedRow}
        loadMessages={loadMessages}
        definitionNodes={definitionNodes}
        definitionPending={definitionPending}
        events={events}
        runStatus={runStatus}
        approval={approval}
        onApprove={onApprove}
        onReject={onReject}
        pendingInteractions={pendingInteractions}
        viewerIsStarter={viewerIsStarter}
        starterDisplayName={starterDisplayName}
        actionStates={actionStates}
        onSubmitAsk={onSubmitAsk}
        nodeState={
          selectedRow === null
            ? undefined
            : visibleNodeStates.find(state => state.nodeId === selectedRow.nodeId)
        }
      />
      {roomFooter}
    </div>
  );

  const handleLayoutChanged = (layout: Record<string, number>): void => {
    const roomSize = layout['legacy-run-room'];
    if (typeof roomSize !== 'number') return;
    onRoomRatioChange(clampRoomRatio(roomSize));
  };

  return (
    <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {mode === 'single' ? (
        <>
          {wrappedLeft}
          {roomOpen ? roomPane : null}
        </>
      ) : (
        <ResizablePanelGroup
          orientation={stacked ? 'vertical' : 'horizontal'}
          className="min-h-0 flex-1"
          defaultLayout={
            roomOpen
              ? {
                  'legacy-run-view': 100 - clampRoomRatio(roomRatio),
                  'legacy-run-room': clampRoomRatio(roomRatio),
                }
              : { 'legacy-run-view': 100 }
          }
          onLayoutChanged={handleLayoutChanged}
        >
          <PercentResizablePanel
            id="legacy-run-view"
            defaultSize={roomOpen ? sizes.view.defaultSize : '100%'}
            minSize={sizes.view.minSize}
          >
            {wrappedLeft}
          </PercentResizablePanel>
          {roomOpen ? (
            <>
              <ResizableHandle withHandle aria-label="Resize node room" />
              <PercentResizablePanel
                id="legacy-run-room"
                defaultSize={sizes.room.defaultSize}
                minSize={sizes.room.minSize}
                maxSize={sizes.room.maxSize}
              >
                {roomPane}
              </PercentResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
