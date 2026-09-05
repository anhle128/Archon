/**
 * Workflow ENV store against a real SqliteAdapter.
 *
 * Covers JSON TEXT round-trip, name/bounds validation, unique conflict mapping,
 * corrupt-row handling, summary independence from patch parsing, full-document
 * replacement, and workflow-scoped mismatch.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other DB tests.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const {
  createWorkflowEnv,
  deleteWorkflowEnv,
  getWorkflowEnvById,
  isWorkflowEnvNameConflict,
  listWorkflowEnvSummaries,
  updateWorkflowEnv,
  WorkflowEnvCorruptRowError,
  WorkflowEnvNameConflictError,
} = await import('./workflow-envs');

afterAll(async () => {
  await db.close();
});

describe('remote_agent_workflow_envs schema (fresh SQLite)', () => {
  test('createSchema installed the table, unique constraint, and workflow_name index', async () => {
    const tables = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remote_agent_workflow_envs'`
    );
    expect(tables.rows).toHaveLength(1);

    const cols = await db.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('remote_agent_workflow_envs')`
    );
    const names = cols.rows.map(r => r.name).sort();
    expect(names).toEqual(
      [
        'created_at',
        'created_by_user_id',
        'id',
        'name',
        'patches',
        'updated_at',
        'workflow_name',
      ].sort()
    );

    const indexes = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'remote_agent_workflow_envs'`
    );
    const indexNames = indexes.rows.map(r => r.name);
    expect(indexNames).toContain('idx_workflow_envs_workflow_name');
    // Named UNIQUE constraint surfaces as an auto-index on SQLite.
    expect(indexNames.some(n => /workflow_name/i.test(n) && /name/i.test(n))).toBe(true);
  });
});

describe('workflow-envs CRUD', () => {
  test('create/list/get/update/delete round-trips patches through SQLite TEXT', async () => {
    const created = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'baseline',
      patches: {
        research: { provider: 'claude', model: 'claude-sonnet-4', prompt: 'v1' },
      },
      created_by_user_id: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.workflow_name).toBe('feature');
    expect(created.name).toBe('baseline');
    expect(created.patches.research?.prompt).toBe('v1');
    expect(typeof created.created_at === 'string' || created.created_at instanceof Date).toBe(true);

    // Raw column is a JSON string on SQLite.
    const raw = await db.query<{ patches: unknown }>(
      'SELECT patches FROM remote_agent_workflow_envs WHERE id = $1',
      [created.id]
    );
    expect(typeof raw.rows[0]?.patches).toBe('string');

    const fetched = await getWorkflowEnvById(created.id);
    expect(fetched?.patches).toEqual(created.patches);

    const summaries = await listWorkflowEnvSummaries('feature');
    expect(summaries.some(s => s.id === created.id)).toBe(true);
    expect(summaries.find(s => s.id === created.id)).not.toHaveProperty('patches');

    const replaced = await updateWorkflowEnv('feature', created.id, {
      patches: {
        research: { provider: 'codex', model: 'gpt-5', prompt: 'v2' },
      },
    });
    expect(replaced?.patches.research?.provider).toBe('codex');
    expect(replaced?.patches.research?.prompt).toBe('v2');
    // Full document replacement — no leftover keys from the prior map if we swap targets.
    const swapped = await updateWorkflowEnv('feature', created.id, {
      patches: {
        build: { bash: 'echo hi' },
      },
    });
    expect(swapped?.patches).toEqual({ build: { bash: 'echo hi' } });

    const emptied = await updateWorkflowEnv('feature', created.id, { patches: {} });
    expect(emptied?.patches).toEqual({});

    const deleted = await deleteWorkflowEnv('feature', created.id);
    expect(deleted).toBe(true);
    expect(await getWorkflowEnvById(created.id)).toBeNull();
  });

  test('empty {} patches are valid on create', async () => {
    const created = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'empty-map',
      patches: {},
      created_by_user_id: null,
    });
    expect(created.patches).toEqual({});
    await deleteWorkflowEnv('feature', created.id);
  });

  test('name validation and bounds are enforced at the store boundary', async () => {
    await expect(
      createWorkflowEnv({
        workflow_name: 'feature',
        name: '',
        patches: {},
        created_by_user_id: null,
      })
    ).rejects.toThrow();

    await expect(
      createWorkflowEnv({
        workflow_name: 'feature',
        name: '_bad',
        patches: {},
        created_by_user_id: null,
      })
    ).rejects.toThrow();

    await expect(
      createWorkflowEnv({
        workflow_name: 'a'.repeat(256),
        name: 'ok',
        patches: {},
        created_by_user_id: null,
      })
    ).rejects.toThrow();

    await expect(
      createWorkflowEnv({
        workflow_name: 'feature',
        name: 'ok',
        patches: { research: {} },
        created_by_user_id: null,
      })
    ).rejects.toThrow();
  });

  test('duplicate (workflow_name, name) maps to WorkflowEnvNameConflictError', async () => {
    const first = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'dup',
      patches: {},
      created_by_user_id: null,
    });

    await expect(
      createWorkflowEnv({
        workflow_name: 'feature',
        name: 'dup',
        patches: { x: { model: 'm' } },
        created_by_user_id: null,
      })
    ).rejects.toBeInstanceOf(WorkflowEnvNameConflictError);

    // Same name under a different workflow is fine.
    const other = await createWorkflowEnv({
      workflow_name: 'other',
      name: 'dup',
      patches: {},
      created_by_user_id: null,
    });
    expect(other.id).not.toBe(first.id);

    await deleteWorkflowEnv('feature', first.id);
    await deleteWorkflowEnv('other', other.id);
  });

  test('rename unique conflict also maps to WorkflowEnvNameConflictError', async () => {
    const a = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'alpha',
      patches: {},
      created_by_user_id: null,
    });
    const b = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'beta',
      patches: {},
      created_by_user_id: null,
    });

    await expect(updateWorkflowEnv('feature', b.id, { name: 'alpha' })).rejects.toBeInstanceOf(
      WorkflowEnvNameConflictError
    );

    await deleteWorkflowEnv('feature', a.id);
    await deleteWorkflowEnv('feature', b.id);
  });

  test('update requires at least one field; mismatched workflow path is a no-op', async () => {
    const created = await createWorkflowEnv({
      workflow_name: 'feature',
      name: 'scoped',
      patches: { n: { model: 'm1' } },
      created_by_user_id: null,
    });

    await expect(updateWorkflowEnv('feature', created.id, {})).rejects.toThrow(
      /at least one of name or patches/
    );

    const missed = await updateWorkflowEnv('other-workflow', created.id, {
      patches: { n: { model: 'm2' } },
    });
    expect(missed).toBeNull();

    const still = await getWorkflowEnvById(created.id);
    expect(still?.patches.n?.model).toBe('m1');

    expect(await deleteWorkflowEnv('other-workflow', created.id)).toBe(false);
    expect(await getWorkflowEnvById(created.id)).not.toBeNull();

    expect(await deleteWorkflowEnv('feature', created.id)).toBe(true);
  });

  test('list ordering is LOWER(name), name, id and ignores corrupt patches', async () => {
    const c = await createWorkflowEnv({
      workflow_name: 'order-wf',
      name: 'Charlie',
      patches: { n: { model: 'c' } },
      created_by_user_id: null,
    });
    const a = await createWorkflowEnv({
      workflow_name: 'order-wf',
      name: 'alpha',
      patches: { n: { model: 'a' } },
      created_by_user_id: null,
    });
    const b = await createWorkflowEnv({
      workflow_name: 'order-wf',
      name: 'Beta',
      patches: { n: { model: 'b' } },
      created_by_user_id: null,
    });

    // Corrupt one row's patches — summary list must still succeed (no patches parse).
    await db.query(`UPDATE remote_agent_workflow_envs SET patches = $1 WHERE id = $2`, [
      '{not-json',
      b.id,
    ]);

    const summaries = await listWorkflowEnvSummaries('order-wf');
    expect(summaries.map(s => s.name)).toEqual(['alpha', 'Beta', 'Charlie']);
    for (const s of summaries) {
      expect(s).not.toHaveProperty('patches');
    }

    await expect(getWorkflowEnvById(b.id)).rejects.toBeInstanceOf(WorkflowEnvCorruptRowError);

    await deleteWorkflowEnv('order-wf', a.id);
    await deleteWorkflowEnv('order-wf', b.id);
    await deleteWorkflowEnv('order-wf', c.id);
  });

  test('isWorkflowEnvNameConflict is constraint/message exact', () => {
    expect(
      isWorkflowEnvNameConflict(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_workflow_envs_workflow_name_name',
        })
      )
    ).toBe(true);

    expect(
      isWorkflowEnvNameConflict(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'some_other_unique',
        })
      )
    ).toBe(false);

    expect(
      isWorkflowEnvNameConflict(
        new Error(
          'UNIQUE constraint failed: remote_agent_workflow_envs.workflow_name, remote_agent_workflow_envs.name'
        )
      )
    ).toBe(true);

    expect(
      isWorkflowEnvNameConflict(
        new Error('UNIQUE constraint failed: remote_agent_workflow_envs.id')
      )
    ).toBe(false);
  });
});
