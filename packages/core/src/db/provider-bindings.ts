import { pool, getDialect, getDatabase } from './connection';
import {
  workflowProviderBindingSchema,
  type WorkflowProviderBinding,
} from '../schemas/workflow-provider-binding';
import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.provider-bindings');
  return cachedLog;
}

export type { WorkflowProviderBinding } from '../schemas/workflow-provider-binding';

const LEGACY_CONTRACT_BINDING_IDS = new Map<string, string>([
  [JSON.stringify(['archon', 'workflow-engine-primary']), 'wpb_archon::workflow_engine_primary'],
]);

const workflowProviderBindingWithSecretSchema = workflowProviderBindingSchema.extend({
  signing_secret: workflowProviderBindingSchema.shape.event_route.nullable().optional(),
});

export type WorkflowProviderBindingWithSecret = WorkflowProviderBinding & {
  signing_secret?: string | null;
};

function hexEncode(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function parseBindingRow(row: unknown): WorkflowProviderBinding {
  const parsed = workflowProviderBindingSchema.safeParse(row);
  if (parsed.success) {
    return parsed.data;
  }

  const stateIssue = parsed.error.issues.find(issue => issue.path.join('.') === 'state');
  if (stateIssue) {
    const state =
      row && typeof row === 'object' && 'state' in row
        ? String((row as { state: unknown }).state)
        : 'unknown';
    throw new Error(`BINDING_CORRUPT_STATE: ${state}`);
  }

  const fields = parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(',');
  throw new Error(`BINDING_CORRUPT_ROW: ${fields}`);
}

function parseBindingRowWithSecret(row: unknown): WorkflowProviderBindingWithSecret {
  const parsed = workflowProviderBindingWithSecretSchema.safeParse(row);
  if (parsed.success) {
    return parsed.data;
  }
  return parseBindingRow(row) as WorkflowProviderBindingWithSecret;
}

export function deriveBindingId(provider: string, name: string): string {
  const legacyId = LEGACY_CONTRACT_BINDING_IDS.get(JSON.stringify([provider, name]));
  if (legacyId) return legacyId;
  return `wpb_v2_${hexEncode(provider)}_${hexEncode(name)}`;
}

export async function createBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
  signingSecret?: string | null;
}): Promise<WorkflowProviderBinding> {
  const dialect = getDialect();
  const db = getDatabase();
  const id = dialect.generateUuid();

  return await db.withTransaction(async query => {
    const result = await query<WorkflowProviderBinding>(
      `INSERT INTO remote_agent_workflow_provider_bindings
         (id, provider, name, codebase_id, event_route, signing_secret, state, binding_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', 1)
       ON CONFLICT (provider, name) DO NOTHING`,
      [
        id,
        input.provider,
        input.name,
        input.codebaseId,
        input.eventRoute,
        input.signingSecret ?? null,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error('BINDING_ALREADY_EXISTS');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
      [input.provider, input.name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_CREATE');
    }
    getLog().debug({ provider: input.provider, name: input.name }, 'db.binding_create_completed');
    return parseBindingRow(row);
  });
}

export async function getBinding(
  provider: string,
  name: string
): Promise<WorkflowProviderBinding | null> {
  const result = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [provider, name]
  );
  const row = result.rows[0];
  if (!row) return null;
  return parseBindingRow(row);
}

export async function getBindingByCodebase(
  provider: string,
  codebaseId: string
): Promise<WorkflowProviderBindingWithSecret[]> {
  const result = await pool.query<WorkflowProviderBindingWithSecret>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND codebase_id = $2',
    [provider, codebaseId]
  );
  return result.rows.map(parseBindingRowWithSecret);
}

export async function getBindingByIdWithSecret(
  id: string
): Promise<WorkflowProviderBindingWithSecret | null> {
  const result = await pool.query<WorkflowProviderBindingWithSecret>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  return row ? parseBindingRowWithSecret(row) : null;
}

export async function updateBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
  signingSecret?: string | null;
}): Promise<WorkflowProviderBinding> {
  const dialect = getDialect();
  const db = getDatabase();

  return await db.withTransaction(async query => {
    const lockClause = db.dialect === 'postgres' ? ' FOR UPDATE' : '';
    const existingResult = await query<WorkflowProviderBinding>(
      `SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [input.provider, input.name]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseBindingRow(existingRow);
    if (existing.state === 'disabled') {
      throw new Error('BINDING_DISABLED');
    }

    const updateResult = await query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET codebase_id = $1,
           event_route = $2,
           signing_secret = COALESCE($3, signing_secret),
           updated_at = ${dialect.now()}
       WHERE provider = $4 AND name = $5 AND binding_version = $6 AND state = $7`,
      [
        input.codebaseId,
        input.eventRoute,
        input.signingSecret ?? null,
        input.provider,
        input.name,
        existing.binding_version,
        existing.state,
      ]
    );

    if (updateResult.rowCount === 0) {
      throw new Error('BINDING_CONCURRENT_MODIFICATION');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
      [input.provider, input.name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_UPDATE');
    }
    getLog().debug({ provider: input.provider, name: input.name }, 'db.binding_update_completed');
    return parseBindingRow(row);
  });
}

export async function rotateBinding(
  provider: string,
  name: string,
  signingSecret?: string | null
): Promise<WorkflowProviderBinding & { previousVersion: number; activeVersion: number }> {
  const dialect = getDialect();
  const db = getDatabase();

  return await db.withTransaction(async query => {
    const lockClause = db.dialect === 'postgres' ? ' FOR UPDATE' : '';
    const existingResult = await query<WorkflowProviderBinding>(
      `SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [provider, name]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseBindingRow(existingRow);
    if (existing.state === 'disabled') {
      throw new Error('BINDING_DISABLED');
    }

    const nextVersion = existing.binding_version + 1;
    const updateResult = await query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET binding_version = $3,
           signing_secret = COALESCE($4, signing_secret),
           state = 'rotated',
           updated_at = ${dialect.now()}
       WHERE provider = $1 AND name = $2 AND binding_version = $5 AND state = $6`,
      [provider, name, nextVersion, signingSecret ?? null, existing.binding_version, existing.state]
    );

    if (updateResult.rowCount === 0) {
      throw new Error('BINDING_CONCURRENT_MODIFICATION');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
      [provider, name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_ROTATE');
    }
    getLog().debug(
      { provider, name, previousVersion: existing.binding_version },
      'db.binding_rotate_completed'
    );
    const parsedRow = parseBindingRow(row);
    return {
      ...parsedRow,
      previousVersion: existing.binding_version,
      activeVersion: parsedRow.binding_version,
    };
  });
}

export async function disableBinding(
  provider: string,
  name: string
): Promise<WorkflowProviderBinding & { previousState: string }> {
  const dialect = getDialect();
  const db = getDatabase();

  return await db.withTransaction(async query => {
    const lockClause = db.dialect === 'postgres' ? ' FOR UPDATE' : '';
    const preSelect = await query<WorkflowProviderBinding>(
      `SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [provider, name]
    );
    const existingRow = preSelect.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseBindingRow(existingRow);
    const previousState = existing.state;

    const updateResult = await query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET state = 'disabled', updated_at = ${dialect.now()}
       WHERE provider = $1 AND name = $2 AND state = $3`,
      [provider, name, previousState]
    );

    if (updateResult.rowCount === 0) {
      throw new Error('BINDING_CONCURRENT_MODIFICATION');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
      [provider, name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_DISABLE');
    }
    getLog().debug({ provider, name, previousState }, 'db.binding_disable_completed');
    return { ...parseBindingRow(row), previousState };
  });
}
