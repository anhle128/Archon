/**
 * Installation usage/cost report skill.
 *
 * GET /api/usage — direct-run ledger aggregates only (no child rollups, no SSE).
 * Types come from generated OpenAPI schemas; never import @archon/core or workflows.
 */
import { requestJson } from '../lib/http';
import type { components } from '@/lib/api.generated';

/** Named OpenAPI schema may be `T | null` because run-detail marks usage nullable. */
export type UsageReport = NonNullable<components['schemas']['UsageReport']>;
export type UsageReportGroup = UsageReport['groups'][number];
export type UsageMetrics = UsageReport['totals'];
export type UsageGroupBy = UsageReport['groupBy'];
/** Kind filter values accepted by GET /api/usage. */
export type UsageKindFilter = 'unclassified' | 'advisor' | 'subagent';

export interface UsageQuery {
  from?: string;
  to?: string;
  codebaseId?: string;
  agentProvider?: string;
  provider?: string;
  model?: string;
  kind?: UsageKindFilter;
  runId?: string;
  nodeId?: string;
  groupBy?: UsageGroupBy;
}

/**
 * Cache-key fragment for every filter/group value the Cost page can set.
 * Empty/undefined values collapse to stable sentinels so keys never collide.
 */
export function usageCacheKey(query: UsageQuery): string {
  const parts = [
    query.from ?? '',
    query.to ?? '',
    query.codebaseId ?? '',
    query.agentProvider ?? '',
    query.provider ?? '',
    query.model ?? '',
    query.kind ?? '',
    query.runId ?? '',
    query.nodeId ?? '',
    query.groupBy ?? 'provider',
  ];
  return `usage:${parts.map(encodeURIComponent).join('|')}`;
}

/** Build GET /api/usage query string from camelCase filters. */
export function buildUsageSearchParams(query: UsageQuery): URLSearchParams {
  const qs = new URLSearchParams();
  if (query.from !== undefined && query.from !== '') qs.set('from', query.from);
  if (query.to !== undefined && query.to !== '') qs.set('to', query.to);
  if (query.codebaseId !== undefined && query.codebaseId !== '') {
    qs.set('codebaseId', query.codebaseId);
  }
  if (query.agentProvider !== undefined && query.agentProvider !== '') {
    qs.set('agentProvider', query.agentProvider);
  }
  if (query.provider !== undefined && query.provider !== '') qs.set('provider', query.provider);
  if (query.model !== undefined && query.model !== '') qs.set('model', query.model);
  if (query.kind !== undefined) qs.set('kind', query.kind);
  if (query.runId !== undefined && query.runId !== '') qs.set('runId', query.runId);
  if (query.nodeId !== undefined && query.nodeId !== '') qs.set('nodeId', query.nodeId);
  if (query.groupBy !== undefined) qs.set('groupBy', query.groupBy);
  return qs;
}

export async function getUsageReport(query: UsageQuery = {}): Promise<UsageReport> {
  const qs = buildUsageSearchParams(query);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return requestJson<UsageReport>(`/api/usage${suffix}`);
}

/** UTC calendar-day `YYYY-MM-DD` for an instant. */
export function utcDateOnly(d: Date = new Date()): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First calendar day of the UTC month containing `d`. */
export function utcMonthStart(d: Date = new Date()): string {
  return utcDateOnly(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/**
 * Inclusive UTC calendar-day range → API half-open `[from, to)`.
 * `through` is the last included day; exclusive `to` is midnight after that day.
 */
export function inclusiveUtcRangeToApi(
  fromDay: string,
  throughDay: string
): { from: string; to: string } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(throughDay)) {
    return { error: 'Dates must be YYYY-MM-DD (UTC calendar days).' };
  }
  const fromMs = Date.parse(`${fromDay}T00:00:00.000Z`);
  const throughMs = Date.parse(`${throughDay}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(throughMs)) {
    return { error: 'Invalid UTC calendar day.' };
  }
  if (throughMs < fromMs) {
    return { error: 'Through must be on or after From.' };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  // Inclusive span in days; reject when exclusive range would exceed 366 days.
  const inclusiveDays = Math.floor((throughMs - fromMs) / dayMs) + 1;
  if (inclusiveDays > 366) {
    return { error: 'Range cannot exceed 366 days.' };
  }
  const toMs = throughMs + dayMs;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}
