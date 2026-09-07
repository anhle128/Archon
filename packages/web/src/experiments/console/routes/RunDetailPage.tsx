import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useKeymap, type Binding } from '../lib/keymap';
import { RunDetailHeader } from '../components/RunDetailHeader';
import { WorkflowEnvResolvedTable } from '../components/WorkflowEnvResolvedTable';
import { RunActionBar } from '../components/RunActionBar';
import { StreamToolbar, type DetailView } from '../components/StreamToolbar';
import { ApprovalContext } from '../components/ApprovalContext';
import { ApprovalPanel } from '../components/ApprovalPanel';
import { ArtifactPanel } from '../components/ArtifactPanel';
import { ConsoleInspectPane } from '../components/ConsoleInspectPane';
import { ConsoleAskChrome } from '../components/ask/ConsoleAskChrome';
import {
  createAskAnswerController,
  type AskActionState,
  type AskActionStateByRequest,
} from '../components/ask/ask-answer-controller';
import { isAskAwaitingRun } from '../components/ask/awaiting-chrome';
import { RunStartedLine, RunFinishedLine } from '../components/RunLifecycle';
import { buildConsoleLogEntries } from '../components/inspect/build-console-log-entries';
import { buildLogRows } from '../components/inspect/build-log-rows';
import {
  readNodeSearchParam,
  resolveInitialInspectSelection,
  selectInspectNode,
  type InspectSelection,
} from '../components/inspect/console-inspect-selection';
import { readApprovalContext } from '../components/inspect/read-approval-context';
import { synthesizeLogNodeStates } from '../components/inspect/synthesize-log-node-states';
import { StreamContextProvider } from '../lib/stream-context';
import { useRunStreamSSE } from '../lib/sse';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import { runMessageConversationId, type Run, type RunEnvOverlay } from '../primitives/run';
import { foldNodeRuns } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Project } from '../primitives/project';
import type { AskAnswerBody, ArtifactFile, ConsoleRunDetail } from '../skills/runs';

/**
 * Run detail — the "logs" page, promoted out of a hidden tab.
 *
 * Data sources:
 *   - skill.getRun(id)     → run metadata + workflow_events
 *   - skill.listMessages() → conversation messages (assistant text, user input,
 *                            persisted tool calls in metadata)
 *
 * RunStream merges both into one timeline. Paused runs render the
 * ApprovalContext + ApprovalPanel at the bottom of the stream so the user can
 * answer the gate in place.
 *
 * Updates flow through SSE (lib/sse.ts) with a 30s safety-net refetch
 * for runs that are still running/paused.
 */
const TOGGLE_KEYS = {
  toolCalls: 'archon.console.showToolCalls',
  system: 'archon.console.showSystem',
  view: 'archon.console.detailView',
  node: 'archon.console.runNodeFilter',
} as const;

function readToggle(key: string, defaultOn: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultOn;
    return stored === '1';
  } catch {
    return defaultOn;
  }
}

function writeToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readView(): DetailView {
  try {
    const stored = localStorage.getItem(TOGGLE_KEYS.view);
    return stored === 'graph' ? 'graph' : 'log';
  } catch {
    return 'log';
  }
}

function writeView(v: DetailView): void {
  try {
    localStorage.setItem(TOGGLE_KEYS.view, v);
  } catch {
    /* ignore */
  }
}

function readNodeFilter(): string {
  try {
    return localStorage.getItem(TOGGLE_KEYS.node) ?? 'all';
  } catch {
    return 'all';
  }
}

function writeNodeFilter(v: string): void {
  try {
    localStorage.setItem(TOGGLE_KEYS.node, v);
  } catch {
    /* ignore */
  }
}

function isKnownInspectNode(
  nodeId: string,
  nodeStates: ConsoleRunDetail['nodeStates'],
  rows: ReturnType<typeof buildLogRows>
): boolean {
  return (
    nodeStates.some(state => state.nodeId === nodeId) || rows.some(row => row.nodeId === nodeId)
  );
}

/**
 * ENV chip/table gate for run detail. Malformed/legacy `metadata.envOverlay`
 * stays `null` on the Run primitive — never render false audit UI from hybrids.
 */
