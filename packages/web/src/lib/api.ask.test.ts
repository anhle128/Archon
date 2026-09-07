import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { answerAskHuman, getApiErrorStatus } from './api';

Object.assign(globalThis, {
  window: { location: { origin: 'http://localhost' } },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe('answerAskHuman', () => {
  test('posts one encoded Ask answer', async () => {
    const response = { success: true, message: 'accepted' };
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(response));

    const body = { answers: [{ questionId: 'q1', value: 'Ship' }] };
    const result = await answerAskHuman('run/a', 'tool b', body);

    expect(result).toEqual(response);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows/runs/run%2Fa/ask/tool%20b/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });
});

describe('getApiErrorStatus', () => {
  test('reads numeric API error status', () => {
    const cases: Array<{ error: unknown; expected: number | null }> = [
      { error: { status: 409 }, expected: 409 },
      { error: Object.create({ status: 409 }), expected: 409 },
      { error: new Error('x'), expected: null },
      { error: null, expected: null },
      { error: '409', expected: null },
      { error: { status: '409' }, expected: null },
    ];

    for (const { error, expected } of cases) {
      expect(getApiErrorStatus(error)).toBe(expected);
    }
  });
});
