import { describe, expect, test } from 'bun:test';

import {
  SOLO_TERMINAL_USER_ID,
  serializeServerControlMessage,
  unavailableMessage,
} from './protocol';
import type { SpawnedTerminal } from './pty';
import type { TerminalSessionManager, TerminalSocket } from './session-manager';
import type { TerminalRunRow, TerminalTarget } from './target';
import {
  createTerminalEndpoint,
  type TerminalAuthPort,
  type TerminalEndpointDeps,
  type TerminalSocketData,
  type TerminalUpgradeServer,
} from './endpoint';

const RUN_ID = 'run-1';
const CANONICAL_USER_ID = 'user-canonical';
const SESSION_USER_ID = 'better-auth-user';
const HEADER_USER_ID = 'header-user';
const RESUME_TOKEN = 'ab'.repeat(32);
const HOST_TARGET: TerminalTarget = { kind: 'host', cwd: '/checkout', shell: '/bin/bash' };
const RUN_ROW: TerminalRunRow = { working_path: '/checkout', metadata: {} };

interface RecordedSocket extends TerminalSocket {
  data: TerminalSocketData;
  frames: Array<string | Uint8Array>;
  closes: Array<{ code?: number; reason?: string }>;
}

interface UpgradeCapture extends TerminalUpgradeServer {
  calls: Array<{ url: string; data: TerminalSocketData }>;
  result: boolean;
}

function fakePty(): SpawnedTerminal {
  return {
    write(): void {},
    resize(): void {},
    kill(): void {},
    exited: new Promise(() => {}),
  };
}

function fakeSocket(data: TerminalSocketData): RecordedSocket {
  return {
    data,
    frames: [],
    closes: [],
    send(payload: string | Uint8Array): number {
      this.frames.push(payload);
      return typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
    },
    close(code?: number, reason?: string): void {
      this.closes.push({ code, reason });
    },
    getBufferedAmount(): number {
      return 0;
    },
  };
}

function recordingManager(): TerminalSessionManager & {
  attachCalls: unknown[];
  createCalls: unknown[];
  inputs: Array<{ socket: TerminalSocket; data: string }>;
  resizes: Array<{ socket: TerminalSocket; cols: number; rows: number }>;
  closeCalls: TerminalSocket[];
  disconnectCalls: TerminalSocket[];
  drainCalls: TerminalSocket[];
  destroyAllCount: number;
  attachResult: boolean;
} {
  return {
    attachCalls: [],
    createCalls: [],
    inputs: [],
    resizes: [],
    closeCalls: [],
    disconnectCalls: [],
    drainCalls: [],
    destroyAllCount: 0,
    attachResult: false,
    attachExisting(input): boolean {
      this.attachCalls.push(input);
      return this.attachResult;
    },
    create(input): void {
      this.createCalls.push(input);
    },
    input(socket, data): void {
      this.inputs.push({ socket, data });
    },
    resize(socket, cols, rows): void {
      this.resizes.push({ socket, cols, rows });
    },
    closeSession(socket): void {
      this.closeCalls.push(socket);
    },
    disconnect(socket): void {
      this.disconnectCalls.push(socket);
    },
    drain(socket): void {
      this.drainCalls.push(socket);
    },
    destroyAll(): void {
      this.destroyAllCount += 1;
    },
  };
}

function upgradeServer(result = true): UpgradeCapture {
  const server: UpgradeCapture = {
    calls: [],
    result,
    upgrade(request, options): boolean {
      server.calls.push({ url: request.url, data: options.data });
      return server.result;
    },
  };
  return server;
}

function terminalRequest(
  options: {
    origin?: string | null;
    host?: string;
    method?: string;
    upgrade?: string | null;
    path?: string;
    query?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  const headers = new Headers({
    Host: options.host ?? 'localhost:3090',
    ...(options.headers ?? {}),
  });
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'http://localhost:3090');
  if (options.upgrade !== null) headers.set('Upgrade', options.upgrade ?? 'websocket');
  const path = options.path ?? `/api/workflows/runs/${RUN_ID}/terminal`;
  const query = options.query ? `?${options.query}` : '';
  return new Request(`http://localhost:3090${path}${query}`, {
    method: options.method ?? 'GET',
    headers,
  });
}