export function hasRunEnvOverlayUi(
  run: Pick<Run, 'envOverlay'>
): run is Pick<Run, 'envOverlay'> & { envOverlay: RunEnvOverlay } {
  return run.envOverlay !== null;
}
export function RunDetailPage(): ReactElement {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const appliedRunIdRef = useRef<string | null>(null);
  const prevSearchNodeRef = useRef<string | null>(null);
  const [showToolCalls, setShowToolCalls] = useState<boolean>(() =>
    readToggle(TOGGLE_KEYS.toolCalls, true)
  );
  const [showSystem, setShowSystem] = useState<boolean>(() =>
    readToggle(TOGGLE_KEYS.system, false)
  );
  const [view, setView] = useState<DetailView>(() => readView());
  const [streamNodeFilter, setStreamNodeFilter] = useState<string>(() => readNodeFilter());
  const [inspectSelection, setInspectSelection] = useState<InspectSelection>({
    nodeId: null,
    logRowId: null,
  });
  const [askActions, setAskActions] = useState<{
    runId: string | undefined;
    states: AskActionStateByRequest;
  }>({ runId, states: {} });
  const actionStates = askActions.runId === runId ? askActions.states : {};
  const selectedNodeIdRef = useRef<string | null>(null);

  // `Project | null` / `ConsoleRunDetail | null` rather than the `as unknown as T`
  // casts the original sentinel used — keeps the null path honest for
  // downstream readers (they can guard explicitly instead of meeting a
  // mis-typed value).
  const { data: project } = useEntity<Project | null>(
    projectId !== undefined ? K.project(projectId) : 'noop:no-project-id',
    () => (projectId !== undefined ? skill.getProject(projectId) : Promise.resolve(null))
  );

  const { data: detail, error: detailError } = useEntity<ConsoleRunDetail | null>(
    runId !== undefined ? K.run(runId) : 'noop:no-run-id',
    () => (runId !== undefined ? skill.getRun(runId) : Promise.resolve(null))
  );

  // Messages are tied to the run's conversation — and the /messages endpoint
  // takes the *platform* conversation id, not the DB id. CLI runs expose it as
  // conversationPlatformId; chat-dispatched runs only expose the worker
  // conversation (workerPlatformId), which holds their messages (#2048). The
  // helper picks whichever is present.
  const conversationPlatformId = runMessageConversationId(detail?.run);

  const { data: messages } = useEntity<Message[]>(
    conversationPlatformId !== null
      ? K.messages(conversationPlatformId)
      : 'noop:no-conversation-id',
    () =>
      conversationPlatformId !== null
        ? skill.listMessages(conversationPlatformId)
        : Promise.resolve([])
  );

  // Live updates: subscribe to the conversation SSE stream. Events here
  // invalidate the run and messages caches; useEntity refetches authoritative
  // state. Auto-reconnects on disconnect. The hook itself no-ops while the
  // conversation id is still unknown.
  useRunStreamSSE(conversationPlatformId, runId ?? null);

  // SSE-drop safety net: if the stream silently dies (network hiccup,
  // sleep/wake, mobile transitions) the EventSource will reconnect but we
  // may have missed terminal events in the meantime. A 30s heartbeat refetch
  // while status is non-terminal catches that without being polling proper —
  // it stops the moment the run hits a terminal state.
  const status = detail?.run.status;
  useEffect(() => {
    if (runId === undefined) return;
    if (status !== 'running' && status !== 'paused') return;
    const id = setInterval(() => {
      invalidate(K.run(runId));
      if (conversationPlatformId !== null) {
        invalidate(K.messages(conversationPlatformId));
      }
    }, 30000);
    return (): void => {
      clearInterval(id);
    };
  }, [runId, status, conversationPlatformId]);

  // Surface the artifact count on the tab even when the user hasn't visited
  // the panel yet. Cheap call — the server walks one directory. Must live
  // above any early return so the hook order stays stable across renders.
  const { data: artifactFiles } = useEntity<ArtifactFile[]>(
    runId !== undefined ? K.artifacts(runId) : 'noop:no-run-id',
    () =>
      runId !== undefined ? skill.listRunArtifacts(runId) : Promise.resolve([] as ArtifactFile[])
  );

  const inspectNodeStates = useMemo(() => {
    if (detail === undefined || detail === null) return [];
    return synthesizeLogNodeStates(
      detail.nodeStates,
      detail.rawEvents,
      detail.run.status,
      detail.approval
    );
  }, [detail]);

  const logRows = useMemo(
    () => buildLogRows(inspectNodeStates, detail?.rawEvents ?? []),
    [inspectNodeStates, detail]
  );

  const logEntries = useMemo(
    () =>
      buildConsoleLogEntries({
        rows: logRows,
        rawEvents: detail?.rawEvents ?? [],
        nodeRuns: foldNodeRuns(detail?.events ?? []),
        runStartedAt: detail?.run.startedAt ?? '',
      }),
    [logRows, detail]
  );

  // Distinct nodes drive the node-filter dropdown — derived from the same fold
  // the stream renders, so the options match the dividers exactly.
  const nodeOptions = useMemo(
    () => foldNodeRuns(detail?.events ?? []).map(r => ({ id: r.nodeId, name: r.nodeName })),
    [detail?.events]
  );

  // Drop a persisted node selection that doesn't apply to this run (e.g. after
  // navigating to a different workflow). Guarded on the run being loaded so the
  // empty list during loading can't clobber a still-valid stored selection.
  // useLayoutEffect (not useEffect) so the reset lands before paint — navigating
  // to a cached run whose node set lacks the selection never flashes an empty
  // "Waiting for first event…" frame.
  useLayoutEffect(() => {
    if (detail === undefined || detail === null) return;
    if (streamNodeFilter !== 'all' && !nodeOptions.some(o => o.id === streamNodeFilter)) {
      setStreamNodeFilter('all');
    }
  }, [detail, nodeOptions, streamNodeFilter]);

  useEffect(() => {
    if (detail === undefined || detail === null || runId === undefined) return;
    if (appliedRunIdRef.current === runId) return;
    appliedRunIdRef.current = runId;
    setInspectSelection(
      resolveInitialInspectSelection({
        requestedNodeId: readNodeSearchParam(location.search),
        nodeStates: inspectNodeStates,
        rows: logRows,
        approvalNodeId: readApprovalContext(detail.approval)?.nodeId ?? null,
      })
    );
  }, [detail, runId, inspectNodeStates, logRows, location.search]);

  useEffect(() => {
    const requested = readNodeSearchParam(location.search);
    const previous = prevSearchNodeRef.current;
    prevSearchNodeRef.current = requested;
    if (appliedRunIdRef.current !== runId || runId === undefined) return;
    if (requested === null || requested === previous) return;
    if (requested === inspectSelection.nodeId) return;
    if (!isKnownInspectNode(requested, inspectNodeStates, logRows)) return;
    setInspectSelection({ nodeId: requested, logRowId: null });
  }, [location.search, runId, inspectSelection.nodeId, inspectNodeStates, logRows]);

  const replaceNodeSearch = useCallback(
    (nodeId: string | null): void => {
      const params = new URLSearchParams(location.search);
      if (nodeId === null || nodeId === '') params.delete('node');
      else params.set('node', nodeId);
      const next = params.toString();
      const search = next === '' ? '' : `?${next}`;
      if (search === location.search) return;
      navigate({ search }, { replace: true });
    },
    [location.search, navigate]
  );

  const onInspectSelect = useCallback(
    (nodeId: string, rowId?: string): void => {
      setInspectSelection(selectInspectNode(nodeId, rowId ?? null));
      replaceNodeSearch(nodeId);
    },
    [replaceNodeSearch]
  );

  selectedNodeIdRef.current = inspectSelection.nodeId;

  const setAskActionState = useCallback(
    (requestId: string, state: AskActionState): void => {
      setAskActions(current => ({
        runId,
        states: {
          ...(current.runId === runId ? current.states : {}),
          [requestId]: state,
        },
      }));
    },
    [runId]
  );

  const askController = useMemo(
    () =>
      runId === undefined
        ? null
        : createAskAnswerController({
            runId,
            postAnswer: skill.answerAskHuman,
            setActionState: setAskActionState,
            invalidate: async (): Promise<void> => {
              invalidate(K.run(runId));
              const selectedNodeId = selectedNodeIdRef.current;
              if (selectedNodeId !== null) {
                invalidate(K.nodeMessages(runId, selectedNodeId));
              }
            },
            now: (): Date => new Date(),
          }),
    [runId, setAskActionState]
  );

  const submitAsk = useCallback(
    (requestId: string, body: AskAnswerBody): Promise<void> =>
      askController?.submit(requestId, body) ?? Promise.resolve(),
    [askController]
  );

  const onCloseRoom = useCallback((): void => {
    setInspectSelection({ nodeId: null, logRowId: null });
    replaceNodeSearch(null);
  }, [replaceNodeSearch]);

  // Auto-scroll to bottom on new content IF user is already near the bottom.
  const lastBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    // Near-bottom heuristic: within 120px of the end.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    lastBottomRef.current = atBottom;
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !lastBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, detail?.events.length]);

  // Keymap bindings: hoisted above early returns so the hook order is stable
  // across all render paths (loading, error, ready).
  const detailStatus = detail?.run.status ?? null;
  const isPaused = detailStatus === 'paused';
  const hasDeclaredGate = isPaused && detail?.run.approval != null;
  const goBack = useCallback((): void => {
    if (projectId !== undefined) navigate(`/console/p/${projectId}`);
    else navigate('/console');
  }, [navigate, projectId]);
  const setViewPersist = useCallback((next: DetailView): void => {
    setView(next);
    writeView(next);
  }, []);
  const toggleToolCalls = useCallback((): void => {
    setShowToolCalls(v => {
      const next = !v;
      writeToggle(TOGGLE_KEYS.toolCalls, next);
      return next;
    });
  }, []);
  const toggleSystem = useCallback((): void => {
    setShowSystem(v => {
      const next = !v;
      writeToggle(TOGGLE_KEYS.system, next);
      return next;
    });
  }, []);
  // Approve/Reject keymap bindings fire the matching button's click event
  // rather than lifting ApprovalPanel's internal state — keeps the panel
  // self-contained and avoids prop drilling for a paused-only shortcut.
  const clickApprove = useCallback((): void => {
    const el = document.querySelector<HTMLButtonElement>('[data-keymap-approve]');
    if (el !== null && !el.disabled) el.click();
  }, []);
  const clickReject = useCallback((): void => {
    const el = document.querySelector<HTMLButtonElement>('[data-keymap-reject]');
    if (el !== null && !el.disabled) el.click();
  }, []);
  const bindings = useMemo<readonly Binding[]>(
    () => [
      {
        keys: ['1'],
        label: 'Log tab',
        run: (): void => {
          setViewPersist('log');
        },
      },
      {
        keys: ['2'],
        label: 'Graph tab',
        run: (): void => {
          setViewPersist('graph');
        },
      },
      {
        keys: ['3'],
        label: 'Artifacts tab',
        run: (): void => {
          setViewPersist('artifacts');
        },
      },
      { keys: ['t'], label: 'Toggle tool calls', run: toggleToolCalls },
      { keys: ['s'], label: 'Toggle system', run: toggleSystem },
      {
        keys: ['a'],
        label: 'Approve',
        when: (): boolean => hasDeclaredGate,
        run: clickApprove,
      },
      {
        keys: ['r'],
        label: 'Reject',
        when: (): boolean => hasDeclaredGate,
        run: clickReject,
      },
      { keys: ['Escape'], label: 'Back to runs', run: goBack },
      { keys: ['h'], label: 'Back to runs', run: goBack },
    ],
    [
      hasDeclaredGate,
      goBack,
      setViewPersist,
      toggleToolCalls,
      toggleSystem,
      clickApprove,
      clickReject,
    ]
  );
  useKeymap({ bindings });

  if (projectId === undefined || runId === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
        Invalid run URL.
      </div>
    );
  }

  if (detailError !== undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-text-primary">Could not load run.</p>
        <p className="font-mono text-[11px] text-text-tertiary">{detailError.message}</p>
      </div>
    );
  }

  if (detail === undefined || detail === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
        Loading run…
      </div>
    );
  }

  const { run, events } = detail;
  const messageList = messages ?? [];
  const inlineToolCount = messageList.reduce((acc, m) => acc + m.toolCalls.length, 0);
  // Mirror RunStream's source-of-truth rule: when no inline tool calls exist
  // on messages, the workflow tool_called events become the canonical count.
  const workflowToolCount =
    inlineToolCount === 0
      ? events.filter(e => e.kind === 'tool_call' && e.result === null).length
      : 0;
  const toolCallCount = inlineToolCount + workflowToolCount;

  const toolbar = (
    <StreamToolbar
      view={view}
      onChangeView={next => {
        setView(next);
        writeView(next);
      }}
      showToolCalls={showToolCalls}
      onToggleToolCalls={next => {
        setShowToolCalls(next);
        writeToggle(TOGGLE_KEYS.toolCalls, next);
      }}
      showSystem={showSystem}
      onToggleSystem={next => {
        setShowSystem(next);
        writeToggle(TOGGLE_KEYS.system, next);
      }}
      toolCallCount={toolCallCount}
      messageCount={messageList.length}
      artifactCount={artifactFiles?.length ?? null}
      nodeOptions={nodeOptions}
      selectedNodeId={streamNodeFilter}
      onSelectNode={next => {
        setStreamNodeFilter(next);
        writeNodeFilter(next);
      }}
    />
  );

  const logHeader: ReactNode = (
    <>
      <div className="sticky top-0 z-10 bg-surface px-6">{toolbar}</div>
      <div className="px-6 pt-4">
        {detail.usage === null ? (
          <div
            className="mb-3 rounded-[10px] border border-warning/40 bg-warning/[0.06] px-3 py-2 text-[12px] text-warning"
            role="status"
          >
            Usage report unavailable for this run. This is not zero cost.
          </div>
        ) : null}
        {hasRunEnvOverlayUi(run) ? <WorkflowEnvResolvedTable overlay={run.envOverlay} /> : null}
        <RunStartedLine run={run} />
      </div>
    </>
  );

  const logFooter: ReactNode = (
    <div className="px-6 pb-4">
      <RunFinishedLine run={run} />
      {run.status === 'paused' && run.approval !== null && run.approval !== undefined ? (
        <div className="mt-6 rounded border border-warning/30 bg-warning/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-warning" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
              Waiting for approval
            </span>
          </div>
          <ApprovalContext run={run} />
          <div className="mt-2">
            <ApprovalPanel run={run} />
          </div>
        </div>
      ) : null}
    </div>
  );

  const projectCwd = project?.path;
  const inspectView = view === 'graph' ? 'graph' : 'log';
  const showInspectPane = view !== 'artifacts' && projectCwd !== undefined;

  return (
    <StreamContextProvider value={{ runStartedAt: run.startedAt }}>
      <section className="flex h-full flex-col">
        <RunDetailHeader
          run={run}
          projectId={projectId}
          projectName={project?.name ?? projectId}
          usage={detail.usage}
          askAwaiting={isAskAwaitingRun(run.status, detail.pendingInteractions)}
        />
        <ConsoleAskChrome
          status={run.status}
          pendingInteractions={detail.pendingInteractions}
          nodeStates={inspectNodeStates}
          runError={detail.runError}
          onRequestGraphView={(): void => {
            setViewPersist('graph');
          }}
          onSelectAwaitingNode={(nodeId: string): void => {
            onInspectSelect(nodeId);
          }}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === 'artifacts' ? (
            <>
              <div className="px-6">{toolbar}</div>
              <ArtifactPanel runId={runId} />
            </>
          ) : showInspectPane && projectCwd !== undefined ? (
            <>
              {view === 'graph' ? <div className="px-6">{toolbar}</div> : null}
              <ConsoleInspectPane
                view={inspectView}
                run={run}
                projectId={projectId}
                projectCwd={projectCwd}
                messages={messageList}
                events={events}
                rawEvents={detail.rawEvents}
                nodeStates={inspectNodeStates}
                approval={detail.approval}
                logEntries={logEntries}
                usage={detail.usage}
                streamNodeFilter={streamNodeFilter}
                selectedNodeId={inspectSelection.nodeId}
                selectedLogRowId={inspectSelection.logRowId}
                showToolCalls={showToolCalls}
                showSystem={showSystem}
                logHeader={logHeader}
                logFooter={logFooter}
                logScrollRef={scrollRef}
                onSelectNode={onInspectSelect}
                onCloseRoom={onCloseRoom}
                loadDefinition={skill.getWorkflowDagNodes}
                loadMessages={skill.listNodeMessages}
                pendingInteractions={detail.pendingInteractions}
                viewerIsStarter={detail.viewerIsStarter}
                starterDisplayName={detail.starterDisplayName}
                actionStates={actionStates}
                onSubmitAsk={submitAsk}
              />
            </>
          ) : (
            <>
              <div className="px-6">{toolbar}</div>
              <div className="p-6 text-[12px] text-text-tertiary">Loading project…</div>
            </>
          )}
        </div>

        <RunActionBar run={run} />
      </section>
    </StreamContextProvider>
  );
}
