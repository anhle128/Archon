/**
 * Query boundary for a selected node transcript: fetch once per run/node and
 * poll only while the enclosing run is live.
 */
import { useQuery } from '@tanstack/react-query';

import { getWorkflowNodeMessages, type WorkflowNodeMessagesResponse } from '@/lib/api';

import type { LogRow } from './build-log-rows';
import { NodeRoom } from './NodeRoom';

export function transcriptRefetchInterval(isLive: boolean): 1000 | false {
  return isLive ? 1000 : false;
}

export interface NodeTranscriptPaneProps {
  runId: string;
  row: LogRow | null;
  isLive: boolean;
  loadMessages: typeof getWorkflowNodeMessages;
}

export function NodeTranscriptPane({
  runId,
  row,
  isLive,
  loadMessages,
}: NodeTranscriptPaneProps): React.ReactElement {
  const query = useQuery({
    queryKey: ['workflowNodeMessages', runId, row?.nodeId],
    queryFn: (): Promise<WorkflowNodeMessagesResponse> => loadMessages(runId, row?.nodeId ?? ''),
    enabled: row !== null,
    refetchInterval: transcriptRefetchInterval(isLive),
  });

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
    />
  );
}
