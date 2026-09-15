process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import { roomOpenerId } from '@/lib/execution-room-model';

import { StreamContextProvider } from '../lib/stream-context';
import type { UsageMetrics, UsageReport, UsageReportGroup } from '../skills/usage';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { aggregateUsageMetrics } from './RunStream';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const nodeDivider = await import('./NodeDivider');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

function emptyMetrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
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

function group(
  dims: UsageReportGroup['dimensions'],
  metrics: Partial<UsageMetrics> = {}
): UsageReportGroup {
  return { dimensions: dims, metrics: emptyMetrics(metrics) };
}

function nodeReport(groups: UsageReportGroup[]): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'node',
    totals: aggregateUsageMetrics(groups),
    groups,
    coverage: {
      usageEventCount: 0,
      ledgeredEventCount: 0,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
  };
}

function requireHtmlElement(value: Element | null, label: string): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(label);
  }
  return value;
}

function requireButton(value: Element | null, label: string): HTMLButtonElement {
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error(label);
  }
  return value;
}

describe('NodeDivider', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  function renderDivider(
    overrides: Partial<Parameters<typeof nodeDivider.NodeDivider>[0]> = {}
  ): void {
    const usageGroup = group(
      { nodeId: 'plan', provider: 'anthropic', model: 'sonnet', modelSource: 'reported' },
      { reportedUsd: 0.25, estimatedUsd: 0.3, recordCount: 1 }
    );
    const usageGroups = [usageGroup];
    root.render(
      createElement(StreamContextProvider, {
        value: { runStartedAt: '2026-06-05T10:00:00Z' },
        children: createElement(nodeDivider.NodeDivider, {
          rowId: 'plan-start',
          nodeId: 'plan',
          nodeName: 'Plan',
          selected: false,
          onSelect: (): void => undefined,
          status: 'completed',
          durationMs: 1000,
          timestamp: '2026-06-05T10:00:01Z',
          costUsd: 0.25,
          numTurns: 2,
          stopReason: 'end_turn',
          skipReason: null,
          skipExpr: null,
          showDetail: true,
          hasLedgerUsage: true,
          reportedUsd: 0.25,
          estimatedUsd: 0.3,
          usageGroups,
          usageAggregate: aggregateUsageMetrics(usageGroups),
          runUsage: nodeReport(usageGroups),
          ...overrides,
        }),
      })
    );
  }

  test('clicking the identity control reports rowId and nodeId', async () => {
    const selected: [string, string][] = [];
    await act(async () => {
      renderDivider({
        onSelect: (rowId: string, nodeId: string): void => {
          selected.push([rowId, nodeId]);
        },
      });
    });

    const row = requireHtmlElement(host.querySelector('#node-transition-plan-start'), 'row root');
    const identity = requireButton(row.querySelector('button'), 'identity');
    expect(identity.id).toBe(roomOpenerId('console', 'log', 'plan-start'));
    expect(row.id).toBe('node-transition-plan-start');
    await act(async () => {
      identity.click();
    });
    expect(selected).toEqual([['plan-start', 'plan']]);
  });

  test('selected rows expose aria-current true and pending status is allowed', async () => {
    await act(async () => {
      renderDivider({ selected: true, status: 'pending' });
    });

    const identity = requireButton(
      host.querySelector('#node-transition-plan-start button'),
      'identity'
    );
    expect(identity.getAttribute('aria-current')).toBe('true');
    expect(host.textContent).toContain('pending');
    expect(host.textContent).toContain('Plan');
  });

  test('usage expansion stays separately operable from row selection', async () => {
    const selected: [string, string][] = [];
    await act(async () => {
      renderDivider({
        onSelect: (rowId: string, nodeId: string): void => {
          selected.push([rowId, nodeId]);
        },
      });
    });

    const row = requireHtmlElement(host.querySelector('#node-transition-plan-start'), 'row root');
    const buttons = [...row.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    const chevron = requireButton(buttons[1] ?? null, 'usage chevron');
    expect(chevron.getAttribute('aria-label')).toBe('Show usage breakdown for this node');
    expect(host.textContent).not.toContain('Usage · Plan');

    await act(async () => {
      chevron.click();
    });
    expect(selected).toEqual([]);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Usage · Plan');
    expect(host.textContent).toContain('node ledger rows');

    const identity = requireButton(buttons[0] ?? null, 'identity');
    await act(async () => {
      identity.click();
    });
    expect(selected).toEqual([['plan-start', 'plan']]);
    expect(host.textContent).toContain('Usage · Plan');
  });

  test('renders awaiting as warning waiting-on-you chrome', async () => {
    await act(async () => {
      renderDivider({ status: 'awaiting' });
    });
    const status = [...host.querySelectorAll('span')].find(
      item => (item.textContent ?? '').trim() === 'waiting on you · 00:01 · $0.25 / ≈$0.30 · 2t'
    );
    expect(status).toBeDefined();
    expect(status?.className).toContain('text-warning');
  });
});
