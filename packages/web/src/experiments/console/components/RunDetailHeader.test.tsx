process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { RunDetailHeader } from './RunDetailHeader';
import type { Run } from '../primitives/run';
import type { UsageReport } from '../skills/usage';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';

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
    envOverlay: null,
    ...overrides,
  };
}

function renderHeader(props: {
  usage: UsageReport | null;
  runOverrides?: Partial<Run>;
  askAwaiting?: boolean;
  onAwaitingInput?: () => void;
}): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(RunDetailHeader, {
        run: run(props.runOverrides),
        projectName: 'demo',
        projectId: 'proj-1',
        usage: props.usage,
        askAwaiting: props.askAwaiting,
        onAwaitingInput: props.onAwaitingInput,
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

describe('RunDetailHeader Ask pause copy', () => {
  test('uses Awaiting input only for an Ask pause', () => {
    const ask = renderHeader({
      usage: usage(),
      runOverrides: { status: 'paused' },
      askAwaiting: true,
    });
    expect(ask).toContain('Awaiting input');
    expect(ask).not.toContain('Waiting for approval');

    const gate = renderHeader({
      usage: usage(),
      runOverrides: { status: 'paused' },
      askAwaiting: false,
    });
    expect(gate).toContain('Waiting for approval');
    expect(gate).not.toContain('Awaiting input');
  });

  test('renders Awaiting input as a button that invokes onAwaitingInput', async () => {
    const react = await import('react');
    const reactDomClient = await import('react-dom/client');
    const act = react.act;
    const createRoot = reactDomClient.createRoot;
    const win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    const host = el as unknown as Element;
    const root: Root = createRoot(host);
    const clicks: number[] = [];
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(RunDetailHeader, {
            run: run({ status: 'paused' }),
            projectName: 'demo',
            projectId: 'proj-1',
            usage: usage(),
            askAwaiting: true,
            onAwaitingInput: (): void => {
              clicks.push(1);
            },
          })
        )
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const awaiting = [...host.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === 'Awaiting input'
    );
    expect(awaiting).not.toBeUndefined();
    await act(async () => {
      (awaiting as unknown as HTMLButtonElement).click();
    });
    expect(clicks).toEqual([1]);
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  test('paused approval status is not an Ask button', () => {
    const gate = renderHeader({
      usage: usage(),
      runOverrides: { status: 'paused' },
      askAwaiting: false,
      onAwaitingInput: (): void => undefined,
    });
    expect(gate).toContain('>Waiting for approval</span>');
    expect(gate).not.toContain('Awaiting input');
    expect(gate).not.toContain('>Waiting for approval</button>');
  });

  test('completed status is not a button', () => {
    const markup = renderHeader({
      usage: usage(),
      runOverrides: { status: 'completed' },
      onAwaitingInput: (): void => undefined,
    });
    expect(markup).toContain('>Completed</span>');
    expect(markup).not.toContain('>Completed</button>');
  });
});

describe('RunDetailHeader ENV chip', () => {
  test('renders env: name chip for pending or complete overlay', () => {
    const pending = renderHeader({
      usage: usage(),
      runOverrides: {
        envOverlay: {
          envId: 'e1',
          envName: 'fast',
          workflowName: 'archon-dev',
          complete: false,
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: null,
        },
      },
    });
    expect(pending).toContain('env: fast');
    expect(pending).toContain('data-testid="run-env-chip"');

    const none = renderHeader({ usage: usage() });
    expect(none).not.toContain('run-env-chip');
  });
});
