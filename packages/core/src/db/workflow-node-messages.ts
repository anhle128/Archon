/**
 * Database operations for immutable per-node workflow transcripts.
 *
 * Sequence is assigned as MAX(seq)+1 inside a transaction. An adopted unique
 * race retries exactly once in a fresh transaction. Corrupt stored payloads
 * fail closed and never log payload bodies.
 */
import { createLogger } from '@archon/paths';
import {
  appendNodeMessageSchema,
  type AppendNodeMessageInput,
  type NodeMessage,
} from '@archon/workflows/schemas/node-message';
import { workflowNodeMessageRowSchema } from '../schemas/workflow-node-message';
import { getDatabase, getDatabaseType, getDialect, pool } from './connection';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-node-messages');
  return cachedLog;
}

const COLUMNS = 'id, workflow_run_id, node_id, seq, kind, payload, metadata, created_at';

/** Stored payload/row failed JSON or schema normalization. Logs id only. */
export class WorkflowNodeMessageCorruptRowError extends Error {
  constructor(readonly messageId: string) {
    super(`Workflow node message row corrupt: ${messageId}`);
    this.name = 'WorkflowNodeMessageCorruptRowError';
  }
}

/**
 * Map dialect unique violations to sequence conflicts ONLY when the adopted
 * (workflow_run_id, node_id, seq) constraint is implicated.
 *
 * PostgreSQL: SQLSTATE 23505 AND constraint === uq_workflow_node_messages_run_node_seq
 * only — never message prose (even if it names the constraint).
 * SQLite: UNIQUE message must list all three fully-qualified transcript columns
 * on remote_agent_workflow_node_messages (not bare names or another table).
 */
export function isNodeMessageSequenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const dbError = error as Error & { code?: string; constraint?: string };
  if (dbError.code === '23505' && dbError.constraint === 'uq_workflow_node_messages_run_node_seq') {
    return true;
  }
  if (!/UNIQUE constraint failed/i.test(dbError.message)) return false;
  const columns = dbError.message
    .replace(/^[\s\S]*UNIQUE constraint failed:\s*/i, '')
    .split(',')
    .map(column => column.trim().toLowerCase());
  return [
    'remote_agent_workflow_node_messages.workflow_run_id',
    'remote_agent_workflow_node_messages.node_id',
    'remote_agent_workflow_node_messages.seq',
  ].every(column => columns.includes(column));
}

function throwCorrupt(
  messageId: string,
  reason: 'payload_json_parse' | 'metadata_json_parse' | 'row_schema'
): never {
  getLog().error({ messageId, reason }, 'db.workflow_node_message_corrupt_row');
  throw new WorkflowNodeMessageCorruptRowError(messageId);
}

function parseNodeMessageRow(raw: unknown): NodeMessage {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const messageId = typeof row.id === 'string' ? row.id : 'unknown';
  let payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      throwCorrupt(messageId, 'payload_json_parse');
    }
  }
  let metadata = row.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata) as unknown;
    } catch {
      throwCorrupt(messageId, 'metadata_json_parse');
    }
  }
  const parsed = workflowNodeMessageRowSchema.safeParse({ ...row, payload, metadata });
  if (!parsed.success) throwCorrupt(messageId, 'row_schema');
  return parsed.data;
}

