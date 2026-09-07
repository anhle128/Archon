import { describe, expect, test } from 'bun:test';

import {
  createRunTerminalClient,
  type TerminalBrowserSocket,
  type TerminalClientState,
} from './client';
import {
  INPUT_MAX_BYTES,
  RECONNECT_MS,
  REPLACED_SOCKET_CLOSE_CODE,
  resumeStorageKey,
} from './protocol';

const RUN_ID = 'run/1';
const TOKEN = 'a'.repeat(64);
const NEXT_TOKEN = 'b'.repeat(64);
const ENCODED_PATH = '/api/workflows/runs/run%2F1/terminal';

interface FakeSocket extends TerminalBrowserSocket {
  url: string;
  sent: string[];
  closes: Array<{ code?: number; reason?: string }>;
  listeners: {
    open: Array<() => void>;
    message: Array<(event: { data: unknown }) => void>;
    close: Array<(event: { code: number; reason: string }) => void>;
    error: Array<() => void>;
  };
  open(): void;
  receiveText(raw: string): void;
  receiveBinary(bytes: Uint8Array): void;
  remoteClose(code: number, reason?: string): void;
}

interface Timer {
  id: number;
  callback: () => void;
  ms: number;
}

function fakeStorage(initial: Record<string, string> = {}): {
  store: Map<string, string>;
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    storage: {
      getItem(key: string): string | null {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        store.set(key, value);
      },
      removeItem(key: string): void {
        store.delete(key);
      },
    },
  };
}

function createSocket(url: string): FakeSocket {
  const socket: FakeSocket = {
    url,
    binaryType: 'blob',
    readyState: 0,
    sent: [],
    closes: [],
    listeners: { open: [], message: [], close: [], error: [] },
    send(data: string): void {
      this.sent.push(data);
    },
    close(code?: number, reason?: string): void {
      this.closes.push({ code, reason });
      this.readyState = 3;
      for (const listener of this.listeners.close) {
        listener({ code: code ?? 1000, reason: reason ?? '' });
      }
    },
    addEventListener(type: string, listener: (event: Event) => void): void {
      if (type === 'open' || type === 'message' || type === 'close' || type === 'error') {
        this.listeners[type].push(listener as never);
      }
    },
    open(): void {
      this.readyState = 1;
      for (const listener of this.listeners.open) listener();
    },
    receiveText(raw: string): void {
      for (const listener of this.listeners.message) listener({ data: raw });
    },
    receiveBinary(bytes: Uint8Array): void {
      const copy = bytes.slice();
      for (const listener of this.listeners.message) {
        listener({ data: copy.buffer });
      }
    },
    remoteClose(code: number, reason = ''): void {
      this.readyState = 3;
      for (const listener of this.listeners.close) listener({ code, reason });
    },
  };
  return socket;
}

