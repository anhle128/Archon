/**
 * Console-owned inspect room: one persistent surface for every Story 5.5
 * node body, with Ask cards inline at agent tool invocations.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { formatToolIo, projectToolTranscript } from '@/lib/pair-tool-transcript';
import { projectTextTranscript } from '@/lib/project-text-transcript';
import type { Run } from '../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import { submitRunReviewFeedback } from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import { ApprovalPanel } from './ApprovalPanel';
import { ConsoleAskCard, ConsoleInvalidAskCard } from './ask/ConsoleAskCard';
import type { AskActionStateByRequest } from './ask/ask-answer-controller';
import { resolveAskCardPresentation } from './ask/ask-card-presentation';
import { parseAskEnvelope } from './ask/parse-ask-envelope';
import { selectVisibleNodeAskInteractions } from './ask/select-visible-node-ask-interactions';
import type { LogRow } from './inspect/build-log-rows';
import { inspectStatusLabel } from './inspect/inspect-status';
import { resolveRoomKind, type RoomKind, type RoomResolution } from './inspect/resolve-room-kind';
import { selectNodeRoomMessages } from './inspect/select-node-room-messages';
import {
  selectChildRun,
  selectGateChrome,
  selectLoopGroupChrome,
  selectNodeStdout,
  selectRouteDecision,
  type GateChrome,
  type LoopGroupChrome,
  type RouteDecisionView,
  type StdoutView,
} from './inspect/select-room-data';

export interface ConsoleNodeRoomProps {
  run: Run;
  projectId: string;
  nodeId: string | null;
  selectedRow: LogRow | null;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  nodeStates: readonly WorkflowNodeState[];
  events: readonly WorkflowEvent[];
  approval: unknown;
  isLive: boolean;
  loadMessages: (
    runId: string,
    nodeId: string,
    options?: { occurrenceId?: string; attemptId?: string }
  ) => Promise<WorkflowNodeMessagesResponse>;
  onClose: () => void;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
}

const IDLE_NODE_MESSAGES_KEY = 'console-node-room:idle';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children, ...props }) => (
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-surface-inset p-3 font-mono text-[12px]"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-surface-inset px-1 py-[1px] font-mono text-[12px] text-text-primary"
        {...props}
      >
        {children}
      </code>
    );
  },
  a: ({ children, ...props }) => (
    <a
      className="text-primary underline decoration-primary/40 hover:decoration-primary"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const ROUTE_FIELDS = [
  ['Outcome', 'outcome'],
  ['Target', 'to'],
  ['Condition', 'condition'],
  ['Condition result', 'conditionResult'],
  ['Attempt', 'attempt'],
  ['Execution', 'executionSeq'],
  ['Negative count', 'negativeCount'],
  ['Maximum iterations', 'maxIterations'],
] as const;

function assertNever(value: never): never {
  void value;
  throw new Error('Unsupported workflow node message kind');
}

function inspectRow(
  nodeId: string,
  selectedRow: LogRow | null,
  nodeStates: readonly WorkflowNodeState[]
): LogRow {
  if (selectedRow !== null && selectedRow.nodeId === nodeId) return selectedRow;
  const state = nodeStates.find(item => item.nodeId === nodeId);
  return {
    id: nodeId,
    nodeId,
    label: state?.name ?? nodeId,
    status: state?.status ?? 'pending',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  };
}

function selectionExtra(row: LogRow): string | null {
  if (row.selection.kind === 'loop_iteration') return `×${String(row.selection.iteration)}`;
  if (row.selection.kind === 'route_iteration') return `#${String(row.selection.executionSeq)}`;
  return null;
}

function RoomPlaceholder({ children }: { children: string }): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-text-secondary">
      {children}
    </div>
  );
}

function RoomRegion({ nodeId, children }: { nodeId: string; children: ReactNode }): ReactElement {
  return (
    <section
      role="region"
      aria-label={nodeId + ' room'}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {children}
    </section>
  );
}

function RoomHeader({
  nodeId,
  label,
  status,
  extra,
  onClose,
}: {
  nodeId: string | null;
  label: string;
  status: string;
  extra: string | null;
  onClose: () => void;
}): ReactElement {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-text-primary">{label}</p>
        {nodeId !== null ? (
          <p className="truncate font-mono text-[11px] text-text-tertiary">{nodeId}</p>
        ) : null}
        {status !== '' ? <p className="text-[11px] text-text-secondary">{status}</p> : null}
        {extra !== null ? <p className="text-[11px] text-text-secondary">{extra}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        Close
      </button>
    </header>
  );
}

function AgentTranscript({
  messages,
  renderAfterMessage,
  renderAtEnd,
}: {
  messages: readonly WorkflowNodeMessage[];
  renderAfterMessage?: (message: WorkflowNodeMessage) => ReactNode;
  renderAtEnd?: ReactNode;
}): ReactElement {
  if (messages.length === 0) {
    return renderAtEnd === undefined ? (
      <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">{renderAtEnd}</div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {projectToolTranscript(projectTextTranscript(messages)).map(item => {
        if (item.kind === 'tool-card') {
          const outcomeParts: string[] = [];
          if (item.pending) outcomeParts.push('pending');
          else {
            if (item.outcome !== undefined) outcomeParts.push(item.outcome);
            if (item.exitCode !== undefined) outcomeParts.push(`exit ${String(item.exitCode)}`);
            if (item.truncated === true || item.outputState === 'truncated') {
              outcomeParts.push('truncated');
            }
            if (item.outputState === 'missing') outcomeParts.push('missing output');
          }
          return (
            <div key={item.id}>
              <div className="ptool rounded-[var(--radius)] border border-border bg-surface-inset px-2.5 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11.5px] font-bold text-accent-bright">{item.name}</span>
                  {outcomeParts.length > 0 ? (
                    <span className="text-[11px] text-text-secondary">
                      {outcomeParts.join(' · ')}
                    </span>
                  ) : null}
                </div>
                {item.input !== undefined ? (
                  <div className="mt-1.5">
                    <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
                      Input
                    </div>
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                      {formatToolIo(item.input)}
                    </pre>
                  </div>
                ) : null}
                {item.output !== undefined ? (
                  <div className="mt-1.5">
                    <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
                      Output
                    </div>
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                      {formatToolIo(item.output)}
                    </pre>
                  </div>
                ) : item.pending ? (
                  <div className="mt-1.5 text-[11px] text-text-secondary">Output unavailable</div>
                ) : null}
              </div>
              {item.messages.map(message => renderAfterMessage?.(message))}
            </div>
          );
        }
        return (
          <div key={item.message.id}>
            {renderTranscriptItem(item.message)}
            {renderAfterMessage?.(item.message)}
          </div>
        );
      })}
      {renderAtEnd}
    </div>
  );
}

function collectToolIds(messages: readonly WorkflowNodeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

function renderTranscriptItem(message: WorkflowNodeMessage): ReactElement {
  switch (message.kind) {
    case 'text':
      return (
        <div className="max-w-none text-[13px] text-text-primary">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {message.payload.text}
          </ReactMarkdown>
        </div>
      );
    case 'tool': {
      const { name, input, output } = message.payload;
      return (
        <div className="ptool rounded-[var(--radius)] border border-border bg-surface-inset px-2.5 py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] font-bold text-accent-bright">{name}</span>
          </div>
          {input !== undefined ? (
            <div className="mt-1.5">
              <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
                Input
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                {formatToolIo(input)}
              </pre>
            </div>
          ) : null}
          {output !== undefined ? (
            <div className="mt-1.5">
              <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
                Output
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                {formatToolIo(output)}
              </pre>
            </div>
          ) : null}
        </div>
      );
    }
    case 'status': {
      const { state, detail } = message.payload;
      return (
        <p className="text-[11px] text-text-secondary">
          {inspectStatusLabel(state)}
          {detail ? ` ${detail}` : ''}
        </p>
      );
    }
    default:
      return assertNever(message);
  }
}

function StdoutBody({ stdout }: { stdout: StdoutView }): ReactElement {
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-text-secondary">Status: {inspectStatusLabel(stdout.status)}</p>
      {stdout.truncated ? (
        <p className="text-[11px] text-warning">
          {stdout.originalBytes === null
            ? 'Output truncated'
            : `Output truncated from ${String(stdout.originalBytes)} bytes`}
        </p>
      ) : null}
      {stdout.failedDetail ? <p className="text-[13px] text-error">{stdout.failedDetail}</p> : null}
      {stdout.text === null ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {stdout.text}
        </pre>
      )}
      {stdout.exitCode === 0 ? (
        <p className="text-[11px] text-text-secondary">Exit status: 0</p>
      ) : null}
    </div>
  );
}

function GateBody({
  chrome,
  run,
  nodeId,
}: {
  chrome: GateChrome;
  run: Run;
  nodeId: string;
}): ReactElement {
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [annotationPending, setAnnotationPending] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<string | null>(chrome.feedbackReceiptStatus);
  return (
    <div className="space-y-3 p-4">
      {chrome.showInactiveNotice ? (
        <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
          <p className="text-[13px] text-text-secondary">Gate is not the active pause</p>
        </div>
      ) : null}
      {chrome.decision !== null ? (
        <p className="text-[13px] text-text-primary">
          {chrome.decision === 'approved' ? 'Approved' : 'Rejected'}
        </p>
      ) : null}
      {chrome.canDecide && chrome.decision === null ? (
        <p className="text-[13px] text-text-secondary">Waiting for approval</p>
      ) : null}
      <p className="text-[13px] text-text-primary">{chrome.message}</p>
      {chrome.document !== null ? (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {chrome.document}
        </pre>
      ) : null}
      {chrome.reviewUrl !== null ? (
        <a
          href={chrome.reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-[13px] text-primary underline decoration-primary/40 hover:decoration-primary"
        >
          Open Plannotator
        </a>
      ) : null}
      {chrome.gateType === 'plannotator_gate' &&
      chrome.canDecide &&
      chrome.reviewSessionId !== null &&
      chrome.gateId !== null ? (
        <div className="space-y-2">
          <input
            type="text"
            value={annotationDraft}
            onChange={(event): void => {
              setAnnotationDraft(event.target.value);
            }}
            placeholder="Annotations / comment…"
            className="w-full rounded-md border border-border bg-surface-inset px-2 py-1.5 text-[13px] text-text-primary"
            disabled={annotationPending}
          />
          <button
            type="button"
            disabled={annotationPending || annotationDraft.trim().length === 0}
            className="rounded-md px-2 py-1 text-[12px] text-primary hover:bg-primary/10 disabled:opacity-50"
            onClick={(): void => {
              const gateId = chrome.gateId;
              const reviewSessionId = chrome.reviewSessionId;
              if (gateId === null || reviewSessionId === null) return;
              void (async (): Promise<void> => {
                setAnnotationError(null);
                setAnnotationPending(true);
                try {
                  const receipt = await submitRunReviewFeedback(run.id, {
                    nodeId,
                    gateId,
                    reviewSessionId,
                    requestId: crypto.randomUUID(),
                    feedback: annotationDraft.trim(),
                  });
                  setReceiptStatus(receipt.status);
                  setAnnotationDraft('');
                } catch (error: unknown) {
                  setAnnotationError(error instanceof Error ? error.message : String(error));
                } finally {
                  setAnnotationPending(false);
                }
              })();
            }}
          >
            Send annotations
          </button>
          {receiptStatus !== null ? (
            <p className="text-[11px] text-text-secondary">Annotations {receiptStatus}</p>
          ) : null}
          {annotationError !== null ? (
            <p className="text-[11px] text-error">{annotationError}</p>
          ) : null}
        </div>
      ) : null}
      {chrome.canDecide ? <ApprovalPanel run={run} /> : null}
    </div>
  );
}

function WorkflowBody({
  projectId,
  childRunId,
  fanOut,
  output,
  paused,
  message,
}: {
  projectId: string;
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
}): ReactElement {
  const hasContent = childRunId !== null || fanOut || output !== null || paused;
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Child run</h3>
      {paused ? (
        <p className="rounded border border-warning/20 bg-warning/5 p-3 text-[13px] text-warning">
          {message ?? 'Sub-run is paused pending review'}
        </p>
      ) : null}
      {fanOut ? (
        <p className="text-[13px] text-text-secondary">This node spawned multiple child runs</p>
      ) : null}
      {childRunId !== null ? (
        <a
          href={`/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(childRunId)}`}
          className="text-[13px] text-primary hover:underline"
        >
          Open child run
        </a>
      ) : null}
      {output !== null ? (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {output}
        </pre>
      ) : null}
      {!hasContent ? <RoomPlaceholder>Child run has not started</RoomPlaceholder> : null}
    </div>
  );
}

function RouteBody({ decision }: { decision: RouteDecisionView | null }): ReactElement {
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Routing decision</h3>
      {decision === null ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        <dl className="space-y-2">
          {ROUTE_FIELDS.map(([label, key]) =>
            decision[key] === null ? null : (
              <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 text-[13px]">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="font-mono text-text-primary">{decision[key]}</dd>
              </div>
            )
          )}
        </dl>
      )}
    </div>
  );
}

function LoopGroupBody({ chrome }: { chrome: LoopGroupChrome }): ReactElement {
  return (
    <div className="space-y-4 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Loop group</h3>
      <div className="space-y-2">
        <h4 className="text-[11px] font-medium uppercase text-text-secondary">Body nodes</h4>
        {chrome.body.map(node => (
          <div key={node.qualifiedId} className="text-[13px] text-text-primary">
            <span className="font-mono">{node.id}</span>
            <span className="ml-2 text-text-secondary">
              {node.dependsOn.length === 0 ? 'Start' : `After ${node.dependsOn.join(', ')}`}
            </span>
          </div>
        ))}
      </div>
      {chrome.iterations.length === 0 ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        chrome.iterations.map(iteration => {
          const selected = iteration.iteration === chrome.selectedIteration;
          return (
            <details
              key={iteration.iteration}
              open={selected}
              aria-current={selected ? 'true' : undefined}
              className="rounded border border-border bg-surface-elevated p-3"
            >
              <summary className="cursor-pointer text-[13px] text-text-primary">
                {'×' + String(iteration.iteration) + ' ' + iteration.status}
              </summary>
              <div className="mt-2 space-y-1">
                {iteration.body.map(node => (
                  <p key={node.qualifiedId} className="text-[13px] text-text-secondary">
                    <span className="font-mono text-text-primary">{node.qualifiedId}</span>{' '}
                    {node.status}
                  </p>
                ))}
              </div>
            </details>
          );
        })
      )}
    </div>
  );
}

function isUnknownAgentFallback(resolution: RoomResolution | null): boolean {
  return resolution !== null && resolution.kind === 'agent' && resolution.nodeType === 'unknown';
}

function isAgentKind(kind: RoomKind | undefined): boolean {
  return kind === 'agent';
}

export function ConsoleNodeRoom({
  run,
  projectId,
  nodeId,
  selectedRow,
  definitionNodes,
  definitionPending,
  nodeStates,
  events,
  approval,
  isLive,
  loadMessages,
  onClose,
  pendingInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
}: ConsoleNodeRoomProps): ReactElement {
  const resolution =
    nodeId === null ? null : resolveRoomKind(nodeId, definitionNodes, events, approval);
  const waitingOnDefinition = definitionPending && isUnknownAgentFallback(resolution);
  const agentActive = nodeId !== null && isAgentKind(resolution?.kind) && !waitingOnDefinition;
  const row = nodeId === null ? null : inspectRow(nodeId, selectedRow, nodeStates);
  const occurrenceId =
    row?.selection.kind === 'occurrence' ? row.selection.occurrenceId : undefined;
  const attemptId = row?.selection.kind === 'occurrence' ? row.selection.attemptId : undefined;
  const messagesKey =
    agentActive && nodeId !== null
      ? `${K.nodeMessages(run.id, nodeId)}:${occurrenceId ?? ''}:${attemptId ?? ''}`
      : IDLE_NODE_MESSAGES_KEY;
  const messagesQuery = useEntity<WorkflowNodeMessagesResponse>(messagesKey, () => {
    if (agentActive && nodeId !== null) {
      return loadMessages(run.id, nodeId, { occurrenceId, attemptId });
    }
    return Promise.resolve({ messages: [] });
  });
  const refetchRef = useRef(messagesQuery.refetch);
  refetchRef.current = messagesQuery.refetch;

  useEffect(() => {
    if (!isLive || !agentActive) return undefined;
    const handle = globalThis.setInterval(() => {
      refetchRef.current();
    }, 1000);
    return (): void => {
      globalThis.clearInterval(handle);
    };
  }, [isLive, agentActive, messagesKey]);

  const headerLabel = row?.label ?? (nodeId === null ? 'Select a node' : nodeId);
  const headerStatus = row === null ? '' : inspectStatusLabel(row.status);
  const headerExtra = row === null ? null : selectionExtra(row);

  const allMessages = messagesQuery.error === undefined ? (messagesQuery.data?.messages ?? []) : [];
  const visibleMessages = row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);
  const visibleAsks =
    row !== null && resolution?.kind === 'agent'
      ? selectVisibleNodeAskInteractions({
          pending: pendingInteractions,
          nodeId: row.nodeId,
          allMessages,
          visibleMessages,
        })
      : [];
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
  const selectedNodeState =
    row === null ? undefined : nodeStates.find(state => state.nodeId === row.nodeId);
  const firstActionableId = orderedAsks.find(interaction => {
    if (!viewerIsStarter || interaction.status !== 'pending') return false;
    if (parseAskEnvelope(interaction.envelope) === null) return false;
    return (
      resolveAskCardPresentation({
        interaction,
        action: actionStates[interaction.tool_use_id],
        nodeStatus: selectedNodeState?.status,
        nodeError: selectedNodeState?.error,
      }).viewState === 'pending'
    );
  })?.id;
  const nowMs = Date.now();
  const agentDisplayName = row?.label ?? '';
  const roomNodeId = row?.nodeId ?? '';

  const renderAskCard = (interaction: PendingInteraction): ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    if (questions === null) {
      return (
        <ConsoleInvalidAskCard
          key={interaction.id}
          interaction={interaction}
          agentDisplayName={agentDisplayName}
          nodeId={roomNodeId}
        />
      );
    }
    const requestId = interaction.tool_use_id;
    return (
      <ConsoleAskCard
        key={interaction.id}
        interaction={interaction}
        questions={questions}
        presentation={resolveAskCardPresentation({
          interaction,
          action: actionStates[requestId],
          nodeStatus: selectedNodeState?.status,
          nodeError: selectedNodeState?.error,
        })}
        viewerIsStarter={viewerIsStarter}
        starterDisplayName={starterDisplayName}
        agentDisplayName={agentDisplayName}
        nodeId={roomNodeId}
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

  let body: ReactNode;
  if (nodeId === null || resolution === null || row === null) {
    body = <RoomPlaceholder>Select a node</RoomPlaceholder>;
  } else if (waitingOnDefinition) {
    body = <RoomPlaceholder>Loading workflow definition</RoomPlaceholder>;
  } else if (resolution.kind === 'agent') {
    if (messagesQuery.error !== undefined) {
      body = (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-text-secondary">
            <p>Failed to load node transcript</p>
            <button
              type="button"
              className="text-[12px] text-primary transition-colors hover:text-accent-bright"
              onClick={(): void => {
                messagesQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
          {unanchoredAsks.length === 0 ? null : (
            <div className="flex flex-col gap-3 p-3">{unanchoredAsks.map(renderAskCard)}</div>
          )}
        </div>
      );
    } else if (messagesQuery.loading || messagesQuery.data === undefined) {
      body = <RoomPlaceholder>Loading node transcript</RoomPlaceholder>;
    } else {
      body = (
        <AgentTranscript
          messages={visibleMessages}
          renderAfterMessage={(message: WorkflowNodeMessage): ReactNode =>
            message.kind === 'tool'
              ? anchoredAsks
                  .filter(interaction => interaction.tool_use_id === message.payload.id)
                  .map(renderAskCard)
              : undefined
          }
          renderAtEnd={unanchoredAsks.length === 0 ? undefined : unanchoredAsks.map(renderAskCard)}
        />
      );
    }
  } else if (resolution.kind === 'stdout') {
    body = <StdoutBody stdout={selectNodeStdout(events, row)} />;
  } else if (resolution.kind === 'gate') {
    body = (
      <GateBody
        run={run}
        nodeId={row.nodeId}
        chrome={selectGateChrome({
          definitionNode: resolution.definitionNode,
          events,
          row,
          approval,
          runStatus: run.status,
          gateType: resolution.nodeType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
        })}
      />
    );
  } else if (resolution.kind === 'workflow') {
    const child = selectChildRun({ events, approval, row, runStatus: run.status });
    body = (
      <WorkflowBody
        projectId={projectId}
        childRunId={child.childRunId}
        fanOut={child.fanOut}
        output={child.output}
        paused={child.paused}
        message={child.message}
      />
    );
  } else if (resolution.kind === 'route_loop') {
    body = <RouteBody decision={selectRouteDecision(events, row)} />;
  } else if (resolution.kind === 'loop_group') {
    body = (
      <LoopGroupBody
        chrome={selectLoopGroupChrome({
          definitionNode: resolution.definitionNode,
          events,
          row,
        })}
      />
    );
  } else {
    body = assertNever(resolution.kind);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <RoomHeader
        nodeId={nodeId}
        label={headerLabel}
        status={headerStatus}
        extra={headerExtra}
        onClose={onClose}
      />
      {nodeId === null ? body : <RoomRegion nodeId={nodeId}>{body}</RoomRegion>}
    </div>
  );
}
