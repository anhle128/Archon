import { useState, type ReactElement } from 'react';
import {
  formatElapsed,
  formatRelativeToBaseline,
  formatClock,
  formatUsdAmount,
} from '../lib/format';
import { useStreamContext } from '../lib/stream-context';
import type { UsageMetrics, UsageReport, UsageReportGroup } from '../skills/usage';
import { UsageBreakdownTable } from './UsageBreakdownTable';
import type { InspectStatus } from './inspect/inspect-status';
import { inspectStatusLabel } from './inspect/inspect-status';

interface NodeDividerProps {
  /** Selectable log-row identity — also the scroll-anchor suffix. */
  rowId: string;
  /** `step_name` — the inspect node this row belongs to. */
  nodeId: string;
  nodeName: string;
  selected: boolean;
  onSelect: (rowId: string, nodeId: string) => void;
  /** Folded lifecycle status; `running` = the node is still in-flight. */
  status: InspectStatus;
  durationMs: number | null;
  timestamp: string;
  /** From `node_completed` — legacy per-node spend when ledger has no row. */
  costUsd?: number | null;
  /** Cumulative ledger reported USD for this exact step name (all attempts). */
  reportedUsd?: number | null;
  /** Cumulative ledger estimated USD for this exact step name. */
  estimatedUsd?: number | null;
  /** True when the direct-run usage report has a group for this step name. */
  hasLedgerUsage?: boolean;
  numTurns?: number | null;
  /** From `node_completed` — surfaced under the System detail toggle. */
  stopReason?: string | null;
  /** Only set for `skipped` — `when_condition` / `trigger_rule`. */
  skipReason?: string | null;
  /** Only set for `skipped` — the evaluated gating expression. */
  skipExpr?: string | null;
  /** When true, surface skip reason / stop reason inline. */
  showDetail?: boolean;
  /** Every exact ledger group for this step name (provider/model/source/kind splits). */
  usageGroups?: UsageReportGroup[];
  /** Pre-aggregated metrics across usageGroups (expansion totals). */
  usageAggregate?: UsageMetrics;
  /** Full direct-run usage (for optional run-wide coverage context on expand). */
  runUsage?: UsageReport | null;
}

/**
 * Build a node-local synthetic usage report for expansion.
 *
 * Coverage is intentionally empty integrity (not inferred from ledger row counts)
 * and never copies run-wide unledgered counts as this node's under-count.
 * Callers pass run-wide coverage separately so the table can label it run-wide.
 */
export function buildNodeLedgerUsageReport(args: {
  usageGroups: UsageReportGroup[];
  usageAggregate: UsageMetrics;
  runUsage: UsageReport | null;
}): {
  report: UsageReport;
  runWideCoverage: UsageReport['coverage'] | null;
} {
  const { usageGroups, usageAggregate, runUsage } = args;
  return {
    report: {
      scope: runUsage?.scope ?? {
        from: null,
        to: null,
        includesChildRollup: false as const,
      },
      groupBy: 'node',
      totals: usageAggregate,
      groups: usageGroups,
      // Scope-correct placeholder only — never invent event coverage from ledger rows,
      // never copy run-wide unledgered counts into node-local integrity.
      coverage: {
        usageEventCount: 0,
        ledgeredEventCount: 0,
        unledgeredEventCount: 0,
        hasRecordedUsage: true,
        historicalBackfill: false as const,
        filterScope: 'date-project-run-node' as const,
      },
    },
    runWideCoverage:
      runUsage !== null && runUsage.coverage.unledgeredEventCount > 0 ? runUsage.coverage : null,
  };
}

const STATUS_COLOR: Record<InspectStatus, string> = {
  pending: 'text-text-tertiary',
  running: 'text-[color:var(--running)]',
  completed: 'text-success',
  failed: 'text-error',
  skipped: 'text-text-tertiary',
  awaiting: 'text-[color:var(--running)]',
};

/**
 * Thin divider heading one DAG node — exactly one per node, folded from its
 * transitions (started + terminal, plus any resume-time skip).
 *   left gutter:  relative timestamp (mono)
 *   left label:   node name in mono
 *   right label:  status + duration + ledger usage (when present)
 *
 * Failed nodes can still show ledger usage because data comes from
 * `node_usage_recorded`, not `node_completed`.
 */
