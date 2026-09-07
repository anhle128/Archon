import { describe, expect, test } from 'bun:test';

import { createFetchWithTerminal, createTerminalEndpoint } from './index';
import type { TerminalEndpoint, TerminalUpgradeServer } from './endpoint';

const TERMINAL_PATH = '/api/workflows/runs/run-1/terminal';

function request(path: string, method = 'GET'): Request {
  return new Request(`http://localhost:3090${path}`, { method });
}

const RECORDING_DEFAULT = Symbol('recording-default');
const RECORDING_UNDEFINED = Symbol('recording-undefined');

function recordingEndpoint(
  response: Response | typeof RECORDING_DEFAULT | typeof RECORDING_UNDEFINED = RECORDING_DEFAULT
): TerminalEndpoint & {
  matchesCalls: string[];
  upgradeCalls: Request[];
} {
  return {
    matchesCalls: [],
    upgradeCalls: [],
    matches(pathname: string): boolean {
      this.matchesCalls.push(pathname);
      return pathname === TERMINAL_PATH;
    },
    async handleUpgrade(req: Request, _server: TerminalUpgradeServer) {
      this.upgradeCalls.push(req);
      if (response === RECORDING_UNDEFINED) return undefined;
      return response === RECORDING_DEFAULT ? new Response('upgrade-handled') : response;
    },
    websocket: {},
    destroyAll(): void {},
  };
}

describe('createFetchWithTerminal', () => {
  test('intercepts the exact terminal pathname before Hono', async () => {
    const endpoint = recordingEndpoint();
    const fetchCalls: Request[] = [];
    const fetch = createFetchWithTerminal(req => {
      fetchCalls.push(req);
      return new Response('hono');
    }, endpoint);
    const req = request(`${TERMINAL_PATH}?resume=token`);
    const server: TerminalUpgradeServer = {
      upgrade(): boolean {
        return true;
      },
    };

    const result = await fetch(req, server);

    expect(endpoint.matchesCalls).toEqual([TERMINAL_PATH]);
    expect(endpoint.upgradeCalls).toEqual([req]);
    expect(fetchCalls).toEqual([]);
    expect(await result?.text()).toBe('upgrade-handled');
  });

  test('preserves undefined when the terminal upgrade is accepted', async () => {
    const endpoint = recordingEndpoint(RECORDING_UNDEFINED);
    const fetch = createFetchWithTerminal(() => new Response('hono'), endpoint);
    const result = await fetch(request(TERMINAL_PATH), {
      upgrade(): boolean {
        return true;
      },
    });
    expect(result).toBeUndefined();
  });

  test('passes unrelated API, webhook, static, and SPA paths to app.fetch unchanged', async () => {
    const endpoint = recordingEndpoint();
    const fetchCalls: Request[] = [];
    const fetch = createFetchWithTerminal(req => {
      fetchCalls.push(req);
      return new Response(`hono:${new URL(req.url).pathname}`);
    }, endpoint);
    const server: TerminalUpgradeServer = {
      upgrade(): boolean {
        throw new Error('upgrade must not run for unrelated paths');
      },
    };
    const unrelated = [
      '/api/workflows',
      '/api/workflows/runs/run-1',
      '/api/workflows/runs/run-1/terminal/extra',
      '/webhooks/github',
      '/assets/index.js',
      '/runs/run-1',
    ];

    for (const path of unrelated) {
      const req = request(path);
      const result = await fetch(req, server);
      expect(await result?.text()).toBe(`hono:${path}`);
      expect(fetchCalls.at(-1)).toBe(req);
    }

    expect(endpoint.upgradeCalls).toEqual([]);
    expect(endpoint.matchesCalls).toEqual(unrelated);
  });

  test('createTerminalEndpoint matches only the locked terminal pathname', () => {
    const endpoint = createTerminalEndpoint();
    expect(endpoint.matches(TERMINAL_PATH)).toBe(true);
    expect(endpoint.matches('/api/workflows/runs/run-1/terminal/')).toBe(false);
    expect(endpoint.matches('/api/workflows')).toBe(false);
  });
});
