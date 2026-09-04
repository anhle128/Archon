import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
let databaseType: 'postgresql' | 'sqlite' = 'postgresql';

mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
  getDatabaseType: () => databaseType,
  getDatabase: () => ({
    query: mockQuery,
    dialect: databaseType === 'postgresql' ? 'postgres' : 'sqlite',
    sql: mockPostgresDialect,
  }),
}));

import { queryUsageReport, UsageReportQueryError } from './usage-report';

function emptyMetricRow(overrides: Record<string, unknown> = {}) {
  return {
    tokens_input_sum: null,
    tokens_output_sum: null,
    tokens_reasoning_sum: null,
    tokens_cache_read_sum: null,
    tokens_cache_write_sum: null,
    requests_sum: null,
    reported_usd_sum: null,
    estimated_usd_sum: null,
    record_count: 0,
    missing_tokens_input: 0,
    missing_tokens_output: 0,
    missing_tokens_reasoning: 0,
    missing_tokens_cache_read: 0,
    missing_tokens_cache_write: 0,
    missing_requests: 0,
    rows_missing_usd: 0,
    ...overrides,
  };
}

function metricRow(overrides: Record<string, unknown> = {}) {
  return emptyMetricRow({
    tokens_input_sum: '10',
    tokens_output_sum: '5',
    tokens_reasoning_sum: null,
    tokens_cache_read_sum: '2',
    tokens_cache_write_sum: null,
    requests_sum: '1',
    reported_usd_sum: '0.25',
    estimated_usd_sum: null,
    record_count: '2',
    missing_tokens_input: '0',
    missing_tokens_output: '0',
    missing_tokens_reasoning: '2',
    missing_tokens_cache_read: '1',
    missing_tokens_cache_write: '2',
    missing_requests: '1',
    rows_missing_usd: '0',
    ...overrides,
  });
}

function coverageRow(overrides: Record<string, unknown> = {}) {
  return {
    usage_event_count: '1',
    ledgered_event_count: '1',
    ...overrides,
  };
}

/** Route mockQuery calls: totals, groups, coverage — in Promise.all order is not guaranteed.
 *  Identify by SQL shape instead. */
