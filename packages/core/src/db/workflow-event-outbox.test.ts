import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));

mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
}));

mock.module('@archon/paths', () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    trace: mock(() => {}),
    fatal: mock(() => {}),
  })),
}));

import {
  claimDueOutboxEvents,
  completeAttempt,
  enqueueExternalWorkflowEvent,
  insertExternalWorkflowEvent,
  updateOutboxAfterAttempt,
} from './workflow-event-outbox';

function outboxRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'outbox-1',
    event_id: 'evt-1',
    idempotency_key: 'archon:workflow-engine-primary:evt-1',
    event_type: 'workflow.run.completed',
    provider: 'archon',
    workflow_run_id: 'run-1',
    codebase_id: 'cb-1',
    binding_id: 'wpb-1',
    event_route: 'https://hermes.example/events',
    event_body: '{"eventId":"evt-1"}',
    status: 'pending',
    not_routable_reason: null,
    attempt_count: 0,
    last_attempt_at: null,
    next_attempt_at: '2026-07-25T00:00:00.000Z',
    last_error: null,
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'attempt-1',
    outbox_event_id: 'outbox-1',
    attempt_number: 1,
    request_url: 'https://hermes.example/events',
    request_method: 'POST',
    request_headers: '{}',
    request_body: '{"eventId":"evt-1"}',
    response_status: null,
    response_headers: null,
    response_body: null,
    transport_error: null,
    started_at: '2026-07-25T00:00:00.000Z',
    completed_at: null,
    duration_ms: null,
    outcome: 'pending',
    ...overrides,
  };
}

describe('workflow-event-outbox db layer', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(() => Promise.resolve(createQueryResult([])));
  });

  test('insertExternalWorkflowEvent inserts a stable body and idempotency key', async () => {
    mockQuery.mockResolvedValueOnce(createQueryResult([outboxRow()], 1));

    const result = await insertExternalWorkflowEvent(
      (sql, params) => mockQuery(sql, params) as ReturnType<typeof mockQuery>,
      {
        event_id: 'evt-1',
        idempotency_key: 'archon:workflow-engine-primary:evt-1',
        event_type: 'workflow.run.completed',
        workflow_run_id: 'run-1',
        codebase_id: 'cb-1',
        binding_id: 'wpb-1',
        event_route: 'https://hermes.example/events',
        event_body: '{"eventId":"evt-1"}',
        next_attempt_at: '2026-07-25T00:00:00.000Z',
      }
    );

    expect(result.event_id).toBe('evt-1');
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO remote_agent_workflow_event_outbox');
    expect(sql).toContain('RETURNING *');
    expect(params).toContain('archon:workflow-engine-primary:evt-1');
    expect(params).toContain('{"eventId":"evt-1"}');
  });

  test('enqueueExternalWorkflowEvent logs and swallows insert failures', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    await expect(
      enqueueExternalWorkflowEvent({
        event_id: 'evt-1',
        idempotency_key: 'archon:workflow-engine-primary:evt-1',
        event_type: 'workflow.run.completed',
        workflow_run_id: 'run-1',
        event_body: '{}',
      })
    ).resolves.toBeUndefined();
  });

  test('claimDueOutboxEvents leaves indeterminate pending attempts eligible after restart', async () => {
    mockQuery.mockResolvedValueOnce(createQueryResult([outboxRow()], 1));

    await claimDueOutboxEvents(25, '2026-07-25T00:00:00.000Z');

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status IN ('pending', 'retrying')");
    expect(sql).not.toContain('NOT EXISTS');
    expect(sql).not.toContain("attempts.outcome = 'pending'");
  });

  test('attempt and outbox updates use UPDATE then SELECT instead of UPDATE RETURNING', async () => {
    mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
    mockQuery.mockResolvedValueOnce(
      createQueryResult([attemptRow({ outcome: 'succeeded', completed_at: new Date() })], 1)
    );
    await completeAttempt({
      attemptId: 'attempt-1',
      outcome: 'succeeded',
      completedAt: new Date('2026-07-25T00:00:01.000Z'),
      durationMs: 1000,
      responseStatus: 204,
      responseHeaders: {},
      responseBody: '',
    });

    mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
    mockQuery.mockResolvedValueOnce(
      createQueryResult([outboxRow({ status: 'delivered', attempt_count: 1 })], 1)
    );
    await updateOutboxAfterAttempt('outbox-1', {
      status: 'delivered',
      attempt_count: 1,
      last_attempt_at: new Date('2026-07-25T00:00:01.000Z'),
      next_attempt_at: null,
      last_error: null,
    });

    const updateSql = mockQuery.mock.calls
      .map(call => (call[0] as string).trim())
      .filter(sql => sql.startsWith('UPDATE'));
    expect(updateSql).toHaveLength(2);
    expect(updateSql.every(sql => !sql.includes('RETURNING'))).toBe(true);
  });
});
