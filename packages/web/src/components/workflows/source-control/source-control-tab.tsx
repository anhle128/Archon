import { useCallback, useEffect, useReducer, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getWorkflowRunGitChanges } from '@/lib/api';

import { SourceControlPanel, type SourceControlLoadState } from './source-control-panel';
import {
  INITIAL_SOURCE_CONTROL_STATE,
  sourceControlSnapshotReducer,
  toSourceControlSnapshot,
} from './source-control-state';

export function SourceControlTab({ runId }: { runId: string }): ReactElement {
  const [snapshotState, dispatch] = useReducer(
    sourceControlSnapshotReducer,
    INITIAL_SOURCE_CONTROL_STATE
  );

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['workflowRunGitChanges', runId],
    queryFn: () => getWorkflowRunGitChanges(runId),
    refetchInterval: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [runId]);

  useEffect(() => {
    if (!data) return;
    dispatch({
      type: 'received',
      snapshot: toSourceControlSnapshot(data),
    });
  }, [data]);

  const onReload = useCallback((): void => {
    void refetch();
  }, [refetch]);

  const onAcceptPending = useCallback((): void => {
    dispatch({ type: 'accept_pending' });
  }, []);

  const loadState: SourceControlLoadState = isError ? 'error' : isFetching ? 'loading' : 'idle';

  return (
    <SourceControlPanel
      snapshot={snapshotState.displayed}
      loadState={loadState}
      stale={snapshotState.pending !== null}
      onReload={onReload}
      onAcceptPending={onAcceptPending}
    />
  );
}
