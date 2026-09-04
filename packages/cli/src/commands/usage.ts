/**
 * `archon usage` — installation-wide workflow usage report.
 *
 * Reuses core `queryUsageReport` (defaults, filters, range bounds, grouping,
 * coverage). CLI maps `--since`/`--until` → query `from`/`to` to avoid colliding
 * with worktree `--from`. Human output distinguishes reported vs estimated USD;
 * `--json` emits the exact camelCase report via writeJsonLine.
 */
import {
  queryUsageReport,
  UsageReportQueryError,
  type UsageReportQuery,
} from '@archon/core/db/usage-report';
import type {
  UsageGroupBy,
  UsageMetrics,
  UsageReport,
  UsageReportGroup,
} from '@archon/core/schemas/usage-report';
import {
  usageGroupBySchema,
  usageInstantStringSchema,
  usageKindFilterSchema,
} from '@archon/core/schemas/usage-report';
import { writeJsonLine } from '../utils/stdout';

/** Positive amounts strictly below this floor use the `<$0.000001` form. */
const USD_POSITIVE_FLOOR = 0.000_001;
const ONE_CENT = 0.01;

export interface UsageCommandOptions {
  /** CLI `--since` → query `from` (RFC 3339). */
  since?: string;
  /** CLI `--until` → query `to` (RFC 3339). */
  until?: string;
  /** CLI `--by` → query `groupBy`. */
  by?: string;
  codebaseId?: string;
  agent?: string;
  provider?: string;
  model?: string;
  kind?: string;
  runId?: string;
  node?: string;
  json?: boolean;
}

export type UsageQueryFn = (options: UsageReportQuery) => Promise<UsageReport>;

/**
 * Format a USD amount for human CLI output.
 *
 * - null/undefined → `n/a`
 * - exact 0 → `$0.00` or `≈$0.00`
 * - positive below 1e-6 → `<$0.000001` / `≈<$0.000001` (never rounds to zero)
 * - positive below one cent → up to six significant decimals
 * - otherwise → two decimals
 */
export function formatUsdAmount(amount: number | null | undefined, estimated: boolean): string {
  if (amount === null || amount === undefined) {
    return 'n/a';
  }
  const approx = estimated ? '≈' : '';
  if (amount === 0) {
    return `${approx}$0.00`;
  }
  if (amount > 0 && amount < USD_POSITIVE_FLOOR) {
    return `${approx}<$0.000001`;
  }
  if (amount > 0 && amount < ONE_CENT) {
    // Preserve up to 6 decimals; strip only trailing zeros after the last non-zero digit.
    const fixed = amount.toFixed(6);
    const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    // Guard: never collapse a positive value to bare `$0`.
    if (trimmed === '0' || trimmed === '0.0') {
      return `${approx}<$0.000001`;
    }
    return `${approx}$${trimmed}`;
  }
  return `${approx}$${amount.toFixed(2)}`;
}

function formatMetricsLine(metrics: UsageMetrics): string {
  const reported = formatUsdAmount(metrics.reportedUsd, false);
  const estimated = formatUsdAmount(metrics.estimatedUsd, true);
  const inTok = metrics.tokensInput === null ? 'n/a' : String(metrics.tokensInput);
  const outTok = metrics.tokensOutput === null ? 'n/a' : String(metrics.tokensOutput);
  const req = metrics.requests === null ? 'n/a' : String(metrics.requests);
  return [
    `reported ${reported}`,
    `estimated ${estimated}`,
    `in ${inTok}`,
    `out ${outTok}`,
    `req ${req}`,
    `rows ${String(metrics.recordCount)}`,
    `unpriced ${String(metrics.rowsMissingUsd)}`,
  ].join('  ');
}

