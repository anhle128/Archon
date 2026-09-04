/**
 * Integration test: usage-report totals/groups/coverage share one SQLite snapshot
 * under a concurrent writer.
 *
 * Unit mocks cannot freeze SQL results across statements. This file opens two
 * SqliteAdapter connections on one on-disk WAL database, starts a report, and
 * commits a second atomic usage observation between logical reads via the
 * test seam. The returned object must be entirely before or entirely after
 * that commit — never mixed (e.g. totals=1 with coverage=2).
 *
 * Isolated `bun test` invocation (package.json) — mock.module's ./connection.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

// Dynamic import required: mock.module('./connection') must bind before usage-report loads.
const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');

const tempDir = mkdtempSync(join(tmpdir(), 'usage-report-snapshot-'));
const dbPath = join(tempDir, 'archon.db');
const db = new SqliteAdapter(dbPath);
const writer = new SqliteAdapter(dbPath);

mock.module('./connection', () => ({
  pool: db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite' as const,
  getDatabase: () => db,
}));

// Dynamic import required: see mock.module('./connection') above.
const { queryUsageReport, setUsageReportSnapshotSeamForTest } = await import('./usage-report');

const CODEBASE_ID = 'cb-usage-snapshot';
const RUN_COHERENCE = 'run-usage-snap-cohere';
const RUN_OVERFLOW = 'run-usage-snap-overflow';

await db.query(
  `INSERT INTO remote_agent_codebases (id, name, default_cwd)
   VALUES ($1, 'usage-snapshot', '/tmp/usage-snapshot')`,
  [CODEBASE_ID]
);
await db.query(
  `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
   VALUES ('conv-usage-snapshot', 'web', 'conv-usage-snapshot-platform')`,
  []
);

async function ensureRun(runId: string): Promise<void> {
  await db.query(
    `INSERT OR IGNORE INTO remote_agent_workflow_runs
       (id, workflow_name, conversation_id, codebase_id, user_message, status, started_at)
     VALUES ($1, 'wf-usage-snap', 'conv-usage-snapshot', $2, 'msg', 'completed', datetime('now'))`,
    [runId, CODEBASE_ID]
  );
}

await ensureRun(RUN_COHERENCE);
await ensureRun(RUN_OVERFLOW);

type SeedTarget = {
  withTransaction: SqliteAdapter['withTransaction'];
};

async function seedUsageObservation(
  target: SeedTarget,
  opts: {
    runId: string;
    eventId: string;
    ledgerId: string;
    createdAt: string;
    tokensInput: number;
    provider?: string;
  }
): Promise<void> {
  const provider = opts.provider ?? 'anthropic';
  // Atomic event+ledger pair — mirrors the recorder's single-transaction write.
  await target.withTransaction(async query => {
    await query(
      `INSERT INTO remote_agent_workflow_events
         (id, workflow_run_id, event_type, step_name, data, created_at)
       VALUES ($1, $2, 'node_usage_recorded', 'step-a', '{}', $3)`,
      [opts.eventId, opts.runId, opts.createdAt]
    );
    await query(
      `INSERT INTO remote_agent_usage_ledger (
         id, workflow_event_id, entry_index, agent_provider, provider, model, model_source, kind,
         tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
         requests, cost_usd, cost_estimated_usd, pricing_source
       ) VALUES (
         $1, $2, 0, 'claude', $4, 'sonnet', 'reported', NULL,
         $3, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL
       )`,
      [opts.ledgerId, opts.eventId, opts.tokensInput, provider]
    );
  });
}

afterAll(() => {
  setUsageReportSnapshotSeamForTest(undefined);
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('queryUsageReport — coherent snapshot under concurrent write', () => {
  test('mid-report concurrent commit cannot tear totals/groups/coverage', async () => {
    await seedUsageObservation(db, {
      runId: RUN_COHERENCE,
      eventId: 'evt-snap-1',
      ledgerId: 'led-snap-1',
      createdAt: '2026-09-01 12:00:00.000',
      tokensInput: 10,
    });

    let seamWrote = false;
    setUsageReportSnapshotSeamForTest(async phase => {
      if (phase !== 'after-totals' || seamWrote) return;
      seamWrote = true;
      // Second connection commits while the report still holds its snapshot.
      await seedUsageObservation(writer, {
        runId: RUN_COHERENCE,
        eventId: 'evt-snap-2',
        ledgerId: 'led-snap-2',
        createdAt: '2026-09-01 12:00:01.000',
        tokensInput: 20,
      });
    });

    const report = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      runId: RUN_COHERENCE,
      groupBy: 'provider',
    });

    expect(seamWrote).toBe(true);

    const totalRecords = report.totals.recordCount;
    const groupRecords = report.groups.reduce((n, g) => n + g.metrics.recordCount, 0);
    const usageEvents = report.coverage.usageEventCount;
    const ledgered = report.coverage.ledgeredEventCount;

    // Entirely before (1) or entirely after (2) — never mixed.
    expect(totalRecords === 1 || totalRecords === 2).toBe(true);
    expect(groupRecords).toBe(totalRecords);
    expect(usageEvents).toBe(totalRecords);
    expect(ledgered).toBe(totalRecords);
    expect(report.coverage.unledgeredEventCount).toBe(0);

    if (totalRecords === 1) {
      expect(report.totals.tokensInput).toBe(10);
      expect(report.groups[0]?.metrics.tokensInput).toBe(10);
    } else {
      expect(report.totals.tokensInput).toBe(30);
      expect(report.groups[0]?.metrics.tokensInput).toBe(30);
    }

    setUsageReportSnapshotSeamForTest(undefined);
    const after = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      runId: RUN_COHERENCE,
      groupBy: 'provider',
    });
    expect(after.totals.recordCount).toBe(2);
    expect(after.totals.tokensInput).toBe(30);
    expect(after.coverage.usageEventCount).toBe(2);
    expect(after.coverage.ledgeredEventCount).toBe(2);
  });

  test('concurrent 501st group cannot flip an in-flight 500-group snapshot into overflow', async () => {
    // 500 distinct providers → 500 groups (under LIMIT 501, no overflow).
    for (let i = 0; i < 500; i++) {
      const n = String(i).padStart(3, '0');
      await seedUsageObservation(db, {
        runId: RUN_OVERFLOW,
        eventId: `evt-ovf-${n}`,
        ledgerId: `led-ovf-${n}`,
        createdAt: `2026-09-01 13:00:${String(i % 60).padStart(2, '0')}.000`,
        tokensInput: 1,
        provider: `prov-${n}`,
      });
    }

    let seamWrote = false;
    setUsageReportSnapshotSeamForTest(async phase => {
      if (phase !== 'after-totals' || seamWrote) return;
      seamWrote = true;
      // 501st provider group commits between totals and groups/coverage.
      await seedUsageObservation(writer, {
        runId: RUN_OVERFLOW,
        eventId: 'evt-ovf-500',
        ledgerId: 'led-ovf-500',
        createdAt: '2026-09-01 13:01:00.000',
        tokensInput: 1,
        provider: 'prov-500',
      });
    });

    const inFlight = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      runId: RUN_OVERFLOW,
      groupBy: 'provider',
    });

    expect(seamWrote).toBe(true);
    // Pre-commit snapshot: 500 groups, coherent totals/coverage — not overflow.
    expect(inFlight.groups).toHaveLength(500);
    expect(inFlight.totals.recordCount).toBe(500);
    expect(inFlight.groups.reduce((n, g) => n + g.metrics.recordCount, 0)).toBe(500);
    expect(inFlight.coverage.usageEventCount).toBe(500);
    expect(inFlight.coverage.ledgeredEventCount).toBe(500);
    expect(inFlight.coverage.unledgeredEventCount).toBe(0);

    setUsageReportSnapshotSeamForTest(undefined);
    // Post-commit report sees 501 groups and overflows rather than truncating.
    await expect(
      queryUsageReport({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
        runId: RUN_OVERFLOW,
        groupBy: 'provider',
      })
    ).rejects.toMatchObject({
      name: 'UsageReportQueryError',
      code: 'overflow',
    });
  });
});
