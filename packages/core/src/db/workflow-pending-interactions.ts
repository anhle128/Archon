/**
 * Database operations for pending AskHuman / permission interactions.
 *
 * Inserts the pending row and the `node_awaiting` audit event in one
 * transaction. Corrupt stored JSON fails closed and never logs envelope
 * or answer bodies.
 */
import { createLogger } from '@archon/paths';
import { AskHumanNoStarterError } from '@archon/providers/types';
import {
  insertPendingInteractionSchema,
  pendingInteractionSchema,
  type InsertPendingInteractionInput,
  type PendingInteraction,
} from '@archon/workflows/schemas/pending-interaction';
import { getDatabase, getDatabaseType, getDialect, pool } from './connection';
import { insertWorkflowEvent } from './workflow-events';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-pending-interactions');
  return cachedLog;
}

const COLUMNS =
  'id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, answer, provider_session_id, created_at, resolved_at, resolved_by';

/** Stored envelope/answer/row failed JSON or schema normalization. Logs id only. */
export class PendingInteractionCorruptRowError extends Error {
  constructor(readonly rowId: string) {
    super(`Pending interaction row corrupt: ${rowId}`);
    this.name = 'PendingInteractionCorruptRowError';
  }
}

function throwCorrupt(
  rowId: string,
  reason: 'envelope_json_parse' | 'answer_json_parse' | 'row_schema'
): never {
  getLog().error({ rowId, reason }, 'db.pending_interaction_corrupt_row');
  throw new PendingInteractionCorruptRowError(rowId);
}

function parseJsonColumn(
  value: unknown,
  rowId: string,
  reason: 'envelope_json_parse' | 'answer_json_parse'
): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throwCorrupt(rowId, reason);
  }
}

function parsePendingInteractionRow(raw: unknown): PendingInteraction {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowId = typeof row.id === 'string' ? row.id : 'unknown';
  const envelope = parseJsonColumn(row.envelope, rowId, 'envelope_json_parse');
  const answer = parseJsonColumn(row.answer, rowId, 'answer_json_parse');
  const parsed = pendingInteractionSchema.safeParse({ ...row, envelope, answer });
  if (!parsed.success) throwCorrupt(rowId, 'row_schema');
  return parsed.data;
}

export async function insertPendingInteraction(
  input: InsertPendingInteractionInput
): Promise<PendingInteraction> {
  const parsed = insertPendingInteractionSchema.parse(input);
  const db = getDatabase();
  const dialect = getDialect();
  const lockSuffix = getDatabaseType() === 'postgresql' ? ' FOR UPDATE' : '';

  return db.withTransaction(async query => {
    const runResult = await query<{ user_id: string | null; status: string }>(
      `SELECT user_id, status FROM remote_agent_workflow_runs WHERE id = $1${lockSuffix}`,
      [parsed.workflow_run_id]
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new Error(`Workflow run not found: ${parsed.workflow_run_id}`);
    }
    if (run.user_id == null) {
      throw new AskHumanNoStarterError(parsed.workflow_run_id);
    }

    const id = dialect.generateUuid();
    await query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, answer, provider_session_id, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NULL, $7, NULL, NULL)`,
      [
        id,
        parsed.workflow_run_id,
        parsed.node_id,
        parsed.tool_use_id,
        parsed.kind,
        JSON.stringify(parsed.envelope),
        parsed.provider_session_id,
      ]
    );

    await insertWorkflowEvent(query, {
      workflow_run_id: parsed.workflow_run_id,
      event_type: 'node_awaiting',
      step_name: parsed.node_id,
      data: {
        node_id: parsed.node_id,
        tool_use_id: parsed.tool_use_id,
        kind: parsed.kind,
      },
    });

    const inserted = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM remote_agent_pending_interactions WHERE id = $1`,
      [id]
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error(`Pending interaction vanished after insert: ${id}`);
    }
    return parsePendingInteractionRow(row);
  });
}

export async function listPendingInteractions(
  workflowRunId: string
): Promise<PendingInteraction[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLUMNS}
     FROM remote_agent_pending_interactions
     WHERE workflow_run_id = $1
     ORDER BY created_at ASC, id ASC`,
    [workflowRunId]
  );
  return result.rows.map(parsePendingInteractionRow);
}