export function NodeDivider({
  rowId,
  nodeId,
  nodeName,
  selected,
  onSelect,
  status,
  durationMs,
  timestamp,
  costUsd,
  reportedUsd,
  estimatedUsd,
  hasLedgerUsage = false,
  numTurns,
  stopReason,
  skipReason,
  skipExpr,
  showDetail = false,
  usageGroups,
  usageAggregate,
  runUsage = null,
}: NodeDividerProps): ReactElement {
  const { runStartedAt } = useStreamContext();
  const [expanded, setExpanded] = useState(false);
  const displayed = formatRelativeToBaseline(timestamp, runStartedAt);
  const wallClock = formatClock(timestamp);
  const dur =
    durationMs !== null && durationMs > 0
      ? ` · ${formatElapsed(Math.floor(durationMs / 1000))}`
      : '';

  let cost = '';
  if (hasLedgerUsage) {
    const rep = formatUsdAmount(reportedUsd ?? null, false);
    const est = formatUsdAmount(estimatedUsd ?? null, true);
    cost = ` · ${rep} / ${est}`;
  } else if (
    costUsd !== null &&
    costUsd !== undefined &&
    Number.isFinite(costUsd) &&
    costUsd >= 0
  ) {
    // Legacy node_completed cost only when the ledger has nothing for this step.
    // Authoritative reported zero still renders; ledger rows (incl. ledgered zero) win.
    cost = ` · ${formatUsdAmount(costUsd, false)}`;
  }

  const turns =
    numTurns !== null && numTurns !== undefined && numTurns > 0 ? ` · ${numTurns}t` : '';

  const hasStopDetail =
    status !== 'skipped' &&
    showDetail &&
    stopReason !== null &&
    stopReason !== undefined &&
    stopReason.length > 0;

  const hasSkipDetail =
    status === 'skipped' &&
    showDetail &&
    skipReason !== null &&
    skipReason !== undefined &&
    skipReason.length > 0;

  const canExpand =
    hasLedgerUsage &&
    usageGroups !== undefined &&
    usageGroups.length > 0 &&
    usageAggregate !== undefined;

  // Multi-row synthetic report — node ledger groups only; run-wide coverage labeled separately.
  const nodeUsageView =
    canExpand && usageGroups !== undefined && usageAggregate !== undefined
      ? buildNodeLedgerUsageReport({
          usageGroups,
          usageAggregate,
          runUsage,
        })
      : null;
  const nodeReport = nodeUsageView?.report ?? null;
  const runWideCoverage = nodeUsageView?.runWideCoverage ?? null;

  return (
    <div
      id={`node-transition-${rowId}`}
      className="flex flex-col gap-1 border-b border-border/60 py-[11px]"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onSelect(rowId, nodeId);
          }}
          aria-current={selected ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
        >
          <time
            dateTime={timestamp}
            title={wallClock}
            className="w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-text-tertiary"
          >
            {displayed}
          </time>
          <span className="font-mono text-[13px] font-semibold text-text-primary">{nodeName}</span>
          {/* Dashed leader line (design v3 .log-line). */}
          <div
            className="h-px flex-1"
            style={{
              background:
                'repeating-linear-gradient(90deg, var(--border) 0 4px, transparent 4px 8px)',
            }}
            aria-hidden
          />
          <span className={`font-mono text-[11.5px] ${STATUS_COLOR[status]}`}>
            {inspectStatusLabel(status)}
            {dur}
            {cost}
            {turns}
          </span>
        </button>
        {canExpand ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(v => !v);
            }}
            className="shrink-0 px-1 font-mono text-[10px] text-text-tertiary transition-colors hover:text-accent-bright"
            aria-expanded={expanded}
            aria-label={
              expanded ? 'Hide usage breakdown for this node' : 'Show usage breakdown for this node'
            }
            title="Show usage breakdown for this node"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : null}
      </div>
      {hasStopDetail ? (
        <div className="ml-[68px] flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-text-tertiary">
          <span>stop</span>
          <span className="text-text-secondary">{stopReason}</span>
        </div>
      ) : null}
      {hasSkipDetail ? (
        <div className="ml-[68px] flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-text-tertiary">
          <span>reason</span>
          <span className="text-text-secondary">{skipReason}</span>
          {skipExpr !== null && skipExpr !== undefined && skipExpr.length > 0 ? (
            <>
              <span>expr</span>
              <span className="text-text-secondary">{skipExpr}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {expanded && nodeReport !== null ? (
        <div className="ml-[68px] mt-2">
          <UsageBreakdownTable
            report={nodeReport}
            compact
            title={`Usage · ${nodeName}`}
            coveragePresentation="node-ledger"
            runWideCoverage={runWideCoverage}
          />
        </div>
      ) : null}
    </div>
  );
}
