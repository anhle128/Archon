import { describe, expect, test } from 'bun:test';
import {
  USAGE_INSTANT_PRECISION_MESSAGE,
  USAGE_INSTANT_SHAPE_MESSAGE,
  usageDimensionsSchema,
  usageGroupBySchema,
  usageInstantStringSchema,
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

describe('usageInstantStringSchema', () => {
  test('accepts no fraction and 1–3 fractional digits with Z or numeric offsets', () => {
    const accepted = [
      '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00.1Z',
      '2026-09-01T00:00:00.12Z',
      '2026-09-01T00:00:00.123Z',
      '2026-09-01T00:00:00+00:00',
      '2026-09-01T00:00:00.5+00:00',
      '2026-09-01T05:30:00.12+05:30',
      '2026-09-01T07:00:00.500+07:00',
      '2026-08-31T19:00:00.250-05:00',
      '2028-02-29T00:00:00.000Z',
    ];
    for (const value of accepted) {
      const parsed = usageInstantStringSchema.safeParse(value);
      expect(parsed.success, value).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toBe(value);
        // Lossless vs JS Date millisecond path — no silent truncate/round.
        const ms = new Date(value).getTime();
        expect(Number.isNaN(ms), value).toBe(false);
        expect(new Date(ms).toISOString()).toBe(new Date(value).toISOString());
      }
    }
  });

  test('equivalent offsets resolve to the same UTC millisecond', () => {
    const pairs: Array<[string, string]> = [
      ['2026-09-01T00:00:00Z', '2026-09-01T00:00:00+00:00'],
      ['2026-09-01T00:00:00.5Z', '2026-09-01T07:00:00.5+07:00'],
      ['2026-09-01T00:00:00.12Z', '2026-09-01T00:00:00.120+00:00'],
      ['2026-09-01T00:00:00.123Z', '2026-08-31T19:00:00.123-05:00'],
    ];
    for (const [a, b] of pairs) {
      expect(usageInstantStringSchema.safeParse(a).success).toBe(true);
      expect(usageInstantStringSchema.safeParse(b).success).toBe(true);
      expect(new Date(a).getTime()).toBe(new Date(b).getTime());
    }
  });

  test('rejects 4+, 6+, and 9-digit fractions before Date parsing', () => {
    const rejected = [
      '2026-09-01T00:00:00.0004Z',
      '2026-09-01T00:00:00.0005Z',
      '2026-09-01T00:00:00.1234Z',
      '2026-09-01T00:00:00.123456Z',
      '2026-09-01T00:00:00.123456789Z',
      '2026-09-01T00:00:00.0004+00:00',
      '2026-09-01T05:30:00.123456+05:30',
    ];
    for (const value of rejected) {
      const parsed = usageInstantStringSchema.safeParse(value);
      expect(parsed.success, value).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe(USAGE_INSTANT_PRECISION_MESSAGE);
      }
    }
    // 0004 and 0005 would both collapse to the same Date ms if accepted —
    // the schema must reject them so they never reach Date/SQL.
    expect(new Date('2026-09-01T00:00:00.0004Z').getTime()).toBe(
      new Date('2026-09-01T00:00:00.0005Z').getTime()
    );
  });

  test('rejects date-only, zone-less, invalid offset, and calendar-rollover forms', () => {
    const rejected = [
      '2026-09-01',
      '09/01/2026',
      '2026-09-01T00:00:00',
      '2026-09-01T00:00:00+0000',
      '2026-09-01T00:00:00+00',
      '2026-02-29T00:00:00.000Z',
      '2026-02-30T00:00:00.000Z',
      '2026-04-31T00:00:00.000Z',
    ];
    for (const value of rejected) {
      const parsed = usageInstantStringSchema.safeParse(value);
      expect(parsed.success, value).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe(USAGE_INSTANT_SHAPE_MESSAGE);
      }
    }
  });
});
