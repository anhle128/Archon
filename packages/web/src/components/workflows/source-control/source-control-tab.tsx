import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getWorkflowRunGitChanges,
  getWorkflowRunGitDiff,
  getWorkflowRunGitFile,
  getWorkflowRunGitLog,
  gitFileUrl,
  type GitChangedFile,
  type GitFileClientResult,
  type GitFileSource,
  type GitReadyDiffResponse,
} from '@/lib/api';

import { FileViewer, type FileViewerState } from './file-viewer';
import { formatHexPeek } from './hex-peek';
import { SourceControlPanel, type SourceControlLoadState } from './source-control-panel';
import { SourceControlSplit } from './source-control-split';
import {
  INITIAL_GIT_LOG_STATE,
  INITIAL_SOURCE_CONTROL_STATE,
  gitLogSnapshotReducer,
  sourceControlSnapshotReducer,
  toGitLogSnapshot,
  toSourceControlSnapshot,
  type GitLogSnapshotState,
  type SourceControlSnapshot,
} from './source-control-state';
import { useStackedViewport } from './use-stacked-viewport';

type LoadedViewerState = Exclude<FileViewerState, { kind: 'idle' | 'loading' | 'error' }>;

interface PendingViewer {
  file: GitChangedFile;
  state: LoadedViewerState;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isFileChangedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 409
  );
}

function viewerFingerprint(state: FileViewerState): string {
  switch (state.kind) {
    case 'text':
      return `text:${state.contentHash}`;
    case 'image':
      return `image:${state.contentHash}`;
    case 'hex':
      return `hex:${state.contentHash}`;
    case 'download':
      return `download:${state.contentHash}`;
    case 'diff':
      return `diff:${state.reloadFingerprint}`;
    case 'unavailable':
      return `unavailable:${state.emptyReason}`;
    case 'error':
      return 'error';
    case 'idle':
      return 'idle';
    case 'loading':
      return `loading:${state.file.status}:${state.file.path}`;
  }
}

function diffReloadFingerprint(response: GitReadyDiffResponse): string {
  return response.truncated && response.cursor !== '' ? response.cursor : JSON.stringify(response);
}

function fromRawFile(
  runId: string,
  file: GitChangedFile,
  source: GitFileSource,
  raw: Exclude<GitFileClientResult, { kind: 'empty' | 'text' }>
): LoadedViewerState {
  const downloadHref = gitFileUrl(runId, file.path, source, { download: true });
  switch (raw.kind) {
    case 'image':
      return {
        kind: 'image',
        file,
        contentHash: raw.contentHash,
        bytes: raw.bytes,
        mediaType: raw.mediaType,
        downloadHref,
      };
    case 'hex':
      return {
        kind: 'hex',
        file,
        contentHash: raw.contentHash,
        hex: formatHexPeek(raw.bytes),
        downloadHref,
      };
    case 'download':
      return {
        kind: 'download',
        file,
        contentHash: raw.contentHash,
        downloadHref,
      };
  }
}

async function loadViewerFile(
  runId: string,
  file: GitChangedFile,
  signal: AbortSignal
): Promise<LoadedViewerState> {
  if (file.status === 'M') {
    const response = await getWorkflowRunGitDiff(runId, file.path, { signal });
    if ('emptyReason' in response) {
      return { kind: 'unavailable', file, emptyReason: response.emptyReason };
    }
    if (!response.fileFallback) {
      return {
        kind: 'diff',
        file,
        response,
        reloadFingerprint: diffReloadFingerprint(response),
      };
    }
    const raw = await getWorkflowRunGitFile(runId, file.path, 'worktree', { signal });
    if (raw.kind === 'empty') {
      return { kind: 'unavailable', file, emptyReason: raw.emptyReason };
    }
    if (raw.kind === 'text') {
      return {
        kind: 'text',
        file,
        text: raw.text,
        contentHash: raw.contentHash,
        truncated: raw.truncated,
        cursor: raw.cursor,
      };
    }
    return fromRawFile(runId, file, 'worktree', raw);
  }

  const source: GitFileSource = file.status === 'A' ? 'worktree' : 'head';
  const response = await getWorkflowRunGitFile(runId, file.path, source, { signal });
  if (response.kind === 'empty') {
    return { kind: 'unavailable', file, emptyReason: response.emptyReason };
  }
  if (response.kind === 'text') {
    return {
      kind: 'text',
      file,
      text: response.text,
      contentHash: response.contentHash,
      truncated: response.truncated,
      cursor: response.cursor,
    };
  }
  return fromRawFile(runId, file, source, response);
}