function createHarness(
  overrides: Partial<TerminalEndpointDeps> & { manager?: ReturnType<typeof recordingManager> } = {}
): {
  endpoint: ReturnType<typeof createTerminalEndpoint>;
  manager: ReturnType<typeof recordingManager>;
  authCalls: number;
  userCalls: Array<{ platform: 'web'; platformUserId: string; displayName?: string }>;
  runLookups: string[];
  targetRuns: TerminalRunRow[];
  spawnCalls: unknown[];
  authFailures: Array<{ stage: 'session' | 'header'; error: unknown }>;
  openFailures: Array<{ runId: string; userId: string; error: unknown }>;
} {
  const {
    findOrCreateUser: findOrCreateUserOverride,
    getAuth: getAuthOverride,
    manager: managerOverride,
    ...restOverrides
  } = overrides;
  const manager = managerOverride ?? recordingManager();
  const authCalls = { count: 0 };
  const userCalls: Array<{ platform: 'web'; platformUserId: string; displayName?: string }> = [];
  const runLookups: string[] = [];
  const targetRuns: TerminalRunRow[] = [];
  const spawnCalls: unknown[] = [];
  const authFailures: Array<{ stage: 'session' | 'header'; error: unknown }> = [];
  const openFailures: Array<{ runId: string; userId: string; error: unknown }> = [];
  const endpoint = createTerminalEndpoint({
    env: { WEB_UI_ORIGIN: 'http://localhost:3090' },
    getAuth(): TerminalAuthPort | null {
      authCalls.count += 1;
      if (getAuthOverride) return getAuthOverride();
      return null;
    },
    isApiGateEnabled(): boolean {
      return false;
    },
    async findOrCreateUser(platform, platformUserId, displayName) {
      userCalls.push({ platform, platformUserId, displayName });
      if (findOrCreateUserOverride) {
        return findOrCreateUserOverride(platform, platformUserId, displayName);
      }
      return { id: CANONICAL_USER_ID };
    },
    async getWorkflowRun(runId) {
      runLookups.push(runId);
      return RUN_ROW;
    },
    async resolveTerminalTarget(run) {
      targetRuns.push(run);
      return HOST_TARGET;
    },
    spawnTerminalPty(input) {
      spawnCalls.push(input);
      return fakePty();
    },
    manager,
    logAuthFailure(error, stage): void {
      authFailures.push({ error, stage });
    },
    logOpenFailure(error, runId, userId): void {
      openFailures.push({ error, runId, userId });
    },
    ...restOverrides,
  });
  return {
    endpoint,
    manager,
    get authCalls() {
      return authCalls.count;
    },
    userCalls,
    runLookups,
    targetRuns,
    spawnCalls,
    authFailures,
    openFailures,
  };
}

async function jsonError(
  response: Response | undefined
): Promise<{ status: number; body: unknown } | undefined> {
  if (!response) return undefined;
  return { status: response.status, body: await response.json() };
}

