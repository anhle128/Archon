/**
 * Query boundary for a selected node transcript: fetch once per run/node and
 * poll only while the enclosing run is live.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getWorkflowNodeMessages,
  type AskAnswerBody,
  type PendingInteraction,
  type WorkflowNodeMessageResponse,
  type WorkflowNodeMessagesResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import { AskCard, InvalidAskCard } from './AskCard';
import type { AskActionStateByRequest } from './ask-answer-controller';
import { resolveAskCardPresentation } from './ask-card-presentation';
import type { LogRow } from './build-log-rows';
import { selectVisibleNodeAskInteractions } from './merge-agent-room-items';
import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';
import { parseAskEnvelope } from './parse-ask-envelope';

export function transcriptRefetchInterval(status: WorkflowRunStatus): 1000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 1000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
}

export interface NodeTranscriptPaneProps {
  runId: string;
  row: LogRow | null;
  runStatus: WorkflowRunStatus;
  loadMessages: typeof getWorkflowNodeMessages;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  nodeState: WorkflowNodeStateResponse | undefined;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
}

function collectToolIds(messages: readonly WorkflowNodeMessageResponse[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

export function NodeTranscriptPane({
  runId,
  row,
  runStatus,
  loadMessages,
  pendingInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  nodeState,
  onSubmitAsk,
}: NodeTranscriptPaneProps): React.ReactElement {
  const query = useQuery({
    queryKey: ['workflowNodeMessages', runId, row?.nodeId],
    queryFn: (): Promise<WorkflowNodeMessagesResponse> => loadMessages(runId, row?.nodeId ?? ''),
    enabled: row !== null,
    refetchInterval: transcriptRefetchInterval(runStatus),
  });

  const allMessages = query.error ? [] : (query.data?.messages ?? []);
  const visibleMessages = row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);
  const visibleAsks =
    row === null
      ? []
      : selectVisibleNodeAskInteractions({
          pending: pendingInteractions,
          nodeId: row.nodeId,
          allMessages,
          visibleMessages,
        });
  const visibleToolIds = collectToolIds(visibleMessages);
  const anchoredAsks = visibleAsks.filter(interaction =>
    visibleToolIds.has(interaction.tool_use_id)
  );
  const unanchoredAsks = visibleAsks.filter(
    interaction => !visibleToolIds.has(interaction.tool_use_id)
  );
  const orderedAsks = [
    ...visibleMessages.flatMap(message =>
      message.kind === 'tool'
        ? anchoredAsks.filter(interaction => interaction.tool_use_id === message.payload.id)
        : []
    ),
    ...unanchoredAsks,
  ];
  const firstActionableId = orderedAsks.find(interaction => {
    if (!viewerIsStarter || interaction.status !== 'pending') {
      return false;
    }
    if (parseAskEnvelope(interaction.envelope) === null) {
      return false;
    }
    return (
      resolveAskCardPresentation({
        interaction,
        action: actionStates[interaction.tool_use_id],
        nodeStatus: nodeState?.status,
        nodeError: nodeState?.error,
      }).viewState === 'pending'
    );
  })?.id;

  const nowMs = Date.now();
  const agentDisplayName = row?.label ?? '';
  const nodeId = row?.nodeId ?? '';

  const renderAskCard = (interaction: PendingInteraction): React.ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    if (questions === null) {
      return (
        <InvalidAskCard
          key={interaction.id}
          interaction={interaction}
          agentDisplayName={agentDisplayName}
          nodeId={nodeId}
        />
      );
    }
    const requestId = interaction.tool_use_id;
    const presentation = resolveAskCardPresentation({
      interaction,
      action: actionStates[requestId],
      nodeStatus: nodeState?.status,
      nodeError: nodeState?.error,
    });
    return (
      <AskCard
        key={interaction.id}
        interaction={interaction}
        questions={questions}
        presentation={presentation}
        viewerIsStarter={viewerIsStarter}
        starterDisplayName={starterDisplayName}
        agentDisplayName={agentDisplayName}
        nodeId={nodeId}
        autoFocus={interaction.id === firstActionableId}
        nowMs={nowMs}
        onSubmit={(body): void => {
          void onSubmitAsk(requestId, body);
        }}
        onDecline={(): void => {
          void onSubmitAsk(requestId, { decline: true });
        }}
      />
    );
  };

  return (
    <NodeRoom
      nodeId={row?.nodeId ?? null}
      selection={row?.selection ?? null}
      messages={query.data?.messages}
      isPending={query.isPending}
      error={query.error}
      onRetry={(): void => {
        void query.refetch();
      }}
      renderAfterMessage={(message): React.ReactNode => {
        if (message.kind !== 'tool') {
          return null;
        }
        const matching = anchoredAsks.filter(
          interaction => interaction.tool_use_id === message.payload.id
        );
        if (matching.length === 0) {
          return null;
        }
        return matching.map(renderAskCard);
      }}
      renderAtEnd={unanchoredAsks.length === 0 ? undefined : unanchoredAsks.map(renderAskCard)}
    />
  );
}
