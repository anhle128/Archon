import { afterEach, expect, spyOn, test } from 'bun:test';
import { HttpError } from '../lib/http';
import { answerAskHuman } from './runs';

type FetchSpy = ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let fetchSpy: FetchSpy | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string) => Response): FetchSpy {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as typeof fetch);
  return fetchSpy;
}

function ensureWindow(): void {
  if (typeof (globalThis as { window?: { location: { origin: string } } }).window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'http://localhost', hostname: 'localhost' } },
    });
  }
}

test('answerAskHuman posts an encoded URL and JSON body', async () => {
  stubFetch(url => {
    expect(url).toBe('/api/workflows/runs/run%2F1/ask/toolu%20a/answer');
    return jsonResponse({ success: true, message: 'ok' });
  });
  const result = await answerAskHuman('run/1', 'toolu a', { decline: true });
  expect(result).toEqual({ success: true, message: 'ok' });
  const init = fetchSpy?.mock.calls[0]?.[1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(init.body).toBe(JSON.stringify({ decline: true }));
});

test('answerAskHuman rejects a 409 as HttpError with status 409', async () => {
  ensureWindow();
  stubFetch(() => new Response('taken', { status: 409 }));
  try {
    await answerAskHuman('run/1', 'toolu_1', { answers: [{ questionId: 'q1', value: 'yes' }] });
    throw new Error('expected reject');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
  }
});