async function appendOnce(input: AppendNodeMessageInput): Promise<NodeMessage> {
  const db = getDatabase();
  const dialect = getDialect();
  return db.withTransaction(async query => {
    const next = await query<{ next_seq: number | string }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM remote_agent_workflow_node_messages WHERE workflow_run_id = $1 AND node_id = $2',
      [input.workflow_run_id, input.node_id]
    );
    const seq = Number(next.rows[0]?.next_seq ?? 1);
    const id = dialect.generateUuid();
    await query(
      'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        id,
        input.workflow_run_id,
        input.node_id,
        seq,
        input.kind,
        JSON.stringify(input.payload),
        input.metadata === undefined || input.metadata === null
          ? null
          : JSON.stringify(input.metadata),
      ]
    );
    const inserted = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM remote_agent_workflow_node_messages WHERE id = $1`,
      [id]
    );
    return parseNodeMessageRow(inserted.rows[0]);
  });
}

export async function appendNodeMessage(input: AppendNodeMessageInput): Promise<NodeMessage> {
  const parsed = appendNodeMessageSchema.parse(input);
  try {
    return await appendOnce(parsed);
  } catch (error) {
    if (!isNodeMessageSequenceConflict(error)) throw error;
    return appendOnce(parsed);
  }
}

export interface ListNodeMessagesQuery {
  afterSeq?: number;
  throughSeq?: number;
  limit?: number;
  occurrenceId?: string;
  attemptId?: string;
}

function nodeMessageFilterSql(query: ListNodeMessagesQuery | undefined): {
  extra: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const postgres = getDatabaseType() === 'postgresql';
  const occurrenceSql = postgres
    ? "(metadata->'execution'->>'occurrence_id') = $"
    : "json_extract(metadata, '$.execution.occurrence_id') = $";
  const attemptSql = postgres
    ? "(metadata->'execution'->>'attempt_id') = $"
    : "json_extract(metadata, '$.execution.attempt_id') = $";
  if (query?.afterSeq !== undefined) {
    params.push(query.afterSeq);
    clauses.push(`seq > $${String(params.length + 2)}`);
  }
  if (query?.throughSeq !== undefined) {
    params.push(query.throughSeq);
    clauses.push(`seq <= $${String(params.length + 2)}`);
  }
  if (query?.occurrenceId !== undefined) {
    params.push(query.occurrenceId);
    clauses.push(`${occurrenceSql}${String(params.length + 2)}`);
  }
  if (query?.attemptId !== undefined) {
    params.push(query.attemptId);
    clauses.push(`${attemptSql}${String(params.length + 2)}`);
  }
  return { extra: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export async function listNodeMessages(
  workflowRunId: string,
  nodeId: string,
  query?: ListNodeMessagesQuery
): Promise<NodeMessage[]> {
  const filter = nodeMessageFilterSql(query);
  const limit =
    query?.limit !== undefined
      ? Math.min(Math.max(query.limit, 1), 501) // public max 500 + 1 for hasMore
      : query === undefined
        ? undefined
        : 100;
  const limitSql = limit !== undefined ? ` LIMIT $${String(3 + filter.params.length)}` : '';
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLUMNS}
     FROM remote_agent_workflow_node_messages
     WHERE workflow_run_id = $1 AND node_id = $2${filter.extra}
     ORDER BY seq ASC${limitSql}`,
    limit !== undefined
      ? [workflowRunId, nodeId, ...filter.params, limit]
      : [workflowRunId, nodeId, ...filter.params]
  );
  return result.rows.map(parseNodeMessageRow);
}

export async function getNodeMessageHighWatermark(
  workflowRunId: string,
  nodeId: string,
  query?: Pick<ListNodeMessagesQuery, 'occurrenceId' | 'attemptId'>
): Promise<number> {
  const filter = nodeMessageFilterSql(query);
  const result = await pool.query<{ max_seq: number | string | null }>(
    `SELECT COALESCE(MAX(seq), 0) AS max_seq
     FROM remote_agent_workflow_node_messages
     WHERE workflow_run_id = $1 AND node_id = $2${filter.extra}`,
    [workflowRunId, nodeId, ...filter.params]
  );
  return Number(result.rows[0]?.max_seq ?? 0);
}

export async function getNodeMessage(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<NodeMessage | null> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLUMNS}
     FROM remote_agent_workflow_node_messages
     WHERE workflow_run_id = $1 AND node_id = $2 AND id = $3`,
    [workflowRunId, nodeId, messageId]
  );
  const row = result.rows[0];
  return row === undefined ? null : parseNodeMessageRow(row);
}