function selectedFileInSnapshot(
  snapshot: SourceControlSnapshot,
  selected: GitChangedFile | null
): GitChangedFile | undefined {
  if (!selected || snapshot.emptyReason !== undefined) return undefined;
  return snapshot.files.find(file => file.path === selected.path);
}

function sameSnapshot(left: SourceControlSnapshot, right: SourceControlSnapshot): boolean {
  return left.emptyReason === right.emptyReason && left.revision === right.revision;
}

function pendingViewerMatchesFile(
  pending: PendingViewer | null,
  file: GitChangedFile | undefined
): boolean {
  if (!pending || !file) return false;
  return pending.file.path === file.path && pending.file.status === file.status;
}

export function SourceControlTab({ runId }: { runId: string }): ReactElement {
  const [snapshotState, dispatch] = useReducer(
    sourceControlSnapshotReducer,
    INITIAL_SOURCE_CONTROL_STATE
  );
  const [historySnapshotState, dispatchHistory] = useReducer(
    gitLogSnapshotReducer,
    INITIAL_GIT_LOG_STATE
  );
  const queryClient = useQueryClient();
  const stacked = useStackedViewport();
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });
  const pendingListRequestRef = useRef<{ id: number; runId: string } | null>(null);
  const snapshotRef = useRef(snapshotState);
  snapshotRef.current = snapshotState;
  const historySnapshotRef = useRef<GitLogSnapshotState>(historySnapshotState);
  historySnapshotRef.current = historySnapshotState;
  const selectedFileRef = useRef<GitChangedFile | null>(null);
  const viewerStateRef = useRef<FileViewerState>({ kind: 'idle' });
  const pendingViewerRef = useRef<PendingViewer | null>(null);

  const [selectedFile, setSelectedFile] = useState<GitChangedFile | null>(null);
  const [viewerState, setViewerState] = useState<FileViewerState>({ kind: 'idle' });
  const [pendingViewer, setPendingViewer] = useState<PendingViewer | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  selectedFileRef.current = selectedFile;
  viewerStateRef.current = viewerState;
  pendingViewerRef.current = pendingViewer;

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['workflowRunGitChanges', runId],
    queryFn: ({ signal }) => getWorkflowRunGitChanges(runId, { signal }),
    retry: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const {
    data: historyData,
    isError: historyIsError,
    isFetching: historyIsFetching,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['workflowRunGitLog', runId],
    queryFn: ({ signal }) => getWorkflowRunGitLog(runId, { signal }),
    retry: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const abortCurrent = useCallback((): void => {
    const pendingListRequest = pendingListRequestRef.current;
    if (pendingListRequest?.id === requestRef.current.id) {
      void queryClient.cancelQueries({
        queryKey: ['workflowRunGitChanges', pendingListRequest.runId],
        exact: true,
      });
      void queryClient.cancelQueries({
        queryKey: ['workflowRunGitLog', pendingListRequest.runId],
        exact: true,
      });
      pendingListRequestRef.current = null;
    }
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [queryClient]);

  const beginRequest = useCallback((): { id: number; signal: AbortSignal } => {
    abortCurrent();
    const id = requestRef.current.id + 1;
    const controller = new AbortController();
    requestRef.current = { id, controller };
    return { id, signal: controller.signal };
  }, [abortCurrent]);

  const isCurrent = useCallback((id: number, signal: AbortSignal): boolean => {
    return requestRef.current.id === id && !signal.aborted;
  }, []);

  const closeViewer = useCallback((): void => {
    abortCurrent();
    setSelectedFile(null);
    setViewerState({ kind: 'idle' });
    setPendingViewer(null);
    listRef.current?.focus();
  }, [abortCurrent]);

  useEffect(() => {
    dispatch({ type: 'reset' });
    dispatchHistory({ type: 'reset' });
    abortCurrent();
    setSelectedFile(null);
    setViewerState({ kind: 'idle' });
    setPendingViewer(null);
  }, [runId, abortCurrent]);

  useEffect(() => {
    return (): void => {
      abortCurrent();
    };
  }, [abortCurrent]);

  useEffect(() => {
    if (!data) return;
    if (snapshotState.displayed !== null) return;
    dispatch({
      type: 'received',
      snapshot: toSourceControlSnapshot(data),
    });
  }, [data, snapshotState.displayed]);

  useEffect(() => {
    if (!historyData) return;
    if (historySnapshotState.displayed !== null) return;
    dispatchHistory({ type: 'received', snapshot: toGitLogSnapshot(historyData) });
  }, [historyData, historySnapshotState.displayed]);

  const onOpenFile = useCallback(
    (file: GitChangedFile): void => {
      const pendingFile = snapshotRef.current.pending
        ? selectedFileInSnapshot(snapshotRef.current.pending, file)
        : undefined;
      setPendingViewer(null);
      setSelectedFile(file);
      setViewerState({ kind: 'loading', file });
      const { id, signal } = beginRequest();
      void loadViewerFile(runId, file, signal).then(
        (state): void => {
          if (!isCurrent(id, signal)) return;
          setViewerState(state);
        },
        (error: unknown): void => {
          if (isAbortError(error) || !isCurrent(id, signal)) return;
          setViewerState({ kind: 'error', file });
        }
      );
      if (pendingFile) {
        void loadViewerFile(runId, pendingFile, signal).then(
          (state): void => {
            if (!isCurrent(id, signal)) return;
            setPendingViewer({ file: pendingFile, state });
          },
          (): void => undefined
        );
      }
    },
    [beginRequest, isCurrent, runId]
  );

  const onReload = useCallback((): void => {
    const { id, signal } = beginRequest();
    pendingListRequestRef.current = { id, runId };
    void (async (): Promise<void> => {
      try {
        const [result, historyResult] = await Promise.all([refetch(), refetchHistory()]);
        if (!isCurrent(id, signal)) return;
        if (historyResult.isSuccess && historyResult.data !== undefined) {
          dispatchHistory({
            type: 'received',
            snapshot: toGitLogSnapshot(historyResult.data),
          });
        }
        if (!result.isSuccess || result.data === undefined) return;
        const candidate = toSourceControlSnapshot(result.data);
        const candidateFile = selectedFileInSnapshot(candidate, selectedFileRef.current);
        if (!candidateFile) {
          dispatch({ type: 'received', snapshot: candidate });
          return;
        }
        const loaded = await loadViewerFile(runId, candidateFile, signal);
        if (!isCurrent(id, signal)) return;
        const displayedFp = viewerFingerprint(viewerStateRef.current);
        const candidateFp = viewerFingerprint(loaded);
        const displayedSnapshot = snapshotRef.current.displayed;
        const listChanged =
          displayedSnapshot === null || !sameSnapshot(displayedSnapshot, candidate);
        dispatch({ type: 'received', snapshot: candidate });
        if (candidateFp === displayedFp && !listChanged) {
          setPendingViewer(null);
        } else {
          setPendingViewer({ file: candidateFile, state: loaded });
        }
      } catch (error: unknown) {
        if (isAbortError(error) || !isCurrent(id, signal)) return;
      } finally {
        if (pendingListRequestRef.current?.id === id) {
          pendingListRequestRef.current = null;
        }
      }
    })();
  }, [beginRequest, isCurrent, refetch, refetchHistory, runId]);

  const onViewerReload = useCallback((): void => {
    if (viewerState.kind === 'error' && selectedFile) {
      const file = selectedFile;
      const { id, signal } = beginRequest();
      void loadViewerFile(runId, file, signal).then(
        (state): void => {
          if (!isCurrent(id, signal)) return;
          setViewerState(state);
        },
        (error: unknown): void => {
          if (isAbortError(error) || !isCurrent(id, signal)) return;
          setViewerState({ kind: 'error', file });
        }
      );
      return;
    }
    onReload();
  }, [beginRequest, isCurrent, onReload, runId, selectedFile, viewerState.kind]);

  const onViewerCancel = useCallback((): void => {
    if (loadingMoreRef.current) {
      abortCurrent();
      return;
    }
    closeViewer();
  }, [abortCurrent, closeViewer]);

  const onLoadMore = useCallback((): void => {
    const file = selectedFileRef.current;
    const state = viewerStateRef.current;
    if (!file) return;
    const pagingText = state.kind === 'text' && state.truncated && state.cursor !== '';
    const pagingDiff =
      state.kind === 'diff' && state.response.truncated && state.response.cursor !== '';
    if (!pagingText && !pagingDiff) return;

    const { id, signal } = beginRequest();
    loadingMoreRef.current = true;
    setLoadingMore(true);

    void (async (): Promise<void> => {
      const finishPage = (): void => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      };
      try {
        if (state.kind === 'text') {
          const source: GitFileSource = file.status === 'A' ? 'worktree' : 'head';
          const next = await getWorkflowRunGitFile(runId, file.path, source, {
            cursor: state.cursor,
            signal,
          });
          if (!isCurrent(id, signal)) return;
          if (next.kind !== 'text' || next.contentHash !== state.contentHash) {
            finishPage();
            onReload();
            return;
          }
          setViewerState(current => {
            if (current.kind !== 'text') return current;
            return {
              ...current,
              text: current.text + next.text,
              truncated: next.truncated,
              cursor: next.cursor,
            };
          });
          finishPage();
          return;
        }

        if (state.kind !== 'diff') return;
        const next = await getWorkflowRunGitDiff(runId, file.path, {
          cursor: state.response.cursor,
          signal,
        });
        if (!isCurrent(id, signal)) return;
        if ('emptyReason' in next) {
          finishPage();
          onReload();
          return;
        }
        if (
          next.fileFallback ||
          next.path !== state.response.path ||
          next.ref !== state.response.ref ||
          next.status !== state.response.status
        ) {
          finishPage();
          onReload();
          return;
        }
        setViewerState(current => {
          if (current.kind !== 'diff') return current;
          return {
            ...current,
            response: {
              ...current.response,
              hunks: [...current.response.hunks, ...next.hunks],
              truncated: next.truncated,
              cursor: next.cursor,
            },
          };
        });
        finishPage();
      } catch (error: unknown) {
        if (isAbortError(error) || !isCurrent(id, signal)) return;
        finishPage();
        if (isFileChangedError(error)) {
          onReload();
        }
      }
    })();
  }, [beginRequest, isCurrent, onReload, runId]);

  const onAcceptPending = useCallback((): void => {
    abortCurrent();
    const pendingList = snapshotRef.current.pending;
    const pendingHistory = historySnapshotRef.current.pending;
    const acceptedHistory = pendingHistory ?? historySnapshotRef.current.displayed;
    const pendingView = pendingViewerRef.current;
    const acceptedList = pendingList ?? snapshotRef.current.displayed;
    const selected = selectedFileRef.current;
    const acceptedFile = selectedFileInSnapshot(
      acceptedList ?? { files: [], revision: '' },
      selected
    );
    if (pendingList && acceptedFile && !pendingViewerMatchesFile(pendingView, acceptedFile)) {
      return;
    }
    if (pendingList) dispatch({ type: 'accept_pending' });
    if (pendingHistory) dispatchHistory({ type: 'accept_pending' });
    if (
      !acceptedList ||
      acceptedList.emptyReason !== undefined ||
      acceptedHistory?.emptyReason !== undefined ||
      !acceptedFile
    ) {
      setSelectedFile(null);
      setViewerState({ kind: 'idle' });
      setPendingViewer(null);
      listRef.current?.focus();
      return;
    }
    if (pendingView) {
      setSelectedFile(pendingView.file);
      setViewerState(pendingView.state);
    }
    setPendingViewer(null);
  }, [abortCurrent]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeViewer();
  };

  const loadState: SourceControlLoadState = isError ? 'error' : isFetching ? 'loading' : 'idle';
  const historyLoadState: SourceControlLoadState = historyIsError
    ? 'error'
    : historyIsFetching
      ? 'loading'
      : 'idle';
  const pendingListFile = snapshotState.pending
    ? selectedFileInSnapshot(snapshotState.pending, selectedFile)
    : undefined;
  const pendingListNeedsViewer =
    snapshotState.pending?.emptyReason === undefined &&
    snapshotState.pending !== null &&
    selectedFile !== null &&
    pendingListFile !== undefined;
  const changesCanBeAccepted =
    snapshotState.pending === null ||
    !pendingListNeedsViewer ||
    pendingViewerMatchesFile(pendingViewer, pendingListFile);
  const hasPending =
    snapshotState.pending !== null ||
    historySnapshotState.pending !== null ||
    pendingViewer !== null;
  const stale = hasPending && changesCanBeAccepted;

  return (
    <div className="h-full min-h-0" onKeyDown={onKeyDown}>
      <SourceControlSplit
        stacked={stacked}
        list={
          <SourceControlPanel
            snapshot={snapshotState.displayed}
            historySnapshot={historySnapshotState.displayed}
            loadState={loadState}
            historyLoadState={historyLoadState}
            stale={stale}
            onReload={onReload}
            onAcceptPending={onAcceptPending}
            onOpenFile={onOpenFile}
            selectedNowPath={selectedFile?.path ?? null}
            expandedCommit={null}
            commitSnapshot={null}
            commitLoadState="idle"
            onToggleCommit={(): void => undefined}
            onOpenCommitFile={(): void => undefined}
            listRef={listRef}
          />
        }
        viewer={
          <FileViewer
            state={viewerState}
            stacked={stacked}
            loadingMore={loadingMore}
            onCancel={onViewerCancel}
            onReload={onViewerReload}
            onClose={closeViewer}
            onLoadMore={onLoadMore}
          />
        }
      />
    </div>
  );
}
