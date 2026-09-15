import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { HttpError } from '../lib/http';
import { K } from '../store/keys';
import { getConversation } from './conversations';

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

function stubFetch(handler: (url: string, init?: RequestInit) => Response): FetchSpy {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
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

describe('getConversation', () => {
  test('encodes the platform id and maps the conversation summary', async () => {
    stubFetch(url => {
      expect(url).toBe('/api/conversations/web%2Fparent');
      return jsonResponse({
        id: 'db-1',
        platform_conversation_id: 'web/parent',
        platform_type: 'web',
        title: 'Parent chat',
        last_activity_at: '2026-09-08T00:00:00.000Z',
      });
    });

    const summary = await getConversation('web/parent');
    expect(summary).toEqual({
      id: 'web/parent',
      title: 'Parent chat',
      platformType: 'web',
      lastActivityAt: '2026-09-08T00:00:00.000Z',
    });
  });

  test('rejects a non-2xx response as HttpError', async () => {
    ensureWindow();
    stubFetch(() => jsonResponse({ error: 'missing' }, 404));
    await expect(getConversation('web/missing')).rejects.toBeInstanceOf(HttpError);
  });

  test('forwards AbortSignal through requestJson', async () => {
    const controller = new AbortController();
    stubFetch((_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse({
        id: 'db-2',
        platform_conversation_id: 'web/parent',
        platform_type: 'web',
        title: null,
        last_activity_at: null,
      });
    });
    await getConversation('web/parent', { signal: controller.signal });
    expect(fetchSpy?.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('K.parentConversation', () => {
  test('encodes slash and colon ids distinctly from each other and from null', () => {
    expect(K.parentConversation('web/a')).not.toBe(K.parentConversation('web:a'));
    expect(K.parentConversation('web/a')).not.toBe(K.parentConversation(null));
    expect(K.parentConversation('web:a')).not.toBe(K.parentConversation(null));
  });
});
