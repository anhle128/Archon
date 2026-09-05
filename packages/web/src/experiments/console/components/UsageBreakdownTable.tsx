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
  /**
   * `base` (default): report.coverage is the conservative date/project/run/node integrity scope.
   * `node-ledger`: groups are node-local ledger rows only — do not treat report.coverage as
   * node event integrity, and never invent event counts from ledger row counts.
   */
  coveragePresentation?: 'base' | 'node-ledger';
  /**
   * Optional run-wide integrity context for node expansion. When present with unledgered
   * events, render an explicitly labeled run-wide warning — never as this node's under-count.
   */
  runWideCoverage?: UsageReport['coverage'] | null;
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
      <td
        className="px-2 py-1.5 text-right font-mono tabular-nums text-text-tertiary"
        title="Missing token/request measure counts (not unpriced USD)"
      >
        {formatMissingMeasures(m)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-tertiary">
        {String(m.recordCount)}
      </td>
    </>
  );
}

/**
 * Human label for one report group — includes every dimension fixed for `groupBy`
 * so exact groups never collide in the UI solely because secondary dims were omitted.
 */
export function groupLabel(group: UsageReportGroup, groupBy: UsageGroupBy): string {
  const d = group.dimensions;
  switch (groupBy) {
    case 'agent':
      return d.agentProvider ?? '(unknown agent)';
    case 'provider':
      return d.provider ?? '(unknown provider)';
    case 'model': {
      // Fixed dims: provider, model, modelSource
      const p = d.provider ?? '(unknown provider)';
      const m = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return `${p}/${m} · ${formatModelSourceLabel(d.modelSource)}`;
    }
    case 'project': {
      // Fixed dims: codebaseId, codebaseName (null = unassigned/deleted)
      const name =
        d.codebaseName === null || d.codebaseName === undefined
          ? '(no project name)'
          : d.codebaseName;
      const id =
        d.codebaseId === null || d.codebaseId === undefined ? '(no project id)' : d.codebaseId;
      return `${name} · id ${id}`;
    }
    case 'run': {
      // Fixed dims: runId, workflowName, codebaseId — full runId, never truncated
      const run = d.runId !== undefined && d.runId !== '' ? d.runId : '(unknown run)';
      const wf = d.workflowName ?? '(unknown workflow)';
      const projectId =
        d.codebaseId === null || d.codebaseId === undefined || d.codebaseId === ''
          ? '(no project id)'
          : d.codebaseId;
      return `${run} · ${wf} · project ${projectId}`;
    }
    case 'day':
      return d.day ?? '(unknown day)';
    case 'node': {
      // Fixed dims: runId, nodeId, agentProvider, provider, model, modelSource, kind
      const nodeId = d.nodeId === null || d.nodeId === undefined ? '(unattributed)' : d.nodeId;
      const runId = d.runId !== undefined && d.runId !== '' ? d.runId : '(unknown run)';
      const agent = d.agentProvider ?? '(unknown agent)';
      const provider = d.provider ?? '(unknown provider)';
      const model = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return [
        nodeId,
        `run ${runId}`,
        `agent ${agent}`,
        `${provider}/${model}`,
        formatModelSourceLabel(d.modelSource),
        formatKindLabel(d.kind),
      ].join(' · ');
    }
  }
}

/** Explicit modelSource label — missing/unknown never look like a real source id. */
function formatModelSourceLabel(modelSource: string | undefined): string {
  if (modelSource === undefined || modelSource === 'unknown') {
    return 'unknown model source';
  }
  return `source ${modelSource}`;
}

