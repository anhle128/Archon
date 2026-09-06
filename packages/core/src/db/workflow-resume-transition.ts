/**
 * Query-scoped resume primitive shared by public resumeWorkflowRun and
 * AskHuman last-pending resolution. Callers own the transaction; this module
 * must not open one.
 */
import type { QueryResult, SqlDialect } from './adapters/types';
import { getDatabaseType } from './connection';
import { insertWorkflowEvent } from './workflow-events';

export type WorkflowTransactionQuery = <T>(
  sql: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

export type ResumeEligibility = 'standard' | 'paused-ask';

/**
 * Days of inactivity after which a 'running' run is treated as an orphan (its
 * executor presumed dead) and becomes eligible for resume. Bound as a query
 * parameter — never interpolated — so both dialects handle it positionally.
 */
export const ORPHAN_RESUME_STALE_DAYS = 1;

/**
 * SQL fragment matching a run that may be resumed: failed/paused/cancelled, or a stale
 * 'running' orphan (no activity for ORPHAN_RESUME_STALE_DAYS). `dayParamIndex`
 * is the 1-based placeholder position at which the caller MUST bind
 * ORPHAN_RESUME_STALE_DAYS. Shared by findResumableRun and resumeWorkflowRun so
 * the two predicates cannot drift — a hand-duplicated copy did drift and bound
 * the wrong placeholder, breaking resume (PR #1830 review C1).
 */
export function resumableWorkflowStatusClause(dialect: SqlDialect, dayParamIndex: number): string {
  const staleOrphan = `last_activity_at IS NULL OR last_activity_at < ${dialect.nowMinusDays(dayParamIndex)}`;
  return `(status IN ('failed', 'paused', 'cancelled') OR (status = 'running' AND (${staleOrphan})))`;
}

/**
 * `FOR UPDATE` on Postgres, empty on SQLite (which has no such syntax and does
 * not need it — the adapter serializes transactions on one connection, and a
 * cross-process writer that commits between our read and our write makes the
 * deferred BEGIN's read→write upgrade fail with SQLITE_BUSY rather than let a
 * stale snapshot through). Used to pin a run row across a read-then-CAS pair
 * so the value read is the value the CAS acts on.
 * Dialect-branched here rather than in SqlDialect: the branch mirrors
 * unresolvedGateClause's local getDatabaseType() check in workflows.ts.
 */
export function workflowRunLockClause(): string {
  return getDatabaseType() === 'postgresql' ? ' FOR UPDATE' : '';
}

/**
 * Extract a non-empty `metadata.error` string from a raw column value, or null
 * when there is nothing worth preserving. SQLite stores metadata as JSON TEXT
 * and Postgres returns a parsed object (same split normalizeWorkflowRun handles),
 * so both shapes are accepted; absent / null / non-string / empty / unparseable
 * all collapse to null.
 */
function readMetadataError(raw: unknown): string | null {
  let metadata: unknown = raw;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (typeof metadata !== 'object' || metadata === null) return null;
  const error = (metadata as Record<string, unknown>).error;
  return typeof error === 'string' && error !== '' ? error : null;
}

function resumeWhereClause(
  dialect: SqlDialect,
  eligibility: ResumeEligibility,
  dayParamIndex: number
): string {
  if (eligibility === 'paused-ask') {
    return "status = 'paused'";
  }
  return resumableWorkflowStatusClause(dialect, dayParamIndex);
}

/**
 * Flip a run to `running` inside an already-open transaction.
 *
 * Owns the resume UPDATE, metadata-error clear, last-activity timestamps, and
 * conditional `workflow_resumed` audit write. `eligibility: 'standard'` keeps
 * the public failed/paused/cancelled/stale-running predicate.
 * `eligibility: 'paused-ask'` matches only `status = 'paused'` so an Ask
 * answer cannot resurrect a cancelled or failed run.
 *
 * Refresh started_at to NOW so the resumed row competes fairly with
 * currently-active rows in getActiveWorkflowRunByPath's older-wins
 * tiebreaker. The original creation time can be recovered from workflow_events.
 *
 * The CAS also clears `metadata.error` so a run that fails, is resumed, and
 * then completes doesn't keep rendering its old failure (#2329). Because
 * metadata is the ONLY place some failures are recorded — the CLI's SIGTERM
 * handler calls failWorkflowRun and writes no event (#2348) — the error being
 * cleared is first preserved as a `workflow_resumed` event, in the SAME
 * transaction as the clear. The event is written ONLY by the caller whose CAS
 * matched. Read-then-UPDATE rather than UPDATE…RETURNING because the SQLite
 * adapter rejects RETURNING on UPDATE.
 */
export async function resumeWorkflowRunInTransaction(
  query: WorkflowTransactionQuery,
  id: string,
  dialect: SqlDialect,
  eligibility: ResumeEligibility
): Promise<{ resumed: boolean }> {
  const priorRows = await query<{ metadata: unknown }>(
    `SELECT metadata FROM remote_agent_workflow_runs WHERE id = $1${workflowRunLockClause()}`,
    [id]
  );
  const clearedError = readMetadataError(priorRows.rows[0]?.metadata);
  const mergeJson = JSON.stringify({ error: null });
  const mergeParamIndex = eligibility === 'paused-ask' ? 2 : 3;
  const params: unknown[] =
    eligibility === 'paused-ask' ? [id, mergeJson] : [id, ORPHAN_RESUME_STALE_DAYS, mergeJson];

  const result = await query(
    `UPDATE remote_agent_workflow_runs
         SET status = 'running',
             completed_at = NULL,
             started_at = ${dialect.now()},
             last_activity_at = ${dialect.now()},
             metadata = ${dialect.jsonMerge('metadata', mergeParamIndex)}
         WHERE id = $1 AND ${resumeWhereClause(dialect, eligibility, 2)}`,
    params
  );

  const resumed = result.rowCount > 0;
  if (resumed && clearedError !== null) {
    await insertWorkflowEvent(query, {
      workflow_run_id: id,
      event_type: 'workflow_resumed',
      data: { error: clearedError },
    });
  }
  return { resumed };
}
