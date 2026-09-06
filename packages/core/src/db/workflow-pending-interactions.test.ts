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
import type {
  ConfirmPendingPermissionInput,
  InsertPendingInteractionInput,
  ResolvePendingInteractionInput,
} from '@archon/workflows/schemas/pending-interaction';

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

const {
  insertPendingInteraction,
  listPendingInteractions,
  resolvePendingInteraction,
  confirmPendingPermission,
  purgePendingInteractionsInTransaction,
  PendingInteractionCorruptRowError,
  PendingInteractionNotFoundError,
  PendingInteractionAlreadyResolvedError,
  PendingInteractionRunNotPausedError,
  PendingInteractionValidationError,
} = await import('./workflow-pending-interactions');

afterAll(async () => {
  await db.close();
});

const SENTINEL_QUESTION = 'DO_NOT_LOG_QUESTION';
const SENTINEL_ANSWER = 'DO_NOT_LOG_ANSWER';
const SENTINEL_INTENT = 'DO_NOT_LOG_PERMISSION_INTENT';

const baseInput: InsertPendingInteractionInput = {
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'toolu_1',
  kind: 'ask',
  envelope: { questions: [] },
  provider_session_id: 'sess-1',
};

async function pauseRun(runId = 'run-1'): Promise<void> {
  await db.query("UPDATE remote_agent_workflow_runs SET status = 'paused' WHERE id = $1", [runId]);
}

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

  test('rejects terminal and pre-start runs and inserts nothing', async () => {
    for (const status of ['pending', 'completed', 'failed', 'cancelled'] as const) {
      await db.query('UPDATE remote_agent_workflow_runs SET status = $1 WHERE id = $2', [
        status,
        'run-1',
      ]);

      await expect(insertPendingInteraction(baseInput)).rejects.toThrow(
        `Cannot create pending interaction for workflow run run-1 with status '${status}'`
      );

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
    }
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

const mixedEnvelope = {
  questions: [
    {
      id: 'q-color',
      prompt: SENTINEL_QUESTION,
      selection: 'single' as const,
      options: ['red', 'blue'],
      allowOther: false,
    },
    {
      id: 'q-tags',
      prompt: 'Pick tags',
      selection: 'multi' as const,
      options: ['a', 'b', 'c'],
      allowOther: true,
    },
  ],
};

const validAnswers = {
  answers: [
    { questionId: 'q-color', value: 'red' },
    { questionId: 'q-tags', value: ['a', 'c'] },
  ],
};

function resolveInput(
  overrides: Partial<ResolvePendingInteractionInput> = {}
): ResolvePendingInteractionInput {
  return {
    workflow_run_id: 'run-1',
    tool_use_id: 'toolu_1',
    answer: validAnswers,
    resolved_by: 'user-1',
    ...overrides,
  };
}

async function insertPausedAsk(
  overrides: Partial<InsertPendingInteractionInput> = {}
): Promise<void> {
  await insertPendingInteraction({
    ...baseInput,
    envelope: mixedEnvelope,
    ...overrides,
  });
  await pauseRun();
}

function permissionInput(
  overrides: Partial<ConfirmPendingPermissionInput> = {}
): ConfirmPendingPermissionInput {
  return {
    workflow_run_id: 'run-1',
    tool_use_id: 'toolu_perm_1',
    answer: { intent: ` ${SENTINEL_INTENT} ` },
    resolved_by: 'user-1',
    ...overrides,
  };
}

async function insertPausedPermission(): Promise<void> {
  await insertPendingInteraction({
    ...baseInput,
    tool_use_id: 'toolu_perm_1',
    kind: 'permission',
    envelope: { tool: 'Bash' },
  });
  await pauseRun();
}

async function runStatus(runId = 'run-1'): Promise<string | undefined> {
  const result = await db.query<{ status: string }>(
    'SELECT status FROM remote_agent_workflow_runs WHERE id = $1',
    [runId]
  );
  return result.rows[0]?.status;
}

async function resolvedEvents(runId = 'run-1'): Promise<Array<Record<string, unknown>>> {
  const events = await db.query<{ event_type: string; step_name: string | null; data: string }>(
    `SELECT event_type, step_name, data FROM remote_agent_workflow_events
     WHERE workflow_run_id = $1 AND event_type = 'interaction_resolved'`,
    [runId]
  );
  return events.rows.map(row => ({
    event_type: row.event_type,
    step_name: row.step_name,
    data: JSON.parse(String(row.data)) as Record<string, unknown>,
  }));
}

describe('resolvePendingInteraction', () => {
  test('resolves one pending Ask, writes an id-only event, and resumes the last pending row atomically', async () => {
    await insertPausedAsk();

    const result = await resolvePendingInteraction(resolveInput());

    expect(result.resumed).toBe(true);
    expect(result.remaining_pending).toBe(0);
    expect(result.interaction.status).toBe('answered');
    expect(result.interaction.answer).toEqual(validAnswers);
    expect(result.interaction.resolved_by).toBe('user-1');
    expect(result.interaction.resolved_at).not.toBeNull();
    expect(await runStatus()).toBe('running');
    expect(await listPendingInteractions('run-1')).toHaveLength(1);
    expect((await listPendingInteractions('run-1'))[0]?.status).toBe('answered');

    const events = await resolvedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.step_name).toBe('review');
    expect(events[0]?.data).toEqual({
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      declined: false,
      resumed: true,
    });
    expect(events[0]?.data).not.toHaveProperty('envelope');
    expect(events[0]?.data).not.toHaveProperty('answer');
    expect(events[0]?.data).not.toHaveProperty('questions');
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
  });

  test('keeps the first answer and reports already-resolved on a second write', async () => {
    await insertPausedAsk();
    const first = await resolvePendingInteraction(resolveInput());
    expect(first.interaction.answer).toEqual(validAnswers);

    const err = await resolvePendingInteraction(resolveInput({ answer: { decline: true } })).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionAlreadyResolvedError);

    const listed = await listPendingInteractions('run-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.answer).toEqual(validAnswers);
    expect(listed[0]?.status).toBe('answered');
  });

  test('does not resume while a sibling interaction is pending', async () => {
    await insertPendingInteraction({ ...baseInput, envelope: mixedEnvelope });
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_2',
      envelope: mixedEnvelope,
    });
    await pauseRun();

    const result = await resolvePendingInteraction(resolveInput());
    expect(result.resumed).toBe(false);
    expect(result.remaining_pending).toBe(1);
    expect(await runStatus()).toBe('paused');

    const listed = await listPendingInteractions('run-1');
    expect(listed.map(row => row.status).sort()).toEqual(['answered', 'pending']);
    const events = await resolvedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ resumed: false, declined: false });
  });

  test('rolls back the answer when the interaction-resolved event insert fails', async () => {
    await insertPausedAsk();
    await db.query(`
      CREATE TRIGGER abort_workflow_events BEFORE INSERT ON remote_agent_workflow_events
      BEGIN
        SELECT RAISE(ABORT, 'event insert blocked');
      END
    `);
    try {
      await expect(resolvePendingInteraction(resolveInput())).rejects.toThrow();
      const listed = await listPendingInteractions('run-1');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.status).toBe('pending');
      expect(listed[0]?.answer).toBeNull();
      expect(await runStatus()).toBe('paused');
    } finally {
      await db.query('DROP TRIGGER IF EXISTS abort_workflow_events');
    }
  });

  test('rolls back the answer when the paused-run resume CAS cannot win', async () => {
    await insertPausedAsk();
    await db.query(`
      CREATE TRIGGER skip_paused_ask_resume BEFORE UPDATE ON remote_agent_workflow_runs
      WHEN NEW.status = 'running' AND OLD.status = 'paused'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    try {
      const err = await resolvePendingInteraction(resolveInput()).then(
        () => null,
        (caught: unknown) => caught
      );
      expect(err).toBeInstanceOf(PendingInteractionRunNotPausedError);
      const listed = await listPendingInteractions('run-1');
      expect(listed[0]?.status).toBe('pending');
      expect(listed[0]?.answer).toBeNull();
      expect(await runStatus()).toBe('paused');
    } finally {
      await db.query('DROP TRIGGER IF EXISTS skip_paused_ask_resume');
    }
  });

  test('rejects an answer before the run reaches paused', async () => {
    await insertPendingInteraction({ ...baseInput, envelope: mixedEnvelope });
    const err = await resolvePendingInteraction(resolveInput()).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionRunNotPausedError);
    const listed = await listPendingInteractions('run-1');
    expect(listed[0]?.status).toBe('pending');
    expect(await runStatus()).toBe('running');
  });

  test('rejects a permission row on the Ask endpoint', async () => {
    await insertPausedAsk({ kind: 'permission', envelope: { questions: [] } });
    const err = await resolvePendingInteraction(resolveInput()).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionValidationError);
    expect((err as PendingInteractionValidationError).code).toBe('kind_not_ask');
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
    expect((err as Error).message).not.toContain(SENTINEL_ANSWER);
    const listed = await listPendingInteractions('run-1');
    expect(listed[0]?.status).toBe('pending');
  });

  test('rejects missing duplicate and unknown question ids', async () => {
    await insertPausedAsk();

    const missing = await resolvePendingInteraction(
      resolveInput({
        answer: { answers: [{ questionId: 'q-color', value: 'red' }] },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(missing).toBeInstanceOf(PendingInteractionValidationError);
    expect((missing as PendingInteractionValidationError).code).toBe('missing_question');

    const unknown = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'red' },
            { questionId: 'q-tags', value: ['a'] },
            { questionId: 'nope', value: 'x' },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(unknown).toBeInstanceOf(PendingInteractionValidationError);
    expect((unknown as PendingInteractionValidationError).code).toBe('unknown_question');

    const duplicate = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'red' },
            { questionId: 'q-color', value: 'blue' },
            { questionId: 'q-tags', value: ['a'] },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(duplicate).toBeInstanceOf(PendingInteractionValidationError);
    expect((duplicate as PendingInteractionValidationError).code).toBe('duplicate_question');

    const listed = await listPendingInteractions('run-1');
    expect(listed[0]?.status).toBe('pending');
  });

  test('rejects duplicate ids in the stored envelope', async () => {
    await insertPausedAsk({
      envelope: {
        questions: [
          {
            id: 'q-dup',
            prompt: SENTINEL_QUESTION,
            selection: 'single',
            options: ['yes', 'no'],
            allowOther: false,
          },
          {
            id: 'q-dup',
            prompt: 'Again',
            selection: 'single',
            options: ['yes', 'no'],
            allowOther: false,
          },
        ],
      },
    });
    const err = await resolvePendingInteraction(
      resolveInput({ answer: { answers: [{ questionId: 'q-dup', value: 'yes' }] } })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionValidationError);
    expect((err as PendingInteractionValidationError).code).toBe('duplicate_envelope_id');
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
  });

  test('enforces single and multi value shapes', async () => {
    await insertPausedAsk();
    const singleArray = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: ['red'] },
            { questionId: 'q-tags', value: ['a'] },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(singleArray).toBeInstanceOf(PendingInteractionValidationError);
    expect((singleArray as PendingInteractionValidationError).code).toBe('invalid_single_value');

    const multiString = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'red' },
            { questionId: 'q-tags', value: 'a' },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(multiString).toBeInstanceOf(PendingInteractionValidationError);
    expect((multiString as PendingInteractionValidationError).code).toBe('invalid_multi_value');

    const emptyMulti = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'red' },
            { questionId: 'q-tags', value: [] },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(emptyMulti).toBeInstanceOf(PendingInteractionValidationError);
    expect((emptyMulti as PendingInteractionValidationError).code).toBe('invalid_multi_value');
  });

  test('accepts an exact option and a nonblank Other value', async () => {
    await insertPausedAsk({
      envelope: {
        questions: [
          {
            id: 'q-color',
            prompt: SENTINEL_QUESTION,
            selection: 'single',
            options: ['red', 'blue'],
            allowOther: true,
          },
          {
            id: 'q-size',
            prompt: 'Size',
            selection: 'single',
            options: ['s', 'm'],
            allowOther: false,
          },
        ],
      },
    });
    const result = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'purple' },
            { questionId: 'q-size', value: 'm' },
          ],
        },
      })
    );
    expect(result.interaction.answer).toEqual({
      answers: [
        { questionId: 'q-color', value: 'purple' },
        { questionId: 'q-size', value: 'm' },
      ],
    });
    expect(result.resumed).toBe(true);
  });

  test('rejects blank or forbidden Other values', async () => {
    await insertPausedAsk();
    const forbidden = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: SENTINEL_ANSWER },
            { questionId: 'q-tags', value: ['a'] },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(forbidden).toBeInstanceOf(PendingInteractionValidationError);
    expect((forbidden as PendingInteractionValidationError).code).toBe('invalid_option');
    expect((forbidden as Error).message).not.toContain(SENTINEL_ANSWER);

    const blankOther = await resolvePendingInteraction(
      resolveInput({
        answer: {
          answers: [
            { questionId: 'q-color', value: 'red' },
            { questionId: 'q-tags', value: ['   '] },
          ],
        },
      })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(blankOther).toBeInstanceOf(PendingInteractionValidationError);
    expect((blankOther as PendingInteractionValidationError).code).toBe('blank_other');
  });

  test('redacts a shape-validation sentinel from errors and logs', async () => {
    await insertPausedAsk();
    const err = await resolvePendingInteraction({
      workflow_run_id: 'run-1',
      tool_use_id: 'toolu_1',
      answer: {
        answers: [{ questionId: 'q-color', value: SENTINEL_ANSWER }],
        extra: SENTINEL_QUESTION,
      },
      resolved_by: 'user-1',
    } as never).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionValidationError);
    expect((err as PendingInteractionValidationError).code).toBe('invalid_body');
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
    expect((err as Error).message).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
  });

  test('reports corrupt stored JSON with the row id only', async () => {
    await insertPendingInteraction({ ...baseInput, envelope: mixedEnvelope });
    await pauseRun();
    await db.query(
      'UPDATE remote_agent_pending_interactions SET envelope = $1 WHERE tool_use_id = $2',
      [`{"question":"${SENTINEL_QUESTION}"`, 'toolu_1']
    );
    const err = await resolvePendingInteraction(resolveInput()).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(PendingInteractionCorruptRowError);
    expect((err as Error).message).toMatch(/^Pending interaction row corrupt: /);
    expect((err as Error).message).not.toContain(SENTINEL_QUESTION);
    expect((err as Error).message).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).toContain((err as PendingInteractionCorruptRowError).rowId);
  });
});

describe('confirmPendingPermission', () => {
  test('confirms the last Permission and commits an identifier-only event with the resume', async () => {
    await insertPausedPermission();

    const result = await confirmPendingPermission(permissionInput());

    expect(result.resumed).toBe(true);
    expect(result.remaining_pending).toBe(0);
    expect(result.interaction.status).toBe('answered');
    expect(result.interaction.answer).toEqual({ intent: ` ${SENTINEL_INTENT} ` });
    expect(result.interaction.resolved_by).toBe('user-1');
    expect(await runStatus()).toBe('running');
    expect((await resolvedEvents())[0]?.data).toEqual({
      node_id: 'review',
      tool_use_id: 'toolu_perm_1',
      kind: 'permission',
      resumed: true,
    });
    expect(JSON.stringify(await resolvedEvents())).not.toContain(SENTINEL_INTENT);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_INTENT);
  });

  test('preserves the first intent when a second confirmation loses the CAS', async () => {
    await insertPausedPermission();
    await confirmPendingPermission(permissionInput());

    await expect(
      confirmPendingPermission(permissionInput({ answer: { intent: 'second-intent' } }))
    ).rejects.toBeInstanceOf(PendingInteractionAlreadyResolvedError);

    const [row] = await listPendingInteractions('run-1');
    expect(row?.answer).toEqual({ intent: ` ${SENTINEL_INTENT} ` });
  });

  test('leaves the run paused while a sibling Ask remains pending', async () => {
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_perm_1',
      kind: 'permission',
      envelope: {},
    });
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_ask_1',
      envelope: mixedEnvelope,
    });
    await pauseRun();

    const result = await confirmPendingPermission(permissionInput());

    expect(result.resumed).toBe(false);
    expect(result.remaining_pending).toBe(1);
    expect(await runStatus()).toBe('paused');
  });

  test('resumes when an answered Ask leaves Permission as the final pending row', async () => {
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_perm_1',
      kind: 'permission',
      envelope: {},
    });
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_ask_1',
      envelope: mixedEnvelope,
    });
    await pauseRun();
    const askResult = await resolvePendingInteraction(resolveInput({ tool_use_id: 'toolu_ask_1' }));
    expect(askResult.resumed).toBe(false);

    const result = await confirmPendingPermission(permissionInput());

    expect(result.resumed).toBe(true);
    expect(result.remaining_pending).toBe(0);
    expect(await runStatus()).toBe('running');
  });

  test('rolls back the confirmation when the resolved event insert fails', async () => {
    await insertPausedPermission();
    await db.query(`
    CREATE TRIGGER abort_permission_event BEFORE INSERT ON remote_agent_workflow_events
    BEGIN
      SELECT RAISE(ABORT, 'event insert blocked');
    END
  `);
    try {
      await expect(confirmPendingPermission(permissionInput())).rejects.toThrow();
      const [row] = await listPendingInteractions('run-1');
      expect(row?.status).toBe('pending');
      expect(row?.answer).toBeNull();
      expect(await runStatus()).toBe('paused');
    } finally {
      await db.query('DROP TRIGGER IF EXISTS abort_permission_event');
    }
  });

  test('rolls back the confirmation when the paused-run resume CAS loses', async () => {
    await insertPausedPermission();
    await db.query(`
    CREATE TRIGGER skip_permission_resume BEFORE UPDATE ON remote_agent_workflow_runs
    WHEN NEW.status = 'running' AND OLD.status = 'paused'
    BEGIN
      SELECT RAISE(IGNORE);
    END
  `);
    try {
      await expect(confirmPendingPermission(permissionInput())).rejects.toBeInstanceOf(
        PendingInteractionRunNotPausedError
      );
      const [row] = await listPendingInteractions('run-1');
      expect(row?.status).toBe('pending');
      expect(row?.answer).toBeNull();
    } finally {
      await db.query('DROP TRIGGER IF EXISTS skip_permission_resume');
    }
  });

  test('rejects a confirmation before the run reaches paused', async () => {
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_perm_1',
      kind: 'permission',
      envelope: {},
    });
    await expect(confirmPendingPermission(permissionInput())).rejects.toBeInstanceOf(
      PendingInteractionRunNotPausedError
    );
    expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
  });

  test('rejects a pending Ask without consuming it', async () => {
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_perm_1',
      envelope: mixedEnvelope,
    });
    await pauseRun();
    const error = await confirmPendingPermission(permissionInput()).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PendingInteractionValidationError);
    expect((error as PendingInteractionValidationError).code).toBe('kind_not_permission');
    expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
  });

  test('rejects a whitespace-only intent before opening the transaction', async () => {
    await insertPausedPermission();
    const error = await confirmPendingPermission(
      permissionInput({ answer: { intent: '   ' } })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PendingInteractionValidationError);
    expect((error as PendingInteractionValidationError).code).toBe('invalid_body');
    expect((await listPendingInteractions('run-1'))[0]?.status).toBe('pending');
  });

  test('reports a missing run and a missing call id without exposing intent', async () => {
    const missingRun = await confirmPendingPermission(
      permissionInput({ workflow_run_id: 'missing-run' })
    ).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(missingRun).toBeInstanceOf(PendingInteractionNotFoundError);

    await pauseRun();
    const missingCall = await confirmPendingPermission(permissionInput()).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(missingCall).toBeInstanceOf(PendingInteractionNotFoundError);
    expect(JSON.stringify([missingRun, missingCall, errorLogs])).not.toContain(SENTINEL_INTENT);
  });
});

describe('purgePendingInteractionsInTransaction', () => {
  test('purges only pending rows, leaves answers null, and writes one safe event per row', async () => {
    await insertPendingInteraction({ ...baseInput, envelope: mixedEnvelope });
    await insertPendingInteraction({
      ...baseInput,
      tool_use_id: 'toolu_2',
      envelope: mixedEnvelope,
    });
    await pauseRun();
    await resolvePendingInteraction(resolveInput({ tool_use_id: 'toolu_2' }));

    const result = await db.withTransaction(query =>
      purgePendingInteractionsInTransaction(query, 'run-1', 'cancelled')
    );
    expect(result).toEqual({ purged: 1 });

    const rows = await db.query<{
      tool_use_id: string;
      status: string;
      answer: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
    }>(
      `SELECT tool_use_id, status, answer, resolved_by, resolved_at
       FROM remote_agent_pending_interactions
       WHERE workflow_run_id = $1
       ORDER BY tool_use_id ASC`,
      ['run-1']
    );
    const purgedRow = rows.rows.find(row => row.tool_use_id === 'toolu_1');
    const answeredRow = rows.rows.find(row => row.tool_use_id === 'toolu_2');
    expect(purgedRow?.status).toBe('purged');
    expect(purgedRow?.answer).toBeNull();
    expect(purgedRow?.resolved_by).toBeNull();
    expect(purgedRow?.resolved_at).not.toBeNull();
    expect(answeredRow?.status).toBe('answered');
    expect(answeredRow?.answer).toBe(JSON.stringify(validAnswers));

    const events = await resolvedEvents();
    expect(events).toHaveLength(2);
    const purgeEvent = events.find(
      event => (event.data as Record<string, unknown>).purged === true
    );
    expect(purgeEvent?.step_name).toBe('review');
    expect(purgeEvent?.data).toEqual({
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      purged: true,
      resumed: false,
      terminal_status: 'cancelled',
    });
    expect(JSON.stringify(events)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(events)).not.toContain(SENTINEL_ANSWER);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_QUESTION);
    expect(JSON.stringify(errorLogs)).not.toContain(SENTINEL_ANSWER);
  });
});