/** Explicit kind label — null/undefined map to unclassified (SQL NULL). */
function formatKindLabel(kind: string | null | undefined): string {
  if (kind === null || kind === undefined) {
    return 'unclassified kind';
  }
  return `kind ${kind}`;
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
 * Pure helpers exported for unit tests — loading/error/empty/event-only/filter states.
 *
 * Order matters:
 * 1. unavailable / null
 * 2. historical never-recorded (`hasRecordedUsage: false`)
 * 3. true event-only (base scope has usage events and ZERO ledgered rows)
 * 4. dimension-filter no-match (base scope has any ledgered rows, zero matched groups;
 *    partial unledgered may still ride as a separate base-scope warning)
 * 5. has-data (matched ledger rows; partial unledgered is a warning inside this state)
 *
 * Coverage is conservative date/project/run/node integrity and does NOT include
 * provider/model/kind filters. True event-only is defined from base ledger coverage
 * (`ledgeredEventCount === 0`), never from `recordCount===0` alone under dimension filters.
 * A base with any ledgered event + empty matched groups is a filter miss — not wholly
 * event-only — even when some sibling events remain unledgered.
 */
export type UsageUiState =
  | 'unavailable'
  | 'not-recorded'
  | 'event-only'
  | 'filter-empty'
  | 'has-data';

export function describeUsageState(report: UsageReport | null, unavailable: boolean): UsageUiState {
  if (unavailable || report === null) return 'unavailable';
  if (!report.coverage.hasRecordedUsage) return 'not-recorded';

  const { unledgeredEventCount, ledgeredEventCount, usageEventCount } = report.coverage;
  if (report.totals.recordCount === 0) {
    // True event-only: base scope recorded usage events but materialised ZERO ledger rows.
    // Dimension filters must not reclassify a partially-ledgered base as wholly event-only.
    if (ledgeredEventCount === 0 && (unledgeredEventCount > 0 || usageEventCount > 0)) {
      return 'event-only';
    }
    // Any ledgered base event + zero matched ledger rows = provider/model/kind filter miss.
    // Partial unledgered (if any) is a separate base-scope warning, not this empty state.
    return 'filter-empty';
  }
  return 'has-data';
}

/** Compact per-dimension missing counters — separate from unpriced USD / ledger coverage. */
export function formatMissingMeasures(m: UsageMetrics): string {
  return [
    `in:${String(m.missingTokensInput)}`,
    `out:${String(m.missingTokensOutput)}`,
    `reason:${String(m.missingTokensReasoning)}`,
    `cacheR:${String(m.missingTokensCacheRead)}`,
    `cacheW:${String(m.missingTokensCacheWrite)}`,
    `req:${String(m.missingRequests)}`,
  ].join(' ');
}

/**
 * Shared warning copy for Cost table + run header when events lack ledger rows.
 * Always uses exact `unledgeredEventCount` — never substitutes total event count.
 */
export function eventOnlyUsageMessage(coverage: UsageReport['coverage']): string {
  const n = coverage.unledgeredEventCount;
  const label = n === 1 ? '1 usage event' : `${String(n)} usage events`;
  return `${label} recorded without ledger rows (event-only fallback). Totals are incomplete and under-counted.`;
}

/** Run-wide incomplete coverage — never presented as a node-local under-count. */
export function runWideCoverageMessage(coverage: UsageReport['coverage']): string {
  const n = coverage.unledgeredEventCount;
  if (n === 1) {
    return 'Run-wide: 1 usage event lacks ledger rows. This is run-scope coverage, not this node local under-count.';
  }
  return `Run-wide: ${String(n)} usage events lack ledger rows. This is run-scope coverage, not this node local under-count.`;
}

export function UsageBreakdownTable({
  report,
  unavailable = false,
  title,
  compact = false,
  className = '',
  coveragePresentation = 'base',
  runWideCoverage = null,
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

  // Historical / never-recorded — distinct from event-only fallback below.
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

  // Event-only fallback: usage events exist, ledger materialization failed.
  // Must render BEFORE any empty/no-row treatment and never say "No usage recorded".
  if (state === 'event-only') {
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
    return (
      <div className={`flex flex-col gap-3 ${className}`}>
        {title !== undefined ? (
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        ) : null}
        <div
          className="rounded-[10px] border border-warning/40 bg-warning/[0.06] px-4 py-3"
          role="status"
          data-usage-state="event-only"
        >
          <p className="text-[13px] font-medium text-warning">Incomplete usage coverage</p>
          <p className="mt-1 text-[12px] text-text-secondary">{eventOnlyUsageMessage(coverage)}</p>
          <p className="mt-2 font-mono text-[11px] tabular-nums text-text-tertiary">
            Ledger coverage: {String(coverage.ledgeredEventCount)}/
            {String(coverage.usageEventCount)} ledgered
            {coverage.unledgeredEventCount > 0
              ? ` · ${String(coverage.unledgeredEventCount)} unledgered`
              : ''}
          </p>
        </div>
      </div>
    );
  }

  // Base scope has ledgered rows (or empty integrity) but dimension filters matched zero groups.
  // Partial unledgered is a SEPARATE base-scope warning — never rebrand this as wholly event-only,
  // and never claim the empty filtered dimension itself owns the missing ledger rows.
  if (state === 'filter-empty') {
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
    const partialBase = coverage.unledgeredEventCount > 0;
    return (
      <div className={`flex flex-col gap-3 ${className}`} data-usage-state="filter-empty">
        {title !== undefined ? (
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        ) : null}
        {partialBase ? (
          <div
            className="rounded-[10px] border border-warning/30 bg-warning/[0.05] px-3 py-2 text-[12px] text-text-secondary"
            role="status"
            data-usage-state="partial-unledgered"
            data-coverage-scope="base"
          >
            <p>
              Base scope: {String(coverage.unledgeredEventCount)} usage event
              {coverage.unledgeredEventCount === 1 ? '' : 's'} lack ledger rows. Totals may
              under-count until those rows are repaired. This is base date/project/run/node coverage
              — not a property of the empty filtered dimension.
            </p>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-text-tertiary">
              Ledger coverage: {String(coverage.ledgeredEventCount)}/
              {String(coverage.usageEventCount)} ledgered · {String(coverage.unledgeredEventCount)}{' '}
              unledgered
            </p>
          </div>
        ) : null}
        <EmptyState
          title="No groups matched filters"
          hint={
            partialBase
              ? 'Provider, model, or kind filters matched no ledger rows. Some base-scope events still lack ledger rows (see warning above) — that under-count is base coverage, not this empty filter result.'
              : 'Base-scope usage is fully ledgered. Provider, model, or kind filters matched no ledger rows — this is not incomplete coverage and not missing usage.'
          }
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
  const showBaseCoverage = coveragePresentation === 'base';
  const showRunWideWarning = runWideCoverage !== null && runWideCoverage.unledgeredEventCount > 0;

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
        <div className="flex flex-col gap-0.5">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary"
            title="Missing token/request measure counts — separate from unpriced USD and ledger coverage"
          >
            Missing measures
          </span>
          <span
            className="font-mono text-[11px] tabular-nums text-text-secondary"
            data-testid="missing-measures-totals"
          >
            {formatMissingMeasures(report.totals)}
          </span>
        </div>
        {showBaseCoverage ? (
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
        ) : (
          <div className="ml-auto flex flex-col gap-0.5 text-right">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              Scope
            </span>
            <span
              className="font-mono text-[12px] tabular-nums text-text-secondary"
              data-coverage-scope="node-ledger"
            >
              node ledger rows
            </span>
          </div>
        )}
      </div>

      {showBaseCoverage && coverage.unledgeredEventCount > 0 ? (
        <div
          className="rounded-[10px] border border-warning/30 bg-warning/[0.05] px-3 py-2 text-[12px] text-text-secondary"
          role="status"
          data-usage-state="partial-unledgered"
        >
          {String(coverage.unledgeredEventCount)} usage event
          {coverage.unledgeredEventCount === 1 ? '' : 's'} lack ledger rows (event-only fallback).
          Totals under-count until those rows are repaired.
        </div>
      ) : null}

      {showRunWideWarning && runWideCoverage !== null ? (
        <div
          className="rounded-[10px] border border-warning/30 bg-warning/[0.05] px-3 py-2 text-[12px] text-text-secondary"
          role="status"
          data-coverage-scope="run-wide"
          data-usage-state="run-wide-unledgered"
        >
          {runWideCoverageMessage(runWideCoverage)}
          <span className="mt-1 block font-mono text-[11px] tabular-nums text-text-tertiary">
            Run-wide ledger: {String(runWideCoverage.ledgeredEventCount)}/
            {String(runWideCoverage.usageEventCount)} ledgered ·{' '}
            {String(runWideCoverage.unledgeredEventCount)} unledgered
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/50 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              <th className={`${pad} font-semibold`}>Group</th>
              <th className={`${pad} text-right font-semibold`}>Reported</th>
              <th className={`${pad} text-right font-semibold`}>Estimated</th>
              <th className={`${pad} text-right font-semibold`}>Unpriced</th>
              <th className={`${pad} text-right font-semibold`}>In</th>
              <th className={`${pad} text-right font-semibold`}>Out</th>
              <th className={`${pad} text-right font-semibold`}>Req</th>
              <th className={`${pad} text-right font-semibold`}>Missing</th>
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
