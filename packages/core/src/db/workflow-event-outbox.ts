/**
 * Database operations for external workflow-event outbox delivery.
 *
 * Public enqueue is best-effort and MUST NOT throw: workflow execution must not
 * fail because external notification persistence or delivery fails.
 */
import { createLogger } from '@archon/paths';
import { getDialect, pool } from './connection';
import type { QueryResult } from './adapters/types';
import {
  workflowEventDeliveryAttemptRowSchema,
  type WorkflowEventDeliveryAttemptOutcome,
  type WorkflowEventDeliveryAttemptRow,
} from '../schemas/workflow-event-delivery-attempt';
import {
  workflowEventOutboxRowSchema,
  type WorkflowEventOutboxRow,
  type WorkflowEventOutboxStatus,
} from '../schemas/workflow-event-outbox';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-event-outbox');
  return cachedLog;
}

type OutboxQuery<T = unknown> = (sql: string, params?: unknown[]) => Promise<QueryResult<T>>;

export interface InsertExternalWorkflowEventInput {
  event_id: string;
  idempotency_key: string;
  event_type: string;
  workflow_run_id: string;
  event_body: string;
  provider?: string;
  codebase_id?: string | null;
  binding_id?: string | null;
  event_route?: string | null;
  status?: WorkflowEventOutboxStatus;
  not_routable_reason?: string | null;
  next_attempt_at?: Date | string | null;
}

export interface PendingAttemptRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: string;
  startedAt?: Date | string;
}

export interface CompleteAttemptInput {
  attemptId: string;
  outcome: WorkflowEventDeliveryAttemptOutcome;
  completedAt?: Date | string;
  durationMs?: number | null;
  responseStatus?: number | null;
  responseHeaders?: Record<string, string> | null;
  responseBody?: string | null;
  transportError?: string | null;
}

export interface OutboxAttemptUpdate {
  status: WorkflowEventOutboxStatus;
  attempt_count: number;
  last_attempt_at: Date | string;
  next_attempt_at?: Date | string | null;
  last_error?: string | null;
}

function toDbTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseOutboxRow(row: unknown): WorkflowEventOutboxRow {
  return workflowEventOutboxRowSchema.parse(row);
}

function parseAttemptRow(row: unknown): WorkflowEventDeliveryAttemptRow {
  return workflowEventDeliveryAttemptRowSchema.parse(row);
}

