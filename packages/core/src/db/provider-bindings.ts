import { z } from '@hono/zod-openapi';
import { pool, getDialect, getDatabase } from './connection';
import {
  workflowProviderBindingSchema,
  type WorkflowProviderBinding,
} from '../schemas/workflow-provider-binding';
import type { ExternalWorkflowEventType } from '../schemas/workflow-event';
import {
  normalizeProviderBindingTransform,
  validateProviderBindingTransform,
} from '../events/provider-binding-transform';
import type { ProviderBindingTransform } from '../schemas/provider-binding-transform';
import {
  deliveryHeadersSchema,
  normalizeDeliveryHeaders,
  type DeliveryHeaders,
} from '../events/delivery-headers';
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

const workflowProviderBindingForRoutingSchema = workflowProviderBindingSchema
  .omit({ transform: true })
  .extend({
    signing_secret: workflowProviderBindingSchema.shape.event_route.nullable().optional(),
    // Persisted transform validation belongs to the transform boundary so a
    // corrupt config can create durable transform-failed evidence.
    transform: z.unknown().nullable().optional(),
  });

const workflowProviderBindingWithSecretSchema = workflowProviderBindingSchema
  .omit({ transform: true })
  .extend({
    signing_secret: workflowProviderBindingSchema.shape.event_route.nullable().optional(),
    delivery_headers: deliveryHeadersSchema.default({}),
  });

export type WorkflowProviderBindingForRouting = z.infer<
  typeof workflowProviderBindingForRoutingSchema
>;
export type WorkflowProviderBindingWithSecret = z.infer<
  typeof workflowProviderBindingWithSecretSchema
>;

const PUBLIC_COLUMNS =
  'id, provider, name, codebase_id, event_route, event_types, transform, state, binding_version, created_at, updated_at';
const LIFECYCLE_COLUMNS =
  'id, provider, name, codebase_id, event_route, event_types, state, binding_version, created_at, updated_at';
const ROUTING_COLUMNS = `${LIFECYCLE_COLUMNS}, signing_secret, transform`;
const DELIVERY_COLUMNS = `${LIFECYCLE_COLUMNS}, signing_secret, delivery_headers`;

function hexEncode(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function normalizeEventTypes(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const normalized: Record<string, unknown> = { ...row };
  if (typeof normalized.event_types === 'string') {
    try {
      normalized.event_types = JSON.parse(normalized.event_types) as unknown;
    } catch {
      // Leave the invalid value for the public schema to classify by field path.
    }
  }
  return normalized;
}

function parseJsonColumn(
  row: Record<string, unknown>,
  column: 'transform' | 'delivery_headers',
  failOnInvalid: boolean
): void {
  if (typeof row[column] !== 'string') return;
  try {
    row[column] = JSON.parse(row[column]) as unknown;
  } catch {
    if (failOnInvalid) throw new Error(`BINDING_CORRUPT_ROW: ${column}`);
  }
}

function parseBindingRow(row: unknown, includeTransform = true): WorkflowProviderBinding {
  const normalized = normalizeEventTypes(row);
  if (typeof normalized === 'object' && normalized !== null) {
    if (includeTransform) {
      parseJsonColumn(normalized as Record<string, unknown>, 'transform', true);
    } else {
      delete (normalized as Record<string, unknown>).transform;
    }
  }
  const parsed = workflowProviderBindingSchema.safeParse(normalized);
  if (parsed.success) {
    return parsed.data;
  }

  const stateIssue = parsed.error.issues.find(issue => issue.path.join('.') === 'state');
  if (stateIssue) {
    throwCorruptState(row);
  }

  const fields = parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(',');
  throw new Error(`BINDING_CORRUPT_ROW: ${fields}`);
}

function throwCorruptState(row: unknown): never {
  const state =
    row && typeof row === 'object' && 'state' in row
      ? String((row as { state: unknown }).state)
      : 'unknown';
  throw new Error(`BINDING_CORRUPT_STATE: ${state}`);
}

function parseBindingRowForRouting(row: unknown): WorkflowProviderBindingForRouting {
  const normalized = normalizeEventTypes(row);
  if (typeof normalized === 'object' && normalized !== null) {
    parseJsonColumn(normalized as Record<string, unknown>, 'transform', false);
  }
  const parsed = workflowProviderBindingForRoutingSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(',');
  throw new Error(`BINDING_CORRUPT_ROW: ${fields}`);
}

function parseBindingRowWithSecret(row: unknown): WorkflowProviderBindingWithSecret {
  const normalized = normalizeEventTypes(row);
  if (typeof normalized === 'object' && normalized !== null) {
    parseJsonColumn(normalized as Record<string, unknown>, 'delivery_headers', true);
  }
  const parsed = workflowProviderBindingWithSecretSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some(issue => issue.path[0] === 'delivery_headers')) {
    throw new Error('BINDING_CORRUPT_ROW: delivery_headers');
  }
  const fields = parsed.error.issues.map(issue => issue.path.join('.') || '<root>').join(',');
  throw new Error(`BINDING_CORRUPT_ROW: ${fields}`);
}

