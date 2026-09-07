/**
 * Inspect-only node transcript room: slice a node's messages for the selected
 * run row and render text, tool calls, and lifecycle notes.
 */
import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { WorkflowNodeMessageResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatToolIo, projectToolTranscript } from '@/lib/pair-tool-transcript';
import { projectTextTranscript } from '@/lib/project-text-transcript';

import type { LogRowSelection } from './build-log-rows';

export interface NodeRoomProps {
  nodeId: string | null;
  selection: LogRowSelection | null;
  messages: readonly WorkflowNodeMessageResponse[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  renderAfterMessage?: (message: WorkflowNodeMessageResponse) => React.ReactNode;
  renderAtEnd?: React.ReactNode;
}

type StatusMessage = Extract<WorkflowNodeMessageResponse, { kind: 'status' }>;

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

function assertNever(value: never): never {
  void value;
  throw new Error('Unsupported workflow node message kind');
}

export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessageResponse[],
  selection: LogRowSelection
): WorkflowNodeMessageResponse[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  // occurrence-scoped: server already filtered by occurrence_id/attempt_id
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

function toolOutcomeLabel(input: {
  pending: boolean;
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exitCode?: number;
  truncated?: boolean;
  outputState?: 'full' | 'truncated' | 'missing' | 'unknown';
}): string | null {
  if (input.pending) return 'pending';
  const parts: string[] = [];
  if (input.outcome !== undefined) parts.push(input.outcome);
  if (input.exitCode !== undefined) parts.push(`exit ${String(input.exitCode)}`);
  if (input.truncated === true || input.outputState === 'truncated') parts.push('truncated');
  if (input.outputState === 'missing') parts.push('missing output');
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

function ToolTranscriptCard({
  name,
  input,
  output,
  pending,
  outcome,
  exitCode,
  truncated,
  outputState,
}: {
  name: string;
  input: unknown;
  output: unknown;
  pending: boolean;
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exitCode?: number;
  truncated?: boolean;
  outputState?: 'full' | 'truncated' | 'missing' | 'unknown';
}): React.ReactElement {
  const outcomeLabel = toolOutcomeLabel({ pending, outcome, exitCode, truncated, outputState });
  return (
    <div className="ptool rounded-[var(--radius)] border border-border bg-surface-inset px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11.5px] font-bold text-accent-bright">{name}</span>
        {outcomeLabel !== null ? (
          <span className="text-[11px] text-text-secondary">{outcomeLabel}</span>
        ) : null}
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
      ) : pending ? (
        <div className="mt-1.5 text-[11px] text-text-secondary">Output unavailable</div>
      ) : null}
    </div>
  );
}

function StatusTranscriptItem({ message }: { message: StatusMessage }): React.ReactElement {
  const { state, detail } = message.payload;
  return (
    <p className="text-xs text-text-secondary">
      {state}
      {detail ? ` ${detail}` : ''}
    </p>
  );
}

function renderTranscriptItem(message: WorkflowNodeMessageResponse): React.ReactElement {
  switch (message.kind) {
    case 'text':
      return (
        <div className="chat-markdown max-w-none text-sm text-text-primary">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {message.payload.text}
          </ReactMarkdown>
        </div>
      );
    case 'tool':
      return (
        <ToolTranscriptCard
          name={message.payload.name}
          input={message.payload.input}
          output={message.payload.output}
          pending={message.payload.output === undefined}
        />
      );
    case 'status':
      return <StatusTranscriptItem message={message} />;
    default:
      return assertNever(message);
  }
}

export function NodeRoom({
  nodeId,
  selection,
  messages,
  isPending,
  error,
  onRetry,
  renderAfterMessage,
  renderAtEnd,
}: NodeRoomProps): React.ReactElement {
  if (nodeId === null || selection === null) {
    return <RoomPlaceholder>Select a node</RoomPlaceholder>;
  }

  let body: React.ReactNode;
  if (isPending) {
    body = <RoomPlaceholder>Loading node transcript</RoomPlaceholder>;
  } else if (error) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-text-secondary">
        <p>Failed to load node transcript</p>
        <button
          type="button"
          className="text-xs text-primary hover:text-accent-bright transition-colors"
          onClick={(): void => {
            onRetry();
          }}
        >
          Retry
        </button>
        {renderAtEnd}
      </div>
    );
  } else {
    const ordered = selectNodeRoomMessages(messages ?? [], selection);
    if (ordered.length === 0) {
      body = renderAtEnd ?? <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>;
    } else {
      const projected = projectToolTranscript(projectTextTranscript(ordered));
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {projected.map((item): React.ReactElement => {
            if (item.kind === 'tool-card') {
              return (
                <Fragment key={item.id}>
                  <div>
                    <ToolTranscriptCard
                      name={item.name}
                      input={item.input}
                      output={item.output}
                      pending={item.pending}
                      outcome={item.outcome}
                      exitCode={item.exitCode}
                      truncated={item.truncated}
                      outputState={item.outputState}
                    />
                  </div>
                  {item.messages.map(message => (
                    <Fragment key={`after-${message.id}`}>{renderAfterMessage?.(message)}</Fragment>
                  ))}
                </Fragment>
              );
            }
            return (
              <Fragment key={item.message.id}>
                <div>{renderTranscriptItem(item.message)}</div>
                {renderAfterMessage?.(item.message)}
              </Fragment>
            );
          })}
          {renderAtEnd}
        </div>
      );
    }
  }

  return <RoomRegion nodeId={nodeId}>{body}</RoomRegion>;
}
