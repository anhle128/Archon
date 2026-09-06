/**
 * Database operations for pending AskHuman / permission interactions.
 *
 * Inserts the pending row and the `node_awaiting` audit event in one
 * transaction. Resolves an Ask answer or Permission confirmation in one
 * transaction that may also resume the run. Terminal cancel/fail callers purge
 * remaining pending rows on the same query they used for the status CAS.
 * Corrupt stored JSON fails closed and never logs envelope or answer bodies.
 */
import { createLogger } from '@archon/paths';
import { AskHumanNoStarterError } from '@archon/providers/types';
import {
  askHumanQuestionSchema,
  confirmPendingPermissionInputSchema,
  insertPendingInteractionSchema,
  pendingInteractionSchema,
  resolvePendingInteractionInputSchema,
  type AskAnswerBody,
  type AskHumanQuestion,
  type ConfirmPendingPermissionInput,
  type InsertPendingInteractionInput,
  type PendingInteraction,
  type ResolvePendingInteractionInput,
  type ResolvePendingInteractionResult,
} from '@archon/workflows/schemas/pending-interaction';
import { getDatabase, getDatabaseType, getDialect, pool } from './connection';
import { insertWorkflowEvent } from './workflow-events';
import {
  resumeWorkflowRunInTransaction,
  workflowRunLockClause,
  type WorkflowTransactionQuery,
} from './workflow-resume-transition';

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

export class PendingInteractionNotFoundError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly toolUseId: string
  ) {
    super(`Pending interaction not found: ${workflowRunId}/${toolUseId}`);
    this.name = 'PendingInteractionNotFoundError';
  }
}

export class PendingInteractionAlreadyResolvedError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly toolUseId: string,
    readonly status: string
  ) {
    super(`Pending interaction already resolved: ${workflowRunId}/${toolUseId}`);
    this.name = 'PendingInteractionAlreadyResolvedError';
  }
}

export class PendingInteractionRunNotPausedError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly status: string
  ) {
    super(`Workflow run is not paused: ${workflowRunId}`);
    this.name = 'PendingInteractionRunNotPausedError';
  }
}

export type PendingInteractionValidationCode =
  | 'invalid_body'
  | 'kind_not_ask'
  | 'kind_not_permission'
  | 'missing_question'
  | 'unknown_question'
  | 'duplicate_question'
  | 'duplicate_envelope_id'
  | 'invalid_single_value'
  | 'invalid_multi_value'
  | 'invalid_option'
  | 'blank_other';

