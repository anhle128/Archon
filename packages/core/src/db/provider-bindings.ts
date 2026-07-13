import { pool, getDialect } from './connection';
import type { WorkflowProviderBinding } from '../schemas/workflow-provider-binding';
import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.provider-bindings');
  return cachedLog;
}

export type { WorkflowProviderBinding } from '../schemas/workflow-provider-binding';

const VALID_PERSISTED_STATES = ['active', 'disabled', 'rotated'] as const;

export function deriveBindingId(provider: string, name: string): string {
  const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_');
  return `wpb_${sanitize(provider)}::${sanitize(name)}`;
}

export async function createBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
}): Promise<WorkflowProviderBinding> {
  const dialect = getDialect();
  const id = dialect.generateUuid();
  const result = await pool.query<WorkflowProviderBinding>(
    `INSERT INTO remote_agent_workflow_provider_bindings
       (id, provider, name, codebase_id, event_route, state, binding_version)
     VALUES ($1, $2, $3, $4, $5, 'active', 1)
     ON CONFLICT (provider, name) DO NOTHING`,
    [id, input.provider, input.name, input.codebaseId, input.eventRoute]
  );

  if (result.rowCount === 0) {
    throw new Error('BINDING_ALREADY_EXISTS');
  }

  const selectResult = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [input.provider, input.name]
  );
  const row = selectResult.rows[0];
  if (!row) {
    throw new Error('BINDING_VANISHED_AFTER_CREATE');
  }
  getLog().debug({ provider: input.provider, name: input.name }, 'db.binding_create_completed');
  return row;
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

  if (!VALID_PERSISTED_STATES.includes(row.state as (typeof VALID_PERSISTED_STATES)[number])) {
    throw new Error(`BINDING_CORRUPT_STATE: ${row.state}`);
  }
  return row;
}

export async function updateBinding(input: {
  provider: string;
  name: string;
  codebaseId: string;
  eventRoute: string;
}): Promise<WorkflowProviderBinding> {
  const dialect = getDialect();
  const updateResult = await pool.query(
    `UPDATE remote_agent_workflow_provider_bindings
     SET codebase_id = $1, event_route = $2, updated_at = ${dialect.now()}
     WHERE provider = $3 AND name = $4`,
    [input.codebaseId, input.eventRoute, input.provider, input.name]
  );

  if (updateResult.rowCount === 0) {
    throw new Error('BINDING_NOT_FOUND');
  }

  const selectResult = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [input.provider, input.name]
  );
  const row = selectResult.rows[0];
  if (!row) {
    throw new Error('BINDING_VANISHED_AFTER_UPDATE');
  }
  getLog().debug({ provider: input.provider, name: input.name }, 'db.binding_update_completed');
  return row;
}

export async function rotateBinding(
  provider: string,
  name: string
): Promise<WorkflowProviderBinding & { previousVersion: number; activeVersion: number }> {
  const dialect = getDialect();

  const updateResult = await pool.query(
    `UPDATE remote_agent_workflow_provider_bindings
     SET binding_version = binding_version + 1, state = 'rotated', updated_at = ${dialect.now()}
     WHERE provider = $1 AND name = $2 AND state != 'disabled'`,
    [provider, name]
  );

  if (updateResult.rowCount === 0) {
    const checkResult = await pool.query<WorkflowProviderBinding>(
      'SELECT state FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
      [provider, name]
    );
    if (checkResult.rows[0]?.state === 'disabled') {
      throw new Error('BINDING_DISABLED');
    }
    throw new Error('BINDING_NOT_FOUND');
  }

  const selectResult = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [provider, name]
  );
  const row = selectResult.rows[0];
  if (!row) {
    throw new Error('BINDING_VANISHED_AFTER_ROTATE');
  }
  const previousVersion = row.binding_version - 1;
  getLog().debug({ provider, name, previousVersion }, 'db.binding_rotate_completed');
  return { ...row, previousVersion, activeVersion: row.binding_version };
}

export async function disableBinding(
  provider: string,
  name: string
): Promise<WorkflowProviderBinding & { previousState: string }> {
  const dialect = getDialect();

  const preSelect = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [provider, name]
  );
  const existing = preSelect.rows[0];
  if (!existing) {
    throw new Error('BINDING_NOT_FOUND');
  }
  const previousState = existing.state;

  const updateResult = await pool.query(
    `UPDATE remote_agent_workflow_provider_bindings
     SET state = 'disabled', updated_at = ${dialect.now()}
     WHERE provider = $1 AND name = $2`,
    [provider, name]
  );

  if (updateResult.rowCount === 0) {
    throw new Error('BINDING_NOT_FOUND');
  }

  const selectResult = await pool.query<WorkflowProviderBinding>(
    'SELECT * FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2',
    [provider, name]
  );
  const row = selectResult.rows[0];
  if (!row) {
    throw new Error('BINDING_VANISHED_AFTER_DISABLE');
  }
  getLog().debug({ provider, name, previousState }, 'db.binding_disable_completed');
  return { ...row, previousState };
}
