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

type ToolMessage = Extract<WorkflowNodeMessageResponse, { kind: 'tool' }>;
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

function ToolTranscriptItem({ message }: { message: ToolMessage }): React.ReactElement {
  const { name, input, output } = message.payload;
  return (
    <div className="flex flex-col gap-1">
      <span className="w-fit rounded-full bg-surface-elevated px-2 py-0.5 font-mono text-xs text-text-secondary">
        {name}
      </span>
      {input !== undefined ? (
        <details>
          <summary className="cursor-pointer text-xs text-text-secondary">Input</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-text-secondary">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      ) : null}
      {output !== undefined ? (
        <details>
          <summary className="cursor-pointer text-xs text-text-secondary">Output</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-text-secondary">
            {JSON.stringify(output, null, 2)}
          </pre>
        </details>
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
      return <ToolTranscriptItem message={message} />;
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
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {ordered.map(
            (message): React.ReactElement => (
              <Fragment key={message.id}>
                <div>{renderTranscriptItem(message)}</div>
                {renderAfterMessage?.(message)}
              </Fragment>
            )
          )}
          {renderAtEnd}
        </div>
      );
    }
  }

  return <RoomRegion nodeId={nodeId}>{body}</RoomRegion>;
}
