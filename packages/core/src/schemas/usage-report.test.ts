import { describe, expect, test } from 'bun:test';
import {
  usageDimensionsSchema,
  usageGroupBySchema,
  usageLedgerCoverageSchema,
  usageMetricsSchema,
  usageReportSchema,
} from './usage-report';

function sampleMetrics(overrides: Record<string, unknown> = {}) {
  return {
    tokensInput: 10,
    tokensOutput: 5,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: 0.01,
    estimatedUsd: null,
    recordCount: 1,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 1,
    missingTokensCacheRead: 1,
    missingTokensCacheWrite: 1,
    missingRequests: 1,
    rowsMissingUsd: 0,
    ...overrides,
  };
}

describe('usageReportSchema', () => {
  test('accepts a full camelCase report without effective USD', () => {
    const report = usageReportSchema.parse({
      scope: {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        codebaseId: 'cb-1',
        includesChildRollup: false,
      },
      groupBy: 'provider',
      totals: sampleMetrics(),
      groups: [
        {
          dimensions: { provider: 'anthropic' },
          metrics: sampleMetrics({ tokensInput: 0 }),
        },
      ],
      coverage: {
        usageEventCount: 1,
        ledgeredEventCount: 1,
        unledgeredEventCount: 0,
        hasRecordedUsage: true,
        historicalBackfill: false,
        filterScope: 'date-project-run-node',
      },
    });

    expect(report.groupBy).toBe('provider');
    expect(report.scope.includesChildRollup).toBe(false);
    expect(report.totals.tokensInput).toBe(10);
    expect(report.totals.reportedUsd).toBe(0.01);
    expect(report.coverage.filterScope).toBe('date-project-run-node');
    expect('effectiveUsd' in report.totals).toBe(false);
  });

  test('rejects combined effective USD and unknown keys', () => {
    expect(() =>
      usageMetricsSchema.parse({
        ...sampleMetrics(),
        effectiveUsd: 1,
      })
    ).toThrow();
  });

  test('groupBy enum covers the seven planned modes', () => {
    expect(usageGroupBySchema.options).toEqual([
      'agent',
      'provider',
      'model',
      'project',
      'run',
      'day',
      'node',
    ]);
  });

  test('dimensions allow explicit optional fields including null project', () => {
    const dims = usageDimensionsSchema.parse({
      codebaseId: null,
      codebaseName: null,
      model: null,
      kind: null,
    });
    expect(dims.codebaseId).toBeNull();
    expect(dims.model).toBeNull();
  });

  test('coverage locks historicalBackfill false and filterScope', () => {
    expect(() =>
      usageLedgerCoverageSchema.parse({
        usageEventCount: 0,
        ledgeredEventCount: 0,
        unledgeredEventCount: 0,
        hasRecordedUsage: false,
        historicalBackfill: true,
        filterScope: 'date-project-run-node',
      })
    ).toThrow();
  });
});
