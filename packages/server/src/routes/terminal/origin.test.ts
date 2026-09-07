import { describe, expect, test } from 'bun:test';

import { TerminalOriginError, assertTerminalOrigin } from './origin';

function request(origin: string | null, host = 'localhost:3090'): Request {
  const headers = new Headers({ Host: host });
  if (origin !== null) headers.set('Origin', origin);
  return new Request('http://localhost:3090/api/workflows/runs/run-1/terminal', { headers });
}

describe('assertTerminalOrigin', () => {
  test('rejects missing, malformed, opaque, and cross-host origins', () => {
    for (const origin of [
      null,
      'not a url',
      'null',
      'file:///tmp/index.html',
      'https://evil.test',
    ]) {
      expect(() => assertTerminalOrigin(request(origin), {})).toThrow(TerminalOriginError);
    }
  });

  test('allows the Vite origin when only the port differs', () => {
    expect(() => assertTerminalOrigin(request('http://localhost:5173'), {})).not.toThrow();
  });

  test('normalizes a concrete WEB_UI_ORIGIN and rejects every other origin', () => {
    const env = { WEB_UI_ORIGIN: 'https://archon.example/' };
    expect(() =>
      assertTerminalOrigin(request('https://archon.example', 'archon.example'), env)
    ).not.toThrow();
    expect(() =>
      assertTerminalOrigin(request('http://archon.example', 'archon.example'), env)
    ).toThrow(TerminalOriginError);
  });

  test('treats WEB_UI_ORIGIN=* as same-host rather than allow-all', () => {
    expect(() =>
      assertTerminalOrigin(request('http://localhost:5173'), { WEB_UI_ORIGIN: '*' })
    ).not.toThrow();
    expect(() =>
      assertTerminalOrigin(request('http://other.test:5173'), { WEB_UI_ORIGIN: '*' })
    ).toThrow(TerminalOriginError);
  });
});
