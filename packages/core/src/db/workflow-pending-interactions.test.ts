/**
 * Pending-interaction store against a real SqliteAdapter.
 *
 * Covers atomic pending+node_awaiting writes, no-starter / missing-run
 * failures, unique (run, tool_use_id), paused-run accumulation, ordered
 * list, and fail-closed corrupt-row handling that never logs payload bodies.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other DB tests.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AskHumanNoStarterError } from '@archon/providers/types';
import type { InsertPendingInteractionInput } from '@archon/workflows/schemas/pending-interaction';

const errorLogs: unknown[] = [];

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error(...args: unknown[]) {
      errorLogs.push(args);
    },
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const { insertPendingInteraction, listPendingInteractions, PendingInteractionCorruptRowError } =
  await import('./workflow-pending-interactions');

afterAll(async () => {
  await db.close();
});

const SENTINEL_QUESTION = 'DO_NOT_LOG_QUESTION';
const SENTINEL_ANSWER = 'DO_NOT_LOG_ANSWER';

const baseInput: InsertPendingInteractionInput = {
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'toolu_1',
  kind: 'ask',
  envelope: { questions: [] },
  provider_session_id: 'sess-1',
};

async function seedRun(options?: {
  runId?: string;
  userId?: string | null;
  conversationId?: string;
}): Promise<void> {
  const runId = options?.runId ?? 'run-1';
  const conversationId = options?.conversationId ?? 'conversation-1';
  const userId = options?.userId === undefined ? 'user-1' : options.userId;

  if (userId !== null) {
    await db.query('INSERT INTO remote_agent_users (id, display_name) VALUES ($1, $2)', [
      userId,
      'Starter',
    ]);
  }
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', `${conversationId}-platform`]
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [runId, 'ask-test', conversationId, 'go', 'running', userId]
  );
}

beforeEach(async () => {
  errorLogs.length = 0;
  await db.query('DELETE FROM remote_agent_conversations');
  await db.query('DELETE FROM remote_agent_users');
  await seedRun();
});

describe('insertPendingInteraction', () => {
  test('returns a canonical pending row and one node_awaiting event with id-only data', async () => {
    const row = await insertPendingInteraction(baseInput);

    expect(row.workflow_run_id).toBe('run-1');
    expect(row.node_id).toBe('review');
    expect(row.tool_use_id).toBe('toolu_1');
    expect(row.kind).toBe('ask');
    expect(row.status).toBe('pending');
    expect(row.envelope).toEqual({ questions: [] });
    expect(row.answer).toBeNull();
    expect(row.provider_session_id).toBe('sess-1');
    expect(row.resolved_at).toBeNull();
    expect(row.resolved_by).toBeNull();
    expect(row.id.length).toBeGreaterThan(0);

    const events = await db.query<{
      event_type: string;
      step_name: string | null;
      data: string;
    }>(
      'SELECT event_type, step_name, data FROM remote_agent_workflow_events WHERE workflow_run_id = $1',
      ['run-1']
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.event_type).toBe('node_awaiting');
    expect(events.rows[0]?.step_name).toBe('review');
    const data = JSON.parse(String(events.rows[0]?.data)) as Record<string, unknown>;
    expect(data).toEqual({
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
    });
    expect(data).not.toHaveProperty('envelope');
    expect(data).not.toHaveProperty('questions');
    expect(data).not.toHaveProperty('answer');
  });

  test('throws AskHumanNoStarterError when run user_id is null and inserts nothing', async () => {
    await db.query('DELETE FROM remote_agent_conversations');
    await db.query('DELETE FROM remote_agent_users');
    await seedRun({ userId: null });

    const err = await insertPendingInteraction(baseInput).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(AskHumanNoStarterError);
    expect((err as AskHumanNoStarterError).workflowRunId).toBe('run-1');

    const pending = await db.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM remote_agent_pending_interactions',
      []
    );
    const events = await db.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM remote_agent_workflow_events',
      []
    );
    expect(Number(pending.rows[0]?.count)).toBe(0);
    expect(Number(events.rows[0]?.count)).toBe(0);
  });

  test('throws a normal Error for a missing run and inserts nothing', async () => {
    const err = await insertPendingInteraction({
      ...baseInput,
      workflow_run_id: 'missing-run',
    }).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AskHumanNoStarterError);

    const pending = await db.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM remote_agent_pending_interactions',
      []
    );
    const events = await db.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM remote_agent_workflow_events',
      []
    );
    expect(Number(pending.rows[0]?.count)).toBe(0);
    expect(Number(events.rows[0]?.count)).toBe(0);
  });

  test('rolls back the pending insert when the node_awaiting event insert aborts', async () => {
    await db.query(`
      CREATE TRIGGER abort_workflow_events BEFORE INSERT ON remote_agent_workflow_events
      BEGIN
        SELECT RAISE(ABORT, 'event insert blocked');
      END
    `);
    try {
      await expect(insertPendingInteraction(baseInput)).rejects.toThrow();
      const pending = await db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM remote_agent_pending_interactions',
        []
      );
      expect(Number(pending.rows[0]?.count)).toBe(0);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS abort_workflow_events');
    }
  });

  test('allows another pending ask on an already-paused run', async () => {
    await insertPendingInteraction(baseInput);
    await db.query("UPDATE remote_agent_workflow_runs SET status = 'paused' WHERE id = $1", [
      'run-1',
    ]);

    const second = await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_2',
    });
    expect(second.tool_use_id).toBe('toolu_2');
    expect(second.status).toBe('pending');
    expect(await listPendingInteractions('run-1')).toHaveLength(2);
  });

  test('rejects reused (workflow_run_id, tool_use_id) and leaves the original row', async () => {
    const original = await insertPendingInteraction(baseInput);
    await expect(
      insertPendingInteraction({ ...baseInput, node_id: 'other-node' })
    ).rejects.toThrow();

    const listed = await listPendingInteractions('run-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(original);
  });
});

describe('listPendingInteractions', () => {
  test('orders by created_at ASC then id ASC', async () => {
    const first = await insertPendingInteraction({ ...baseInput, tool_use_id: 't1' });
    const second = await insertPendingInteraction({ ...baseInput, tool_use_id: 't2' });
    const third = await insertPendingInteraction({ ...baseInput, tool_use_id: 't3' });

    await db.query('UPDATE remote_agent_pending_interactions SET created_at = $1 WHERE id = $2', [
      '2026-01-01 00:00:00',
      second.id,
    ]);
    await db.query('UPDATE remote_agent_pending_interactions SET created_at = $1 WHERE id = $2', [
      '2026-01-01 00:00:00',
      first.id,
    ]);
    await db.query('UPDATE remote_agent_pending_interactions SET created_at = $1 WHERE id = $2', [
      '2026-01-02 00:00:00',
      third.id,
    ]);

    const listed = await listPendingInteractions('run-1');
    const sameTimestampIds = [first.id, second.id].sort();
    expect(listed.map(row => row.id)).toEqual([...sameTimestampIds, third.id]);
  });

  test('malformed envelope JSON fails closed without logging the sentinel', async () => {
    await db.query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, provider_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'bad-json',
        'run-1',
        'review',
        'toolu_bad_json',
        'ask',
        'pending',
        `{"question":"${SENTINEL_QUESTION}"`,
        'sess-1',
      ]
    );

    const err = await listPendingInteractions('run-1').then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionCorruptRowError);
    expect((err as Error).message).toBe('Pending interaction row corrupt: bad-json');
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
    expect((err as Error).message).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).toContain('bad-json');
  });

  test('schema-invalid JSON fails closed without logging the sentinel', async () => {
    await db.query(
      `INSERT INTO remote_agent_pending_interactions
         (id, workflow_run_id, node_id, tool_use_id, kind, status, envelope, answer, provider_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'bad-schema',
        'run-1',
        'review',
        'toolu_bad_schema',
        'ask',
        'pending',
        JSON.stringify([{ question: SENTINEL_QUESTION }]),
        JSON.stringify({ answer: SENTINEL_ANSWER }),
        'sess-1',
      ]
    );

    const err = await listPendingInteractions('run-1').then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionCorruptRowError);
    expect((err as Error).message).toBe('Pending interaction row corrupt: bad-schema');
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
    expect((err as Error).message).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).toContain('bad-schema');
  });
});
