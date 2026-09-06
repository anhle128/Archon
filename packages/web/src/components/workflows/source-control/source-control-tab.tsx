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
  type GitLogCommit,
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
  type GitLogSnapshot,
  type GitLogSnapshotState,
  type SourceControlSnapshot,
  type SourceControlSnapshotState,
} from './source-control-state';
import { useStackedViewport } from './use-stacked-viewport';

type LoadedViewerState = Exclude<FileViewerState, { kind: 'idle' | 'loading' | 'error' }>;

type ViewerScope = { kind: 'now' } | { kind: 'commit'; oid: string; parentOid: string | null };

interface PendingViewer {
  file: GitChangedFile;
  scope: ViewerScope;
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

function sameViewerScope(left: ViewerScope, right: ViewerScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'now' ||
      (right.kind === 'commit' && left.oid === right.oid && left.parentOid === right.parentOid))
  );
}

function rawSourceFor(file: GitChangedFile, scope: ViewerScope): GitFileSource | null {
  if (scope.kind === 'now') return file.status === 'D' ? 'head' : 'worktree';
  if (file.status !== 'D') return scope.oid;
  return scope.parentOid;
}

async function loadViewerFile(
  runId: string,
  file: GitChangedFile,
  scope: ViewerScope,
  signal: AbortSignal
): Promise<LoadedViewerState> {
  if (file.status === 'M') {
    const response = await getWorkflowRunGitDiff(runId, file.path, {
      signal,
      ref: scope.kind === 'commit' ? scope.oid : undefined,
    });
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
    const source = rawSourceFor(file, scope);
    if (source === null) throw new Error('Commit deletion has no parent');
    const raw = await getWorkflowRunGitFile(runId, file.path, source, { signal });
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
    return fromRawFile(runId, file, source, raw);
  }
  const source = rawSourceFor(file, scope);
  if (source === null) throw new Error('Commit deletion has no parent');
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

function sameGitLogSnapshot(left: GitLogSnapshot, right: GitLogSnapshot): boolean {
  return left.emptyReason === right.emptyReason && left.revision === right.revision;
}

function pendingAfterReceive<T>(
  current: { displayed: T | null; pending: T | null },
  incoming: T | null,
  same: (left: T, right: T) => boolean
): T | null {
  if (incoming === null) return current.pending;
  if (current.displayed === null) return null;
  if (same(current.displayed, incoming)) return null;
  return incoming;
}

function historyContainsOid(snapshot: GitLogSnapshot | null, oid: string): boolean {
  return (
    snapshot !== null &&
    snapshot.emptyReason === undefined &&
    snapshot.commits.some(commit => commit.oid === oid)
  );
}

function pendingViewerMatchesFile(
  pending: PendingViewer | null,
  file: GitChangedFile | undefined,
  scope: ViewerScope
): boolean {
  if (!pending || !file) return false;
  return (
    pending.file.path === file.path &&
    pending.file.status === file.status &&
    sameViewerScope(pending.scope, scope)
  );
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
  const [commitSnapshotState, dispatchCommit] = useReducer(
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
  const pendingListRequestRef = useRef<{
    id: number;
    runId: string;
    commitOid: string | null;
  } | null>(null);
  const snapshotRef = useRef(snapshotState);
  snapshotRef.current = snapshotState;
  const historySnapshotRef = useRef<GitLogSnapshotState>(historySnapshotState);
  historySnapshotRef.current = historySnapshotState;
  const commitSnapshotRef = useRef<SourceControlSnapshotState>(commitSnapshotState);
  commitSnapshotRef.current = commitSnapshotState;
  const selectedFileRef = useRef<GitChangedFile | null>(null);
  const viewerStateRef = useRef<FileViewerState>({ kind: 'idle' });
  const pendingViewerRef = useRef<PendingViewer | null>(null);
  const viewerScopeRef = useRef<ViewerScope>({ kind: 'now' });
  const expandedCommitRef = useRef<GitLogCommit | null>(null);

  const [selectedFile, setSelectedFile] = useState<GitChangedFile | null>(null);
  const [viewerState, setViewerState] = useState<FileViewerState>({ kind: 'idle' });
  const [pendingViewer, setPendingViewer] = useState<PendingViewer | null>(null);
  const [viewerScope, setViewerScope] = useState<ViewerScope>({ kind: 'now' });
  const [expandedCommit, setExpandedCommit] = useState<GitLogCommit | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  selectedFileRef.current = selectedFile;
  viewerStateRef.current = viewerState;
  pendingViewerRef.current = pendingViewer;
  viewerScopeRef.current = viewerScope;
  expandedCommitRef.current = expandedCommit;

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

  const {
    data: commitData,
    isError: commitIsError,
    isFetching: commitIsFetching,
    refetch: refetchCommit,
  } = useQuery({
    queryKey: ['workflowRunGitChanges', runId, expandedCommit?.oid ?? null],
    enabled: expandedCommit !== null,
    queryFn: ({ signal }) => {
      if (expandedCommit === null) throw new Error('Missing expanded commit');
      return getWorkflowRunGitChanges(runId, { ref: expandedCommit.oid, signal });
    },
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
      if (pendingListRequest.commitOid !== null) {
        void queryClient.cancelQueries({
          queryKey: [
            'workflowRunGitChanges',
            pendingListRequest.runId,
            pendingListRequest.commitOid,
          ],
          exact: true,
        });
      }
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
    viewerScopeRef.current = { kind: 'now' };
    setViewerScope({ kind: 'now' });
    listRef.current?.focus();
  }, [abortCurrent]);

  useEffect(() => {
    dispatch({ type: 'reset' });
    dispatchHistory({ type: 'reset' });
    dispatchCommit({ type: 'reset' });
    abortCurrent();
    setSelectedFile(null);
    setViewerState({ kind: 'idle' });
    setPendingViewer(null);
    setExpandedCommit(null);
    viewerScopeRef.current = { kind: 'now' };
    setViewerScope({ kind: 'now' });
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

  useEffect(() => {
    if (!commitData) return;
    if (commitSnapshotState.displayed !== null) return;
    dispatchCommit({
      type: 'received',
      snapshot: toSourceControlSnapshot(commitData),
    });
  }, [commitData, commitSnapshotState.displayed]);

  const onOpenScopedFile = useCallback(
    (file: GitChangedFile, scope: ViewerScope): void => {
      viewerScopeRef.current = scope;
      setViewerScope(scope);
      const pendingFile =
        scope.kind === 'now'
          ? snapshotRef.current.pending
            ? selectedFileInSnapshot(snapshotRef.current.pending, file)
            : undefined
          : expandedCommitRef.current?.oid === scope.oid && commitSnapshotRef.current.pending
            ? selectedFileInSnapshot(commitSnapshotRef.current.pending, file)
            : undefined;
      setPendingViewer(null);
      setSelectedFile(file);
      setViewerState({ kind: 'loading', file });
      const { id, signal } = beginRequest();
      void loadViewerFile(runId, file, scope, signal).then(
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
        void loadViewerFile(runId, pendingFile, scope, signal).then(
          (state): void => {
            if (!isCurrent(id, signal)) return;
            setPendingViewer({ file: pendingFile, scope, state });
          },
          (): void => undefined
        );
      }
    },
    [beginRequest, isCurrent, runId]
  );

  const onOpenFile = useCallback(
    (file: GitChangedFile): void => {
      onOpenScopedFile(file, { kind: 'now' });
    },
    [onOpenScopedFile]
  );

  const onOpenCommitFile = useCallback(
    (file: GitChangedFile): void => {
      const commit = expandedCommitRef.current;
      if (commit === null) return;
      onOpenScopedFile(file, {
        kind: 'commit',
        oid: commit.oid,
        parentOid: commit.parents[0] ?? null,
      });
    },
    [onOpenScopedFile]
  );

  const onToggleCommit = useCallback((commit: GitLogCommit): void => {
    setExpandedCommit(current => (current?.oid === commit.oid ? null : commit));
    dispatchCommit({ type: 'reset' });
  }, []);

  const onReload = useCallback((): void => {
    const { id, signal } = beginRequest();
    const expanded = expandedCommitRef.current;
    pendingListRequestRef.current = { id, runId, commitOid: expanded?.oid ?? null };
    void (async (): Promise<void> => {
      try {
        const [nowResult, historyResult, commitResult] = await Promise.all([
          refetch(),
          refetchHistory(),
          expanded === null ? Promise.resolve(null) : refetchCommit(),
        ]);
        if (!isCurrent(id, signal)) return;

        const nowSnapshot =
          nowResult.isSuccess && nowResult.data !== undefined
            ? toSourceControlSnapshot(nowResult.data)
            : null;
        const historySnapshot =
          historyResult.isSuccess && historyResult.data !== undefined
            ? toGitLogSnapshot(historyResult.data)
            : null;
        const commitSnapshot =
          commitResult?.isSuccess && commitResult.data !== undefined
            ? toSourceControlSnapshot(commitResult.data)
            : null;

        if (nowSnapshot) dispatch({ type: 'received', snapshot: nowSnapshot });
        if (historySnapshot) {
          dispatchHistory({ type: 'received', snapshot: historySnapshot });
        }
        if (commitSnapshot) {
          dispatchCommit({ type: 'received', snapshot: commitSnapshot });
        }

        const pendingNow = pendingAfterReceive(snapshotRef.current, nowSnapshot, sameSnapshot);
        const pendingHistory = pendingAfterReceive(
          historySnapshotRef.current,
          historySnapshot,
          sameGitLogSnapshot
        );
        const pendingCommit = pendingAfterReceive(
          commitSnapshotRef.current,
          commitSnapshot,
          sameSnapshot
        );

        const selected = selectedFileRef.current;
        const scope = viewerScopeRef.current;
        if (!selected) return;

        const expandedNow = expandedCommitRef.current;
        let reloadFile: GitChangedFile | null = selected;
        if (scope.kind === 'now') {
          reloadFile = pendingNow
            ? (selectedFileInSnapshot(pendingNow, selected) ?? null)
            : selected;
        } else if (expandedNow !== null && scope.oid === expandedNow.oid) {
          reloadFile = pendingCommit
            ? (selectedFileInSnapshot(pendingCommit, selected) ?? null)
            : selected;
        }

        if (reloadFile === null) return;

        const loaded = await loadViewerFile(runId, reloadFile, scope, signal);
        if (!isCurrent(id, signal)) return;

        const snapshotsUnchanged =
          pendingNow === null && pendingHistory === null && pendingCommit === null;
        if (
          viewerFingerprint(loaded) === viewerFingerprint(viewerStateRef.current) &&
          snapshotsUnchanged
        ) {
          setPendingViewer(null);
        } else {
          setPendingViewer({ file: reloadFile, scope, state: loaded });
        }
      } catch (error: unknown) {
        if (isAbortError(error) || !isCurrent(id, signal)) return;
      } finally {
        if (pendingListRequestRef.current?.id === id) {
          pendingListRequestRef.current = null;
        }
      }
    })();
  }, [beginRequest, isCurrent, refetch, refetchCommit, refetchHistory, runId]);

  const onViewerReload = useCallback((): void => {
    if (viewerState.kind === 'error' && selectedFile) {
      const file = selectedFile;
      const { id, signal } = beginRequest();
      void loadViewerFile(runId, file, viewerScopeRef.current, signal).then(
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
    const scope = viewerScopeRef.current;
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
          const source = rawSourceFor(file, scope);
          if (source === null) {
            finishPage();
            setViewerState({ kind: 'error', file });
            return;
          }
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
          ref: scope.kind === 'commit' ? scope.oid : undefined,
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
    const pendingNow = snapshotRef.current.pending;
    const pendingHistory = historySnapshotRef.current.pending;
    const pendingCommit = commitSnapshotRef.current.pending;
    const pendingView = pendingViewerRef.current;
    const selected = selectedFileRef.current;
    const scope = viewerScopeRef.current;
    const expanded = expandedCommitRef.current;
    const acceptedNow = pendingNow ?? snapshotRef.current.displayed;
    const acceptedHistory = pendingHistory ?? historySnapshotRef.current.displayed;
    const acceptedCommit = pendingCommit ?? commitSnapshotRef.current.displayed;

    if (scope.kind === 'now' && pendingNow) {
      const matching = selectedFileInSnapshot(pendingNow, selected);
      if (matching && !pendingViewerMatchesFile(pendingView, matching, scope)) {
        return;
      }
    }
    if (
      scope.kind === 'commit' &&
      expanded !== null &&
      scope.oid === expanded.oid &&
      pendingCommit
    ) {
      const matching = selectedFileInSnapshot(pendingCommit, selected);
      if (matching && !pendingViewerMatchesFile(pendingView, matching, scope)) {
        return;
      }
    }

    const acceptedListForScope =
      scope.kind === 'now'
        ? acceptedNow
        : scope.kind === 'commit' && expanded !== null && scope.oid === expanded.oid
          ? acceptedCommit
          : null;
    const fileGoneFromScopeList =
      acceptedListForScope !== null &&
      selected !== null &&
      selectedFileInSnapshot(acceptedListForScope, selected) === undefined;
    const anyCap6 =
      acceptedNow?.emptyReason !== undefined ||
      acceptedHistory?.emptyReason !== undefined ||
      acceptedCommit?.emptyReason !== undefined;

    const acceptAllReducers = (): void => {
      if (pendingNow) dispatch({ type: 'accept_pending' });
      if (pendingHistory) dispatchHistory({ type: 'accept_pending' });
      if (pendingCommit) dispatchCommit({ type: 'accept_pending' });
    };

    const collapseIfMissingFromHistory = (): void => {
      if (expanded !== null && !historyContainsOid(acceptedHistory, expanded.oid)) {
        setExpandedCommit(null);
        dispatchCommit({ type: 'reset' });
      }
    };

    if (anyCap6) {
      acceptAllReducers();
      setSelectedFile(null);
      setViewerState({ kind: 'idle' });
      setPendingViewer(null);
      viewerScopeRef.current = { kind: 'now' };
      setViewerScope({ kind: 'now' });
      setExpandedCommit(null);
      dispatchCommit({ type: 'reset' });
      listRef.current?.focus();
      return;
    }

    if (fileGoneFromScopeList) {
      acceptAllReducers();
      setSelectedFile(null);
      setViewerState({ kind: 'idle' });
      setPendingViewer(null);
      viewerScopeRef.current = { kind: 'now' };
      setViewerScope({ kind: 'now' });
      collapseIfMissingFromHistory();
      listRef.current?.focus();
      return;
    }

    acceptAllReducers();
    collapseIfMissingFromHistory();
    if (pendingView && sameViewerScope(pendingView.scope, scope)) {
      setSelectedFile(pendingView.file);
      setViewerState(pendingView.state);
      viewerScopeRef.current = pendingView.scope;
      setViewerScope(pendingView.scope);
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
  const commitLoadState: SourceControlLoadState = commitIsError
    ? 'error'
    : commitIsFetching
      ? 'loading'
      : 'idle';
  const pendingNowFile = snapshotState.pending
    ? selectedFileInSnapshot(snapshotState.pending, selectedFile)
    : undefined;
  const pendingNowNeedsViewer =
    viewerScope.kind === 'now' &&
    snapshotState.pending?.emptyReason === undefined &&
    snapshotState.pending !== null &&
    selectedFile !== null &&
    pendingNowFile !== undefined;
  const pendingCommitFile = commitSnapshotState.pending
    ? selectedFileInSnapshot(commitSnapshotState.pending, selectedFile)
    : undefined;
  const pendingCommitNeedsViewer =
    viewerScope.kind === 'commit' &&
    expandedCommit !== null &&
    viewerScope.oid === expandedCommit.oid &&
    commitSnapshotState.pending?.emptyReason === undefined &&
    commitSnapshotState.pending !== null &&
    selectedFile !== null &&
    pendingCommitFile !== undefined;
  const changesCanBeAccepted =
    (!pendingNowNeedsViewer ||
      pendingViewerMatchesFile(pendingViewer, pendingNowFile, viewerScope)) &&
    (!pendingCommitNeedsViewer ||
      pendingViewerMatchesFile(pendingViewer, pendingCommitFile, viewerScope));
  const hasPending =
    snapshotState.pending !== null ||
    historySnapshotState.pending !== null ||
    commitSnapshotState.pending !== null ||
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
            selectedNowPath={viewerScope.kind === 'now' ? (selectedFile?.path ?? null) : null}
            selectedCommitPath={
              viewerScope.kind === 'commit' && viewerScope.oid === expandedCommit?.oid
                ? (selectedFile?.path ?? null)
                : null
            }
            expandedCommit={expandedCommit}
            commitSnapshot={commitSnapshotState.displayed}
            commitLoadState={commitLoadState}
            onToggleCommit={onToggleCommit}
            onOpenCommitFile={onOpenCommitFile}
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
