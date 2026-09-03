import { describe, expect, test } from 'bun:test';
import { describeUsageState } from './UsageBreakdownTable';
import type { UsageReport } from '../skills/usage';
import { formatUsdAmount } from '../lib/format';

function emptyMetrics(overrides: Partial<UsageReport['totals']> = {}): UsageReport['totals'] {
  return {
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: null,
    estimatedUsd: null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
    ...overrides,
  };
}

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'provider',
    totals: emptyMetrics(),
    groups: [],
    coverage: {
      usageEventCount: 0,
      ledgeredEventCount: 0,
      unledgeredEventCount: 0,
      hasRecordedUsage: false,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
    ...overrides,
  };
}

describe('describeUsageState', () => {
  test('null report or unavailable flag → unavailable (not zero)', () => {
    expect(describeUsageState(null, false)).toBe('unavailable');
    expect(describeUsageState(report(), true)).toBe('unavailable');
  });

  test('hasRecordedUsage false → not-recorded (not zero)', () => {
    expect(
      describeUsageState(
        report({ coverage: { ...report().coverage, hasRecordedUsage: false } }),
        false
      )
    ).toBe('not-recorded');
  });

  test('recorded usage with rows → has-data', () => {
    expect(
      describeUsageState(
        report({
          totals: emptyMetrics({ recordCount: 2, reportedUsd: 0, estimatedUsd: 0.004 }),
          coverage: {
            ...report().coverage,
            hasRecordedUsage: true,
            usageEventCount: 2,
            ledgeredEventCount: 2,
          },
          groups: [
            {
              dimensions: { provider: 'anthropic' },
              metrics: emptyMetrics({ recordCount: 2, reportedUsd: 0, estimatedUsd: 0.004 }),
            },
          ],
        }),
        false
      )
    ).toBe('has-data');
  });
});

describe('formatUsdAmount display rules (shared with Cost page)', () => {
  test('distinguishes absent, zero, sub-cent, floor, reported, estimated', () => {
    expect(formatUsdAmount(null, false)).toBe('n/a');
    expect(formatUsdAmount(0, false)).toBe('$0.00');
    expect(formatUsdAmount(0, true)).toBe('≈$0.00');
    expect(formatUsdAmount(0.004, false)).toBe('$0.004');
    expect(formatUsdAmount(0.004, true)).toBe('≈$0.004');
    expect(formatUsdAmount(1e-9, false)).toBe('<$0.000001');
    expect(formatUsdAmount(1.25, false)).toBe('$1.25');
    expect(formatUsdAmount(1.25, true)).toBe('≈$1.25');
  });
});
