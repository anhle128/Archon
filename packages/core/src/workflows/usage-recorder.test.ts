import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';
import type { RecordWorkflowUsageInput } from '@archon/workflows/deps';
import type { ModelUsageEntry } from '@archon/workflows/schemas/usage-breakdown';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  getArchonConfigPath: mock(() => '/home/test/.archon/config.yaml'),
  getArchonWorkspacesPath: mock(() => '/home/test/.archon/workspaces'),
  getArchonWorktreesPath: mock(() => '/home/test/.archon/worktrees'),
  getDefaultCommandsPath: mock(() => '/app/.archon/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/app/.archon/workflows/defaults'),
}));

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
const mockWithTransaction = mock(async (fn: (query: typeof mockQuery) => Promise<unknown>) => {
  return fn(mockQuery);
});
const mockPoolQuery = mock(() => Promise.resolve(createQueryResult([])));

mock.module('../db/connection', () => ({
  pool: {
    query: mockPoolQuery,
  },
  getDialect: () => mockPostgresDialect,
  getDatabaseType: () => 'postgresql',
  getDatabase: () => ({
    withTransaction: mockWithTransaction,
  }),
}));

const mockLoadPricingLookups = mock(async () => ({
  configByProviderModel: new Map(),
  configBlockedByProviderModel: new Map(),
  catalogByProviderModel: new Map(),
}));
const mockMaterializeUsageCost = mock(() => ({
  cost_usd: 0.01,
  cost_estimated_usd: null,
  pricing_source: null,
}));

mock.module('../usage/estimate', () => ({
  loadPricingLookups: mockLoadPricingLookups,
  materializeUsageCost: mockMaterializeUsageCost,
}));

import { createWorkflowUsageRecorder } from './usage-recorder';

function entry(overrides: Partial<ModelUsageEntry> = {}): ModelUsageEntry {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    modelSource: 'reported',
    inputTokens: 100,
    outputTokens: 40,
    costUsd: 0.01,
    ...overrides,
  };
}

function validInput(overrides: Partial<RecordWorkflowUsageInput> = {}): RecordWorkflowUsageInput {
  return {
    runId: 'run-1',
    stepName: 'planner',
    agentProvider: 'claude',
    usageBreakdown: [entry()],
    retryEpoch: 0,
    iteration: null,
    reaskAttempt: 0,
    terminalError: false,
    errorSubtype: null,
    ...overrides,
  };
}