describe('createTerminalEndpoint handleUpgrade', () => {
  test('rejects a missing origin before attempting auth', async () => {
    const harness = createHarness();
    const response = await jsonError(
      await harness.endpoint.handleUpgrade(terminalRequest({ origin: null }), upgradeServer())
    );
    expect(response).toEqual({ status: 403, body: { error: 'Forbidden origin' } });
    expect(harness.authCalls).toBe(0);
  });

  test('resolves a Better Auth session before the identity header', async () => {
    const harness = createHarness({
      getAuth(): TerminalAuthPort {
        return {
          api: {
            async getSession() {
              return {
                user: { id: SESSION_USER_ID, name: 'Ada', email: 'ada@example.com' },
              };
            },
          },
        };
      },
    });
    const server = upgradeServer();
    const result = await harness.endpoint.handleUpgrade(
      terminalRequest({ headers: { 'X-Archon-User': HEADER_USER_ID } }),
      server
    );
    expect(result).toBeUndefined();
    expect(harness.userCalls).toEqual([
      { platform: 'web', platformUserId: SESSION_USER_ID, displayName: 'Ada' },
    ]);
    expect(server.calls[0]?.data).toEqual({
      runId: RUN_ID,
      userId: CANONICAL_USER_ID,
      resumeToken: null,
    });
  });

  test('falls back to the trusted identity header and canonical user id', async () => {
    const harness = createHarness({
      async findOrCreateUser(_platform, platformUserId) {
        return { id: `canonical-${platformUserId}` };
      },
    });
    const server = upgradeServer();
    const result = await harness.endpoint.handleUpgrade(
      terminalRequest({ headers: { 'X-Archon-User': HEADER_USER_ID } }),
      server
    );
    expect(result).toBeUndefined();
    expect(harness.userCalls).toEqual([
      { platform: 'web', platformUserId: HEADER_USER_ID, displayName: HEADER_USER_ID },
    ]);
    expect(server.calls[0]?.data.userId).toBe(`canonical-${HEADER_USER_ID}`);
  });

  test('returns 401 for anonymous requests when the API gate is on', async () => {
    const harness = createHarness({
      isApiGateEnabled: () => true,
    });
    const server = upgradeServer();
    expect(
      await jsonError(await harness.endpoint.handleUpgrade(terminalRequest(), server))
    ).toEqual({
      status: 401,
      body: { error: 'Authentication required' },
    });
    expect(server.calls).toEqual([]);
  });

  test('uses solo when the API gate is off and no identity resolves', async () => {
    const server = upgradeServer();
    const result = await createHarness().endpoint.handleUpgrade(terminalRequest(), server);
    expect(result).toBeUndefined();
    expect(server.calls[0]?.data.userId).toBe(SOLO_TERMINAL_USER_ID);
  });

  test('keeps a resolved identity per-user when the API gate is off', async () => {
    const harness = createHarness({
      isApiGateEnabled: () => false,
      async findOrCreateUser() {
        return { id: CANONICAL_USER_ID };
      },
    });
    const server = upgradeServer();
    await harness.endpoint.handleUpgrade(
      terminalRequest({ headers: { 'X-Archon-User': HEADER_USER_ID } }),
      server
    );
    expect(server.calls[0]?.data.userId).toBe(CANONICAL_USER_ID);
    expect(server.calls[0]?.data.userId).not.toBe(SOLO_TERMINAL_USER_ID);
  });

  test('returns 426 for non-GET and missing upgrade headers', async () => {
    const harness = createHarness();
    expect(
      await jsonError(
        await harness.endpoint.handleUpgrade(terminalRequest({ method: 'POST' }), upgradeServer())
      )
    ).toEqual({ status: 426, body: { error: 'WebSocket upgrade required' } });
    expect(
      await jsonError(
        await harness.endpoint.handleUpgrade(terminalRequest({ upgrade: null }), upgradeServer())
      )
    ).toEqual({ status: 426, body: { error: 'WebSocket upgrade required' } });
  });

  test('returns 404 when the workflow run is missing', async () => {
    const harness = createHarness({
      async getWorkflowRun() {
        return null;
      },
    });
    const server = upgradeServer();
    expect(
      await jsonError(await harness.endpoint.handleUpgrade(terminalRequest(), server))
    ).toEqual({
      status: 404,
      body: { error: 'Workflow run not found' },
    });
    expect(server.calls).toEqual([]);
  });

  test('returns 400 when the run id cannot be percent-decoded', async () => {
    const harness = createHarness();
    expect(
      await jsonError(
        await harness.endpoint.handleUpgrade(
          terminalRequest({ path: '/api/workflows/runs/run%ZZ/terminal' }),
          upgradeServer()
        )
      )
    ).toEqual({ status: 400, body: { error: 'Invalid run ID' } });
  });

  test('returns 500 when Bun upgrade fails and undefined when it succeeds', async () => {
    const harness = createHarness();
    expect(
      await jsonError(await harness.endpoint.handleUpgrade(terminalRequest(), upgradeServer(false)))
    ).toEqual({
      status: 500,
      body: { error: 'WebSocket upgrade failed' },
    });
    expect(
      await harness.endpoint.handleUpgrade(terminalRequest(), upgradeServer(true))
    ).toBeUndefined();
  });

  test('passes only runId, userId, and a validated or null resume token to upgrade', async () => {
    const harness = createHarness();
    const server = upgradeServer();
    await harness.endpoint.handleUpgrade(
      terminalRequest({
        query: [
          `resume=${RESUME_TOKEN}`,
          'cwd=/etc',
          'working_path=/etc/passwd',
          'isolation_env_id=forged-env',
          'containerId=forged-container',
        ].join('&'),
      }),
      server
    );
    expect(server.calls).toHaveLength(1);
    expect(Object.keys(server.calls[0]!.data).sort()).toEqual(['resumeToken', 'runId', 'userId']);
    expect(server.calls[0]!.data).toEqual({
      runId: RUN_ID,
      userId: SOLO_TERMINAL_USER_ID,
      resumeToken: RESUME_TOKEN,
    });
    expect(harness.runLookups).toEqual([RUN_ID]);
  });

  test('normalizes an invalid resume query value to null', async () => {
    const server = upgradeServer();
    await createHarness().endpoint.handleUpgrade(
      terminalRequest({ query: 'resume=not-a-token' }),
      server
    );
    expect(server.calls[0]?.data.resumeToken).toBeNull();
  });
});