function createHarness(options: { token?: string; now?: number } = {}): {
  states: TerminalClientState[];
  output: Uint8Array[];
  sockets: FakeSocket[];
  timers: Timer[];
  store: Map<string, string>;
  now: { value: number };
  client: ReturnType<typeof createRunTerminalClient>;
  fireTimer(ms: number): void;
} {
  const sockets: FakeSocket[] = [];
  const timers: Timer[] = [];
  let nextTimerId = 1;
  const now = { value: options.now ?? 0 };
  const { store, storage } = fakeStorage(
    options.token === undefined ? {} : { [resumeStorageKey(RUN_ID)]: options.token }
  );
  const states: TerminalClientState[] = [];
  const output: Uint8Array[] = [];
  const client = createRunTerminalClient({
    runId: RUN_ID,
    onState: (state: TerminalClientState): void => {
      states.push(state);
    },
    onOutput: (bytes: Uint8Array): void => {
      output.push(bytes);
    },
    location: {
      origin: 'http://localhost:5173',
      protocol: 'http:',
      host: 'localhost:5173',
    },
    storage,
    createSocket: (url: string): FakeSocket => {
      const socket = createSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: (): number => now.value,
    setTimeout: (callback: () => void, ms: number): number => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.push({ id, callback, ms });
      return id;
    },
    clearTimeout: (id: unknown): void => {
      const index = timers.findIndex(timer => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return {
    states,
    output,
    sockets,
    timers,
    store,
    now,
    client,
    fireTimer(ms: number): void {
      const index = timers.findIndex(timer => timer.ms === ms);
      if (index < 0) throw new Error(`no timer scheduled for ${ms}ms`);
      const [timer] = timers.splice(index, 1);
      timer?.callback();
    },
  };
}

function readyFrame(resumeToken: string, cols = 80, rows = 24): string {
  return JSON.stringify({ type: 'ready', resumeToken, cols, rows });
}

describe('createRunTerminalClient', () => {
  test('connects to the same-origin terminal path with arraybuffer binaryType', () => {
    const harness = createHarness();
    expect(harness.states).toEqual([{ kind: 'connecting' }]);
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0]?.url).toBe(`ws://localhost:5173${ENCODED_PATH}`);
    expect(harness.sockets[0]?.url).not.toContain('3090');
    expect(harness.sockets[0]?.binaryType).toBe('arraybuffer');
  });

  test('appends only a valid stored resume token as the query parameter', () => {
    const valid = createHarness({ token: TOKEN });
    expect(valid.sockets[0]?.url).toBe(`ws://localhost:5173${ENCODED_PATH}?resume=${TOKEN}`);
    expect(new URL(valid.sockets[0]?.url ?? '').search).toBe(`?resume=${TOKEN}`);

    const invalid = createHarness({ token: 'not-a-token' });
    expect(invalid.sockets[0]?.url).toBe(`ws://localhost:5173${ENCODED_PATH}`);
  });

  test('uses wss for https pages', () => {
    const sockets: FakeSocket[] = [];
    createRunTerminalClient({
      runId: 'run-1',
      onState: (): void => undefined,
      onOutput: (): void => undefined,
      location: {
        origin: 'https://archon.example',
        protocol: 'https:',
        host: 'archon.example',
      },
      storage: fakeStorage().storage,
      createSocket: (url: string): FakeSocket => {
        const socket = createSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    expect(sockets[0]?.url).toBe('wss://archon.example/api/workflows/runs/run-1/terminal');
  });

  test('stores the ready token, enters connected, and delivers binary output before or after ready', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveBinary(new Uint8Array([1, 2, 3]));
    socket.receiveText(readyFrame(TOKEN));
    expect(harness.store.get(resumeStorageKey(RUN_ID))).toBe(TOKEN);
    expect(harness.states.at(-1)).toEqual({ kind: 'connected' });
    socket.receiveBinary(new Uint8Array([4, 5]));
    expect(harness.output.map(bytes => Array.from(bytes))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  test('sends large and multi-byte input as ordered bounded JSON frames', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveText(readyFrame(TOKEN));
    const data = `${'a'.repeat(INPUT_MAX_BYTES)}©`;
    harness.client.sendInput(data);
    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'input', data: 'a'.repeat(INPUT_MAX_BYTES) }),
      JSON.stringify({ type: 'input', data: '©' }),
    ]);
    harness.client.sendInput('pwd\n');
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'input', data: 'pwd\n' }));
  });

  test('sends only integer in-range resize dimensions', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveText(readyFrame(TOKEN));
    harness.client.resize(120, 40);
    harness.client.resize(80.5, 24);
    harness.client.resize(0, 24);
    harness.client.resize(80, 201);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'resize', cols: 120, rows: 40 })]);
  });

  test('caches resize until ready and resends it after reconnect', () => {
    const harness = createHarness();
    const first = harness.sockets[0];
    if (!first) throw new Error('missing socket');
    harness.client.resize(120, 40);
    expect(first.sent).toEqual([]);
    first.open();
    first.receiveText(readyFrame(TOKEN));
    expect(first.sent).toEqual([JSON.stringify({ type: 'resize', cols: 120, rows: 40 })]);

    first.remoteClose(1006);
    expect(harness.states.at(-1)).toEqual({ kind: 'reconnecting' });
    expect(harness.timers.map(timer => timer.ms)).toEqual([250]);
    harness.fireTimer(250);
    const second = harness.sockets[1];
    if (!second) throw new Error('missing reconnect socket');
    second.open();
    second.receiveText(readyFrame(NEXT_TOKEN));
    expect(second.sent).toEqual([JSON.stringify({ type: 'resize', cols: 120, rows: 40 })]);
    expect(harness.store.get(resumeStorageKey(RUN_ID))).toBe(NEXT_TOKEN);
  });

  test('reconnects unexpected closes with capped backoff until 120 seconds', () => {
    const harness = createHarness();
    const first = harness.sockets[0];
    if (!first) throw new Error('missing socket');
    first.open();
    first.receiveText(readyFrame(TOKEN));
    first.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(250);

    harness.now.value = 250;
    harness.fireTimer(250);
    harness.sockets[1]?.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(500);

    harness.now.value = 750;
    harness.fireTimer(500);
    harness.sockets[2]?.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(1000);

    harness.now.value = 1750;
    harness.fireTimer(1000);
    harness.sockets[3]?.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(2000);

    harness.now.value = 3750;
    harness.fireTimer(2000);
    harness.sockets[4]?.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(5000);

    harness.now.value = 8750;
    harness.fireTimer(5000);
    harness.sockets[5]?.remoteClose(1006);
    expect(harness.timers[0]?.ms).toBe(5000);

    harness.now.value = RECONNECT_MS;
    harness.sockets[5]?.remoteClose(1006);
    harness.fireTimer(5000);
    const last = harness.sockets.at(-1);
    last?.remoteClose(1006);
    expect(harness.timers).toEqual([]);
    expect(harness.states.at(-1)).toEqual({ kind: 'closed' });
  });

  test('disconnect closes the socket without a close frame and retains the token', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveText(readyFrame(TOKEN));
    harness.client.disconnect();
    expect(socket.sent).toEqual([]);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(harness.store.get(resumeStorageKey(RUN_ID))).toBe(TOKEN);
    expect(harness.timers).toEqual([]);
    expect(harness.states.filter(state => state.kind === 'reconnecting')).toEqual([]);
  });

  test('closeSession sends close, clears storage, and enters closed without reconnecting', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveText(readyFrame(TOKEN));
    harness.client.closeSession();
    expect(socket.sent).toEqual([JSON.stringify({ type: 'close' })]);
    expect(harness.store.has(resumeStorageKey(RUN_ID))).toBe(false);
    expect(harness.states.at(-1)).toEqual({ kind: 'closed' });
    expect(harness.timers).toEqual([]);
    expect(harness.sockets).toHaveLength(1);
  });

  test('unavailable, error, and exit clear storage and disable reconnect', () => {
    for (const frame of [
      JSON.stringify({
        type: 'unavailable',
        reason: 'no_checkout',
        message: 'checkout gone',
      }),
      JSON.stringify({ type: 'error', message: 'Terminal output overflowed.' }),
      JSON.stringify({ type: 'exit', code: 1, signal: null }),
    ]) {
      const harness = createHarness();
      const socket = harness.sockets[0];
      if (!socket) throw new Error('missing socket');
      socket.open();
      socket.receiveText(readyFrame(TOKEN));
      socket.receiveText(frame);
      expect(harness.store.has(resumeStorageKey(RUN_ID))).toBe(false);
      socket.remoteClose(1000);
      expect(harness.timers).toEqual([]);
      expect(harness.sockets).toHaveLength(1);
    }
  });

  test('close code 4001 shows another-tab copy and does not reconnect', () => {
    const harness = createHarness();
    const socket = harness.sockets[0];
    if (!socket) throw new Error('missing socket');
    socket.open();
    socket.receiveText(readyFrame(TOKEN));
    socket.remoteClose(REPLACED_SOCKET_CLOSE_CODE);
    expect(harness.states.at(-1)).toEqual({
      kind: 'error',
      message: 'Terminal opened in another tab.',
    });
    expect(harness.store.has(resumeStorageKey(RUN_ID))).toBe(false);
    expect(harness.timers).toEqual([]);
    expect(harness.sockets).toHaveLength(1);
  });
});
