/**
 * Usage report query — dialect-safe aggregates over the usage ledger.
 *
 * Join path: ledger → workflow event → workflow run → codebase.
 * Accounting timestamp is the owning event's `created_at`.
 *
 * All filter values are SQL parameters. GROUP BY / ORDER BY fragments come only
 * from an exhaustive enum switch — never from request string interpolation.
 */
import { getDatabase, getDatabaseType } from './connection';
import type { QueryResult } from './adapters/types';

import { createLogger } from '@archon/paths';
import {
  USAGE_INSTANT_SHAPE_MESSAGE,
  usageGroupBySchema,
  usageInstantStringSchema,
  usageKindFilterSchema,
  usageReportSchema,
  type UsageDimensions,
  type UsageGroupBy,
  type UsageKindFilter,
  type UsageMetrics,
  type UsageReport,
} from '../schemas/usage-report';

import type { UsageLedgerKind, UsageLedgerModelSource } from '../schemas/usage-ledger';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger). */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.usage-report');
  return cachedLog;
}

/** Logical phases between multi-statement snapshot reads (test concurrency seam). */
export type UsageReportSnapshotPhase = 'after-totals' | 'after-groups';

type UsageReportSnapshotSeam = (phase: UsageReportSnapshotPhase) => void | Promise<void>;

/**
 * Test-only hook invoked between totals → groups → coverage reads inside the
 * snapshot. Production keeps this undefined. Lets tests commit a concurrent
 * observation mid-report and assert the returned object never tears.
 */
let usageReportSnapshotSeamForTest: UsageReportSnapshotSeam | undefined;

/** @internal */ export function setUsageReportSnapshotSeamForTest(
  seam: UsageReportSnapshotSeam | undefined
): void {
  usageReportSnapshotSeamForTest = seam;
}

const MAX_GROUPS = 500;
const FETCH_LIMIT = MAX_GROUPS + 1;
const MAX_CROSS_RUN_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type UsageReportQueryErrorCode =
  | 'validation'
  | 'overflow'
  | 'unsafe_aggregate'
  | 'query_failed';

/**
 * Structured error for invalid filters, group overflow, or corrupt aggregates.
 * REST maps `validation`/`overflow` to HTTP 400.
 */
export class UsageReportQueryError extends Error {
  readonly code: UsageReportQueryErrorCode;

  constructor(code: UsageReportQueryErrorCode, message: string) {
    super(message);
    this.name = 'UsageReportQueryError';
    this.code = code;
  }
}

/** Caller-facing query options (camelCase API convention). */
export interface UsageReportQuery {
  from?: Date | string;
  to?: Date | string;
  codebaseId?: string;
  agentProvider?: string;
  provider?: string;
  model?: string;
  kind?: UsageKindFilter;
  runId?: string;
  /** Exact persisted step name; requires `runId`. */
  nodeId?: string;
  /** Default: `provider`. */
  groupBy?: UsageGroupBy;
}

interface ResolvedScope {
  from: Date | null;
  to: Date | null;
  fromIso: string | null;
  toIso: string | null;
  codebaseId?: string;
  runId?: string;
  nodeId?: string;
  agentProvider?: string;
  provider?: string;
  model?: string;
  kind?: UsageKindFilter;
  groupBy: UsageGroupBy;
}

interface MetricAggRow {
  tokens_input_sum: string | number | null;
  tokens_output_sum: string | number | null;
  tokens_reasoning_sum: string | number | null;
  tokens_cache_read_sum: string | number | null;
  tokens_cache_write_sum: string | number | null;
  requests_sum: string | number | null;
  reported_usd_sum: string | number | null;
  estimated_usd_sum: string | number | null;
  record_count: string | number;
  missing_tokens_input: string | number;
  missing_tokens_output: string | number;
  missing_tokens_reasoning: string | number;
  missing_tokens_cache_read: string | number;
  missing_tokens_cache_write: string | number;
  missing_requests: string | number;
  rows_missing_usd: string | number;
}

