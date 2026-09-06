/**
 * Workflow node transcript store against a real SqliteAdapter.
 *
 * Covers independent per-node sequences, ordered list, cascade deletion,
 * concurrent append sequencing, exact conflict classification, and
 * fail-closed corrupt-row handling that never logs payload bodies.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other DB tests.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

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
  appendNodeMessage,
  isNodeMessageSequenceConflict,
  listNodeMessages,
  WorkflowNodeMessageCorruptRowError,
} = await import('./workflow-node-messages');

afterAll(async () => {
  await db.close();
});

async function seedRun(runId = 'run-1', conversationId = 'conversation-1'): Promise<void> {
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', conversationId + '-platform']
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [runId, 'transcript-test', conversationId, 'inspect this run', 'running']
  );
}

beforeEach(async () => {
  errorLogs.length = 0;
  await db.query('DELETE FROM remote_agent_conversations');
  await seedRun();
});

describe('workflow-node-messages persistence', () => {
  test('append assigns independent monotonic sequences and list returns seq order', async () => {
    const first = await appendNodeMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'first' },
    });
    const second = await appendNodeMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'status',
      payload: { state: 'completed' },
    });
    const otherNode = await appendNodeMessage({
      workflow_run_id: 'run-1',
      node_id: 'test',
      kind: 'text',
      payload: { text: 'other' },
    });
    expect([first.seq, second.seq, otherNode.seq]).toEqual([1, 2, 1]);
    expect((await listNodeMessages('run-1', 'review')).map(row => row.seq)).toEqual([1, 2]);
  });

  test('deleting a run cascade-deletes its transcript', async () => {
    await appendNodeMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'kept only with run' },
    });
    await db.query('DELETE FROM remote_agent_workflow_runs WHERE id = $1', ['run-1']);
    expect(await listNodeMessages('run-1', 'review')).toEqual([]);
  });

  test('corrupt payload fails closed without logging the payload body', async () => {
    await db.query(
      'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload) VALUES ($1, $2, $3, $4, $5, $6)',
      ['bad-1', 'run-1', 'review', 1, 'text', '{"secret":"DO_NOT_LOG"}']
    );
    const err = await listNodeMessages('run-1', 'review').then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(WorkflowNodeMessageCorruptRowError);
    expect((err as Error).message).toBe('Workflow node message row corrupt: bad-1');
    expect((err as Error).message).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(errorLogs)).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(errorLogs)).toContain('bad-1');
  });

  test('malformed JSON payload fails closed without logging the sentinel', async () => {
    await db.query(
      'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload) VALUES ($1, $2, $3, $4, $5, $6)',
      ['bad-json', 'run-1', 'review', 1, 'text', '{secret:"DO_NOT_LOG"']
    );
    const err = await listNodeMessages('run-1', 'review').then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(WorkflowNodeMessageCorruptRowError);
    expect((err as Error).message).toBe('Workflow node message row corrupt: bad-json');
    expect((err as Error).message).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(errorLogs)).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(errorLogs)).toContain('bad-json');
  });

  test('concurrent Promise.all appends receive sequences 1 and 2', async () => {
    const [a, b] = await Promise.all([
      appendNodeMessage({
        workflow_run_id: 'run-1',
        node_id: 'parallel',
        kind: 'text',
        payload: { text: 'a' },
      }),
      appendNodeMessage({
        workflow_run_id: 'run-1',
        node_id: 'parallel',
        kind: 'text',
        payload: { text: 'b' },
      }),
    ]);
    expect([a.seq, b.seq].sort((left, right) => left - right)).toEqual([1, 2]);
  });
});

describe('isNodeMessageSequenceConflict', () => {
  test('classifies exact PostgreSQL and SQLite sequence conflicts and rejects unrelated uniques', () => {
    expect(
      isNodeMessageSequenceConflict(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_workflow_node_messages_run_node_seq',
        })
      )
    ).toBe(true);

    expect(
      isNodeMessageSequenceConflict(
        Object.assign(
          new Error(
            'duplicate key value violates unique constraint "uq_workflow_node_messages_run_node_seq"'
          ),
          {
            code: '23505',
            constraint: 'some_other_unique',
          }
        )
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        Object.assign(
          new Error(
            'duplicate key value violates unique constraint "uq_workflow_node_messages_run_node_seq"'
          ),
          { code: '23505' }
        )
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        new Error(
          'duplicate key value violates unique constraint "uq_workflow_node_messages_run_node_seq"'
        )
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        new Error(
          'UNIQUE constraint failed: remote_agent_workflow_node_messages.workflow_run_id, remote_agent_workflow_node_messages.node_id, remote_agent_workflow_node_messages.seq'
        )
      )
    ).toBe(true);

    expect(
      isNodeMessageSequenceConflict(
        new Error(
          'UNIQUE constraint failed: remote_agent_workflow_node_messages.seq, remote_agent_workflow_node_messages.workflow_run_id, remote_agent_workflow_node_messages.node_id'
        )
      )
    ).toBe(true);

    expect(
      isNodeMessageSequenceConflict(
        new Error('UNIQUE constraint failed: remote_agent_workflow_node_messages.id')
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        new Error(
          'UNIQUE constraint failed: remote_agent_workflow_node_messages.workflow_run_id, remote_agent_workflow_node_messages.node_id'
        )
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        new Error(
          'UNIQUE constraint failed: remote_agent_other_table.workflow_run_id, remote_agent_other_table.node_id, remote_agent_other_table.seq'
        )
      )
    ).toBe(false);

    expect(
      isNodeMessageSequenceConflict(
        new Error('UNIQUE constraint failed: workflow_run_id, node_id, seq')
      )
    ).toBe(false);
  });
});