function installQueryRouter(opts: {
  totals?: Record<string, unknown>;
  groups?: Record<string, unknown>[];
  coverage?: Record<string, unknown>;
}) {
  mockQuery.mockImplementation((sql: string) => {
    const s = String(sql);
    if (s.includes("event_type = 'node_usage_recorded'") && s.includes('usage_event_count')) {
      return Promise.resolve(createQueryResult([opts.coverage ?? coverageRow()]));
    }
    if (s.includes('GROUP BY')) {
      return Promise.resolve(createQueryResult(opts.groups ?? []));
    }
    // totals
    return Promise.resolve(createQueryResult([opts.totals ?? emptyMetricRow()]));
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  databaseType = 'postgresql';
});

describe('queryUsageReport validation', () => {
  test('rejects only-from or only-to', async () => {
    await expect(queryUsageReport({ from: '2026-09-01T00:00:00.000Z' })).rejects.toMatchObject({
      name: 'UsageReportQueryError',
      code: 'validation',
    });
    await expect(queryUsageReport({ to: '2026-09-02T00:00:00.000Z' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  test('requires from < to', async () => {
    await expect(
      queryUsageReport({
        from: '2026-09-02T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'validation' });
  });

  test('caps cross-run ranges at 366 days', async () => {
    await expect(
      queryUsageReport({
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-01-03T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'validation' });
  });

  test('allows >366 days when scoped to a runId', async () => {
    installQueryRouter({
      totals: emptyMetricRow(),
      groups: [],
      coverage: coverageRow({ usage_event_count: '0', ledgered_event_count: '0' }),
    });
    const report = await queryUsageReport({
      from: '2024-01-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
    });
    expect(report.scope.runId).toBe('run-1');
    expect(report.coverage.hasRecordedUsage).toBe(false);
  });

  test('nodeId and groupBy=node require runId', async () => {
    await expect(queryUsageReport({ nodeId: 'plan' })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('nodeId requires runId'),
    });
    await expect(queryUsageReport({ groupBy: 'node' })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('groupBy=node requires runId'),
    });
  });

  test('rejects date-only, locale, zone-less, invalid-offset, and calendar-rollover strings', async () => {
    const invalid = [
      '2026-09-01', // date-only
      '09/01/2026', // locale-formatted
      'Sep 1, 2026', // locale prose
      '2026-09-01T00:00:00', // zone-less
      '2026-09-01 00:00:00', // space separator, no zone
      '2026-09-01T00:00:00+0000', // invalid offset form
      '2026-09-01T00:00:00+00', // truncated offset
      '2026-02-29T00:00:00.000Z', // non-leap calendar rollover
      '2026-02-30T00:00:00.000Z', // nonexistent day
      '2026-04-31T00:00:00.000Z', // nonexistent day
    ];
    for (const bad of invalid) {
      await expect(
        queryUsageReport({ from: bad, to: '2026-09-02T00:00:00.000Z' })
      ).rejects.toMatchObject({
        name: 'UsageReportQueryError',
        code: 'validation',
        message: expect.stringContaining('RFC 3339'),
      });
      await expect(
        queryUsageReport({ from: '2026-09-01T00:00:00.000Z', to: bad })
      ).rejects.toMatchObject({ code: 'validation' });
    }
  });

  test('accepts Z and explicit-offset RFC 3339 instants', async () => {
    installQueryRouter({});
    const validPairs: Array<[string, string]> = [
      ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'],
      ['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'],
      ['2026-09-01T00:00:00+00:00', '2026-09-02T00:00:00+00:00'],
      ['2026-09-01T05:30:00.000+05:30', '2026-09-01T06:30:00.000+05:30'],
      ['2028-02-29T00:00:00.000Z', '2028-03-01T00:00:00.000Z'], // leap day
    ];
    for (const [from, to] of validPairs) {
      mockQuery.mockClear();
      installQueryRouter({});
      const report = await queryUsageReport({ from, to });
      expect(report.scope.from).not.toBeNull();
      expect(report.scope.to).not.toBeNull();
      expect(new Date(report.scope.from!).getTime()).toBeLessThan(
        new Date(report.scope.to!).getTime()
      );
    }
  });

  test('accepts internal Date callers without string validation', async () => {
    installQueryRouter({});
    const from = new Date(Date.UTC(2026, 8, 1));
    const to = new Date(Date.UTC(2026, 8, 2));
    const report = await queryUsageReport({ from, to });
    expect(report.scope.from).toBe(from.toISOString());
    expect(report.scope.to).toBe(to.toISOString());
  });

  test('rejects invalid Date instances from internal callers', async () => {
    await expect(
      queryUsageReport({ from: new Date(Number.NaN), to: new Date() })
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('queryUsageReport defaults and filters', () => {
  test('neither dates nor runId uses current UTC month', async () => {
    installQueryRouter({});
    const before = new Date();
    const report = await queryUsageReport();
    const after = new Date();

    expect(report.scope.from).not.toBeNull();
    expect(report.scope.to).not.toBeNull();
    expect(report.groupBy).toBe('provider');
    expect(report.scope.includesChildRollup).toBe(false);

    const from = new Date(report.scope.from!);
    const to = new Date(report.scope.to!);
    expect(from.getUTCDate()).toBe(1);
    expect(from.getUTCHours()).toBe(0);
    expect(to.getTime()).toBe(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    // Bounds computed around "now"
    expect(from.getTime()).toBeLessThanOrEqual(
      Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), 1)
    );
    expect(from.getTime()).toBeGreaterThanOrEqual(
      Date.UTC(before.getUTCFullYear(), before.getUTCMonth(), 1)
    );

    // SQL half-open range params present
    const totalsCall = mockQuery.mock.calls.find(c => {
      const sql = String(c[0]);
      return sql.includes('SUM(l.tokens_input)') && !sql.includes('GROUP BY');
    }) as [string, unknown[]];
    expect(totalsCall[0]).toContain('e.created_at >=');
    expect(totalsCall[0]).toContain('e.created_at <');
    expect(totalsCall[0]).toContain('::timestamptz');
  });

  test('runId without dates queries entire run with null scope dates', async () => {
    installQueryRouter({
      coverage: coverageRow({ usage_event_count: '0', ledgered_event_count: '0' }),
    });
    const report = await queryUsageReport({ runId: 'run-abc', groupBy: 'node' });
    expect(report.scope).toEqual({
      from: null,
      to: null,
      runId: 'run-abc',
      includesChildRollup: false,
    });
    expect(report.coverage.hasRecordedUsage).toBe(false);

    const totalsCall = mockQuery.mock.calls.find(c => {
      const sql = String(c[0]);
      return sql.includes('SUM(l.tokens_input)') && !sql.includes('GROUP BY');
    }) as [string, unknown[]];
    expect(totalsCall[0]).not.toContain('created_at');
    expect(totalsCall[1]).toEqual(['run-abc']);
  });

  test('kind=unclassified maps to SQL NULL; advisor binds a param', async () => {
    installQueryRouter({});
    await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      kind: 'unclassified',
    });
    const totalsCall = mockQuery.mock.calls.find(c => {
      const sql = String(c[0]);
      return sql.includes('SUM(l.tokens_input)') && !sql.includes('GROUP BY');
    }) as [string, unknown[]];
    expect(totalsCall[0]).toContain('l.kind IS NULL');
    expect(totalsCall[1]).toEqual(['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z']);

    mockQuery.mockClear();
    installQueryRouter({});
    await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      kind: 'advisor',
    });
    const advisorCall = mockQuery.mock.calls.find(c => {
      const sql = String(c[0]);
      return sql.includes('SUM(l.tokens_input)') && !sql.includes('GROUP BY');
    }) as [string, unknown[]];
    expect(advisorCall[0]).toContain('l.kind = $');
    expect(advisorCall[1]).toContain('advisor');
  });

  test('coverage ignores agent/provider/model/kind filters', async () => {
    installQueryRouter({
      coverage: coverageRow({ usage_event_count: '3', ledgered_event_count: '2' }),
    });
    const report = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      codebaseId: 'cb-1',
      agentProvider: 'claude',
      provider: 'anthropic',
      model: 'sonnet',
      kind: 'advisor',
    });

    expect(report.coverage).toEqual({
      usageEventCount: 3,
      ledgeredEventCount: 2,
      unledgeredEventCount: 1,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    });

    const coverageCall = mockQuery.mock.calls.find(c =>
      String(c[0]).includes('usage_event_count')
    ) as [string, unknown[]];
    expect(coverageCall[0]).toContain("event_type = 'node_usage_recorded'");
    expect(coverageCall[0]).toContain('r.codebase_id');
    expect(coverageCall[0]).not.toContain('l.agent_provider');
    expect(coverageCall[0]).not.toContain('l.provider');
    expect(coverageCall[0]).not.toContain('l.model');
    expect(coverageCall[0]).not.toContain('l.kind');
    // only date + codebase params
    expect(coverageCall[1]).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
      'cb-1',
    ]);
  });
});

describe('queryUsageReport grouping and aggregates', () => {
  test('parameterizes filters and uses enum-selected group fragments for all modes', async () => {
    const modes = ['agent', 'provider', 'model', 'project', 'run', 'day', 'node'] as const;

    for (const groupBy of modes) {
      mockQuery.mockClear();
      installQueryRouter({
        groups: [
          {
            ...metricRow(),
            dim_agent_provider: 'claude',
            dim_provider: 'anthropic',
            dim_model: 'sonnet',
            dim_model_source: 'reported',
            dim_codebase_id: 'cb-1',
            dim_codebase_name: 'Archon',
            dim_run_id: 'run-1',
            dim_workflow_name: 'build',
            dim_day: '2026-09-03',
            dim_node_id: 'plan',
            dim_kind: null,
          },
        ],
      });

      const report = await queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-10T00:00:00.000Z',
        runId: groupBy === 'node' ? 'run-1' : undefined,
        groupBy,
      });
      expect(report.groupBy).toBe(groupBy);
      expect(report.groups).toHaveLength(1);

      const groupsCall = mockQuery.mock.calls.find(c => String(c[0]).includes('GROUP BY')) as [
        string,
        unknown[],
      ];
      expect(groupsCall[0]).toContain('LIMIT 501');
      expect(groupsCall[0]).toContain('NULLS FIRST');
      expect(groupsCall[0]).toContain('remote_agent_usage_ledger l');
      expect(groupsCall[0]).toContain('remote_agent_workflow_events e');
      expect(groupsCall[0]).toContain('remote_agent_workflow_runs r');
      expect(groupsCall[0]).toContain('remote_agent_codebases c');
      // no string-interpolated free-form group expression from caller
      expect(groupsCall[0]).not.toContain('${');
    }
  });

  test('day grouping uses dialect UTC expressions', async () => {
    databaseType = 'postgresql';
    installQueryRouter({});
    await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      groupBy: 'day',
    });
    let groupsCall = mockQuery.mock.calls.find(c => String(c[0]).includes('GROUP BY')) as [
      string,
      unknown[],
    ];
    expect(groupsCall[0]).toContain("AT TIME ZONE 'UTC'");

    mockQuery.mockClear();
    databaseType = 'sqlite';
    installQueryRouter({});
    await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      groupBy: 'day',
    });
    groupsCall = mockQuery.mock.calls.find(c => String(c[0]).includes('GROUP BY')) as [
      string,
      unknown[],
    ];
    expect(groupsCall[0]).toContain("strftime('%Y-%m-%d', e.created_at)");
    expect(groupsCall[0]).toContain("strftime('%Y-%m-%d %H:%M:%f', e.created_at)");
    // sqlite date params preserve fractional seconds (ms padded by toISOString)
    expect(String(groupsCall[1][0])).toBe('2026-09-01 00:00:00.000');
  });

  test('converts PG bigint strings and preserves null sums vs zero', async () => {
    installQueryRouter({
      totals: metricRow({
        tokens_input_sum: '10',
        tokens_output_sum: null,
        reported_usd_sum: '0',
        estimated_usd_sum: null,
        record_count: '3',
        missing_tokens_output: '3',
        rows_missing_usd: '0',
      }),
      groups: [
        {
          ...metricRow({
            tokens_input_sum: '10',
            tokens_output_sum: null,
            reported_usd_sum: '0',
            record_count: '3',
            missing_tokens_output: '3',
          }),
          dim_provider: 'anthropic',
        },
      ],
    });

    const report = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
    });

    expect(report.totals.tokensInput).toBe(10);
    expect(report.totals.tokensOutput).toBeNull();
    expect(report.totals.reportedUsd).toBe(0);
    expect(report.totals.estimatedUsd).toBeNull();
    expect(report.totals.recordCount).toBe(3);
    expect(report.totals.missingTokensOutput).toBe(3);
    expect(report.groups[0]?.dimensions).toEqual({ provider: 'anthropic' });
    expect(report.groups[0]?.metrics.tokensOutput).toBeNull();
  });

  test('rejects unsafe/non-finite/negative USD aggregates', async () => {
    installQueryRouter({
      totals: metricRow({ reported_usd_sum: 'NaN' }),
    });
    await expect(
      queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'unsafe_aggregate' });

    installQueryRouter({
      totals: metricRow({ reported_usd_sum: '-1' }),
    });
    await expect(
      queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'unsafe_aggregate' });

    installQueryRouter({
      totals: metricRow({ tokens_input_sum: String(Number.MAX_SAFE_INTEGER + 1) }),
    });
    await expect(
      queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'unsafe_aggregate' });
  });

  test('fetches 501 groups and throws overflow instead of truncating', async () => {
    const groups = Array.from({ length: 501 }, (_, i) => ({
      ...metricRow({ record_count: '1' }),
      dim_provider: `p-${String(i)}`,
    }));
    installQueryRouter({ groups });

    await expect(
      queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
    ).rejects.toMatchObject({
      name: 'UsageReportQueryError',
      code: 'overflow',
    });

    const groupsCall = mockQuery.mock.calls.find(c => String(c[0]).includes('GROUP BY')) as [
      string,
      unknown[],
    ];
    expect(groupsCall[0]).toContain('LIMIT 501');
  });

  test('old run with no usage events returns empty summary hasRecordedUsage false', async () => {
    installQueryRouter({
      totals: emptyMetricRow(),
      groups: [],
      coverage: coverageRow({ usage_event_count: '0', ledgered_event_count: '0' }),
    });
    const report = await queryUsageReport({ runId: 'legacy-run', groupBy: 'node' });
    expect(report.groups).toEqual([]);
    expect(report.totals.recordCount).toBe(0);
    expect(report.totals.tokensInput).toBeNull();
    expect(report.coverage.hasRecordedUsage).toBe(false);
    expect(report.coverage.historicalBackfill).toBe(false);
  });
});

describe('UsageReportQueryError', () => {
  test('is an Error subclass with stable name/code', () => {
    const err = new UsageReportQueryError('validation', 'bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('UsageReportQueryError');
    expect(err.code).toBe('validation');
  });
});