describe('createTerminalEndpoint websocket callbacks', () => {
  test('attaches an existing session before resolving a target', async () => {
    const manager = recordingManager();
    manager.attachResult = true;
    const harness = createHarness({ manager });
    const ws = fakeSocket({
      runId: RUN_ID,
      userId: CANONICAL_USER_ID,
      resumeToken: RESUME_TOKEN,
    });
    await harness.endpoint.websocket.open!(ws as never);
    expect(manager.attachCalls).toHaveLength(1);
    expect(harness.targetRuns).toEqual([]);
    expect(manager.createCalls).toEqual([]);
    expect(harness.spawnCalls).toEqual([]);
  });

  test('sends the locked unavailable frame when the target cannot be opened', async () => {
    const harness = createHarness({
      async resolveTerminalTarget() {
        return { kind: 'unavailable', reason: 'no_checkout' };
      },
    });
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    await harness.endpoint.websocket.open!(ws as never);
    expect(ws.frames).toEqual([
      serializeServerControlMessage({
        type: 'unavailable',
        reason: 'no_checkout',
        message: unavailableMessage('no_checkout'),
      }),
    ]);
    expect(ws.closes).toEqual([{ code: 1000, reason: 'Terminal unavailable' }]);
    expect(harness.manager.createCalls).toEqual([]);
  });

  test('spawns exactly one PTY from the server-owned target', async () => {
    const harness = createHarness();
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    await harness.endpoint.websocket.open!(ws as never);
    expect(harness.targetRuns).toEqual([RUN_ROW]);
    expect(harness.manager.createCalls).toHaveLength(1);
    const created = harness.manager.createCalls[0] as {
      runId: string;
      userId: string;
      targetKind: string;
      socket: TerminalSocket;
      spawn(onData: (chunk: Uint8Array) => void): SpawnedTerminal;
    };
    expect(created.runId).toBe(RUN_ID);
    expect(created.userId).toBe(CANONICAL_USER_ID);
    expect(created.targetKind).toBe('host');
    expect(created.socket).toBe(ws);
    created.spawn(() => {});
    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]).toMatchObject({ target: HOST_TARGET, cols: 80, rows: 24 });
  });

  test('does not pass hostile query values into target resolution', async () => {
    const harness = createHarness();
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    await harness.endpoint.websocket.open!(ws as never);
    expect(harness.targetRuns).toEqual([RUN_ROW]);
    expect(harness.targetRuns[0]).toEqual({ working_path: '/checkout', metadata: {} });
  });

  test('sends a locked error and closes when open fails', async () => {
    const harness = createHarness({
      async resolveTerminalTarget() {
        throw new Error('/secret/path exploded');
      },
    });
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    await harness.endpoint.websocket.open!(ws as never);
    expect(harness.openFailures).toHaveLength(1);
    expect(harness.openFailures[0]?.runId).toBe(RUN_ID);
    expect(harness.openFailures[0]?.userId).toBe(CANONICAL_USER_ID);
    expect(ws.frames).toEqual([
      serializeServerControlMessage({ type: 'error', message: 'Could not open the terminal.' }),
    ]);
    expect(ws.closes).toEqual([{ code: 1011, reason: 'Terminal open failed' }]);
  });

  test('dispatches text input, resize, and close and destroys invalid frames', () => {
    const harness = createHarness();
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    harness.endpoint.websocket.message!(
      ws as never,
      JSON.stringify({ type: 'input', data: 'ls\n' })
    );
    harness.endpoint.websocket.message!(
      ws as never,
      JSON.stringify({ type: 'resize', cols: 120, rows: 40 })
    );
    harness.endpoint.websocket.message!(ws as never, JSON.stringify({ type: 'close' }));
    expect(harness.manager.inputs).toEqual([{ socket: ws, data: 'ls\n' }]);
    expect(harness.manager.resizes).toEqual([{ socket: ws, cols: 120, rows: 40 }]);
    expect(harness.manager.closeCalls).toEqual([ws]);

    const invalid = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    harness.endpoint.websocket.message!(invalid as never, '{not-json');
    const binary = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    harness.endpoint.websocket.message!(binary as never, new Uint8Array([1, 2, 3]) as never);
    expect(harness.manager.closeCalls).toEqual([ws, invalid, binary]);
  });

  test('close and drain forward the same socket identity to the manager', () => {
    const harness = createHarness();
    const ws = fakeSocket({ runId: RUN_ID, userId: CANONICAL_USER_ID, resumeToken: null });
    harness.endpoint.websocket.close!(ws as never, 1001, 'going away');
    harness.endpoint.websocket.drain!(ws as never);
    expect(harness.manager.disconnectCalls).toEqual([ws]);
    expect(harness.manager.drainCalls).toEqual([ws]);
  });

  test('destroyAll delegates to the session manager', () => {
    const harness = createHarness();
    harness.endpoint.destroyAll();
    expect(harness.manager.destroyAllCount).toBe(1);
  });
});