export class PendingInteractionValidationError extends Error {
  constructor(readonly code: PendingInteractionValidationCode) {
    super(`Pending interaction validation failed: ${code}`);
    this.name = 'PendingInteractionValidationError';
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
    if (run.status !== 'running' && run.status !== 'paused') {
      throw new Error(
        `Cannot create pending interaction for workflow run ${parsed.workflow_run_id} with status '${run.status}'`
      );
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

function isDecline(answer: AskAnswerBody): answer is { decline: true } {
  return 'decline' in answer;
}

function throwValidation(code: PendingInteractionValidationCode): never {
  throw new PendingInteractionValidationError(code);
}

function parseEnvelopeQuestions(
  envelope: Record<string, unknown>,
  rowId: string
): AskHumanQuestion[] {
  const questionsRaw = envelope.questions;
  if (!Array.isArray(questionsRaw)) {
    throwCorrupt(rowId, 'row_schema');
  }
  const questions: AskHumanQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of questionsRaw) {
    const parsed = askHumanQuestionSchema.safeParse(raw);
    if (!parsed.success) throwCorrupt(rowId, 'row_schema');
    if (seen.has(parsed.data.id)) throwValidation('duplicate_envelope_id');
    seen.add(parsed.data.id);
    questions.push(parsed.data);
  }
  return questions;
}

function validateOption(question: AskHumanQuestion, value: string): void {
  if (question.options.includes(value)) return;
  if (!question.allowOther) throwValidation('invalid_option');
  if (value.trim() === '') throwValidation('blank_other');
}

function validateAskAnswers(
  envelope: Record<string, unknown>,
  answer: AskAnswerBody,
  rowId: string
): void {
  if (isDecline(answer)) return;
  const questions = parseEnvelopeQuestions(envelope, rowId);
  const answers = answer.answers;
  const answerIds = answers.map(item => item.questionId);
  if (new Set(answerIds).size !== answerIds.length) throwValidation('duplicate_question');
  const questionIds = new Set(questions.map(question => question.id));
  for (const question of questions) {
    if (!answerIds.includes(question.id)) throwValidation('missing_question');
  }
  for (const item of answers) {
    if (!questionIds.has(item.questionId)) throwValidation('unknown_question');
  }
  const byId = new Map(questions.map(question => [question.id, question]));
  for (const item of answers) {
    const question = byId.get(item.questionId);
    if (!question) throwValidation('unknown_question');
    if (question.selection === 'single') {
      if (typeof item.value !== 'string') throwValidation('invalid_single_value');
      validateOption(question, item.value);
      continue;
    }
    if (
      !Array.isArray(item.value) ||
      item.value.length === 0 ||
      item.value.some(value => typeof value !== 'string')
    ) {
      throwValidation('invalid_multi_value');
    }
    for (const value of item.value) validateOption(question, value);
  }
}

export async function resolvePendingInteraction(
  input: ResolvePendingInteractionInput
): Promise<ResolvePendingInteractionResult> {
  const parsedInput = resolvePendingInteractionInputSchema.safeParse(input);
  if (!parsedInput.success) throwValidation('invalid_body');

  const workflowRunId = parsedInput.data.workflow_run_id;
  const toolUseId = parsedInput.data.tool_use_id;
  const answer = parsedInput.data.answer;
  const resolvedBy = parsedInput.data.resolved_by;
  const db = getDatabase();
  const dialect = getDialect();
  const lockSuffix = workflowRunLockClause();

  return db.withTransaction(async query => {
    const runResult = await query<{ status: string }>(
      `SELECT status FROM remote_agent_workflow_runs WHERE id = $1${lockSuffix}`,
      [workflowRunId]
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }

    const interactionResult = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS}
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND tool_use_id = $2${lockSuffix}`,
      [workflowRunId, toolUseId]
    );
    const rawInteraction = interactionResult.rows[0];
    if (!rawInteraction) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }
    const current = parsePendingInteractionRow(rawInteraction);
    if (current.status !== 'pending') {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }
    if (run.status !== 'paused') {
      throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
    }
    if (current.kind !== 'ask') throwValidation('kind_not_ask');

    validateAskAnswers(current.envelope, answer, current.id);

    const cas = await query(
      `UPDATE remote_agent_pending_interactions
       SET status = 'answered',
           answer = $2,
           resolved_at = ${dialect.now()},
           resolved_by = $3
       WHERE id = $1 AND status = 'pending'`,
      [current.id, JSON.stringify(answer), resolvedBy]
    );
    if (cas.rowCount === 0) {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }

    const remainingResult = await query<{ remaining: number | string }>(
      `SELECT COUNT(*) AS remaining
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND status = 'pending'`,
      [workflowRunId]
    );
    const remainingPending = Number(remainingResult.rows[0]?.remaining ?? 0);
    let resumed = false;
    if (remainingPending === 0) {
      const resumeResult = await resumeWorkflowRunInTransaction(
        query,
        workflowRunId,
        dialect,
        'paused-ask'
      );
      if (!resumeResult.resumed) {
        throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
      }
      resumed = true;
    }

    await insertWorkflowEvent(query, {
      workflow_run_id: workflowRunId,
      event_type: 'interaction_resolved',
      step_name: current.node_id,
      data: {
        node_id: current.node_id,
        tool_use_id: toolUseId,
        kind: 'ask',
        declined: isDecline(answer),
        resumed,
      },
    });

    const resolvedRows = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM remote_agent_pending_interactions WHERE id = $1`,
      [current.id]
    );
    const resolvedRow = resolvedRows.rows[0];
    if (!resolvedRow) {
      throw new Error(`Pending interaction vanished after resolve: ${current.id}`);
    }
    return {
      interaction: parsePendingInteractionRow(resolvedRow),
      resumed,
      remaining_pending: remainingPending,
    };
  });
}

