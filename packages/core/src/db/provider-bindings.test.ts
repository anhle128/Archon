import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
const mockWithTransaction = mock(
  async <T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>
  ): Promise<T> => {
    return await fn(mockQuery as <U>(sql: string, params?: unknown[]) => Promise<unknown>);
  }
);
mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
  getDatabase: () => ({
    dialect: 'postgres',
    withTransaction: mockWithTransaction,
  }),
}));

mock.module('@archon/paths', () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    trace: mock(() => {}),
    fatal: mock(() => {}),
  })),
}));

import {
  createBinding,
  getBinding,
  updateBinding,
  rotateBinding,
  disableBinding,
  deriveBindingId,
  getBindingByCodebase,
  getBindingByIdWithSecret,
} from './provider-bindings';

function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wpb-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events/workflow-engine',
    event_types: '["workflow.approval.requested"]',
    state: 'active',
    binding_version: 1,
    created_at: '2026-07-11T11:48:27.000Z',
    updated_at: '2026-07-11T11:48:27.000Z',
    ...overrides,
  };
}

describe('provider-bindings db layer (Story 3.1)', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockWithTransaction.mockClear();
  });

  describe('createBinding()', () => {
    test('inserts provider/name/codebase_id/event_route/event_types/signing_secret with ON CONFLICT DO NOTHING', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));

      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/workflow-engine',
        eventTypes: ['workflow.approval.requested'],
        signingSecret: 'local-test-value',
      });

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO remote_agent_workflow_provider_bindings');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
      expect(params).toContain('archon');
      expect(params).toContain('workflow-engine-primary');
      expect(params).toContain('cb-1');
      expect(params).toContain('https://hermes.example/events/workflow-engine');
      expect(params).toContain('["workflow.approval.requested"]');
      expect(params).toContain('local-test-value');
    });

    test('rejects with BINDING_ALREADY_EXISTS when rowCount is 0 (row already present) and issues no further write', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        createBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/workflow-engine',
        })
      ).rejects.toThrow(/BINDING_ALREADY_EXISTS/);

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('secret-aware private lookups', () => {
    test('getBinding strips signing_secret from the public projection', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ signing_secret: 'local-test-value' })], 1)
      );

      const result = await getBinding('archon', 'workflow-engine-primary');

      expect(result).not.toBeNull();
      expect(result?.event_types).toEqual(['workflow.approval.requested']);
      expect('signing_secret' in (result ?? {})).toBe(false);
    });

    test('getBindingByCodebase returns every binding row for conflict handling', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult(
          [
            bindingRow({ id: 'wpb-1', signing_secret: 'first' }),
            bindingRow({
              id: 'wpb-2',
              name: 'workflow-engine-secondary',
              signing_secret: 'second',
            }),
          ],
          2
        )
      );

      const result = await getBindingByCodebase('archon', 'cb-1');

      expect(result).toHaveLength(2);
      expect(result.map(row => row.signing_secret)).toEqual(['first', 'second']);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE provider = $1 AND codebase_id = $2');
      expect(params).toEqual(['archon', 'cb-1']);
    });

    test('getBindingByIdWithSecret returns the private signing secret', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ signing_secret: 'local-test-value' })], 1)
      );

      const result = await getBindingByIdWithSecret('wpb-1');

      expect(result?.signing_secret).toBe('local-test-value');
    });
  });

  describe('updateBinding()', () => {
    test('issues UPDATE ... WHERE provider=$1 AND name=$2 and never inserts', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ event_route: 'https://hermes.example/events/v2' })], 1)
      );

      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
        eventTypes: ['workflow.approval.requested'],
        signingSecret: 'local-test-value-v2',
      });

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const [preSelectSql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(preSelectSql).toContain('FOR UPDATE');
      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).toContain('signing_secret = COALESCE');
      expect(updateSql).not.toContain('INSERT INTO');
      expect(updateSql).toMatch(/WHERE\s+provider\s*=\s*\$\d+\s+AND\s+name\s*=\s*\$\d+/);
      expect(updateParams).toContain('https://hermes.example/events/v2');
      expect(updateParams).toContain('["workflow.approval.requested"]');
      expect(updateParams).toContain('local-test-value-v2');
    });

    test('preserves the stored allowlist when eventTypes is omitted', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));

      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });

      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('event_types = COALESCE($3, event_types)');
      expect(updateParams[2]).toBeNull();
    });

    test('rejects with BINDING_NOT_FOUND when rowCount is 0 and issues no INSERT fallback', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        updateBinding({
          provider: 'archon',
          name: 'nonexistent-binding',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/v2',
        })
      ).rejects.toThrow(/BINDING_NOT_FOUND/);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('INSERT INTO');
    });

    test('create on an already-created (provider,name) still fails after an update was performed', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v1',
      });

      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });

      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));
      await expect(
        createBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/v3',
        })
      ).rejects.toThrow(/BINDING_ALREADY_EXISTS/);
    });

    test('the exact event route from create is superseded by the exact event route from a subsequent update', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v1',
      });
      const createParams = mockQuery.mock.calls[0]?.[1] as unknown[];
      expect(createParams).toContain('https://hermes.example/events/v1');

      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ event_route: 'https://hermes.example/events/v2' })], 1)
      );
      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });
      const updateParams = mockQuery.mock.calls[3]?.[1] as unknown[];
      expect(updateParams).toContain('https://hermes.example/events/v2');
      expect(updateParams).not.toContain('https://hermes.example/events/v1');
    });

    test('rejects updating a disabled binding', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));

      await expect(
        updateBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-2',
          eventRoute: 'https://hermes.example/events/disabled-v2',
        })
      ).rejects.toThrow(/BINDING_DISABLED/);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [preSelectSql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(preSelectSql).toContain('FOR UPDATE');
    });

    test('rejects when a guarded update loses the row to a concurrent change', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        updateBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-2',
          eventRoute: 'https://hermes.example/events/v2',
        })
      ).rejects.toThrow(/BINDING_CONCURRENT_MODIFICATION/);
    });
  });

  describe('rotateBinding()', () => {
    test('increments binding_version by exactly 1, sets state=rotated, in one transaction', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'rotated', binding_version: 2 })], 1)
      );

      const result = await rotateBinding('archon', 'workflow-engine-primary', 'rotated-secret');

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const [preSelectSql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(preSelectSql).toContain('FOR UPDATE');
      const [updateSql, updateParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).toContain('binding_version = $3');
      expect(updateSql).toContain('signing_secret = COALESCE($4, signing_secret)');
      expect(updateSql).toContain('binding_version = $5');
      expect(updateParams).toEqual([
        'archon',
        'workflow-engine-primary',
        2,
        'rotated-secret',
        1,
        'active',
      ]);
      expect(updateSql).not.toContain('RETURNING');
      const [selectSql] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(selectSql).toContain('SELECT');
      expect(result).toMatchObject({ previousVersion: 1, activeVersion: 2 });
    });

    test('rejects with BINDING_NOT_FOUND when no row matches', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(rotateBinding('archon', 'never-created')).rejects.toThrow(/BINDING_NOT_FOUND/);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('rejects with BINDING_DISABLED when the binding exists but is disabled (atomic guard)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));

      await expect(rotateBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /BINDING_DISABLED/
      );
    });

    test('throws BINDING_VANISHED_AFTER_ROTATE when post-UPDATE SELECT finds no row', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(rotateBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /BINDING_VANISHED_AFTER_ROTATE/
      );
    });
  });

  describe('disableBinding()', () => {
    test('issues UPDATE ... SET state = disabled, never DELETE', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));

      await disableBinding('archon', 'workflow-engine-primary');

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const calledSql = mockQuery.mock.calls.map(c => (c as [string, unknown[]])[0]).join('\n');
      expect(calledSql).toContain('FOR UPDATE');
      expect(calledSql).toContain("state = 'disabled'");
      expect(calledSql).not.toContain('DELETE FROM remote_agent_workflow_provider_bindings');
    });

    test('rejects with BINDING_NOT_FOUND when the pre-SELECT finds no row', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(disableBinding('archon', 'never-created')).rejects.toThrow(/BINDING_NOT_FOUND/);
    });
  });

  describe('getBinding() — status read path', () => {
    test('returns null when no row matches (provider,name)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      expect(await getBinding('archon', 'never-created')).toBeNull();
    });

    test('returns the row unmodified when state=active', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'active' })]));

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'active', binding_version: 1 });
    });

    test('accepts PostgreSQL Date timestamp rows from node-postgres', async () => {
      const timestamp = new Date('2026-07-11T11:48:27.000Z');
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ created_at: timestamp, updated_at: timestamp })])
      );

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row?.created_at).toBe(timestamp);
      expect(row?.updated_at).toBe(timestamp);
    });

    test('returns the row unmodified when state=disabled', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })]));

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'disabled' });
    });

    test('returns the row unmodified when state=rotated', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'rotated', binding_version: 3 })])
      );

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'rotated', binding_version: 3 });
    });

    test('throws (fails closed) rather than returning a row whose state is outside the persisted enum', async () => {
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'not-a-real-state' })])
      );

      await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /BINDING_CORRUPT_STATE/
      );
    });

    test('throws (fails closed) rather than returning a row missing a required column', async () => {
      const corruptRow = bindingRow();
      delete corruptRow.codebase_id;
      mockQuery.mockResolvedValueOnce(createQueryResult([corruptRow]));

      await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /BINDING_CORRUPT_ROW/
      );
    });

    test('throws BINDING_CORRUPT_ROW for invalid event_types JSON', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ event_types: '{' })]));

      await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /BINDING_CORRUPT_ROW/
      );
    });
  });

  describe('boundary / canonicalization (Story 3.1)', () => {
    test('deriveBindingId produces the deterministic wpb_-prefixed slug from the contract fixtures', () => {
      const id = deriveBindingId('archon', 'workflow-engine-primary');
      expect(id).toBe('wpb_archon::workflow_engine_primary');
    });

    test('deriveBindingId remains unique for provider/name identities that previously collided', () => {
      const ids = [
        deriveBindingId('a', 'b_c'),
        deriveBindingId('a_b', 'c'),
        deriveBindingId('a-b', 'c'),
        deriveBindingId('a', 'b-c'),
      ];

      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^wpb_/);
      }
    });
  });
});