function parseLifecycleState(row: unknown): { state: WorkflowProviderBinding['state'] } {
  const parsed = workflowProviderBindingSchema.pick({ state: true }).safeParse(row);
  if (parsed.success) return parsed.data;
  return throwCorruptState(row);
}

function parseLifecycleVersionedState(row: unknown): {
  state: WorkflowProviderBinding['state'];
  binding_version: number;
} {
  const parsed = workflowProviderBindingSchema
    .pick({ state: true, binding_version: true })
    .safeParse(row);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some(issue => issue.path[0] === 'state')) {
    return throwCorruptState(row);
  }
  throw new Error('BINDING_CORRUPT_ROW: binding_version');
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
  eventTypes?: readonly ExternalWorkflowEventType[];
  signingSecret?: string | null;
  transform?: ProviderBindingTransform | null;
  deliveryHeaders?: DeliveryHeaders | null;
}): Promise<WorkflowProviderBinding> {
  const normalizedTransform =
    input.transform === undefined || input.transform === null
      ? input.transform
      : normalizeProviderBindingTransform(input.transform);
  if (normalizedTransform) validateProviderBindingTransform(normalizedTransform);

  const normalizedHeaders =
    input.deliveryHeaders === undefined || input.deliveryHeaders === null
      ? input.deliveryHeaders
      : normalizeDeliveryHeaders(input.deliveryHeaders);

  const dialect = getDialect();
  const db = getDatabase();
  const id = dialect.generateUuid();

  return await db.withTransaction(async query => {
    const result = await query<WorkflowProviderBinding>(
      `INSERT INTO remote_agent_workflow_provider_bindings
         (id, provider, name, codebase_id, event_route, event_types, signing_secret, transform, delivery_headers, state, binding_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 1)
       ON CONFLICT (provider, name) DO NOTHING`,
      [
        id,
        input.provider,
        input.name,
        input.codebaseId,
        input.eventRoute,
        JSON.stringify(input.eventTypes ?? []),
        input.signingSecret ?? null,
        normalizedTransform ? JSON.stringify(normalizedTransform) : null,
        JSON.stringify(normalizedHeaders ?? {}),
      ]
    );

    if (result.rowCount === 0) {
      throw new Error('BINDING_ALREADY_EXISTS');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      `SELECT ${PUBLIC_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2`,
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
    `SELECT ${PUBLIC_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2`,
    [provider, name]
  );
  const row = result.rows[0];
  if (!row) return null;
  return parseBindingRow(row);
}

export async function getBindingByCodebase(
  provider: string,
  codebaseId: string
): Promise<WorkflowProviderBindingForRouting[]> {
  const result = await pool.query<WorkflowProviderBindingForRouting>(
    `SELECT ${ROUTING_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND codebase_id = $2`,
    [provider, codebaseId]
  );
  return result.rows.map(parseBindingRowForRouting);
}

export async function getBindingByIdWithSecret(
  id: string
): Promise<WorkflowProviderBindingWithSecret | null> {
  const result = await pool.query<WorkflowProviderBindingWithSecret>(
    `SELECT ${DELIVERY_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE id = $1`,
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
  eventTypes?: readonly ExternalWorkflowEventType[];
  signingSecret?: string | null;
  transform?: ProviderBindingTransform | null;
  deliveryHeaders?: DeliveryHeaders | null;
}): Promise<WorkflowProviderBinding> {
  const normalizedTransform =
    input.transform === undefined || input.transform === null
      ? input.transform
      : normalizeProviderBindingTransform(input.transform);
  if (normalizedTransform) validateProviderBindingTransform(normalizedTransform);

  const normalizedHeaders =
    input.deliveryHeaders === undefined || input.deliveryHeaders === null
      ? input.deliveryHeaders
      : normalizeDeliveryHeaders(input.deliveryHeaders);

  const dialect = getDialect();
  const db = getDatabase();

  return await db.withTransaction(async query => {
    const lockClause = db.dialect === 'postgres' ? ' FOR UPDATE' : '';
    const existingResult = await query<Pick<WorkflowProviderBinding, 'binding_version' | 'state'>>(
      `SELECT binding_version, state FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [input.provider, input.name]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseLifecycleVersionedState(existingRow);
    if (existing.state === 'disabled') {
      throw new Error('BINDING_DISABLED');
    }

    const transformSupplied = input.transform !== undefined;
    const deliveryHeadersSupplied = input.deliveryHeaders !== undefined;
    const updateParams = [
      input.codebaseId,
      input.eventRoute,
      input.eventTypes === undefined ? null : JSON.stringify(input.eventTypes),
      input.signingSecret ?? null,
      transformSupplied ? 1 : 0,
      transformSupplied && normalizedTransform !== null
        ? JSON.stringify(normalizedTransform)
        : null,
      deliveryHeadersSupplied ? 1 : 0,
      deliveryHeadersSupplied ? JSON.stringify(normalizedHeaders ?? {}) : null,
      input.provider,
      input.name,
      existing.binding_version,
      existing.state,
    ];

    const updateResult = await query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET codebase_id = $1,
           event_route = $2,
           event_types = COALESCE($3, event_types),
           signing_secret = COALESCE($4, signing_secret),
           transform = CASE WHEN $5 = 1 THEN $6 ELSE transform END,
           delivery_headers = CASE WHEN $7 = 1 THEN $8 ELSE delivery_headers END,
           updated_at = ${dialect.now()}
       WHERE provider = $9 AND name = $10 AND binding_version = $11 AND state = $12`,
      updateParams
    );

    if (updateResult.rowCount === 0) {
      throw new Error('BINDING_CONCURRENT_MODIFICATION');
    }

    const selectResult = await query<WorkflowProviderBinding>(
      `SELECT ${LIFECYCLE_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2`,
      [input.provider, input.name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_UPDATE');
    }
    getLog().debug({ provider: input.provider, name: input.name }, 'db.binding_update_completed');
    return parseBindingRow(row, false);
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
    const existingResult = await query<Pick<WorkflowProviderBinding, 'binding_version' | 'state'>>(
      `SELECT binding_version, state FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [provider, name]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseLifecycleVersionedState(existingRow);
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
      `SELECT ${LIFECYCLE_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2`,
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
    const parsedRow = parseBindingRow(row, false);
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
    const preSelect = await query<Pick<WorkflowProviderBinding, 'state'>>(
      `SELECT state FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2${lockClause}`,
      [provider, name]
    );
    const existingRow = preSelect.rows[0];
    if (!existingRow) {
      throw new Error('BINDING_NOT_FOUND');
    }
    const existing = parseLifecycleState(existingRow);
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
      `SELECT ${LIFECYCLE_COLUMNS} FROM remote_agent_workflow_provider_bindings WHERE provider = $1 AND name = $2`,
      [provider, name]
    );
    const row = selectResult.rows[0];
    if (!row) {
      throw new Error('BINDING_VANISHED_AFTER_DISABLE');
    }
    getLog().debug({ provider, name, previousState }, 'db.binding_disable_completed');
    return { ...parseBindingRow(row, false), previousState };
  });
}