export async function confirmPendingPermission(
  input: ConfirmPendingPermissionInput
): Promise<ResolvePendingInteractionResult> {
  const parsedInput = confirmPendingPermissionInputSchema.safeParse(input);
  if (!parsedInput.success) throwValidation('invalid_body');

  const workflowRunId = parsedInput.data.workflow_run_id;
  const toolUseId = parsedInput.data.tool_use_id;
  const answer = parsedInput.data.answer;
  const resolvedBy = parsedInput.data.resolved_by;
  const db = getDatabase();
  const dialect = getDialect();
  const lockSuffix = workflowRunLockClause();

  return db.withTransaction(async query => {
    const runResult = await query<{ status: string }>(
      `SELECT status FROM remote_agent_workflow_runs WHERE id = $1${lockSuffix}`,
      [workflowRunId]
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }

    const interactionResult = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS}
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND tool_use_id = $2${lockSuffix}`,
      [workflowRunId, toolUseId]
    );
    const rawInteraction = interactionResult.rows[0];
    if (!rawInteraction) {
      throw new PendingInteractionNotFoundError(workflowRunId, toolUseId);
    }
    const current = parsePendingInteractionRow(rawInteraction);
    if (current.status !== 'pending') {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }
    if (run.status !== 'paused') {
      throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
    }
    if (current.kind !== 'permission') throwValidation('kind_not_permission');

    const cas = await query(
      `UPDATE remote_agent_pending_interactions
       SET status = 'answered',
           answer = $2,
           resolved_at = ${dialect.now()},
           resolved_by = $3
       WHERE id = $1 AND status = 'pending'`,
      [current.id, JSON.stringify(answer), resolvedBy]
    );
    if (cas.rowCount === 0) {
      throw new PendingInteractionAlreadyResolvedError(workflowRunId, toolUseId, current.status);
    }

    const remainingResult = await query<{ remaining: number | string }>(
      `SELECT COUNT(*) AS remaining
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1 AND status = 'pending'`,
      [workflowRunId]
    );
    const remainingPending = Number(remainingResult.rows[0]?.remaining ?? 0);
    let resumed = false;
    if (remainingPending === 0) {
      const resumeResult = await resumeWorkflowRunInTransaction(
        query,
        workflowRunId,
        dialect,
        'paused-ask'
      );
      if (!resumeResult.resumed) {
        throw new PendingInteractionRunNotPausedError(workflowRunId, run.status);
      }
      resumed = true;
    }

    await insertWorkflowEvent(query, {
      workflow_run_id: workflowRunId,
      event_type: 'interaction_resolved',
      step_name: current.node_id,
      data: {
        node_id: current.node_id,
        tool_use_id: toolUseId,
        kind: 'permission',
        resumed,
      },
    });

    const resolvedRows = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM remote_agent_pending_interactions WHERE id = $1`,
      [current.id]
    );
    const resolvedRow = resolvedRows.rows[0];
    if (!resolvedRow) {
      throw new Error(`Pending interaction vanished after resolve: ${current.id}`);
    }
    return {
      interaction: parsePendingInteractionRow(resolvedRow),
      resumed,
      remaining_pending: remainingPending,
    };
  });
}

/**
 * Purge remaining pending interactions for a run that just won a cancel or
 * fail CAS. Callers own the transaction; this must not open a nested one.
 * Already-answered rows are left untouched. Envelope and answer bodies are
 * never copied into the audit event.
 */
export async function purgePendingInteractionsInTransaction(
  query: WorkflowTransactionQuery,
  workflowRunId: string,
  terminalStatus: 'failed' | 'cancelled'
): Promise<{ purged: number }> {
  const dialect = getDialect();
  const pending = await query<{
    id: string;
    node_id: string;
    tool_use_id: string;
    kind: 'ask' | 'permission';
  }>(
    `SELECT id, node_id, tool_use_id, kind
     FROM remote_agent_pending_interactions
     WHERE workflow_run_id = $1 AND status = 'pending'
     ORDER BY created_at ASC, id ASC${workflowRunLockClause()}`,
    [workflowRunId]
  );

  let purged = 0;
  for (const row of pending.rows) {
    const cas = await query(
      `UPDATE remote_agent_pending_interactions
       SET status = 'purged',
           resolved_at = ${dialect.now()}
       WHERE id = $1 AND status = 'pending'`,
      [row.id]
    );
    if ((cas.rowCount ?? 0) === 0) continue;

    await insertWorkflowEvent(query, {
      workflow_run_id: workflowRunId,
      event_type: 'interaction_resolved',
      step_name: row.node_id,
      data: {
        node_id: row.node_id,
        tool_use_id: row.tool_use_id,
        kind: row.kind,
        purged: true,
        resumed: false,
        terminal_status: terminalStatus,
      },
    });
    purged += 1;
  }
  return { purged };
}
