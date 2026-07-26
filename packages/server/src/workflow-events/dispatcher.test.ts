import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockClaimDueOutboxEvents = mock(async () => []);
const mockInsertPendingAttempt = mock(async () => attemptRow());
const mockCompleteAttempt = mock(async () => attemptRow({ outcome: 'succeeded' }));
const mockUpdateOutboxAfterAttempt = mock(async () => outboxRow({ status: 'delivered' }));
const mockGetBindingByIdWithSecret = mock(async () => ({ signing_secret: 'test-secret' }));
const mockStoreEnqueueExternalWorkflowEvent = mock(async () => {});

mock.module('@archon/core/db/workflow-event-outbox', () => ({
  claimDueOutboxEvents: mockClaimDueOutboxEvents,
  insertPendingAttempt: mockInsertPendingAttempt,
  completeAttempt: mockCompleteAttempt,
  updateOutboxAfterAttempt: mockUpdateOutboxAfterAttempt,
}));

mock.module('@archon/core/db/provider-bindings', () => ({
  getBindingByIdWithSecret: mockGetBindingByIdWithSecret,
}));

mock.module('@archon/core/workflows', () => ({
  createWorkflowStore: mock(() => ({
    enqueueExternalWorkflowEvent: mockStoreEnqueueExternalWorkflowEvent,
  })),
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

import { WorkflowEventDispatcher } from './dispatcher';

const fixedNow = new Date('2026-07-25T00:00:00.000Z');

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
    event_body: '{"schemaVersion":"workflow-event-envelope.v1","eventId":"evt-1"}',
    status: 'pending',
    not_routable_reason: null,
    attempt_count: 0,
    last_attempt_at: null,
    next_attempt_at: fixedNow.toISOString(),
    last_error: null,
    created_at: fixedNow.toISOString(),
    updated_at: fixedNow.toISOString(),
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
    request_body: '{"schemaVersion":"workflow-event-envelope.v1","eventId":"evt-1"}',
    response_status: null,
    response_headers: null,
    response_body: null,
    transport_error: null,
    started_at: fixedNow.toISOString(),
    completed_at: null,
    duration_ms: null,
    outcome: 'pending',
    ...overrides,
  };
}

function hmac(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('WorkflowEventDispatcher', () => {
  beforeEach(() => {
    mockClaimDueOutboxEvents.mockReset();
    mockInsertPendingAttempt.mockReset();
    mockCompleteAttempt.mockReset();
    mockUpdateOutboxAfterAttempt.mockReset();
    mockGetBindingByIdWithSecret.mockReset();
    mockStoreEnqueueExternalWorkflowEvent.mockReset();
    mockClaimDueOutboxEvents.mockImplementation(async () => []);
    mockInsertPendingAttempt.mockImplementation(async () => attemptRow());
    mockCompleteAttempt.mockImplementation(async () => attemptRow({ outcome: 'succeeded' }));
    mockUpdateOutboxAfterAttempt.mockImplementation(async () => outboxRow({ status: 'delivered' }));
    mockGetBindingByIdWithSecret.mockImplementation(async () => ({
      signing_secret: 'test-secret',
    }));
    mockStoreEnqueueExternalWorkflowEvent.mockImplementation(async () => {});
  });

  test('posts the stored body with Hermes V2 headers and marks delivery succeeded', async () => {
    const row = outboxRow();
    mockClaimDueOutboxEvents.mockResolvedValueOnce([row]);
    const fetchImpl = mock(async () => new Response('', { status: 204 }));
    const dispatcher = new WorkflowEventDispatcher({
      now: () => fixedNow,
      fetchImpl,
      enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
    });

    await dispatcher.drainNow();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Record<string, string>;
    const expectedSignature = createHmac('sha256', 'test-secret')
      .update(`${Math.floor(fixedNow.getTime() / 1000)}.${row.event_body}`)
      .digest('hex');
    expect(request.body).toBe(row.event_body);
    expect(headers['X-Webhook-Signature-V2']).toBe(expectedSignature);
    expect(headers['X-Webhook-Timestamp']).toBe(String(Math.floor(fixedNow.getTime() / 1000)));
    expect(headers['X-Request-ID']).toBe(row.idempotency_key);
    expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
      status: 'delivered',
      attempt_count: 1,
      next_attempt_at: null,
      last_error: null,
    });
  });

  test('does not send HTTP when pending attempt insertion fails', async () => {
    mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
    mockInsertPendingAttempt.mockRejectedValueOnce(new Error('insert failed'));
    const fetchImpl = mock(async () => new Response('', { status: 204 }));
    const dispatcher = new WorkflowEventDispatcher({ now: () => fixedNow, fetchImpl });

    await dispatcher.drainNow();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockUpdateOutboxAfterAttempt).not.toHaveBeenCalled();
  });

  test('uses deterministic backoff and terminal failure on attempt 8', async () => {
    const updates: Record<string, unknown>[] = [];
    mockUpdateOutboxAfterAttempt.mockImplementation(async (_id, update) => {
      updates.push(update as Record<string, unknown>);
      return outboxRow(update as Record<string, unknown>);
    });
    const fetchImpl = mock(async () => new Response('nope', { status: 500 }));
    const dispatcher = new WorkflowEventDispatcher({
      now: () => fixedNow,
      fetchImpl,
      enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
    });

    for (let attemptCount = 0; attemptCount < 8; attemptCount += 1) {
      mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow({ attempt_count: attemptCount })]);
      await dispatcher.drainNow();
    }

    const retryDelays = updates.slice(0, 7).map(update => {
      const next = update.next_attempt_at as Date;
      return (next.getTime() - fixedNow.getTime()) / 60_000;
    });
    expect(retryDelays).toEqual([1, 2, 4, 8, 16, 32, 60]);
    expect(updates[7]).toMatchObject({
      status: 'terminal-failure',
      attempt_count: 8,
      next_attempt_at: null,
      last_error: 'http-500',
    });
  });

  test('does not enqueue recursive workflow.delivery.failed events', async () => {
    mockClaimDueOutboxEvents.mockResolvedValueOnce([
      outboxRow({ event_type: 'workflow.delivery.failed' }),
    ]);
    const fetchImpl = mock(async () => new Response('nope', { status: 500 }));
    const dispatcher = new WorkflowEventDispatcher({
      now: () => fixedNow,
      fetchImpl,
      enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
    });

    await dispatcher.drainNow();

    expect(mockStoreEnqueueExternalWorkflowEvent).not.toHaveBeenCalled();
  });

  test('aborts a hung webhook request and schedules retry', async () => {
    mockClaimDueOutboxEvents.mockResolvedValueOnce([outboxRow()]);
    const fetchImpl = mock(
      (_url: string | URL | Request, request?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const dispatcher = new WorkflowEventDispatcher({
      now: () => fixedNow,
      fetchImpl,
      requestTimeoutMs: 1,
      enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
    });

    await dispatcher.drainNow();

    expect(mockCompleteAttempt.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failed',
      transportError: 'aborted',
    });
    expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
      status: 'retrying',
      attempt_count: 1,
      last_error: 'transport-error',
    });
  });

  test('real local HTTP verifier accepts the valid HMAC signature', async () => {
    let verified = false;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.text();
        const timestamp = request.headers.get('X-Webhook-Timestamp') ?? '';
        const expected = hmac('test-secret', timestamp, body);
        verified = request.headers.get('X-Webhook-Signature-V2') === expected;
        return new Response('', { status: verified ? 204 : 403 });
      },
    });
    try {
      mockClaimDueOutboxEvents.mockResolvedValueOnce([
        outboxRow({ event_route: String(server.url) }),
      ]);
      const dispatcher = new WorkflowEventDispatcher({
        now: () => fixedNow,
        enqueueDeliveryFailed: mockStoreEnqueueExternalWorkflowEvent,
      });

      await dispatcher.drainNow();

      expect(verified).toBe(true);
      expect(mockUpdateOutboxAfterAttempt.mock.calls[0]?.[1]).toMatchObject({
        status: 'delivered',
      });
    } finally {
      server.stop(true);
    }
  });

  test('real local HTTP verifier rejects tampered body, wrong secret, and stale timestamp', async () => {
    const nowSeconds = Math.floor(fixedNow.getTime() / 1000);
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.text();
        const timestamp = request.headers.get('X-Webhook-Timestamp') ?? '';
        const timestampSeconds = Number(timestamp);
        const fresh =
          Number.isFinite(timestampSeconds) && Math.abs(nowSeconds - timestampSeconds) <= 300;
        const expected = hmac('test-secret', timestamp, body);
        const verified = fresh && request.headers.get('X-Webhook-Signature-V2') === expected;
        return new Response('', { status: verified ? 204 : 403 });
      },
    });
    const body = '{"schemaVersion":"workflow-event-envelope.v1","eventId":"evt-1"}';
    const send = async (input: {
      body: string;
      signedBody?: string;
      secret?: string;
      timestamp?: number;
    }): Promise<Response> => {
      const timestamp = String(input.timestamp ?? nowSeconds);
      return await fetch(String(server.url), {
        method: 'POST',
        headers: {
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature-V2': hmac(
            input.secret ?? 'test-secret',
            timestamp,
            input.signedBody ?? input.body
          ),
        },
        body: input.body,
      });
    };

    try {
      expect((await send({ body })).status).toBe(204);
      expect((await send({ body: '{"tampered":true}', signedBody: body })).status).toBe(403);
      expect((await send({ body, secret: 'wrong-secret' })).status).toBe(403);
      expect((await send({ body, timestamp: nowSeconds - 301 })).status).toBe(403);
    } finally {
      server.stop(true);
    }
  });
});
