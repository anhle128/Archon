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
  gitFileUrl,
  type GitChangedFile,
  type GitFileSource,
} from '@/lib/api';

import { FileViewer, type FileViewerState } from './file-viewer';
import { SourceControlPanel, type SourceControlLoadState } from './source-control-panel';
import { SourceControlSplit } from './source-control-split';
import {
  INITIAL_SOURCE_CONTROL_STATE,
  sourceControlSnapshotReducer,
  toSourceControlSnapshot,
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

function viewerFingerprint(state: FileViewerState): string {
  switch (state.kind) {
    case 'text':
      return `text:${state.contentHash}`;
    case 'binary':
      return `binary:${state.contentHash}`;
    case 'diff':
      return `diff:${JSON.stringify(state.response)}`;
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
    if (!response.binary) return { kind: 'diff', file, response };
    const raw = await getWorkflowRunGitFile(runId, file.path, 'worktree', { signal });
    if (raw.kind === 'empty') {
      return { kind: 'unavailable', file, emptyReason: raw.emptyReason };
    }
    if (raw.kind !== 'binary') throw new Error('Invalid binary git file response');
    return {
      kind: 'binary',
      file,
      contentHash: raw.contentHash,
      downloadHref: gitFileUrl(runId, file.path, 'worktree'),
    };
  }

  const source: GitFileSource = file.status === 'A' ? 'worktree' : 'head';
  const response = await getWorkflowRunGitFile(runId, file.path, source, { signal });
  if (response.kind === 'empty') {
    return { kind: 'unavailable', file, emptyReason: response.emptyReason };
  }
  if (response.kind === 'binary') {
    return {
      kind: 'binary',
      file,
      contentHash: response.contentHash,
      downloadHref: gitFileUrl(runId, file.path, source),
    };
  }
  return {
    kind: 'text',
    file,
    text: response.text,
    contentHash: response.contentHash,
  };
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
  const selectedFileRef = useRef<GitChangedFile | null>(null);
  const viewerStateRef = useRef<FileViewerState>({ kind: 'idle' });
  const pendingViewerRef = useRef<PendingViewer | null>(null);

  const [selectedFile, setSelectedFile] = useState<GitChangedFile | null>(null);
  const [viewerState, setViewerState] = useState<FileViewerState>({ kind: 'idle' });
  const [pendingViewer, setPendingViewer] = useState<PendingViewer | null>(null);

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

  const abortCurrent = useCallback((): void => {
    const pendingListRequest = pendingListRequestRef.current;
    if (pendingListRequest?.id === requestRef.current.id) {
      void queryClient.cancelQueries({
        queryKey: ['workflowRunGitChanges', pendingListRequest.runId],
        exact: true,
      });
      pendingListRequestRef.current = null;
    }
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
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
        const result = await refetch();
        if (!isCurrent(id, signal)) return;
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
  }, [beginRequest, isCurrent, refetch, runId]);

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

  const onAcceptPending = useCallback((): void => {
    abortCurrent();
    const pendingList = snapshotRef.current.pending;
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
    if (!acceptedList || acceptedList.emptyReason !== undefined || !acceptedFile) {
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
  const pendingListFile = snapshotState.pending
    ? selectedFileInSnapshot(snapshotState.pending, selectedFile)
    : undefined;
  const pendingListNeedsViewer =
    snapshotState.pending?.emptyReason === undefined &&
    snapshotState.pending !== null &&
    selectedFile !== null &&
    pendingListFile !== undefined;
  const stale =
    snapshotState.pending !== null
      ? !pendingListNeedsViewer || pendingViewerMatchesFile(pendingViewer, pendingListFile)
      : pendingViewer !== null;

  return (
    <div className="h-full min-h-0" onKeyDown={onKeyDown}>
      <SourceControlSplit
        stacked={stacked}
        list={
          <SourceControlPanel
            snapshot={snapshotState.displayed}
            loadState={loadState}
            stale={stale}
            onReload={onReload}
            onAcceptPending={onAcceptPending}
            onOpenFile={onOpenFile}
            selectedPath={selectedFile?.path ?? null}
            listRef={listRef}
          />
        }
        viewer={
          <FileViewer
            state={viewerState}
            stacked={stacked}
            onCancel={closeViewer}
            onReload={onViewerReload}
            onClose={closeViewer}
          />
        }
      />
    </div>
  );
}
