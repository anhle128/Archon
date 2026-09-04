/**
 * Integration test: usage-report half-open range filters against REAL bun:sqlite.
 *
 * Mocked usage-report tests cannot prove SQLite comparison behavior. The prior
 * path truncated bounds via `toISOString().slice(0, 19)` + `datetime()`, so
 * `from=...00.500Z` and `to=...00.500Z` both collapsed to the whole second and
 * broke half-open `[from, to)` semantics vs PostgreSQL timestamptz.
 *
 * Runs in its own `bun test` invocation (see package.json) — it mock.module's
 * ./connection with a real adapter, conflicting with other db tests' fakes.
 */
import { describe, test, expect, mock } from 'bun:test';

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

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite' as const,
  getDatabase: () => db,
}));

const { queryUsageReport } = await import('./usage-report');

const CODEBASE_ID = 'cb-usage-boundary';
const RUN_ID = 'run-usage-boundary';

await db.query(
  `INSERT INTO remote_agent_codebases (id, name, default_cwd)
   VALUES ($1, 'usage-boundary', '/tmp/usage-boundary')`,
  [CODEBASE_ID]
);
await db.query(
  `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
   VALUES ('conv-usage-boundary', 'web', 'conv-usage-boundary-platform')`,
  []
);
await db.query(
  `INSERT INTO remote_agent_workflow_runs
     (id, workflow_name, conversation_id, codebase_id, user_message, status, started_at)
   VALUES ($1, 'wf-usage', 'conv-usage-boundary', $2, 'msg', 'completed', datetime('now'))`,
  [RUN_ID, CODEBASE_ID]
);

async function seedUsageObservation(opts: {
  eventId: string;
  ledgerId: string;
  createdAt: string;
  tokensInput: number;
}): Promise<void> {
  await db.query(
    `INSERT INTO remote_agent_workflow_events
       (id, workflow_run_id, event_type, step_name, data, created_at)
     VALUES ($1, $2, 'node_usage_recorded', 'step-a', '{}', $3)`,
    [opts.eventId, RUN_ID, opts.createdAt]
  );
  await db.query(
    `INSERT INTO remote_agent_usage_ledger (
       id, workflow_event_id, entry_index, agent_provider, provider, model, model_source, kind,
       tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
       requests, cost_usd, cost_estimated_usd, pricing_source
     ) VALUES (
       $1, $2, 0, 'claude', 'anthropic', 'sonnet', 'reported', NULL,
       $3, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL
     )`,
    [opts.ledgerId, opts.eventId, opts.tokensInput]
  );
}

// Whole-second stored event at the second boundary.
await seedUsageObservation({
  eventId: 'evt-whole-second',
  ledgerId: 'led-whole-second',
  createdAt: '2026-09-01 00:00:00',
  tokensInput: 11,
});

// Fractional stored event — proves precision survives if event storage gains ms later.
await seedUsageObservation({
  eventId: 'evt-fractional',
  ledgerId: 'led-fractional',
  createdAt: '2026-09-01 00:00:00.250',
  tokensInput: 22,
});

describe('queryUsageReport — SQLite fractional RFC3339 boundaries', () => {
  test('from=...00.500Z excludes a whole-second event at ...00', async () => {
    const report = await queryUsageReport({
      from: '2026-09-01T00:00:00.500Z',
      to: '2026-09-01T00:00:01.000Z',
      runId: RUN_ID,
      groupBy: 'run',
    });
    expect(report.totals.recordCount).toBe(0);
    expect(report.totals.tokensInput).toBeNull();
    expect(report.groups).toEqual([]);
  });

  test('to=...00.500Z includes a whole-second event at ...00', async () => {
    const report = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.500Z',
      runId: RUN_ID,
      groupBy: 'run',
    });
    // Both whole-second (...00) and fractional (...00.250) are in [from, to).
    expect(report.totals.recordCount).toBe(2);
    expect(report.totals.tokensInput).toBe(33);
  });

  test('explicit-offset ...00.500+00:00 matches Z for the same half-open bounds', async () => {
    const fromZ = await queryUsageReport({
      from: '2026-09-01T00:00:00.500Z',
      to: '2026-09-01T00:00:01.000Z',
      runId: RUN_ID,
    });
    const fromOffset = await queryUsageReport({
      from: '2026-09-01T00:00:00.500+00:00',
      to: '2026-09-01T00:00:01.000+00:00',
      runId: RUN_ID,
    });
    expect(fromOffset.totals.recordCount).toBe(fromZ.totals.recordCount);
    expect(fromOffset.totals.tokensInput).toBe(fromZ.totals.tokensInput);

    const toZ = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.500Z',
      runId: RUN_ID,
    });
    const toOffset = await queryUsageReport({
      from: '2026-09-01T00:00:00.000+00:00',
      to: '2026-09-01T00:00:00.500+00:00',
      runId: RUN_ID,
    });
    expect(toOffset.totals.recordCount).toBe(toZ.totals.recordCount);
    expect(toOffset.totals.tokensInput).toBe(toZ.totals.tokensInput);
    expect(toOffset.totals.recordCount).toBe(2);
  });

  test('stored fractional timestamp compares exactly against half-open bounds', async () => {
    // from == stored fractional instant → include (half-open lower bound inclusive)
    const atExact = await queryUsageReport({
      from: '2026-09-01T00:00:00.250Z',
      to: '2026-09-01T00:00:00.251Z',
      runId: RUN_ID,
    });
    expect(atExact.totals.recordCount).toBe(1);
    expect(atExact.totals.tokensInput).toBe(22);

    // to == stored fractional instant → exclude (half-open upper bound exclusive)
    const beforeExact = await queryUsageReport({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.250Z',
      runId: RUN_ID,
    });
    expect(beforeExact.totals.recordCount).toBe(1);
    expect(beforeExact.totals.tokensInput).toBe(11);

    // Window that starts after whole-second but before fractional includes only fractional.
    const midWindow = await queryUsageReport({
      from: '2026-09-01T00:00:00.100Z',
      to: '2026-09-01T00:00:00.500Z',
      runId: RUN_ID,
    });
    expect(midWindow.totals.recordCount).toBe(1);
    expect(midWindow.totals.tokensInput).toBe(22);
  });

  test('non-zero offset instant maps to the same UTC bound as Z', async () => {
    // 2026-09-01T07:00:00.500+07:00 == 2026-09-01T00:00:00.500Z
    const report = await queryUsageReport({
      from: '2026-09-01T07:00:00.500+07:00',
      to: '2026-09-01T07:00:01.000+07:00',
      runId: RUN_ID,
    });
    expect(report.scope.from).toBe('2026-09-01T00:00:00.500Z');
    expect(report.scope.to).toBe('2026-09-01T00:00:01.000Z');
    expect(report.totals.recordCount).toBe(0);
  });
});
