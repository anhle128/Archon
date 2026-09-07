import { type ReactElement } from 'react';
import { formatRelativeToBaseline, formatClock } from '../lib/format';
import { useStreamContext } from '../lib/stream-context';
import type { InlineToolCall } from '../primitives/message';

interface ToolCallItemProps {
  call: InlineToolCall;
  /** Carried from the parent message since metadata tool calls don't track their own timestamp. */
  timestamp: string;
}

/**
 * Tool-call row rendered as a visible inset card — matching mockup `.ptool`.
 *
 * Input and output are always visible (no collapse/chevron) so reviewers can
 * read the full tool exchange at a glance. The Run Stream surface shows node
 * tools inline and should never hide them behind a disclosure.
 *
 * System-filter (showSystem=false) hides `#node-transition-*` at the stream
 * level before this component is reached, so those entries never reach here.
 */
export function ToolCallItem({ call, timestamp }: ToolCallItemProps): ReactElement {
  const { runStartedAt } = useStreamContext();
  const displayed = formatRelativeToBaseline(timestamp, runStartedAt);
  const wallClock = formatClock(timestamp);
  const hasInput = Object.keys(call.input).length > 0;
  const hasOutput = call.output !== undefined && call.output.length > 0;

  return (
    <div
      className="mx-3 mb-2 mt-1 rounded border border-border bg-surface-inset"
      style={{ padding: 'var(--rv-tool-card-padding, 8px 10px)' }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <time
          dateTime={timestamp}
          title={wallClock}
          className="w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-text-tertiary"
        >
          {displayed}
        </time>
        <span
          className="shrink-0 rounded-[5px] border px-[7px] py-[2px] font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
          style={{
            color: 'var(--brand-violet)',
            background: 'color-mix(in oklch, var(--brand-violet), transparent 86%)',
            borderColor: 'color-mix(in oklch, var(--brand-violet), transparent 70%)',
          }}
        >
          Tool
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-[12.5px] font-bold text-text-primary">
            {call.name}
          </span>
        </span>
        {call.durationMs !== undefined ? (
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-text-tertiary">
            {call.durationMs.toString()}ms
          </span>
        ) : null}
      </div>

      {/* Input — always visible when present */}
      {hasInput ? (
        <pre
          className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed text-text-secondary"
          style={{ fontSize: 'var(--rv-tool-io-font-size, 11px)' }}
        >
          {JSON.stringify(call.input, null, 2)}
        </pre>
      ) : null}

      {/* Output — always visible when present */}
      {hasOutput ? (
        <div className={hasInput ? 'mt-2' : 'mt-2'}>
          <div className="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
            Result
          </div>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed text-text-secondary"
            style={{ fontSize: 'var(--rv-tool-io-font-size, 11px)' }}
          >
            {call.output !== undefined && call.output.length > 4000
              ? `${call.output.slice(0, 4000)}\n\n… (${(call.output.length - 4000).toString()} more chars)`
              : call.output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
