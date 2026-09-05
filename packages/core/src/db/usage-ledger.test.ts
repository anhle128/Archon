import { describe, expect, mock, test } from 'bun:test';
import { createQueryResult } from '../test/mocks/database';
import type { UsageLedgerRow } from '../schemas/usage-ledger';
import { insertUsageLedgerRow, insertUsageLedgerRows } from './usage-ledger';

function sampleRow(overrides: Partial<UsageLedgerRow> = {}): UsageLedgerRow {
  return {
    id: 'ledger-1',
    workflow_event_id: 'evt-1',
    entry_index: 0,
    agent_provider: 'claude',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    model_source: 'reported',
    kind: null,
    tokens_input: 10,
    tokens_output: 5,
    tokens_reasoning: null,
    tokens_cache_read: null,
    tokens_cache_write: null,
    requests: null,
    cost_usd: 0.01,
    cost_estimated_usd: null,
    pricing_source: null,
    ...overrides,
  };
}

describe('usage-ledger inserts', () => {
  test('insertUsageLedgerRow writes all 17 columns in order', async () => {
    const query = mock(() => Promise.resolve(createQueryResult([])));
    const row = sampleRow({
      kind: 'subagent',
      tokens_reasoning: 2,
      tokens_cache_read: 3,
      tokens_cache_write: 4,
      requests: 1,
      cost_usd: null,
      cost_estimated_usd: 0.002,
      pricing_source: 'config',
    });

    await insertUsageLedgerRow(query, row);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO remote_agent_usage_ledger');
    expect(sql).not.toContain('ON CONFLICT');
    expect(params).toEqual([
      'ledger-1',
      'evt-1',
      0,
      'claude',
      'anthropic',
      'claude-sonnet-4',
      'reported',
      'subagent',
      10,
      5,
      2,
      3,
      4,
      1,
      null,
      0.002,
      'config',
    ]);
  });

  test('insertUsageLedgerRows preserves entry order and stops on first failure', async () => {
    const query = mock((sql: string) => {
      void sql;
      if (query.mock.calls.length === 2) {
        return Promise.reject(new Error('constraint'));
      }
      return Promise.resolve(createQueryResult([]));
    });

    await expect(
      insertUsageLedgerRows(query, [
        sampleRow({ id: 'a', entry_index: 0 }),
        sampleRow({ id: 'b', entry_index: 1 }),
        sampleRow({ id: 'c', entry_index: 2 }),
      ])
    ).rejects.toThrow('constraint');

    expect(query).toHaveBeenCalledTimes(2);
    const firstParams = (query.mock.calls[0] as [string, unknown[]])[1];
    const secondParams = (query.mock.calls[1] as [string, unknown[]])[1];
    expect(firstParams[0]).toBe('a');
    expect(secondParams[0]).toBe('b');
  });

  test('rejects invalid ledger rows before querying', async () => {
    const query = mock(() => Promise.resolve(createQueryResult([])));
    await expect(
      insertUsageLedgerRow(
        query,
        sampleRow({
          cost_usd: 0.01,
          cost_estimated_usd: 0.02,
          pricing_source: 'config',
        })
      )
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
