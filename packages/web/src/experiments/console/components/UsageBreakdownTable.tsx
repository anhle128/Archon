/**
 * Shared usage breakdown table for the Cost page and run-detail node expansion.
 * Reported and estimated USD stay separate — never combined into one total.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { formatUsdAmount } from '../lib/format';
import type { UsageGroupBy, UsageMetrics, UsageReport, UsageReportGroup } from '../skills/usage';
import { EmptyState } from './EmptyState';

export interface UsageBreakdownTableProps {
  report: UsageReport | null;
  /** When true, surface a soft warning that the usage report could not load. */
  unavailable?: boolean;
  /** Optional title above the table (e.g. node name). */
  title?: string;
  /** Compact mode for inline node expansion. */
  compact?: boolean;
  className?: string;
}

function fmtTok(n: number | null): string {
  return n === null ? 'n/a' : n.toLocaleString('en-US');
}

function MetricsCells({ m }: { m: UsageMetrics }): ReactElement {
  return (
    <>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">
        {formatUsdAmount(m.reportedUsd, false)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">
        {formatUsdAmount(m.estimatedUsd, true)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-tertiary">
        {String(m.rowsMissingUsd)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">
        {fmtTok(m.tokensInput)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">
        {fmtTok(m.tokensOutput)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">
        {fmtTok(m.requests)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-tertiary">
        {String(m.recordCount)}
      </td>
    </>
  );
}

function groupLabel(group: UsageReportGroup, groupBy: UsageGroupBy): string {
  const d = group.dimensions;
  switch (groupBy) {
    case 'agent':
      return d.agentProvider ?? '(unknown agent)';
    case 'provider':
      return d.provider ?? '(unknown provider)';
    case 'model': {
      const p = d.provider ?? '?';
      const m = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return `${p}/${m}`;
    }
    case 'project':
      return d.codebaseName ?? d.codebaseId ?? '(deleted project)';
    case 'run': {
      const wf = d.workflowName ?? 'workflow';
      const id = d.runId !== undefined ? d.runId.replace(/-/g, '').slice(0, 8) : '?';
      return `${wf} · ${id}`;
    }
    case 'day':
      return d.day ?? '(unknown day)';
    case 'node':
      return d.nodeId ?? '(unattributed)';
  }
}

function runDetailHref(group: UsageReportGroup): string | null {
  const runId = group.dimensions.runId;
  const codebaseId = group.dimensions.codebaseId;
  if (runId === undefined || runId === '') return null;
  // Existing run-detail route requires a project id; deleted projects stay unlinked.
  if (codebaseId === null || codebaseId === undefined || codebaseId === '') return null;
  return `/console/p/${encodeURIComponent(codebaseId)}/r/${encodeURIComponent(runId)}`;
}

/**
 * Pure helpers exported for unit tests — loading/error/empty/zero/sub-cent states.
 */
export function describeUsageState(
  report: UsageReport | null,
  unavailable: boolean
): 'unavailable' | 'not-recorded' | 'empty-zero' | 'has-data' {
  if (unavailable || report === null) return 'unavailable';
  if (!report.coverage.hasRecordedUsage) return 'not-recorded';
  if (report.totals.recordCount === 0) return 'not-recorded';
  return 'has-data';
}

export function UsageBreakdownTable({
  report,
  unavailable = false,
  title,
  compact = false,
  className = '',
}: UsageBreakdownTableProps): ReactElement {
  const state = describeUsageState(report, unavailable);

  if (state === 'unavailable') {
    return (
      <div
        className={`rounded-[10px] border border-warning/40 bg-warning/[0.06] px-4 py-3 ${className}`}
        role="status"
      >
        <p className="text-[13px] font-medium text-warning">Usage report unavailable</p>
        <p className="mt-1 text-[12px] text-text-secondary">
          The usage query failed. This is not zero cost — try Refresh later. Legacy run totals, if
          shown, are labeled separately and are not a substitute for the ledger.
        </p>
      </div>
    );
  }

  if (state === 'not-recorded') {
    return (
      <div className={className}>
        {title !== undefined ? (
          <h3 className="mb-2 text-[13px] font-semibold text-text-primary">{title}</h3>
        ) : null}
        <EmptyState
          title="No usage recorded"
          hint="No workflow AI usage events in this scope. That is not the same as a known $0.00 cost."
        />
      </div>
    );
  }

  // state === 'has-data' — report must be non-null after the guards above.
  if (report === null) {
    return (
      <div
        className={`rounded-[10px] border border-warning/40 bg-warning/[0.06] px-4 py-3 ${className}`}
        role="status"
      >
        <p className="text-[13px] font-medium text-warning">Usage report unavailable</p>
      </div>
    );
  }
  const coverage = report.coverage;
  const pad = compact ? 'px-2 py-1' : 'px-2 py-1.5';

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {title !== undefined ? (
        <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
      ) : null}

      {/* Totals strip — reported / estimated stay distinct */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-[10px] border border-border bg-surface-elevated/40 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Reported
          </span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-text-primary">
            {formatUsdAmount(report.totals.reportedUsd, false)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Estimated
          </span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-text-primary">
            {formatUsdAmount(report.totals.estimatedUsd, true)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Unpriced rows
          </span>
          <span className="font-mono text-[15px] tabular-nums text-text-secondary">
            {String(report.totals.rowsMissingUsd)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Tokens in / out
          </span>
          <span className="font-mono text-[13px] tabular-nums text-text-secondary">
            {fmtTok(report.totals.tokensInput)} / {fmtTok(report.totals.tokensOutput)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Requests
          </span>
          <span className="font-mono text-[13px] tabular-nums text-text-secondary">
            {fmtTok(report.totals.requests)}
          </span>
        </div>
        <div className="ml-auto flex flex-col gap-0.5 text-right">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Ledger coverage
          </span>
          <span className="font-mono text-[12px] tabular-nums text-text-secondary">
            {String(coverage.ledgeredEventCount)}/{String(coverage.usageEventCount)} ledgered
            {coverage.unledgeredEventCount > 0
              ? ` · ${String(coverage.unledgeredEventCount)} unledgered`
              : ''}
          </span>
        </div>
      </div>

      {coverage.unledgeredEventCount > 0 ? (
        <div
          className="rounded-[10px] border border-warning/30 bg-warning/[0.05] px-3 py-2 text-[12px] text-text-secondary"
          role="status"
        >
          {String(coverage.unledgeredEventCount)} usage event
          {coverage.unledgeredEventCount === 1 ? '' : 's'} lack ledger rows (event-only fallback).
          Totals under-count until those rows are repaired.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/50 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              <th className={`${pad} font-semibold`}>Group</th>
              <th className={`${pad} text-right font-semibold`}>Reported</th>
              <th className={`${pad} text-right font-semibold`}>Estimated</th>
              <th className={`${pad} text-right font-semibold`}>Unpriced</th>
              <th className={`${pad} text-right font-semibold`}>In</th>
              <th className={`${pad} text-right font-semibold`}>Out</th>
              <th className={`${pad} text-right font-semibold`}>Req</th>
              <th className={`${pad} text-right font-semibold`}>Rows</th>
            </tr>
          </thead>
          <tbody>
            {report.groups.map((g, i) => {
              const label = groupLabel(g, report.groupBy);
              const href = report.groupBy === 'run' ? runDetailHref(g) : null;
              return (
                <tr
                  key={`${label}:${String(i)}`}
                  className="border-b border-border/60 last:border-b-0"
                >
                  <td className={`${pad} font-mono text-text-primary`}>
                    {href !== null ? (
                      <Link
                        to={href}
                        className="text-accent-bright transition-colors hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </td>
                  <MetricsCells m={g.metrics} />
                </tr>
              );
            })}
            <tr className="bg-surface-elevated/30 font-semibold">
              <td className={`${pad} font-mono text-text-primary`}>Totals</td>
              <MetricsCells m={report.totals} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
