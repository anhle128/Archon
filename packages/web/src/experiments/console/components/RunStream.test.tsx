import { describe, test, expect } from 'bun:test';
import {
  aggregateUsageMetrics,
  collectUsageByNode,
  pairToolEvents,
  sumNullableMetric,
} from './RunStream';
import { toRunEvent } from '../primitives/event';
import type { UsageMetrics, UsageReport, UsageReportGroup } from '../skills/usage';

type Raw = Parameters<typeof toRunEvent>[0];

function raw(over: Partial<Raw> & { event_type: string }): Raw {
  return {
    id: 'e1',
    workflow_run_id: 'r1',
    step_index: null,
    step_name: 'node-a',
    data: {},
    created_at: '2026-06-05T10:00:00Z',
    ...over,
  };
}

describe('pairToolEvents — node identity threading', () => {
  test('each paired call carries its source event nodeId (step_name) + duration', () => {
    const events = [
      toRunEvent(
        raw({
          id: 's1',
          event_type: 'tool_called',
          step_name: 'plan',
          data: { tool_name: 'Read', tool_input: { path: 'a' } },
        })
      ),
      toRunEvent(
        raw({
          id: 'c1',
          event_type: 'tool_completed',
          step_name: 'plan',
          data: { tool_name: 'Read', duration_ms: 120 },
        })
      ),
      toRunEvent(
        raw({
          id: 's2',
          event_type: 'tool_called',
          step_name: 'implement',
          data: { tool_name: 'Bash', tool_input: { cmd: 'ls' } },
        })
      ),
      toRunEvent(
        raw({
          id: 'c2',
          event_type: 'tool_completed',
          step_name: 'implement',
          data: { tool_name: 'Bash', duration_ms: 300 },
        })
      ),
    ];

    const paired = pairToolEvents(events);
    expect(paired).toHaveLength(2);
    const byId = new Map(paired.map(p => [p.id, p]));
    expect(byId.get('s1')?.nodeId).toBe('plan');
    expect(byId.get('s1')?.call.durationMs).toBe(120);
    expect(byId.get('s2')?.nodeId).toBe('implement');
    expect(byId.get('s2')?.call.durationMs).toBe(300);
  });

  test('a tool_called with a null step_name stays unattributed (nodeId null)', () => {
    const paired = pairToolEvents([
      toRunEvent(
        raw({ id: 's1', event_type: 'tool_called', step_name: null, data: { tool_name: 'Read' } })
      ),
    ]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.nodeId).toBeNull();
  });
});

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
    scope: { from: null, to: null, includesChildRollup: false, runId: 'run-1' },
    groupBy: 'node',
    totals: emptyMetrics(),
    groups,
    coverage: {
      usageEventCount: groups.length,
      ledgeredEventCount: groups.length,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
  };
}

describe('sumNullableMetric', () => {
  test('all-null stays null; zero stays zero; present values sum', () => {
    expect(sumNullableMetric(null, null)).toBeNull();
    expect(sumNullableMetric(0, null)).toBe(0);
    expect(sumNullableMetric(null, 0)).toBe(0);
    expect(sumNullableMetric(1.5, 0.5)).toBe(2);
    expect(sumNullableMetric(null, 3)).toBe(3);
  });
});

describe('aggregateUsageMetrics', () => {
  test('preserves missingness and sums known zeros, values, and counters', () => {
    const a = group(
      { nodeId: 'plan', provider: 'anthropic', model: 'sonnet', modelSource: 'reported' },
      {
        tokensInput: null,
        tokensOutput: 0,
        reportedUsd: 0.1,
        estimatedUsd: null,
        recordCount: 1,
        missingTokensInput: 1,
        rowsMissingUsd: 0,
      }
    );
    const b = group(
      {
        nodeId: 'plan',
        provider: 'openai',
        model: 'gpt-4.1',
        modelSource: 'requested',
        kind: 'advisor',
      },
      {
        tokensInput: null,
        tokensOutput: 40,
        reportedUsd: null,
        estimatedUsd: 0.004,
        recordCount: 2,
        missingTokensInput: 2,
        rowsMissingUsd: 1,
        requests: 0,
      }
    );

    const agg = aggregateUsageMetrics([a, b]);
    expect(agg.tokensInput).toBeNull();
    expect(agg.tokensOutput).toBe(40);
    expect(agg.reportedUsd).toBe(0.1);
    expect(agg.estimatedUsd).toBe(0.004);
    expect(agg.recordCount).toBe(3);
    expect(agg.missingTokensInput).toBe(3);
    expect(agg.rowsMissingUsd).toBe(1);
    expect(agg.requests).toBe(0);
  });

  test('empty groups → empty null metrics', () => {
    const agg = aggregateUsageMetrics([]);
    expect(agg.tokensInput).toBeNull();
    expect(agg.reportedUsd).toBeNull();
    expect(agg.recordCount).toBe(0);
  });
});

describe('collectUsageByNode', () => {
  test('two API groups sharing nodeId keep both rows and cumulative totals', () => {
    const primary = group(
      {
        nodeId: 'implement',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelSource: 'reported',
        kind: null,
      },
      { reportedUsd: 0.2, estimatedUsd: null, tokensInput: 100, recordCount: 1 }
    );
    const advisor = group(
      {
        nodeId: 'implement',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        modelSource: 'requested',
        kind: 'advisor',
      },
      { reportedUsd: null, estimatedUsd: 0.05, tokensInput: 50, recordCount: 1 }
    );
    const other = group(
      { nodeId: 'plan', provider: 'anthropic', model: 'haiku', modelSource: 'reported' },
      { reportedUsd: 0.01, recordCount: 1 }
    );

    const map = collectUsageByNode(nodeReport([primary, advisor, other]));
    expect(map.size).toBe(2);

    const implement = map.get('implement');
    expect(implement).toBeDefined();
    if (implement === undefined) {
      throw new Error('expected implement node usage collection');
    }
    expect(implement.groups).toHaveLength(2);
    expect(implement.groups).toEqual([primary, advisor]);
    expect(implement.aggregate.reportedUsd).toBe(0.2);
    expect(implement.aggregate.estimatedUsd).toBe(0.05);
    expect(implement.aggregate.tokensInput).toBe(150);
    expect(implement.aggregate.recordCount).toBe(2);

    // Provider/model/source/kind siblings are not discarded by node id overwrite.
    expect(implement.groups[0]?.dimensions.provider).toBe('anthropic');
    expect(implement.groups[1]?.dimensions.provider).toBe('openai');
    expect(implement.groups[1]?.dimensions.kind).toBe('advisor');

    const plan = map.get('plan');
    expect(plan?.groups).toHaveLength(1);
    expect(plan?.aggregate.reportedUsd).toBe(0.01);
  });

  test('non-node groupBy or null usage yields empty map', () => {
    expect(collectUsageByNode(null).size).toBe(0);
    expect(
      collectUsageByNode({
        ...nodeReport([]),
        groupBy: 'provider',
        groups: [group({ provider: 'anthropic', nodeId: 'x' }, { recordCount: 1 })],
      }).size
    ).toBe(0);
  });

  test('blank nodeId groups are skipped', () => {
    const map = collectUsageByNode(
      nodeReport([
        group({ nodeId: null, provider: 'anthropic' }, { recordCount: 1 }),
        group({ nodeId: '', provider: 'openai' }, { recordCount: 1 }),
        group({ nodeId: 'ok', provider: 'anthropic' }, { reportedUsd: 1, recordCount: 1 }),
      ])
    );
    expect(map.size).toBe(1);
    expect(map.get('ok')?.groups).toHaveLength(1);
  });
});
