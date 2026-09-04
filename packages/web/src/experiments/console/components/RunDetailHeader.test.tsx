import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { RunDetailHeader } from './RunDetailHeader';
import type { Run } from '../primitives/run';
import type { UsageReport } from '../skills/usage';

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

function usage(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'node',
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

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    projectId: 'proj-1',
    projectName: 'demo',
    costUsd: null,
    conversationId: null,
    conversationPlatformId: null,
    workerPlatformId: null,
    workflow: 'archon-dev',
    origin: 'cli',
    status: 'completed',
    startedAt: '2026-09-04T10:00:00Z',
    finishedAt: '2026-09-04T10:05:00Z',
    workingPath: null,
    userMessage: 'ship it',
    ...overrides,
  };
}

function renderHeader(props: { usage: UsageReport | null; runOverrides?: Partial<Run> }): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(RunDetailHeader, {
        run: run(props.runOverrides),
        projectName: 'demo',
        projectId: 'proj-1',
        usage: props.usage,
      })
    )
  );
}

describe('RunDetailHeader usage states', () => {
  test('event-only (no ledger groups) surfaces incomplete warning, not not-recorded', () => {
    const markup = renderHeader({
      usage: usage({
        totals: emptyMetrics({ recordCount: 0 }),
        groups: [],
        coverage: {
          usageEventCount: 2,
          ledgeredEventCount: 0,
          unledgeredEventCount: 2,
          hasRecordedUsage: true,
          historicalBackfill: false,
          filterScope: 'date-project-run-node',
        },
      }),
      // Legacy cost present must NOT replace the event-only warning.
      runOverrides: { costUsd: 1.23 },
    });

    expect(markup).toContain('data-usage-state="event-only"');
    expect(markup).toContain('incomplete · event-only');
    expect(markup).not.toContain('not recorded');
    expect(markup).not.toContain('legacy total');
  });

  test('historical zero-event runs still show not recorded', () => {
    const markup = renderHeader({
      usage: usage({
        coverage: {
          usageEventCount: 0,
          ledgeredEventCount: 0,
          unledgeredEventCount: 0,
          hasRecordedUsage: false,
          historicalBackfill: false,
          filterScope: 'date-project-run-node',
        },
      }),
    });

    expect(markup).toContain('data-usage-state="not-recorded"');
    expect(markup).toContain('not recorded');
    expect(markup).not.toContain('event-only');
  });

  test('ledgered direct usage keeps reported/estimated formatting and incomplete badge when partial', () => {
    const markup = renderHeader({
      usage: usage({
        totals: emptyMetrics({
          recordCount: 1,
          reportedUsd: 0,
          estimatedUsd: 0.004,
        }),
        groups: [
          {
            dimensions: { nodeId: 'implement' },
            metrics: emptyMetrics({ recordCount: 1, reportedUsd: 0, estimatedUsd: 0.004 }),
          },
        ],
        coverage: {
          usageEventCount: 2,
          ledgeredEventCount: 1,
          unledgeredEventCount: 1,
          hasRecordedUsage: true,
          historicalBackfill: false,
          filterScope: 'date-project-run-node',
        },
      }),
    });

    expect(markup).toContain('$0.00');
    expect(markup).toContain('≈$0.004');
    expect(markup).toContain('direct');
    expect(markup).toContain('data-usage-state="partial-unledgered"');
    expect(markup).toContain('incomplete');
  });

  test('usage null is unavailable warning', () => {
    const markup = renderHeader({ usage: null });
    expect(markup).toContain('usage unavailable');
    expect(markup).not.toContain('not recorded');
    expect(markup).not.toContain('event-only');
  });

  test('non-null no-history usage report renders legacy $0.00 with legacy total label', () => {
    const markup = renderHeader({
      usage: usage({
        coverage: {
          usageEventCount: 0,
          ledgeredEventCount: 0,
          unledgeredEventCount: 0,
          hasRecordedUsage: false,
          historicalBackfill: false,
          filterScope: 'date-project-run-node',
        },
      }),
      runOverrides: { costUsd: 0 },
    });

    expect(markup).toContain('$0.00');
    expect(markup).toContain('legacy total');
    expect(markup).not.toContain('not recorded');
    expect(markup).not.toContain('data-usage-state="not-recorded"');
  });

  test('ledgered reported zero takes precedence over legacy run total', () => {
    const markup = renderHeader({
      usage: usage({
        totals: emptyMetrics({ recordCount: 1, reportedUsd: 0, estimatedUsd: null }),
        groups: [
          {
            dimensions: { nodeId: 'implement' },
            metrics: emptyMetrics({ recordCount: 1, reportedUsd: 0 }),
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
      }),
      runOverrides: { costUsd: 0 },
    });

    expect(markup).toContain('$0.00');
    expect(markup).toContain('direct');
    expect(markup).not.toContain('legacy total');
  });
});