interface GroupAggRow extends MetricAggRow {
  dim_agent_provider?: string | null;
  dim_provider?: string | null;
  dim_model?: string | null;
  dim_model_source?: string | null;
  dim_codebase_id?: string | null;
  dim_codebase_name?: string | null;
  dim_run_id?: string | null;
  dim_workflow_name?: string | null;
  dim_day?: string | Date | null;
  dim_node_id?: string | null;
  dim_kind?: string | null;
}

interface CoverageRow {
  usage_event_count: string | number;
  ledgered_event_count: string | number;
}

interface GroupSql {
  selectDims: string;
  groupBy: string;
  orderBy: string;
}

interface FilterBuild {
  params: unknown[];
  clauses: string[];
}

/**
 * Format a Date for `created_at` comparison params to match dialect storage.
 * SQLite stores timestamps as TEXT (`datetime('now')` → "YYYY-MM-DD HH:MM:SS",
 * optionally with fractional seconds). Preserve the full instant — never slice
 * to whole seconds — so half-open `[from, to)` bounds match PostgreSQL.
 */
function toDbDateParam(d: Date): string {
  if (getDatabaseType() !== 'sqlite') {
    return d.toISOString();
  }
  // "2026-09-01T00:00:00.500Z" → "2026-09-01 00:00:00.500"
  return d.toISOString().replace('T', ' ').replace(/Z$/, '');
}

/** UTC day expression for GROUP BY day — constant dialect branch only. */
function utcDayExpression(): string {
  return getDatabaseType() === 'postgresql'
    ? "((e.created_at AT TIME ZONE 'UTC')::date)"
    : "strftime('%Y-%m-%d', e.created_at)";
}

/**
 * Parse a usage range bound.
 * - `Date` instances are accepted for internal typed callers (must be finite).
 * - Strings must be complete RFC 3339 instants with `Z` or a numeric offset
 *   and at most 3 fractional second digits (millisecond precision).
 */
export function parseUsageInstant(value: Date | string, label: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new UsageReportQueryError('validation', `Invalid ${label}: must be a valid Date`);
    }
    return value;
  }
  const parsed = usageInstantStringSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? USAGE_INSTANT_SHAPE_MESSAGE;
    throw new UsageReportQueryError('validation', `Invalid ${label}: ${detail}`);
  }
  const d = new Date(parsed.data);
  if (Number.isNaN(d.getTime())) {
    throw new UsageReportQueryError(
      'validation',
      `Invalid ${label}: ${USAGE_INSTANT_SHAPE_MESSAGE}`
    );
  }
  return d;
}

function parseOptionalDate(value: Date | string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  return parseUsageInstant(value, label);
}

