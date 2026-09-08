/**
 * Inspect-only node transcript room: render projected agent history for the
 * selected execution. Cursor paging and Ask placement stay in NodeTranscriptPane.
 */
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { AgentHistoryItem } from '@/lib/agent-history';
import { getWorkflowNodeMessage, type WorkflowNodeMessageResponse } from '@/lib/api';
import { formatDurationMs } from '@/lib/format';
import { formatToolIo } from '@/lib/pair-tool-transcript';
import { cn } from '@/lib/utils';

import type { LogRowSelection } from './build-log-rows';
import { RoomIncompleteNotice } from './RoomIncompleteNotice';

export interface NodeRoomProps {
  nodeId: string | null;
  items: readonly AgentHistoryItem[];
  unknownScope: boolean;
  runId: string;
  isPending: boolean;
  error: string | null;
  onRetry: () => void;
  loadMessage?: typeof getWorkflowNodeMessage;
  renderAfterItem?: (item: AgentHistoryItem) => React.ReactNode;
  renderAtEnd?: React.ReactNode;
}

const UNKNOWN_SCOPE_NOTICE =
  'Execution scope was not recorded; this history may include other executions of the same node.';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS = {
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>): React.ReactElement => (
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }): React.ReactElement => {
    const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
    if (isBlock) {
      return (
        <code className={cn(className, 'font-mono')} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-background px-1.5 py-0.5 font-mono text-sm text-accent-bright"
        {...props}
      >
        {children}
      </code>
    );
  },
  blockquote: ({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'blockquote'>): React.ReactElement => (
    <blockquote className="border-l-2 border-primary pl-4 text-text-secondary" {...props}>
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>): React.ReactElement => (
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

export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessageResponse[],
  selection: LogRowSelection
): WorkflowNodeMessageResponse[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  if (selection.kind === 'occurrence' || selection.kind === 'node') return ordered;
  if (selection.kind !== 'loop_iteration') return ordered;
  const detail = String(selection.iteration);
  const start = ordered.findIndex(
    message =>
      message.kind === 'status' &&
      message.payload.state === 'iteration_started' &&
      message.payload.detail === detail
  );
  if (start < 0) return ordered;
  const terminalOffset = ordered
    .slice(start + 1)
    .findIndex(
      message =>
        message.kind === 'status' &&
        (message.payload.state === 'iteration_completed' ||
          message.payload.state === 'iteration_failed') &&
        message.payload.detail === detail
    );
  if (terminalOffset >= 0) return ordered.slice(start, start + terminalOffset + 2);
  const nextStartOffset = ordered
    .slice(start + 1)
    .findIndex(
      message => message.kind === 'status' && message.payload.state === 'iteration_started'
    );
  return ordered.slice(start, nextStartOffset >= 0 ? start + nextStartOffset + 1 : undefined);
}

export function RoomPlaceholder({ children }: { children: string }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}

export function RoomRegion({
  nodeId,
  children,
}: {
  nodeId: string;
  children: React.ReactNode;
}): React.ReactElement {
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

function AssistantHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'assistant' }>;
}): React.ReactElement {
  return (
    <div
      className="chat-markdown max-w-none text-sm text-text-primary"
      style={{ overflowWrap: 'anywhere' }}
    >
      <div className="mb-1 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
        ASSISTANT
      </div>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {item.text}
      </ReactMarkdown>
    </div>
  );
}

function LifecycleHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'lifecycle' }>;
}): React.ReactElement {
  return (
    <p className="text-xs text-text-secondary">
      {item.state}
      {item.detail !== null && item.detail.length > 0 ? ` ${item.detail}` : ''}
    </p>
  );
}

function toolOutcomeLabel(item: Extract<AgentHistoryItem, { kind: 'tool' }>): string {
  if (item.outcome === 'running') return 'pending';
  if (item.outcome === 'unknown') return 'missing-call';
  return item.outcome;
}

function ToolHistory({
  item,
  runId,
  nodeId,
  loadMessage,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  runId: string;
  nodeId: string;
  loadMessage: typeof getWorkflowNodeMessage;
}): React.ReactElement {
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void loadMessage(runId, nodeId, item.messageId)
      .then((message): void => {
        const output = message.kind === 'tool' ? message.payload.output : undefined;
        setFullOutput(output);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  return (
    <div
      data-tool-id={item.toolUseId}
      className="ptool rounded-[var(--radius)] bg-surface-inset px-2.5 py-2"
      style={{ border: 'var(--rv-tool-card-border)', overflowWrap: 'anywhere' }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[11.5px] font-bold text-accent-bright">{item.name}</span>
        <span className="text-[11px] text-text-secondary">{toolOutcomeLabel(item)}</span>
        {item.durationMs !== null ? (
          <span className="text-[11px] text-text-secondary">
            {formatDurationMs(item.durationMs)}
          </span>
        ) : null}
      </div>
      {item.context.map(entry => (
        <div key={entry.label} className="mt-0.5 text-[11px] text-text-secondary">
          {entry.label}: {entry.value}
        </div>
      ))}
      <details open className="mt-1.5">
        <summary className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
          Input
        </summary>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
          {formatToolIo(item.input)}
        </pre>
      </details>
      <details open className="mt-1.5">
        <summary className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
          Output
        </summary>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
          {formatToolIo(displayedOutput)}
        </pre>
      </details>
      {item.canLoadFullOutput ? (
        <button
          type="button"
          className="mt-1.5 text-xs text-primary hover:text-accent-bright"
          disabled={loading}
          onClick={loadFull}
        >
          View full output
        </button>
      ) : null}
      {loadError !== null ? (
        <div className="mt-1.5 text-[11px] text-error">
          <span>{loadError}</span>
          <button
            type="button"
            className="ml-2 text-xs text-primary hover:text-accent-bright"
            onClick={loadFull}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function NodeRoom({
  nodeId,
  items,
  unknownScope,
  runId,
  isPending,
  error,
  onRetry,
  loadMessage = getWorkflowNodeMessage,
  renderAfterItem,
  renderAtEnd,
}: NodeRoomProps): React.ReactElement {
  if (nodeId === null) {
    return <RoomPlaceholder>Select a node</RoomPlaceholder>;
  }

  let body: React.ReactNode;
  if (isPending && items.length === 0 && error === null) {
    body = <RoomPlaceholder>Loading node transcript</RoomPlaceholder>;
  } else if (items.length === 0 && error !== null) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <RoomIncompleteNotice error={error} onRetry={onRetry} />
        {renderAtEnd}
      </div>
    );
  } else if (items.length === 0) {
    body = renderAtEnd ?? <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>;
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" style={{ overflowWrap: 'anywhere' }}>
        {unknownScope ? <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
        {items.map(item => {
          if (item.kind === 'assistant') {
            return (
              <div key={item.id}>
                <AssistantHistory item={item} />
                {renderAfterItem?.(item)}
              </div>
            );
          }
          if (item.kind === 'tool') {
            return (
              <div key={item.id}>
                <ToolHistory item={item} runId={runId} nodeId={nodeId} loadMessage={loadMessage} />
                {renderAfterItem?.(item)}
              </div>
            );
          }
          return (
            <div key={item.id}>
              <LifecycleHistory item={item} />
              {renderAfterItem?.(item)}
            </div>
          );
        })}
        {error !== null ? <RoomIncompleteNotice error={error} onRetry={onRetry} /> : null}
        {renderAtEnd}
      </div>
    );
  }

  return <RoomRegion nodeId={nodeId}>{body}</RoomRegion>;
}
