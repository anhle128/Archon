import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { getWorkflowNodeMessage, getWorkflowNodeMessages } from './api';

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('getWorkflowNodeMessages', () => {
  test('encodes run and node ids and returns the generated response', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          messages: [
            {
              id: 'message-1',
              seq: 1,
              kind: 'text',
              payload: { text: 'hello' },
              created_at: '2026-09-06T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const result = await getWorkflowNodeMessages('run/one', 'group.review');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/nodes/group.review/messages'
    );
    expect(result.messages[0]?.payload).toEqual({ text: 'hello' });
  });

  test('appends optional cursor query parameters', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [], hasMore: false, highWatermark: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await getWorkflowNodeMessages('run/one', 'group.review', {
      afterSeq: 4,
      limit: 10,
      occurrenceId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/nodes/group.review/messages?afterSeq=4&limit=10&occurrenceId=11111111-1111-4111-8111-111111111111&attemptId=22222222-2222-4222-8222-222222222222'
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('signal');
  });

  test('forwards AbortSignal on the fetch RequestInit without putting it in the query', async () => {
    // Omitting RequestInit.signal from fetchJSON must fail this test.
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [], hasMore: false, highWatermark: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const controller = new AbortController();
    await getWorkflowNodeMessages('run/one', 'group.review', {
      afterSeq: 4,
      limit: 10,
      signal: controller.signal,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/nodes/group.review/messages?afterSeq=4&limit=10'
    );
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('getWorkflowNodeMessage', () => {
  test('encodes slash and space ids, returns the row, and forwards AbortSignal', async () => {
    // Omitting RequestInit.signal from fetchJSON must fail this test.
    const message = {
      id: 'message/one',
      seq: 1,
      kind: 'text' as const,
      payload: { text: 'full' },
      created_at: '2026-09-06T00:00:00.000Z',
    };
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(message), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const controller = new AbortController();
    const result = await getWorkflowNodeMessage('run/one', 'node one', 'message/one', {
      signal: controller.signal,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/nodes/node%20one/messages/message%2Fone'
    );
    expect(result).toEqual(message);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