function currentUtcMonthBounds(now = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

function resolveQuery(options: UsageReportQuery = {}): ResolvedScope {
  const groupByRaw = options.groupBy ?? 'provider';
  const groupByParsed = usageGroupBySchema.safeParse(groupByRaw);
  if (!groupByParsed.success) {
    throw new UsageReportQueryError(
      'validation',
      `Invalid groupBy: expected one of ${usageGroupBySchema.options.join(', ')}`
    );
  }
  const groupBy = groupByParsed.data;

  const runId = options.runId?.trim() || undefined;
  const nodeId = options.nodeId?.trim() || undefined;
  const codebaseId = options.codebaseId?.trim() || undefined;
  const agentProvider = options.agentProvider?.trim() || undefined;
  const provider = options.provider?.trim() || undefined;
  const model = options.model?.trim() || undefined;

  if (options.kind !== undefined) {
    const kindParsed = usageKindFilterSchema.safeParse(options.kind);
    if (!kindParsed.success) {
      throw new UsageReportQueryError(
        'validation',
        `Invalid kind: expected one of ${usageKindFilterSchema.options.join(', ')}`
      );
    }
  }
  const kind = options.kind;

  if (nodeId && !runId) {
    throw new UsageReportQueryError('validation', 'nodeId requires runId');
  }
  if (groupBy === 'node' && !runId) {
    throw new UsageReportQueryError('validation', 'groupBy=node requires runId');
  }

  const hasFrom = options.from !== undefined;
  const hasTo = options.to !== undefined;
  if (hasFrom !== hasTo) {
    throw new UsageReportQueryError(
      'validation',
      'from and to must both be present or both absent'
    );
  }

  let from: Date | null = null;
  let to: Date | null = null;

  if (hasFrom && hasTo) {
    const parsedFrom = parseOptionalDate(options.from, 'from');
    const parsedTo = parseOptionalDate(options.to, 'to');
    if (!parsedFrom || !parsedTo) {
      throw new UsageReportQueryError(
        'validation',
        'from and to must both be present or both absent'
      );
    }
    from = parsedFrom;
    to = parsedTo;
    if (!(from.getTime() < to.getTime())) {
      throw new UsageReportQueryError('validation', 'from must be strictly before to');
    }
    // Cross-run ranges cannot exceed 366 days. Entire-run queries skip this cap.
    if (!runId) {
      const spanMs = to.getTime() - from.getTime();
      if (spanMs > MAX_CROSS_RUN_DAYS * MS_PER_DAY) {
        throw new UsageReportQueryError(
          'validation',
          `Cross-run date range cannot exceed ${String(MAX_CROSS_RUN_DAYS)} days`
        );
      }
    }
  } else if (!runId) {
    // Neither dates nor runId → current UTC calendar month.
    const bounds = currentUtcMonthBounds();
    from = bounds.from;
    to = bounds.to;
  }
  // runId without dates → entire direct run (from/to stay null).

  return {
    from,
    to,
    fromIso: from ? from.toISOString() : null,
    toIso: to ? to.toISOString() : null,
    codebaseId,
    runId,
    nodeId,
    agentProvider,
    provider,
    model,
    kind,
    groupBy,
  };
}

function pushParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${String(params.length)}`;
}

function appendDateAndIdentityFilters(scope: ResolvedScope, out: FilterBuild): void {
  if (scope.from && scope.to) {
    const fromParam = pushParam(out.params, toDbDateParam(scope.from));
    const toParam = pushParam(out.params, toDbDateParam(scope.to));
    if (getDatabaseType() === 'sqlite') {
      // `datetime()` truncates fractional seconds. Normalize both sides with
      // strftime %f so whole-second stored values and fractional bounds compare
      // as the same fixed-width UTC instant (".000" padded when absent).
      out.clauses.push(
        `strftime('%Y-%m-%d %H:%M:%f', e.created_at) >= strftime('%Y-%m-%d %H:%M:%f', ${fromParam})`
      );
      out.clauses.push(
        `strftime('%Y-%m-%d %H:%M:%f', e.created_at) < strftime('%Y-%m-%d %H:%M:%f', ${toParam})`
      );
    } else {
      out.clauses.push(`e.created_at >= ${fromParam}::timestamptz`);
      out.clauses.push(`e.created_at < ${toParam}::timestamptz`);
    }
  }

  if (scope.codebaseId) {
    out.clauses.push(`r.codebase_id = ${pushParam(out.params, scope.codebaseId)}`);
  }
  if (scope.runId) {
    out.clauses.push(`r.id = ${pushParam(out.params, scope.runId)}`);
  }
  if (scope.nodeId) {
    out.clauses.push(`e.step_name = ${pushParam(out.params, scope.nodeId)}`);
  }
}

/** Ledger metric filters: date/project/run/node + agent/provider/model/kind. */
function buildLedgerFilters(scope: ResolvedScope): FilterBuild {
  const out: FilterBuild = { params: [], clauses: [] };
  appendDateAndIdentityFilters(scope, out);

  if (scope.agentProvider) {
    out.clauses.push(`l.agent_provider = ${pushParam(out.params, scope.agentProvider)}`);
  }
  if (scope.provider) {
    out.clauses.push(`l.provider = ${pushParam(out.params, scope.provider)}`);
  }
  if (scope.model) {
    out.clauses.push(`l.model = ${pushParam(out.params, scope.model)}`);
  }
  if (scope.kind === 'unclassified') {
    out.clauses.push('l.kind IS NULL');
  } else if (scope.kind === 'advisor' || scope.kind === 'subagent') {
    out.clauses.push(`l.kind = ${pushParam(out.params, scope.kind)}`);
  }

  return out;
}

/**
 * Coverage filters: date/project/run/node only.
 * Agent/provider/model/kind are excluded because fallback usage events have no
 * normalized ledger row on which those dimensions can operate.
 */
function buildCoverageFilters(scope: ResolvedScope): FilterBuild {
  const out: FilterBuild = { params: [], clauses: [] };
  appendDateAndIdentityFilters(scope, out);
  return out;
}

const METRIC_SELECT = `
  SUM(l.tokens_input) AS tokens_input_sum,
  SUM(l.tokens_output) AS tokens_output_sum,
  SUM(l.tokens_reasoning) AS tokens_reasoning_sum,
  SUM(l.tokens_cache_read) AS tokens_cache_read_sum,
  SUM(l.tokens_cache_write) AS tokens_cache_write_sum,
  SUM(l.requests) AS requests_sum,
  SUM(l.cost_usd) AS reported_usd_sum,
  SUM(l.cost_estimated_usd) AS estimated_usd_sum,
  COUNT(*) AS record_count,
  COALESCE(SUM(CASE WHEN l.tokens_input IS NULL THEN 1 ELSE 0 END), 0) AS missing_tokens_input,
  COALESCE(SUM(CASE WHEN l.tokens_output IS NULL THEN 1 ELSE 0 END), 0) AS missing_tokens_output,
  COALESCE(SUM(CASE WHEN l.tokens_reasoning IS NULL THEN 1 ELSE 0 END), 0) AS missing_tokens_reasoning,
  COALESCE(SUM(CASE WHEN l.tokens_cache_read IS NULL THEN 1 ELSE 0 END), 0) AS missing_tokens_cache_read,
  COALESCE(SUM(CASE WHEN l.tokens_cache_write IS NULL THEN 1 ELSE 0 END), 0) AS missing_tokens_cache_write,
  COALESCE(SUM(CASE WHEN l.requests IS NULL THEN 1 ELSE 0 END), 0) AS missing_requests,
  COALESCE(SUM(CASE WHEN l.cost_usd IS NULL AND l.cost_estimated_usd IS NULL THEN 1 ELSE 0 END), 0) AS rows_missing_usd
`.trim();

const LEDGER_FROM = `
  FROM remote_agent_usage_ledger l
  INNER JOIN remote_agent_workflow_events e ON e.id = l.workflow_event_id
  INNER JOIN remote_agent_workflow_runs r ON r.id = e.workflow_run_id
  LEFT JOIN remote_agent_codebases c ON c.id = r.codebase_id
`.trim();

/**
 * Exhaustive enum switch for GROUP BY dimensions.
 * Never interpolates request strings into SQL identifiers.
 */
function groupSql(groupBy: UsageGroupBy): GroupSql {
  switch (groupBy) {
    case 'agent':
      return {
        selectDims: 'l.agent_provider AS dim_agent_provider',
        groupBy: 'l.agent_provider',
        orderBy: 'l.agent_provider ASC NULLS FIRST',
      };
    case 'provider':
      return {
        selectDims: 'l.provider AS dim_provider',
        groupBy: 'l.provider',
        orderBy: 'l.provider ASC NULLS FIRST',
      };
    case 'model':
      return {
        selectDims: [
          'l.provider AS dim_provider',
          'l.model AS dim_model',
          'l.model_source AS dim_model_source',
        ].join(', '),
        groupBy: 'l.provider, l.model, l.model_source',
        orderBy:
          'l.provider ASC NULLS FIRST, l.model ASC NULLS FIRST, l.model_source ASC NULLS FIRST',
      };
    case 'project':
      return {
        selectDims: 'r.codebase_id AS dim_codebase_id, c.name AS dim_codebase_name',
        groupBy: 'r.codebase_id, c.name',
        orderBy: 'r.codebase_id ASC NULLS FIRST, c.name ASC NULLS FIRST',
      };
    case 'run':
      return {
        selectDims: [
          'r.id AS dim_run_id',
          'r.workflow_name AS dim_workflow_name',
          'r.codebase_id AS dim_codebase_id',
        ].join(', '),
        groupBy: 'r.id, r.workflow_name, r.codebase_id',
        orderBy:
          'r.id ASC NULLS FIRST, r.workflow_name ASC NULLS FIRST, r.codebase_id ASC NULLS FIRST',
      };
    case 'day': {
      const dayExpr = utcDayExpression();
      return {
        selectDims: `${dayExpr} AS dim_day`,
        groupBy: dayExpr,
        orderBy: `${dayExpr} ASC NULLS FIRST`,
      };
    }
    case 'node':
      return {
        selectDims: [
          'r.id AS dim_run_id',
          'e.step_name AS dim_node_id',
          'l.agent_provider AS dim_agent_provider',
          'l.provider AS dim_provider',
          'l.model AS dim_model',
          'l.model_source AS dim_model_source',
          'l.kind AS dim_kind',
        ].join(', '),
        groupBy: 'r.id, e.step_name, l.agent_provider, l.provider, l.model, l.model_source, l.kind',
        orderBy: [
          'r.id ASC NULLS FIRST',
          'e.step_name ASC NULLS FIRST',
          'l.agent_provider ASC NULLS FIRST',
          'l.provider ASC NULLS FIRST',
          'l.model ASC NULLS FIRST',
          'l.model_source ASC NULLS FIRST',
          'l.kind ASC NULLS FIRST',
        ].join(', '),
      };
    default: {
      const unexpected: never = groupBy;
      throw new UsageReportQueryError(
        'validation',
        `Unsupported groupBy: ${JSON.stringify(unexpected)}`
      );
    }
  }
}

function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return Object.prototype.toString.call(value);
}

function toSafeCount(value: unknown, field: string): number {
  if (value === null || value === undefined) {
    throw new UsageReportQueryError('unsafe_aggregate', `Missing count for ${field}`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new UsageReportQueryError(
      'unsafe_aggregate',
      `Unsafe or negative count for ${field}: ${describeUnknown(value)}`
    );
  }
  return n;
}

function toNullableTokenSum(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new UsageReportQueryError(
      'unsafe_aggregate',
      `Unsafe token aggregate for ${field}: ${describeUnknown(value)}`
    );
  }
  return n;
}

function toNullableUsdSum(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageReportQueryError(
      'unsafe_aggregate',
      `Unsafe USD aggregate for ${field}: ${describeUnknown(value)}`
    );
  }
  return n;
}

function mapMetrics(row: MetricAggRow): UsageMetrics {
  return {
    tokensInput: toNullableTokenSum(row.tokens_input_sum, 'tokensInput'),
    tokensOutput: toNullableTokenSum(row.tokens_output_sum, 'tokensOutput'),
    tokensReasoning: toNullableTokenSum(row.tokens_reasoning_sum, 'tokensReasoning'),
    tokensCacheRead: toNullableTokenSum(row.tokens_cache_read_sum, 'tokensCacheRead'),
    tokensCacheWrite: toNullableTokenSum(row.tokens_cache_write_sum, 'tokensCacheWrite'),
    requests: toNullableTokenSum(row.requests_sum, 'requests'),
    reportedUsd: toNullableUsdSum(row.reported_usd_sum, 'reportedUsd'),
    estimatedUsd: toNullableUsdSum(row.estimated_usd_sum, 'estimatedUsd'),
    recordCount: toSafeCount(row.record_count, 'recordCount'),
    missingTokensInput: toSafeCount(row.missing_tokens_input, 'missingTokensInput'),
    missingTokensOutput: toSafeCount(row.missing_tokens_output, 'missingTokensOutput'),
    missingTokensReasoning: toSafeCount(row.missing_tokens_reasoning, 'missingTokensReasoning'),
    missingTokensCacheRead: toSafeCount(row.missing_tokens_cache_read, 'missingTokensCacheRead'),
    missingTokensCacheWrite: toSafeCount(row.missing_tokens_cache_write, 'missingTokensCacheWrite'),
    missingRequests: toSafeCount(row.missing_requests, 'missingRequests'),
    rowsMissingUsd: toSafeCount(row.rows_missing_usd, 'rowsMissingUsd'),
  };
}

function emptyMetrics(): UsageMetrics {
  return {
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: null,
    estimatedUsd: null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
  };
}

function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  throw new UsageReportQueryError(
    'unsafe_aggregate',
    `Non-string dimension value: ${describeUnknown(value)}`
  );
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asOptionalString(value);
}

function mapDimensions(groupBy: UsageGroupBy, row: GroupAggRow): UsageDimensions {
  switch (groupBy) {
    case 'agent':
      return { agentProvider: asOptionalString(row.dim_agent_provider) };
    case 'provider':
      return { provider: asOptionalString(row.dim_provider) };
    case 'model':
      return {
        provider: asOptionalString(row.dim_provider),
        model: asNullableString(row.dim_model) ?? null,
        modelSource:
          (row.dim_model_source as UsageLedgerModelSource | null | undefined) ?? undefined,
      };
    case 'project':
      return {
        codebaseId: asNullableString(row.dim_codebase_id) ?? null,
        codebaseName: asNullableString(row.dim_codebase_name) ?? null,
      };
    case 'run':
      return {
        runId: asOptionalString(row.dim_run_id),
        workflowName: asOptionalString(row.dim_workflow_name),
        codebaseId: asNullableString(row.dim_codebase_id) ?? null,
      };
    case 'day': {
      // Postgres may return a Date for ::date; normalize to YYYY-MM-DD.
      const raw = row.dim_day;
      if (raw instanceof Date) {
        return { day: raw.toISOString().slice(0, 10) };
      }
      const s = asOptionalString(raw);
      return { day: s ? s.slice(0, 10) : s };
    }
    case 'node':
      return {
        runId: asOptionalString(row.dim_run_id),
        nodeId: asNullableString(row.dim_node_id) ?? null,
        agentProvider: asOptionalString(row.dim_agent_provider),
        provider: asOptionalString(row.dim_provider),
        model: asNullableString(row.dim_model) ?? null,
        modelSource:
          (row.dim_model_source as UsageLedgerModelSource | null | undefined) ?? undefined,
        kind: (row.dim_kind as UsageLedgerKind | null | undefined) ?? null,
      };
    default: {
      const unexpected: never = groupBy;
      throw new UsageReportQueryError(
        'validation',
        `Unsupported groupBy: ${JSON.stringify(unexpected)}`
      );
    }
  }
}

/**
 * Query installation usage with shared filtering/grouping semantics for
 * REST, CLI, and run-detail surfaces.
 *
 * Throws {@link UsageReportQueryError} on validation failure, group overflow
 * (>500), or unsafe aggregates. Never silently truncates accounting groups.
 */
export async function queryUsageReport(options: UsageReportQuery = {}): Promise<UsageReport> {
  const scope = resolveQuery(options);
  const ledger = buildLedgerFilters(scope);
  const coverage = buildCoverageFilters(scope);
  const g = groupSql(scope.groupBy);

  const ledgerWhere = whereSql(ledger.clauses);

  const totalsSql = `
    SELECT ${METRIC_SELECT}
    ${LEDGER_FROM}
    ${ledgerWhere}
  `;

  const groupsSql = `
    SELECT ${g.selectDims}, ${METRIC_SELECT}
    ${LEDGER_FROM}
    ${ledgerWhere}
    GROUP BY ${g.groupBy}
    ORDER BY ${g.orderBy}
    LIMIT ${String(FETCH_LIMIT)}
  `;

  const coverageClauses = ["e.event_type = 'node_usage_recorded'", ...coverage.clauses];
  const coverageSql = `
    SELECT
      COUNT(*) AS usage_event_count,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM remote_agent_usage_ledger l2
        WHERE l2.workflow_event_id = e.id
      ) THEN e.id ELSE NULL END) AS ledgered_event_count
    FROM remote_agent_workflow_events e
    INNER JOIN remote_agent_workflow_runs r ON r.id = e.workflow_run_id
    WHERE ${coverageClauses.join(' AND ')}
  `;

  try {
    const db = getDatabase();
    const { totalsResult, groupsResult, coverageResult } = await db.withSnapshotRead(
      async (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => {
        const totalsResult = await query<MetricAggRow>(totalsSql, ledger.params);
        await usageReportSnapshotSeamForTest?.('after-totals');
        const groupsResult = await query<GroupAggRow>(groupsSql, ledger.params);
        await usageReportSnapshotSeamForTest?.('after-groups');
        const coverageResult = await query<CoverageRow>(coverageSql, coverage.params);
        return { totalsResult, groupsResult, coverageResult };
      }
    );

    if (groupsResult.rows.length > MAX_GROUPS) {
      throw new UsageReportQueryError(
        'overflow',
        `Usage report exceeds ${String(MAX_GROUPS)} groups; narrow filters (dates, project, run, provider, or groupBy)`
      );
    }

    const totalsRow = totalsResult.rows[0];
    const totals = totalsRow ? mapMetrics(totalsRow) : emptyMetrics();

    const groups = groupsResult.rows.map(row => ({
      dimensions: mapDimensions(scope.groupBy, row),
      metrics: mapMetrics(row),
    }));

    const coverageRow = coverageResult.rows[0];
    const usageEventCount = coverageRow
      ? toSafeCount(coverageRow.usage_event_count, 'usageEventCount')
      : 0;
    const ledgeredEventCount = coverageRow
      ? toSafeCount(coverageRow.ledgered_event_count, 'ledgeredEventCount')
      : 0;
    if (ledgeredEventCount > usageEventCount) {
      throw new UsageReportQueryError(
        'unsafe_aggregate',
        'ledgeredEventCount exceeds usageEventCount'
      );
    }

    const report: UsageReport = {
      scope: {
        from: scope.fromIso,
        to: scope.toIso,
        ...(scope.codebaseId ? { codebaseId: scope.codebaseId } : {}),
        ...(scope.runId ? { runId: scope.runId } : {}),
        includesChildRollup: false,
      },
      groupBy: scope.groupBy,
      totals,
      groups,
      coverage: {
        usageEventCount,
        ledgeredEventCount,
        unledgeredEventCount: usageEventCount - ledgeredEventCount,
        hasRecordedUsage: usageEventCount > 0,
        historicalBackfill: false,
        filterScope: 'date-project-run-node',
      },
    };

    return usageReportSchema.parse(report);
  } catch (error) {
    if (error instanceof UsageReportQueryError) throw error;
    const err = error as Error;
    getLog().error(
      { err, groupBy: scope.groupBy, runId: scope.runId },
      'usage.report_query_failed'
    );
    throw new UsageReportQueryError('query_failed', `Failed to query usage report: ${err.message}`);
  }
}
