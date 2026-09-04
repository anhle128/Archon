import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { LiveDot } from './LiveDot';
import { OriginBadge } from './OriginBadge';
import type { Run } from '../primitives/run';
import {
  shortRunId,
  formatElapsed,
  elapsedSince,
  formatCost,
  formatUsdAmount,
} from '../lib/format';
import { useIsDocker, useIdeEnv, openInIde } from '../lib/health';
import { statusLabel, statusTextClass } from '../lib/run-status';
import type { UsageReport } from '../skills/usage';
import { describeUsageState, eventOnlyUsageMessage } from './UsageBreakdownTable';

interface RunDetailHeaderProps {
  run: Run;
  projectName: string;
  projectId: string;
  /** Direct-run usage from GET detail (`null` = query failed). */
  usage: UsageReport | null;
}

/** Cost strip for the run header — keeps event-only distinct from not-recorded. */
function RunHeaderUsageLabel({
  run,
  usage,
}: {
  run: Run;
  usage: UsageReport | null;
}): ReactElement {
  const usageState = describeUsageState(usage, false);
  if (usageState === 'unavailable') {
    return (
      <span
        className="font-mono text-[11px] text-warning"
        title="Usage report query failed for this run"
      >
        usage unavailable
      </span>
    );
  }
  if (usageState === 'event-only' && usage !== null) {
    return (
      <span
        className="font-mono text-[11px] text-warning"
        title={eventOnlyUsageMessage(usage.coverage)}
        data-usage-state="event-only"
      >
        incomplete · event-only
      </span>
    );
  }
  if (usageState === 'has-data' && usage !== null) {
    return (
      <span
        className="flex items-center gap-2 font-mono text-[12px] tabular-nums text-text-secondary"
        title={
          usage.coverage.unledgeredEventCount > 0
            ? eventOnlyUsageMessage(usage.coverage)
            : 'Direct-run ledger only (no child rollup)'
        }
      >
        <span title="Provider-reported USD">
          {formatUsdAmount(usage.totals.reportedUsd, false)}
        </span>
        <span className="text-text-tertiary" aria-hidden>
          /
        </span>
        <span title="Estimated USD">{formatUsdAmount(usage.totals.estimatedUsd, true)}</span>
        <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">direct</span>
        {usage.coverage.unledgeredEventCount > 0 ? (
          <span
            className="text-[10px] uppercase tracking-[0.08em] text-warning"
            data-usage-state="partial-unledgered"
          >
            incomplete
          </span>
        ) : null}
      </span>
    );
  }
  // not-recorded
  if (typeof run.costUsd === 'number') {
    return (
      <span
        className="font-mono text-[12px] tabular-nums text-text-secondary"
        title="Legacy run total — not from the usage ledger"
      >
        {formatCost(run.costUsd)}
        <span className="ml-1 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          legacy total
        </span>
      </span>
    );
  }
  return (
    <span
      className="font-mono text-[11px] text-text-tertiary"
      title="No usage events recorded for this run"
      data-usage-state="not-recorded"
    >
      not recorded
    </span>
  );
}

function useLiveElapsed(run: Run): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.status !== 'running') return;
    const handle = setInterval(() => {
      tick(n => n + 1);
    }, 1000);
    return (): void => {
      clearInterval(handle);
    };
  }, [run.status]);
  return formatElapsed(elapsedSince(run.startedAt, run.finishedAt ?? undefined));
}

export function RunDetailHeader({
  run,
  projectName,
  projectId,
  usage,
}: RunDetailHeaderProps): ReactElement {
  const elapsed = useLiveElapsed(run);
  const isPaused = run.status === 'paused';
  const isRunning = run.status === 'running';
  const isDocker = useIsDocker();
  const ideEnv = useIdeEnv();
  const canOpenIde = !isDocker && run.workingPath !== null && run.workingPath !== '';

  const copyRunId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(run.id);
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="relative sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-6 py-3">
      {/* Brand thread along the bottom edge — anchors the detail view. */}
      <span
        aria-hidden
        className="brand-bar pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-60"
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 font-mono text-[12px]">
        <Link
          to={`/console/p/${projectId}`}
          className="text-text-tertiary transition-colors hover:text-text-primary"
        >
          {projectName}
        </Link>
        <span aria-hidden className="text-text-tertiary">
          /
        </span>
        <button
          type="button"
          onClick={() => void copyRunId()}
          className="flex items-center gap-1 font-semibold transition-opacity hover:opacity-80"
          title="Copy full run id"
        >
          <span className="brand-text">{shortRunId(run.id)}</span>
          <span aria-hidden className="font-mono text-[10px] text-text-tertiary">
            ⧉
          </span>
        </button>
      </div>

      <div className="mx-1 h-4 w-px bg-border" aria-hidden />

      {/* Status pill */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <LiveDot />
        ) : isPaused ? (
          <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-warning" />
        ) : (
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${
              run.status === 'failed'
                ? 'bg-error'
                : run.status === 'completed'
                  ? 'bg-success'
                  : 'bg-text-tertiary'
            }`}
          />
        )}
        <span
          className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${statusTextClass[run.status]}`}
        >
          {statusLabel[run.status]}
        </span>
      </div>

      {/* Workflow name */}
      <span className="text-sm font-medium text-text-primary">{run.workflow}</span>

      {/* Origin */}
      <OriginBadge origin={run.origin} />

      {/* Cost + elapsed + IDE — right-aligned.
          Direct ledger reported/estimated stay separate. usage:null is a warning,
          hasRecordedUsage:false is not-recorded — neither is zero. Event-only
          fallback (recorded events, zero ledger rows) is incomplete/under-counted,
          never "not recorded". Legacy run.costUsd only appears with an explicit
          label when the new ledger has nothing and no usage events exist. */}
      <div className="ml-auto flex items-center gap-3">
        <RunHeaderUsageLabel run={run} usage={usage} />

        <span className="font-mono text-[12px] tabular-nums text-text-tertiary">{elapsed}</span>
        {canOpenIde && run.workingPath !== null ? (
          <button
            type="button"
            onClick={() => {
              if (run.workingPath !== null) openInIde(run.workingPath, ideEnv);
            }}
            title={`Open ${run.workingPath} in IDE`}
            aria-label="Open in IDE"
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <span aria-hidden className="font-mono text-[12px] leading-none">
              ↗
            </span>
          </button>
        ) : null}
      </div>

      {/* Provenance sub-row: the input that started this run. `w-full` forces its
          own line in the flex-wrap header.
          TODO(#1882): add a "from chat →" link back to the originating
          conversation once the console chat route supports deep-linking. */}
      {run.userMessage !== '' ? (
        <div className="flex w-full min-w-0 items-baseline gap-2 text-[12px]">
          <span className="shrink-0 font-mono text-text-tertiary">input</span>
          <span className="truncate font-mono text-text-secondary" title={run.userMessage}>
            {run.userMessage}
          </span>
        </div>
      ) : null}
    </header>
  );
}
