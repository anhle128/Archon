import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
  describeUsageState,
  eventOnlyUsageMessage,
  formatMissingMeasures,
  groupLabel,
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

  test('fully ledgered base + zero matched rows → filter-empty (not event-only)', () => {
    expect(
      describeUsageState(
        report({
          totals: emptyMetrics({ recordCount: 0 }),
          groups: [],
          coverage: {
            ...report().coverage,
            hasRecordedUsage: true,
            usageEventCount: 1,
            ledgeredEventCount: 1,
            unledgeredEventCount: 0,
          },
        }),
        false
      )
    ).toBe('filter-empty');
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

  test('partial unledgered with matched rows stays has-data', () => {
    expect(
      describeUsageState(
        report({
          totals: emptyMetrics({ recordCount: 3 }),
          groups: [
            {
              dimensions: { provider: 'anthropic' },
              metrics: emptyMetrics({ recordCount: 3 }),
            },
          ],
          coverage: {
            ...report().coverage,
            hasRecordedUsage: true,
            usageEventCount: 5,
            ledgeredEventCount: 3,
            unledgeredEventCount: 2,
          },
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

describe('groupLabel full grouping tuples', () => {
  test('distinguishes groupBy=model rows that share provider/model but differ by modelSource', () => {
    const reported = groupLabel(
      {
        dimensions: {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          modelSource: 'reported',
        },
        metrics: emptyMetrics(),
      },
      'model'
    );
    const unknown = groupLabel(
      {
        dimensions: {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          modelSource: 'unknown',
        },
        metrics: emptyMetrics(),
      },
      'model'
    );

    expect(reported).toContain('anthropic/claude-sonnet-4');
    expect(reported).toContain('source reported');
    expect(unknown).toContain('anthropic/claude-sonnet-4');
    expect(unknown).toContain('unknown model source');
    expect(reported).not.toBe(unknown);
  });

  test('distinguishes groupBy=node rows that share node id across every fixed dimension', () => {
    const primary = groupLabel(
      {
        dimensions: {
          runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          nodeId: 'implement',
          agentProvider: 'claude',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          modelSource: 'reported',
          kind: null,
        },
        metrics: emptyMetrics(),
      },
      'node'
    );
    const advisor = groupLabel(
      {
        dimensions: {
          runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          nodeId: 'implement',
          agentProvider: 'codex',
          provider: 'openai',
          model: 'gpt-4.1-mini',
          modelSource: 'requested',
          kind: 'advisor',
        },
        metrics: emptyMetrics(),
      },
      'node'
    );

    expect(primary).toContain('implement');
    expect(primary).toContain('run aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(primary).not.toContain('run aaaaaaaa ·');
    expect(primary).toContain('agent claude');
    expect(primary).toContain('anthropic/claude-sonnet-4');
    expect(primary).toContain('source reported');
    expect(primary).toContain('unclassified kind');

    expect(advisor).toContain('implement');
    expect(advisor).toContain('agent codex');
    expect(advisor).toContain('openai/gpt-4.1-mini');
    expect(advisor).toContain('source requested');
    expect(advisor).toContain('kind advisor');
    expect(primary).not.toBe(advisor);
    expect(primary).not.toContain('agent codex');
    expect(advisor).not.toContain('agent claude');
  });

  test('includes every fixed project and run dimension with full runId', () => {
    const project = groupLabel(
      {
        dimensions: { codebaseId: 'cb-1', codebaseName: 'Archon' },
        metrics: emptyMetrics(),
      },
      'project'
    );
    expect(project).toBe('Archon · id cb-1');

    const run = groupLabel(
      {
        dimensions: {
          runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          workflowName: 'feature-dev',
          codebaseId: 'cb-1',
        },
        metrics: emptyMetrics(),
      },
      'run'
    );
    expect(run).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee · feature-dev · project cb-1');
  });

  test('uses explicit non-misleading labels for null/unknown/unclassified dimensions', () => {
    const sparse = groupLabel(
      {
        dimensions: {
          nodeId: null,
          model: null,
          kind: null,
        },
        metrics: emptyMetrics(),
      },
      'node'
    );

    expect(sparse).toContain('(unattributed)');
    expect(sparse).toContain('(unknown run)');
    expect(sparse).toContain('(unknown agent)');
    expect(sparse).toContain('(unknown provider)/(unknown model)');
    expect(sparse).toContain('unknown model source');
    expect(sparse).toContain('unclassified kind');
  });
});

describe('UsageBreakdownTable rendered group labels', () => {
  test('groupBy=model table renders distinct labels for same provider/model different modelSource', () => {
    const modelReport = report({
      groupBy: 'model',
      totals: emptyMetrics({
        reportedUsd: 0.1,
        estimatedUsd: 0.05,
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
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            modelSource: 'reported',
          },
          metrics: emptyMetrics({ reportedUsd: 0.1, recordCount: 1 }),
        },
        {
          dimensions: {
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            modelSource: 'unknown',
          },
          metrics: emptyMetrics({ estimatedUsd: 0.05, recordCount: 1 }),
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: modelReport }))
    );

    expect(markup).toContain('anthropic/claude-sonnet-4 · source reported');
    expect(markup).toContain('anthropic/claude-sonnet-4 · unknown model source');
    expect(markup).toContain('$0.10');
    expect(markup).toContain('≈$0.05');
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
            runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            nodeId: 'implement',
            agentProvider: 'claude',
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
            runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            nodeId: 'implement',
            agentProvider: 'codex',
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

    // Both exact rows retained with distinct full-tuple labels (US-022).
    expect(markup).toContain('Usage · implement');
    expect(markup).toContain('run aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(markup).toContain('agent claude');
    expect(markup).toContain('agent codex');
    expect(markup).toContain('anthropic/claude-sonnet-4');
    expect(markup).toContain('source reported');
    expect(markup).toContain('unclassified kind');
    expect(markup).toContain('openai/gpt-4.1-mini');
    expect(markup).toContain('source requested');
    expect(markup).toContain('kind advisor');
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

  test('fully ledgered filter miss renders No groups matched filters only', () => {
    const filterMiss = report({
      totals: emptyMetrics({ recordCount: 0 }),
      groups: [],
      coverage: {
        ...report().coverage,
        usageEventCount: 1,
        ledgeredEventCount: 1,
        unledgeredEventCount: 0,
        hasRecordedUsage: true,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: filterMiss }))
    );

    expect(markup).toContain('data-usage-state="filter-empty"');
    expect(markup).toContain('No groups matched filters');
    expect(markup).not.toContain('Incomplete usage coverage');
    expect(markup).not.toContain('event-only');
    expect(markup).not.toContain('No usage recorded');
  });

  test('partial coverage warns exactly unledgered count, not total events', () => {
    const partial = report({
      groupBy: 'provider',
      totals: emptyMetrics({
        recordCount: 3,
        reportedUsd: 0.1,
        estimatedUsd: null,
      }),
      groups: [
        {
          dimensions: { provider: 'anthropic' },
          metrics: emptyMetrics({ recordCount: 3, reportedUsd: 0.1 }),
        },
      ],
      coverage: {
        ...report().coverage,
        usageEventCount: 5,
        ledgeredEventCount: 3,
        unledgeredEventCount: 2,
        hasRecordedUsage: true,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(UsageBreakdownTable, { report: partial }))
    );

    expect(markup).toContain('data-usage-state="partial-unledgered"');
    expect(markup).toContain('2 usage events lack ledger rows');
    expect(markup).toContain('3/5 ledgered');
    expect(markup).toContain('2 unledgered');
    expect(markup).not.toContain('5 usage events lack ledger rows');
    expect(eventOnlyUsageMessage(partial.coverage)).toBe(
      '2 usage events recorded without ledger rows (event-only fallback). Totals are incomplete and under-counted.'
    );
    expect(eventOnlyUsageMessage(partial.coverage)).not.toContain('5 usage events');
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
    expect(markup).not.toContain('No groups matched filters');
  });

  test('node-ledger presentation keeps groups and labels run-wide coverage separately', () => {
    const nodeLocal = report({
      groupBy: 'node',
      totals: emptyMetrics({
        reportedUsd: 0.2,
        estimatedUsd: null,
        recordCount: 1,
        tokensInput: 100,
      }),
      groups: [
        {
          dimensions: {
            runId: 'run-a',
            nodeId: 'node-a',
            agentProvider: 'claude',
            provider: 'anthropic',
            model: 'sonnet',
            modelSource: 'reported',
            kind: null,
          },
          metrics: emptyMetrics({
            reportedUsd: 0.2,
            recordCount: 1,
            tokensInput: 100,
          }),
        },
      ],
      // Synthetic node coverage must not claim local under-count.
      coverage: {
        ...report().coverage,
        usageEventCount: 0,
        ledgeredEventCount: 0,
        unledgeredEventCount: 0,
        hasRecordedUsage: true,
      },
    });

    const runWide = {
      usageEventCount: 4,
      ledgeredEventCount: 3,
      unledgeredEventCount: 1,
      hasRecordedUsage: true,
      historicalBackfill: false as const,
      filterScope: 'date-project-run-node' as const,
    };

    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(UsageBreakdownTable, {
          report: nodeLocal,
          compact: true,
          title: 'Usage · node-a',
          coveragePresentation: 'node-ledger',
          runWideCoverage: runWide,
        })
      )
    );

    expect(markup).toContain('Usage · node-a');
    expect(markup).toContain('anthropic/sonnet');
    expect(markup).toContain('$0.20');
    expect(markup).toContain('data-coverage-scope="node-ledger"');
    expect(markup).toContain('node ledger rows');
    expect(markup).toContain('data-coverage-scope="run-wide"');
    expect(markup).toContain('data-usage-state="run-wide-unledgered"');
    expect(markup).toContain('Run-wide: 1 usage event lacks ledger rows');
    expect(markup).toContain('not this node local under-count');
    expect(markup).toContain('Run-wide ledger: 3/4 ledgered · 1 unledgered');
    // Must not present run-wide incomplete as this node's local under-count.
    expect(markup).not.toContain('data-usage-state="partial-unledgered"');
    expect(markup).not.toContain('1 usage events lack ledger rows (event-only fallback)');
    expect(markup).not.toContain('Totals under-count until those rows are repaired');
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
