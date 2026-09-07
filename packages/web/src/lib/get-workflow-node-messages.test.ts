import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { getWorkflowNodeMessages } from './api';

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
    await getWorkflowNodeMessages('run/one', 'group.review', { afterSeq: 4, limit: 10 });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/workflows/runs/run%2Fone/nodes/group.review/messages?afterSeq=4&limit=10'
    );
  });
});