/** Human label for one report group — includes every dimension fixed for `groupBy`. */
export function dimensionLabel(group: UsageReportGroup, groupBy: UsageGroupBy): string {
  const d = group.dimensions;
  switch (groupBy) {
    case 'agent':
      return d.agentProvider ?? '(unknown agent)';
    case 'provider':
      return d.provider ?? '(unknown provider)';
    case 'model': {
      // Fixed dims: provider, model, modelSource
      const provider = d.provider ?? '(unknown provider)';
      const model = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return `${provider}/${model} · ${formatModelSourceLabel(d.modelSource)}`;
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
      // Fixed dims: runId, workflowName, codebaseId
      const run = d.runId ?? '(unknown run)';
      const wf = d.workflowName ?? '(unknown workflow)';
      const projectId =
        d.codebaseId === null || d.codebaseId === undefined ? '(no project id)' : d.codebaseId;
      return `${run} · ${wf} · project ${projectId}`;
    }
    case 'day':
      return d.day ?? '(unknown day)';
    case 'node': {
      // Fixed dims: runId, nodeId, agentProvider, provider, model, modelSource, kind
      const nodeId = d.nodeId === null || d.nodeId === undefined ? '(unknown node)' : d.nodeId;
      const runId = d.runId ?? '(unknown run)';
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
    default: {
      const exhaustiveCheck: never = groupBy;
      return String(exhaustiveCheck);
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

function printHumanReport(report: UsageReport): void {
  const { scope, groupBy, totals, groups, coverage } = report;
  const fromLabel = scope.from ?? '(entire run / open)';
  const toLabel = scope.to ?? '(entire run / open)';
  console.log(`Usage report  groupBy=${groupBy}  range=[${fromLabel}, ${toLabel})`);
  if (scope.runId) {
    console.log(`  runId=${scope.runId}`);
  }
  if (scope.codebaseId) {
    console.log(`  codebaseId=${scope.codebaseId}`);
  }
  console.log(`Totals:  ${formatMetricsLine(totals)}`);
  if (groups.length === 0) {
    console.log(coverage.hasRecordedUsage ? 'No groups matched filters.' : 'No usage recorded.');
  } else {
    console.log(`Groups (${String(groups.length)}):`);
    for (const group of groups) {
      console.log(`  ${dimensionLabel(group, groupBy)}`);
      console.log(`    ${formatMetricsLine(group.metrics)}`);
    }
  }
  console.log(
    `Coverage: events=${String(coverage.usageEventCount)} ledgered=${String(coverage.ledgeredEventCount)} unledgered=${String(coverage.unledgeredEventCount)} recorded=${coverage.hasRecordedUsage ? 'yes' : 'no'}`
  );
  if (coverage.unledgeredEventCount > 0) {
    console.warn(
      `Warning: ${String(coverage.unledgeredEventCount)} usage event(s) have no ledger rows (event-only fallback). Coverage is incomplete for those events.`
    );
  }
}

function buildQuery(options: UsageCommandOptions): UsageReportQuery | { error: string } {
  const query: UsageReportQuery = {};

  if (options.since !== undefined || options.until !== undefined) {
    if (options.since === undefined || options.until === undefined) {
      return {
        error: '--since and --until must both be present or both absent (half-open UTC range)',
      };
    }
    const sinceParsed = usageInstantStringSchema.safeParse(options.since);
    if (!sinceParsed.success) {
      return {
        error: 'Invalid --since: must be a valid RFC 3339 instant with Z or numeric offset',
      };
    }
    const untilParsed = usageInstantStringSchema.safeParse(options.until);
    if (!untilParsed.success) {
      return {
        error: 'Invalid --until: must be a valid RFC 3339 instant with Z or numeric offset',
      };
    }
    query.from = sinceParsed.data;
    query.to = untilParsed.data;
  }

  if (options.by !== undefined) {
    const parsed = usageGroupBySchema.safeParse(options.by);
    if (!parsed.success) {
      return {
        error: `Invalid --by: expected one of ${usageGroupBySchema.options.join(', ')}`,
      };
    }
    query.groupBy = parsed.data;
  }

  if (options.kind !== undefined) {
    const parsed = usageKindFilterSchema.safeParse(options.kind);
    if (!parsed.success) {
      return {
        error: `Invalid --kind: expected one of ${usageKindFilterSchema.options.join(', ')}`,
      };
    }
    query.kind = parsed.data;
  }

  if (options.codebaseId !== undefined) query.codebaseId = options.codebaseId;
  if (options.agent !== undefined) query.agentProvider = options.agent;
  if (options.provider !== undefined) query.provider = options.provider;
  if (options.model !== undefined) query.model = options.model;
  if (options.runId !== undefined) query.runId = options.runId;
  if (options.node !== undefined) query.nodeId = options.node;

  return query;
}

/**
 * Top-level `archon usage` entry. Returns a process exit code.
 *
 * @param options - Parsed CLI flags (already rejected unsupported ones in cli.ts).
 * @param queryFn - Injectable query (defaults to core `queryUsageReport`).
 */
export async function usageCommand(
  options: UsageCommandOptions = {},
  queryFn: UsageQueryFn = queryUsageReport
): Promise<number> {
  const built = buildQuery(options);
  if ('error' in built) {
    console.error(`Error: ${built.error}`);
    return 1;
  }

  try {
    const report = await queryFn(built);
    if (options.json) {
      await writeJsonLine(report);
      return 0;
    }
    printHumanReport(report);
    return 0;
  } catch (err) {
    if (err instanceof UsageReportQueryError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    return 1;
  }
}
