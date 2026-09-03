/**
 * Tests for `archon usage` — formatting, flag→query mapping, JSON stdout,
 * coverage warning, and core query error surfaces.
 *
 * Injects `queryFn` so this file never opens a real DB and never needs
 * `mock.module()` (process-global / irreversible in Bun).
 */
import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { UsageReportQueryError, type UsageReportQuery } from '@archon/core/db/usage-report';
import type { UsageMetrics, UsageReport } from '@archon/core/schemas/usage-report';
import { formatUsdAmount, usageCommand, type UsageQueryFn } from './usage';

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

function sampleReport(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    scope: {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      includesChildRollup: false,
    },
    groupBy: 'provider',
    totals: emptyMetrics({
      tokensInput: 100,
      tokensOutput: 50,
      requests: 2,
      reportedUsd: 1.25,
      estimatedUsd: 0.004,
      recordCount: 2,
      rowsMissingUsd: 0,
    }),
    groups: [
      {
        dimensions: { provider: 'anthropic' },
        metrics: emptyMetrics({
          tokensInput: 100,
          tokensOutput: 50,
          requests: 2,
          reportedUsd: 1.25,
          estimatedUsd: 0.004,
          recordCount: 2,
        }),
      },
    ],
    coverage: {
      usageEventCount: 2,
      ledgeredEventCount: 2,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
    ...overrides,
  };
}

describe('formatUsdAmount', () => {
  it('renders absent, exact zero, reported, and estimated distinctly', () => {
    expect(formatUsdAmount(null, false)).toBe('n/a');
    expect(formatUsdAmount(undefined, true)).toBe('n/a');
    expect(formatUsdAmount(0, false)).toBe('$0.00');
    expect(formatUsdAmount(0, true)).toBe('≈$0.00');
    expect(formatUsdAmount(1.5, false)).toBe('$1.50');
    expect(formatUsdAmount(0.02, true)).toBe('≈$0.02');
  });

  it('uses up to six decimals below one cent and a floor for tinier positives', () => {
    expect(formatUsdAmount(0.004, false)).toBe('$0.004');
    expect(formatUsdAmount(0.000123, true)).toBe('≈$0.000123');
    expect(formatUsdAmount(0.0000004, false)).toBe('<$0.000001');
    expect(formatUsdAmount(0.0000004, true)).toBe('≈<$0.000001');
  });

  it('never rounds a positive cost into the zero representation', () => {
    // Smallest positive that would become 0.00 at two decimals still stays non-zero form.
    expect(formatUsdAmount(0.001, false)).not.toBe('$0.00');
    expect(formatUsdAmount(0.001, false)).toBe('$0.001');
    expect(formatUsdAmount(1e-12, false)).toBe('<$0.000001');
  });
});

describe('usageCommand', () => {
  let logSpy: ReturnType<typeof spyOn<Console, 'log'>>;
  let errSpy: ReturnType<typeof spyOn<Console, 'error'>>;
  let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((...args: unknown[]) => {
      const callback = args.find(arg => typeof arg === 'function');
      if (typeof callback === 'function') (callback as () => void)();
      return true;
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  function humanOut(): string {
    return logSpy.mock.calls.flat().join('\n');
  }

  function jsonOut(): string {
    return ((stdoutSpy.mock.calls[0]?.[0] as string) ?? '').trimEnd();
  }

  it('maps CLI flags onto the core query without SQL duplication', async () => {
    let received: UsageReportQuery | undefined;
    const queryFn: UsageQueryFn = async options => {
      received = options;
      return sampleReport();
    };

    const code = await usageCommand(
      {
        since: '2026-09-01T00:00:00.000Z',
        until: '2026-09-02T00:00:00.000Z',
        by: 'model',
        codebaseId: 'cb-1',
        agent: 'claude',
        provider: 'anthropic',
        model: 'sonnet',
        kind: 'advisor',
        runId: 'run-1',
        node: 'plan',
      },
      queryFn
    );

    expect(code).toBe(0);
    expect(received).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      groupBy: 'model',
      codebaseId: 'cb-1',
      agentProvider: 'claude',
      provider: 'anthropic',
      model: 'sonnet',
      kind: 'advisor',
      runId: 'run-1',
      nodeId: 'plan',
    });
  });

  it('rejects asymmetric --since/--until before querying', async () => {
    let called = false;
    const code = await usageCommand({ since: '2026-09-01T00:00:00.000Z' }, async () => {
      called = true;
      return sampleReport();
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('--since and --until');
  });

  it('rejects invalid --by and --kind before querying', async () => {
    expect(await usageCommand({ by: 'tokens' }, async () => sampleReport())).toBe(1);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('Invalid --by');

    errSpy.mockClear();
    expect(await usageCommand({ kind: 'primary' }, async () => sampleReport())).toBe(1);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('Invalid --kind');
  });

  it('writes exact camelCase report JSON via writeJsonLine', async () => {
    const report = sampleReport({
      totals: emptyMetrics({ reportedUsd: 0, estimatedUsd: null, recordCount: 1 }),
    });
    const code = await usageCommand({ json: true }, async () => report);
    expect(code).toBe(0);
    expect(JSON.parse(jsonOut())).toEqual(report);
    // Logs must stay off stdout for --json consumers.
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('human mode distinguishes reported, estimated, zero, missing, and sub-cent values', async () => {
    const report = sampleReport({
      totals: emptyMetrics({
        reportedUsd: 0,
        estimatedUsd: 0.0004,
        tokensInput: null,
        tokensOutput: 10,
        requests: 0,
        recordCount: 3,
        rowsMissingUsd: 1,
      }),
      groups: [
        {
          dimensions: { provider: 'openai' },
          metrics: emptyMetrics({
            reportedUsd: null,
            estimatedUsd: 0,
            tokensInput: 5,
            recordCount: 1,
          }),
        },
      ],
    });

    const code = await usageCommand({}, async () => report);
    expect(code).toBe(0);
    const out = humanOut();
    expect(out).toContain('reported $0.00');
    expect(out).toContain('estimated ≈$0.0004');
    expect(out).toContain('in n/a');
    expect(out).toContain('out 10');
    expect(out).toContain('req 0');
    expect(out).toContain('openai');
    expect(out).toContain('reported n/a');
    expect(out).toContain('estimated ≈$0.00');
  });

  it('prints a coverage warning when unledgeredEventCount > 0', async () => {
    const report = sampleReport({
      coverage: {
        usageEventCount: 3,
        ledgeredEventCount: 2,
        unledgeredEventCount: 1,
        hasRecordedUsage: true,
        historicalBackfill: false,
        filterScope: 'date-project-run-node',
      },
    });
    expect(await usageCommand({}, async () => report)).toBe(0);
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('no ledger rows');
  });

  it('surfaces core validation/overflow errors without throwing', async () => {
    const code = await usageCommand({}, async () => {
      throw new UsageReportQueryError('validation', 'nodeId requires runId');
    });
    expect(code).toBe(1);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('nodeId requires runId');
  });

  it('defaults to an empty query so core applies UTC-month defaults', async () => {
    let received: UsageReportQuery | undefined;
    await usageCommand({}, async options => {
      received = options;
      return sampleReport();
    });
    expect(received).toEqual({});
  });
});
