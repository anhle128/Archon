/**
 * Database operations for install-wide Workflow ENV overlays.
 *
 * Identity is `(workflow_name, name)`. Update/delete always require both the
 * path workflow name and env id so a mismatched route cannot mutate another
 * workflow's ENV. Patches are whole-document replaced on update.
 */
import { createLogger } from '@archon/paths';
import { envPatchesSchema } from '@archon/workflows/schemas/env-overlay';
import type { EnvPatches } from '@archon/workflows/schemas/env-overlay';
import {
  workflowEnvNameSchema,
  workflowEnvRowSchema,
  workflowEnvSummarySchema,
  workflowEnvWorkflowNameSchema,
  type WorkflowEnvRow,
  type WorkflowEnvSummary,
} from '../schemas/workflow-env';
import { getDatabase, getDialect, pool } from './connection';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-envs');
  return cachedLog;
}

export type { WorkflowEnvRow, WorkflowEnvSummary, EnvPatches };

const FULL_COLUMNS = 'id, workflow_name, name, patches, created_at, updated_at, created_by_user_id';
const SUMMARY_COLUMNS = 'id, workflow_name, name, created_at, updated_at, created_by_user_id';

/** Unique (workflow_name, name) conflict on create/rename. */
export class WorkflowEnvNameConflictError extends Error {
  readonly workflowName: string;
  readonly envName: string;

  constructor(workflowName: string, envName: string) {
    super(`Workflow ENV '${envName}' already exists for workflow '${workflowName}'`);
    this.name = 'WorkflowEnvNameConflictError';
    this.workflowName = workflowName;
    this.envName = envName;
  }
}

/** Stored patches document failed schema/JSON normalization. Logs id only. */
export class WorkflowEnvCorruptRowError extends Error {
  readonly envId: string;

  constructor(envId: string) {
    super(`Workflow ENV row corrupt: ${envId}`);
    this.name = 'WorkflowEnvCorruptRowError';
    this.envId = envId;
  }
}

/**
 * Map dialect unique violations to name conflicts ONLY when the identity
 * constraint is implicated. Unrelated unique errors propagate.
 */
export function isWorkflowEnvNameConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'uq_workflow_envs_workflow_name_name') {
    return true;
  }
  // Postgres without .constraint sometimes embeds the name in the message.
  if (
    (e.code === '23505' || /duplicate key value violates unique constraint/i.test(e.message)) &&
    /uq_workflow_envs_workflow_name_name/i.test(e.message)
  ) {
    return true;
  }
  // SQLite: "UNIQUE constraint failed: remote_agent_workflow_envs.workflow_name, remote_agent_workflow_envs.name"
  if (/UNIQUE constraint failed/i.test(e.message)) {
    const mentionsWorkflowName = /workflow_name/i.test(e.message);
    // After stripping workflow_name, require a bare `.name` / `, name` column mention.
    const withoutWorkflowName = e.message.replace(/workflow_name/gi, '');
    const mentionsNameColumn = /(?:\.|,|\s)name(?:\s|$|,)/i.test(withoutWorkflowName);
    return mentionsWorkflowName && mentionsNameColumn;
  }
  return false;
}

function throwNameConflict(workflowName: string, envName: string, cause: unknown): never {
  const error = new WorkflowEnvNameConflictError(workflowName, envName);
  if (cause instanceof Error) {
    error.cause = cause;
  }
  throw error;
}

function throwCorrupt(envId: string, reason: string): never {
  getLog().error({ envId, reason }, 'db.workflow_env_corrupt_row');
  throw new WorkflowEnvCorruptRowError(envId);
}

/**
 * Normalize PG JSONB objects and SQLite JSON strings through envPatchesSchema.
 * Never logs patch bodies.
 */
function normalizePatches(raw: unknown, envId: string): EnvPatches {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throwCorrupt(envId, 'patches_json_parse');
    }
  }
  const parsed = envPatchesSchema.safeParse(value);
  if (!parsed.success) {
    throwCorrupt(envId, 'patches_schema');
  }
  return parsed.data;
}

function parseFullRow(row: unknown): WorkflowEnvRow {
  if (!row || typeof row !== 'object') {
    throwCorrupt('unknown', 'row_shape');
  }
  const record: Record<string, unknown> = { ...row };
  const id = typeof record.id === 'string' ? record.id : 'unknown';
  record.patches = normalizePatches(record.patches, id);
  const parsed = workflowEnvRowSchema.safeParse(record);
  if (!parsed.success) {
    throwCorrupt(id, 'row_schema');
  }
  return parsed.data;
}

function parseSummaryRow(row: unknown): WorkflowEnvSummary {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid workflow ENV summary row shape');
  }
  const parsed = workflowEnvSummarySchema.safeParse(row);
  if (!parsed.success) {
    const idValue = 'id' in row && typeof row.id === 'string' ? row.id : 'unknown';
    throwCorrupt(idValue, 'summary_schema');
  }
  return parsed.data;
}

