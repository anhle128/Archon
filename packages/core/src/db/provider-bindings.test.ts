import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
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
} from './provider-bindings';

function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wpb-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events/workflow-engine',
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
  });

  describe('createBinding()', () => {
    test('inserts provider/name/codebase_id/event_route with ON CONFLICT DO NOTHING (never DO UPDATE)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));

      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/workflow-engine',
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO remote_agent_workflow_provider_bindings');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
      expect(params).toContain('archon');
      expect(params).toContain('workflow-engine-primary');
      expect(params).toContain('cb-1');
      expect(params).toContain('https://hermes.example/events/workflow-engine');
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

  describe('updateBinding()', () => {
    test('issues UPDATE ... WHERE provider=$1 AND name=$2 and never inserts', async () => {
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

      const [updateSql, updateParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).not.toContain('INSERT INTO');
      expect(updateSql).toMatch(/WHERE\s+provider\s*=\s*\$\d+\s+AND\s+name\s*=\s*\$\d+/);
      expect(updateParams).toContain('https://hermes.example/events/v2');
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
      const updateParams = mockQuery.mock.calls[2]?.[1] as unknown[];
      expect(updateParams).toContain('https://hermes.example/events/v2');
      expect(updateParams).not.toContain('https://hermes.example/events/v1');
    });
  });

  describe('rotateBinding()', () => {
    test('increments binding_version by exactly 1, sets state=rotated, via UPDATE then a separate SELECT (no RETURNING)', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ binding_version: 1 })], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'rotated', binding_version: 2 })], 1)
      );

      const result = await rotateBinding('archon', 'workflow-engine-primary');

      const [updateSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).toContain('binding_version = binding_version + 1');
      expect(updateSql).not.toContain('RETURNING');
      const [selectSql] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(selectSql).toContain('SELECT');
      expect(result).toMatchObject({ previousVersion: 1, activeVersion: 2 });
    });

    test('rejects with BINDING_NOT_FOUND when the pre-SELECT finds no row', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(rotateBinding('archon', 'never-created')).rejects.toThrow(/BINDING_NOT_FOUND/);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('when the UPDATE commits but the follow-up SELECT throws, the caller sees an explicit uncertain-outcome error', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ binding_version: 1 })], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockRejectedValueOnce(new Error('connection reset'));

      await expect(rotateBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /uncertain|connection reset/i
      );
    });
  });

  describe('disableBinding()', () => {
    test('issues UPDATE ... SET state = disabled, never DELETE', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));

      await disableBinding('archon', 'workflow-engine-primary');

      const calledSql = mockQuery.mock.calls.map(c => (c as [string, unknown[]])[0]).join('\n');
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

      await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow();
    });
  });

  describe('boundary / canonicalization (Story 3.1)', () => {
    test('deriveBindingId produces a deterministic wpb_-prefixed slug', () => {
      const id = deriveBindingId('archon', 'workflow-engine-primary');
      expect(id).toBe('wpb_archon_workflow_engine_primary');
    });
  });
});
