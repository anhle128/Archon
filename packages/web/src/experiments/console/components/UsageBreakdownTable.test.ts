import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
  describeUsageState,
  eventOnlyUsageMessage,
  formatMissingMeasures,
  UsageBreakdownTable,
} from './UsageBreakdownTable';

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

  test('recorded events with zero ledger rows → event-only (not empty)', () => {
    expect(
      describeUsageState(
        report({
          totals: emptyMetrics({ recordCount: 0 }),
          coverage: {
            ...report().coverage,
            hasRecordedUsage: true,
            usageEventCount: 2,
            ledgeredEventCount: 0,
            unledgeredEventCount: 2,
          },
          groups: [],
        }),
        false
      )
    ).toBe('event-only');
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

describe('UsageBreakdownTable multi-row node expansion', () => {
  test('two groups sharing one nodeId both render with cumulative totals', () => {
    const multiNodeReport = report({
      groupBy: 'node',
      totals: emptyMetrics({
        reportedUsd: 0.2,
        estimatedUsd: 0.05,
        tokensInput: 150,
        recordCount: 2,
      }),
      coverage: {
        ...report().coverage,
        hasRecordedUsage: true,
        usageEventCount: 2,
        ledgeredEventCount: 2,
      },
      groups: [
        {
          dimensions: {
            nodeId: 'implement',
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            modelSource: 'reported',
            kind: null,
          },
          metrics: emptyMetrics({
            reportedUsd: 0.2,
            estimatedUsd: null,
            tokensInput: 100,
            recordCount: 1,
          }),
        },
        {
          dimensions: {
            nodeId: 'implement',
            provider: 'openai',
            model: 'gpt-4.1-mini',
            modelSource: 'requested',
            kind: 'advisor',
          },
          metrics: emptyMetrics({
            reportedUsd: null,
            estimatedUsd: 0.05,
            tokensInput: 50,
            recordCount: 1,
          }),
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(UsageBreakdownTable, {
          compact: true,
          title: 'Usage · implement',
          report: multiNodeReport,
        })
      )
    );

    // Both exact rows retained (same node label twice is expected until US-022).
    expect(markup).toContain('Usage · implement');
    expect((markup.match(/implement/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Cumulative totals strip + totals row.
    expect(markup).toContain('$0.20');
    expect(markup).toContain('≈$0.05');
    expect(markup).toContain('150');
    // Per-row metrics still present (not collapsed into one overwrite).
    expect(markup).toContain('n/a'); // missing reported on advisor row
    expect(markup).toContain('100');
    expect(markup).toContain('50');
  });
});

describe('UsageBreakdownTable event-only and coverage', () => {
  test('event-only fallback warns incomplete and never says No usage recorded', () => {
    const eventOnly = report({
      totals: emptyMetrics({ recordCount: 0 }),
      groups: [],
      coverage: {
        ...report().coverage,
        usageEventCount: 3,
        ledgeredEventCount: 0,
        unledgeredEventCount: 3,
        hasRecordedUsage: true,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: eventOnly }))
    );

    expect(markup).toContain('data-usage-state="event-only"');
    expect(markup).toContain('Incomplete usage coverage');
    expect(markup).toContain('event-only fallback');
    expect(markup).toContain('under-counted');
    expect(markup).toContain('0/3 ledgered');
    expect(markup).toContain('3 unledgered');
    expect(markup).not.toContain('No usage recorded');
    expect(eventOnlyUsageMessage(eventOnly.coverage)).toContain('3 usage events');
  });

  test('historical zero-event runs still render not-recorded empty state', () => {
    const historical = report({
      totals: emptyMetrics({ recordCount: 0 }),
      groups: [],
      coverage: {
        ...report().coverage,
        usageEventCount: 0,
        ledgeredEventCount: 0,
        unledgeredEventCount: 0,
        hasRecordedUsage: false,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: historical }))
    );

    expect(markup).toContain('No usage recorded');
    expect(markup).not.toContain('event-only');
    expect(markup).not.toContain('Incomplete usage coverage');
  });

  test('totals and groups expose every missing counter separate from unpriced and ledger', () => {
    const withMissing = report({
      groupBy: 'provider',
      totals: emptyMetrics({
        recordCount: 2,
        reportedUsd: 0,
        estimatedUsd: 0.004,
        rowsMissingUsd: 1,
        missingTokensInput: 2,
        missingTokensOutput: 1,
        missingTokensReasoning: 3,
        missingTokensCacheRead: 4,
        missingTokensCacheWrite: 5,
        missingRequests: 6,
      }),
      coverage: {
        ...report().coverage,
        hasRecordedUsage: true,
        usageEventCount: 2,
        ledgeredEventCount: 2,
        unledgeredEventCount: 0,
      },
      groups: [
        {
          dimensions: { provider: 'anthropic' },
          metrics: emptyMetrics({
            recordCount: 1,
            reportedUsd: 0,
            rowsMissingUsd: 0,
            missingTokensInput: 1,
            missingTokensOutput: 0,
            missingTokensReasoning: 1,
            missingTokensCacheRead: 2,
            missingTokensCacheWrite: 2,
            missingRequests: 3,
          }),
        },
        {
          dimensions: { provider: 'openai' },
          metrics: emptyMetrics({
            recordCount: 1,
            estimatedUsd: 0.004,
            rowsMissingUsd: 1,
            missingTokensInput: 1,
            missingTokensOutput: 1,
            missingTokensReasoning: 2,
            missingTokensCacheRead: 2,
            missingTokensCacheWrite: 3,
            missingRequests: 3,
          }),
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: withMissing }))
    );

    const totalsMissing = formatMissingMeasures(withMissing.totals);
    expect(totalsMissing).toBe('in:2 out:1 reason:3 cacheR:4 cacheW:5 req:6');
    expect(markup).toContain('Missing measures');
    expect(markup).toContain(totalsMissing);
    expect(markup).toContain('Missing'); // column header
    expect(markup).toContain(formatMissingMeasures(withMissing.groups[0]!.metrics));
    expect(markup).toContain(formatMissingMeasures(withMissing.groups[1]!.metrics));
    // Unpriced and ledger remain distinct labels/values.
    expect(markup).toContain('Unpriced rows');
    expect(markup).toContain('Ledger coverage');
    expect(markup).toContain('2/2 ledgered');
    // Known zero reported + small estimated still format correctly.
    expect(markup).toContain('$0.00');
    expect(markup).toContain('≈$0.004');
  });
});
