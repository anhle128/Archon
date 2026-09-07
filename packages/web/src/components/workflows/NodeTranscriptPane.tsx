/**
 * Query boundary for a selected node transcript: fetch once per run/node/scope
 * and poll only while the enclosing run is live. On terminal status, drain
 * remaining messages up to the server's scoped high-watermark before stopping.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
import type { LogRow, LogRowSelection } from './build-log-rows';
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

/** Stable scope options derived from a row selection — stable ref for cache keys. */
function scopeFromSelection(selection: LogRowSelection | null): {
  occurrenceId: string | undefined;
  attemptId: string | undefined;
} {
  if (selection?.kind === 'occurrence') {
    return { occurrenceId: selection.occurrenceId, attemptId: selection.attemptId };
  }
  return { occurrenceId: undefined, attemptId: undefined };
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
  const queryClient = useQueryClient();
  const nodeId = row?.nodeId ?? null;
  const { occurrenceId, attemptId } = scopeFromSelection(row?.selection ?? null);

  // Cache key includes scope so switching between occurrences of the same node
  // fetches distinct pages and never shares stale data.
  const queryKey = [
    'workflowNodeMessages',
    runId,
    nodeId,
    occurrenceId ?? null,
    attemptId ?? null,
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: (): Promise<WorkflowNodeMessagesResponse> =>
      loadMessages(runId, nodeId ?? '', { occurrenceId, attemptId }),
    enabled: nodeId !== null,
    refetchInterval: transcriptRefetchInterval(runStatus),
  });

  // Drain any remaining messages after the run reaches a terminal state.
  // We fire one additional fetch when the run terminates and the last response
  // indicates there may be more messages (hasMore) or provides a highWatermark
  // we have not reached yet.
  const drainedRef = useRef(false);
  const drainKeyRef = useRef<string>('');
  const drainKey = `${runId}:${nodeId ?? ''}:${occurrenceId ?? ''}:${attemptId ?? ''}`;

  useEffect(() => {
    const isTerminal =
      runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled';
    if (!isTerminal || nodeId === null) {
      drainedRef.current = false;
      return;
    }
    if (drainedRef.current && drainKeyRef.current === drainKey) return;
    drainedRef.current = true;
    drainKeyRef.current = drainKey;

    // Invalidate once to trigger a final fetch now that the run is terminal.
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }, [runStatus, nodeId, drainKey, queryClient, queryKey]);

  const allMessages = query.error ? [] : (query.data?.messages ?? []);
  const selection = row?.selection ?? null;
  const visibleMessages = selection === null ? [] : selectNodeRoomMessages(allMessages, selection);
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
  const displayNodeId = row?.nodeId ?? '';

  const renderAskCard = (interaction: PendingInteraction): React.ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    if (questions === null) {
      return (
        <InvalidAskCard
          key={interaction.id}
          interaction={interaction}
          agentDisplayName={agentDisplayName}
          nodeId={displayNodeId}
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
        nodeId={displayNodeId}
        autoFocus={interaction.id === firstActionableId}
        nowMs={nowMs}
        mountContext="room"
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