export async function insertExternalWorkflowEvent(
  query: OutboxQuery<WorkflowEventOutboxRow>,
  data: InsertExternalWorkflowEventInput
): Promise<WorkflowEventOutboxRow> {
  const dialect = getDialect();
  const result = await query(
    `INSERT INTO remote_agent_workflow_event_outbox
       (id, event_id, idempotency_key, event_type, provider, workflow_run_id, codebase_id,
        binding_id, event_route, event_body, status, not_routable_reason, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      dialect.generateUuid(),
      data.event_id,
      data.idempotency_key,
      data.event_type,
      data.provider ?? 'archon',
      data.workflow_run_id,
      data.codebase_id ?? null,
      data.binding_id ?? null,
      data.event_route ?? null,
      data.event_body,
      data.status ?? 'pending',
      data.not_routable_reason ?? null,
      toDbTimestamp(data.next_attempt_at),
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('WORKFLOW_EVENT_OUTBOX_INSERT_EMPTY');
  return parseOutboxRow(row);
}

export async function enqueueExternalWorkflowEvent(
  data: InsertExternalWorkflowEventInput
): Promise<void> {
  try {
    await insertExternalWorkflowEvent(
      (sql, params) => pool.query<WorkflowEventOutboxRow>(sql, params),
      data
    );
  } catch (error) {
    getLog().error(
      { err: error as Error, eventType: data.event_type, runId: data.workflow_run_id },
      'db.workflow_event_outbox_enqueue_failed'
    );
  }
}

export async function claimDueOutboxEvents(
  limit: number,
  now: Date | string = new Date()
): Promise<WorkflowEventOutboxRow[]> {
  const result = await pool.query<WorkflowEventOutboxRow>(
    `SELECT * FROM remote_agent_workflow_event_outbox
     WHERE status IN ('pending', 'retrying')
       AND next_attempt_at IS NOT NULL
       AND next_attempt_at <= $1
     ORDER BY next_attempt_at ASC, created_at ASC
     LIMIT $2`,
    [toDbTimestamp(now), limit]
  );
  return result.rows.map(parseOutboxRow);
}

export async function insertPendingAttempt(
  outboxEventId: string,
  attemptNumber: number,
  request: PendingAttemptRequest
): Promise<WorkflowEventDeliveryAttemptRow> {
  const dialect = getDialect();
  const startedAt = toDbTimestamp(request.startedAt ?? new Date());
  const result = await pool.query<WorkflowEventDeliveryAttemptRow>(
    `INSERT INTO remote_agent_workflow_event_delivery_attempts
       (id, outbox_event_id, attempt_number, request_url, request_method, request_headers,
        request_body, started_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING *`,
    [
      dialect.generateUuid(),
      outboxEventId,
      attemptNumber,
      request.url,
      request.method ?? 'POST',
      JSON.stringify(request.headers),
      request.body,
      startedAt,
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('WORKFLOW_EVENT_ATTEMPT_INSERT_EMPTY');
  return parseAttemptRow(row);
}

export async function completeAttempt(
  input: CompleteAttemptInput
): Promise<WorkflowEventDeliveryAttemptRow> {
  const completedAt = toDbTimestamp(input.completedAt ?? new Date());
  await pool.query(
    `UPDATE remote_agent_workflow_event_delivery_attempts
     SET response_status = $1,
         response_headers = $2,
         response_body = $3,
         transport_error = $4,
         completed_at = $5,
         duration_ms = $6,
         outcome = $7
     WHERE id = $8`,
    [
      input.responseStatus ?? null,
      input.responseHeaders ? JSON.stringify(input.responseHeaders) : null,
      input.responseBody ?? null,
      input.transportError ?? null,
      completedAt,
      input.durationMs ?? null,
      input.outcome,
      input.attemptId,
    ]
  );
  const result = await pool.query<WorkflowEventDeliveryAttemptRow>(
    'SELECT * FROM remote_agent_workflow_event_delivery_attempts WHERE id = $1',
    [input.attemptId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('WORKFLOW_EVENT_ATTEMPT_NOT_FOUND');
  return parseAttemptRow(row);
}

export async function updateOutboxAfterAttempt(
  outboxEventId: string,
  update: OutboxAttemptUpdate
): Promise<WorkflowEventOutboxRow> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_workflow_event_outbox
     SET status = $1,
         attempt_count = $2,
         last_attempt_at = $3,
         next_attempt_at = $4,
         last_error = $5,
         updated_at = ${dialect.now()}
     WHERE id = $6`,
    [
      update.status,
      update.attempt_count,
      toDbTimestamp(update.last_attempt_at),
      toDbTimestamp(update.next_attempt_at),
      update.last_error ?? null,
      outboxEventId,
    ]
  );
  const result = await pool.query<WorkflowEventOutboxRow>(
    'SELECT * FROM remote_agent_workflow_event_outbox WHERE id = $1',
    [outboxEventId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('WORKFLOW_EVENT_OUTBOX_NOT_FOUND');
  return parseOutboxRow(row);
}

export async function getOutboxEvent(id: string): Promise<WorkflowEventOutboxRow | null> {
  const result = await pool.query<WorkflowEventOutboxRow>(
    'SELECT * FROM remote_agent_workflow_event_outbox WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  return row ? parseOutboxRow(row) : null;
}

export async function listOutboxEventsByRun(
  workflowRunId: string
): Promise<WorkflowEventOutboxRow[]> {
  const result = await pool.query<WorkflowEventOutboxRow>(
    `SELECT * FROM remote_agent_workflow_event_outbox
     WHERE workflow_run_id = $1
     ORDER BY created_at ASC`,
    [workflowRunId]
  );
  return result.rows.map(parseOutboxRow);
}

export async function listDeliveryAttempts(
  outboxEventId: string
): Promise<WorkflowEventDeliveryAttemptRow[]> {
  const result = await pool.query<WorkflowEventDeliveryAttemptRow>(
    `SELECT * FROM remote_agent_workflow_event_delivery_attempts
     WHERE outbox_event_id = $1
     ORDER BY attempt_number ASC, started_at ASC`,
    [outboxEventId]
  );
  return result.rows.map(parseAttemptRow);
}