describe('createWorkflowUsageRecorder', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(() => Promise.resolve(createQueryResult([])));
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(() => Promise.resolve(createQueryResult([])));
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async fn => fn(mockQuery));
    mockLoadPricingLookups.mockClear();
    mockMaterializeUsageCost.mockClear();
    mockMaterializeUsageCost.mockImplementation(() => ({
      cost_usd: 0.01,
      cost_estimated_usd: null,
      pricing_source: null,
    }));
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  test('commits one node_usage_recorded event plus one ledger row per entry atomically', async () => {
    const recorder = createWorkflowUsageRecorder();
    await recorder.recordWorkflowUsage(
      validInput({
        usageBreakdown: [
          entry({ inputTokens: 10, outputTokens: 2, costUsd: 0.1 }),
          entry({
            provider: 'anthropic',
            model: 'claude-haiku-4',
            inputTokens: 5,
            outputTokens: 1,
            costUsd: undefined,
            requests: 1,
          }),
        ],
        retryEpoch: 2,
        reaskAttempt: 1,
        terminalError: true,
        errorSubtype: 'rate_limit',
      })
    );

    expect(mockLoadPricingLookups).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    // event insert + 2 ledger inserts
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const [eventSql, eventParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(eventSql).toContain('INSERT INTO remote_agent_workflow_events');
    expect(eventSql).not.toContain('ON CONFLICT');
    expect(eventParams[1]).toBe('run-1');
    expect(eventParams[2]).toBe('node_usage_recorded');
    expect(eventParams[4]).toBe('planner');
    const payload = JSON.parse(eventParams[5] as string) as {
      schema_version: number;
      agent_provider: string;
      usage_breakdown: unknown[];
      retry_epoch: number;
      reask_attempt: number;
      terminal_error: boolean;
      error_subtype: string | null;
      iteration: number | null;
    };
    expect(payload.schema_version).toBe(1);
    expect(payload.agent_provider).toBe('claude');
    expect(payload.usage_breakdown).toHaveLength(2);
    expect(payload.retry_epoch).toBe(2);
    expect(payload.reask_attempt).toBe(1);
    expect(payload.terminal_error).toBe(true);
    expect(payload.error_subtype).toBe('rate_limit');
    expect(payload.iteration).toBeNull();
    // estimates must never enter event JSON
    expect(JSON.stringify(payload)).not.toContain('cost_estimated');
    expect(JSON.stringify(payload)).not.toContain('pricing_source');

    const [ledgerSql, ledgerParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(ledgerSql).toContain('INSERT INTO remote_agent_usage_ledger');
    expect(ledgerParams[1]).toBe(eventParams[0]); // same event id
    expect(ledgerParams[2]).toBe(0);
    expect(ledgerParams[3]).toBe('claude');
    expect(ledgerParams[4]).toBe('anthropic');

    const secondLedgerParams = (mockQuery.mock.calls[2] as [string, unknown[]])[1];
    expect(secondLedgerParams[2]).toBe(1);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  test('resolves estimates before opening the transaction', async () => {
    const order: string[] = [];
    mockLoadPricingLookups.mockImplementation(async () => {
      order.push('lookups');
      return {
        configByProviderModel: new Map(),
        configBlockedByProviderModel: new Map(),
        catalogByProviderModel: new Map(),
      };
    });
    mockWithTransaction.mockImplementation(async fn => {
      order.push('tx');
      return fn(mockQuery);
    });

    const recorder = createWorkflowUsageRecorder();
    await recorder.recordWorkflowUsage(validInput());
    expect(order).toEqual(['lookups', 'tx']);
  });

  test('writes nothing and does not throw on invalid input', async () => {
    const recorder = createWorkflowUsageRecorder();
    await expect(
      recorder.recordWorkflowUsage(
        validInput({
          usageBreakdown: [
            {
              provider: 'anthropic',
              model: 'x',
              modelSource: 'reported',
              // missing every numeric measure
            } as ModelUsageEntry,
          ],
        })
      )
    ).resolves.toBeUndefined();

    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('on transaction failure writes one event-only fallback with same id and ignoreDuplicate', async () => {
    mockWithTransaction.mockImplementation(async () => {
      throw new Error('tx boom');
    });

    const recorder = createWorkflowUsageRecorder();
    await expect(recorder.recordWorkflowUsage(validInput())).resolves.toBeUndefined();

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO remote_agent_workflow_events');
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(params[0]).toEqual(expect.any(String));
    expect(params[2]).toBe('node_usage_recorded');
    const payload = JSON.parse(params[5] as string) as Record<string, unknown>;
    expect(payload.schema_version).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('cost_estimated');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('fallback failure is swallowed and never throws', async () => {
    mockWithTransaction.mockImplementation(async () => {
      throw new Error('tx boom');
    });
    mockPoolQuery.mockRejectedValueOnce(new Error('fallback boom'));

    const recorder = createWorkflowUsageRecorder();
    await expect(recorder.recordWorkflowUsage(validInput())).resolves.toBeUndefined();
    expect(mockLogger.error.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('does not enqueue external events or touch workflow lifecycle APIs', async () => {
    const recorder = createWorkflowUsageRecorder();
    await recorder.recordWorkflowUsage(validInput());

    for (const call of mockQuery.mock.calls) {
      const sql = (call as [string, unknown[]])[0];
      expect(sql).not.toContain('workflow_event_outbox');
      expect(sql).not.toContain('remote_agent_workflow_runs');
    }
  });
});