/** List ENV summaries for a workflow without loading patch bodies. */
export async function listWorkflowEnvSummaries(
  workflowName: string
): Promise<WorkflowEnvSummary[]> {
  const name = workflowEnvWorkflowNameSchema.parse(workflowName);
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM remote_agent_workflow_envs
     WHERE workflow_name = $1
     ORDER BY LOWER(name), name, id`,
    [name]
  );
  return result.rows.map(parseSummaryRow);
}

/**
 * Load a full ENV by id (unscoped). Callers must identity-check workflow_name
 * when the route is workflow-scoped (Start uses the unscoped miss vs mismatch).
 */
export async function getWorkflowEnvById(envId: string): Promise<WorkflowEnvRow | null> {
  if (!envId) return null;
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${FULL_COLUMNS} FROM remote_agent_workflow_envs WHERE id = $1`,
    [envId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return parseFullRow(row);
}

export async function createWorkflowEnv(input: {
  workflow_name: string;
  name: string;
  patches: EnvPatches | Record<string, unknown>;
  created_by_user_id: string | null;
}): Promise<WorkflowEnvRow> {
  const workflowName = workflowEnvWorkflowNameSchema.parse(input.workflow_name);
  const envName = workflowEnvNameSchema.parse(input.name);
  const patches = envPatchesSchema.parse(input.patches ?? {});
  const dialect = getDialect();
  const db = getDatabase();
  const id = dialect.generateUuid();

  try {
    return await db.withTransaction(async query => {
      await query(
        `INSERT INTO remote_agent_workflow_envs
           (id, workflow_name, name, patches, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, workflowName, envName, JSON.stringify(patches), input.created_by_user_id ?? null]
      );

      const selectResult = await query<Record<string, unknown>>(
        `SELECT ${FULL_COLUMNS} FROM remote_agent_workflow_envs WHERE id = $1`,
        [id]
      );
      const row = selectResult.rows[0];
      if (!row) {
        throw new Error('WORKFLOW_ENV_VANISHED_AFTER_CREATE');
      }
      getLog().debug(
        { envId: id, workflowName, name: envName },
        'db.workflow_env_create_completed'
      );
      return parseFullRow(row);
    });
  } catch (err) {
    if (isWorkflowEnvNameConflict(err)) {
      throwNameConflict(workflowName, envName, err);
    }
    throw err;
  }
}

/**
 * Workflow-scoped update. `patches`, when present, replaces the whole document
 * (including `{}`). The patch object must contain at least one field.
 * Returns null when id+workflow_name do not match an existing row.
 */
export async function updateWorkflowEnv(
  workflowName: string,
  envId: string,
  patch: { name?: string; patches?: EnvPatches | Record<string, unknown> }
): Promise<WorkflowEnvRow | null> {
  const scopedWorkflowName = workflowEnvWorkflowNameSchema.parse(workflowName);
  if (!envId) return null;

  const hasName = patch.name !== undefined;
  const hasPatches = patch.patches !== undefined;
  if (!hasName && !hasPatches) {
    throw new Error('Workflow ENV update requires at least one of name or patches');
  }

  const nextName = hasName ? workflowEnvNameSchema.parse(patch.name) : undefined;
  const nextPatches = hasPatches ? envPatchesSchema.parse(patch.patches) : undefined;

  const dialect = getDialect();
  const db = getDatabase();

  try {
    return await db.withTransaction(async query => {
      // Portable CASE flags (no PG-only ::int casts) — mirrors provider-bindings.
      const updateResult = await query(
        `UPDATE remote_agent_workflow_envs
         SET name = CASE WHEN $1 = 1 THEN $2 ELSE name END,
             patches = CASE WHEN $3 = 1 THEN $4 ELSE patches END,
             updated_at = ${dialect.now()}
         WHERE id = $5 AND workflow_name = $6`,
        [
          hasName ? 1 : 0,
          nextName ?? null,
          hasPatches ? 1 : 0,
          hasPatches && nextPatches !== undefined ? JSON.stringify(nextPatches) : null,
          envId,
          scopedWorkflowName,
        ]
      );

      if (updateResult.rowCount === 0) {
        return null;
      }

      const selectResult = await query<Record<string, unknown>>(
        `SELECT ${FULL_COLUMNS} FROM remote_agent_workflow_envs WHERE id = $1`,
        [envId]
      );
      const row = selectResult.rows[0];
      if (!row) {
        throw new Error('WORKFLOW_ENV_VANISHED_AFTER_UPDATE');
      }
      getLog().debug(
        { envId, workflowName: scopedWorkflowName },
        'db.workflow_env_update_completed'
      );
      return parseFullRow(row);
    });
  } catch (err) {
    if (isWorkflowEnvNameConflict(err) && nextName !== undefined) {
      throwNameConflict(scopedWorkflowName, nextName, err);
    }
    throw err;
  }
}

/**
 * Workflow-scoped delete. Returns true when a row was deleted.
 * Mismatched workflow path is a no-op (false).
 */
export async function deleteWorkflowEnv(workflowName: string, envId: string): Promise<boolean> {
  const scopedWorkflowName = workflowEnvWorkflowNameSchema.parse(workflowName);
  if (!envId) return false;

  const result = await pool.query(
    `DELETE FROM remote_agent_workflow_envs
     WHERE id = $1 AND workflow_name = $2`,
    [envId, scopedWorkflowName]
  );
  const deleted = result.rowCount > 0;
  if (deleted) {
    getLog().debug({ envId, workflowName: scopedWorkflowName }, 'db.workflow_env_delete_completed');
  }
  return deleted;
}
