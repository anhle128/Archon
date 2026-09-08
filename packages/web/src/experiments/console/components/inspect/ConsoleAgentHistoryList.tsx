/**
 * Console-owned agent history renderer. Uses AgentHistoryItem only as data and
 * never imports Legacy React components.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { AgentHistoryItem } from '@/lib/agent-history';
import { formatToolIo } from '@/lib/pair-tool-transcript';

import { formatDurationMs } from '../../lib/format';

export const UNKNOWN_SCOPE_NOTICE =
  'Execution scope was not recorded; this history may include other executions of the same node.';

export interface ConsoleAgentHistoryListProps {
  items: readonly AgentHistoryItem[];
  showToolCalls: boolean;
  showSystem: boolean;
  onLoadFullOutput: (item: Extract<AgentHistoryItem, { kind: 'tool' }>) => Promise<unknown>;
  renderAfterItem?: (item: AgentHistoryItem) => ReactNode;
  renderAtEnd?: ReactNode;
  unknownScope?: boolean;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>): ReactElement => (
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
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }): ReactElement => {
    const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
    if (isBlock) {
      return (
        <code className={`${className ?? ''} font-mono`} {...props}>
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
  }: React.ComponentPropsWithoutRef<'blockquote'>): ReactElement => (
    <blockquote className="border-l-2 border-primary pl-4 text-text-secondary" {...props}>
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>): ReactElement => (
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

function AssistantHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'assistant' }>;
}): ReactElement {
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
}): ReactElement {
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
  onLoadFullOutput,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  onLoadFullOutput: ConsoleAgentHistoryListProps['onLoadFullOutput'];
}): ReactElement {
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void onLoadFullOutput(item)
      .then((output): void => {
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
      style={{
        border: 'var(--rv-tool-card-border, 1px solid var(--border))',
        overflowWrap: 'anywhere',
      }}
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

function RoomPlaceholder({ children }: { children: string }): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-text-secondary">
      {children}
    </div>
  );
}

export function ConsoleAgentHistoryList({
  items,
  showToolCalls,
  showSystem,
  onLoadFullOutput,
  renderAfterItem,
  renderAtEnd,
  unknownScope = false,
}: ConsoleAgentHistoryListProps): ReactElement {
  if (items.length === 0) {
    return renderAtEnd === undefined || renderAtEnd === null || renderAtEnd === false ? (
      <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">{renderAtEnd}</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" style={{ overflowWrap: 'anywhere' }}>
      {unknownScope ? <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
      {items.map(item => {
        const after = renderAfterItem?.(item);
        if (item.kind === 'tool' && !showToolCalls) {
          return after === undefined || after === null ? null : <div key={item.id}>{after}</div>;
        }
        if (item.kind === 'lifecycle' && !showSystem) {
          return after === undefined || after === null ? null : <div key={item.id}>{after}</div>;
        }
        if (item.kind === 'assistant') {
          return (
            <div key={item.id}>
              <AssistantHistory item={item} />
              {after}
            </div>
          );
        }
        if (item.kind === 'tool') {
          return (
            <div key={item.id}>
              <ToolHistory item={item} onLoadFullOutput={onLoadFullOutput} />
              {after}
            </div>
          );
        }
        return (
          <div key={item.id}>
            <LifecycleHistory item={item} />
            {after}
          </div>
        );
      })}
      {renderAtEnd}
    </div>
  );
}
