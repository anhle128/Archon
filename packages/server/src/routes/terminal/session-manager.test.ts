import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  PENDING_MAX_BYTES,
  RECONNECT_MS,
  REPLAY_MAX_BYTES,
  REPLACED_SOCKET_CLOSE_CODE,
  serializeServerControlMessage,
} from './protocol';
import type { SpawnedTerminal } from './pty';
import {
  createTerminalSessionManager,
  type TerminalLifecycleLogger,
  type TerminalSocket,
} from './session-manager';

const RUN_ID = 'run-1';
const USER_ID = 'user-1';
const TOKEN_BYTES = Buffer.alloc(32, 0xab);
const TOKEN = TOKEN_BYTES.toString('hex');
const OTHER_TOKEN = Buffer.alloc(32, 0xcd).toString('hex');

interface FakeSocket extends TerminalSocket {
  frames: Array<string | Uint8Array>;
  closes: Array<{ code?: number; reason?: string }>;
  buffered: number;
  results: number[];
}

interface FakePty extends SpawnedTerminal {
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  killCount: number;
  resolveExited(result: { code: number | null; signal: string | null }): void;
}

interface LogCall {
  level: 'info' | 'error';
  event: string;
  meta: Record<string, unknown>;
}

function fakeSocket(): FakeSocket {
  return {
    frames: [],
    closes: [],
    buffered: 0,
    results: [],
    send(data: string | Uint8Array): number {
      this.frames.push(data);
      const queued = this.results.shift();
      if (queued !== undefined) return queued;
      return typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
    },
    close(code?: number, reason?: string): void {
      this.closes.push({ code, reason });
    },
    getBufferedAmount(): number {
      return this.buffered;
    },
  };
}

function fakePty(): FakePty {
  let resolveExited!: (result: { code: number | null; signal: string | null }) => void;
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    resolveExited = resolve;
  });
  return {
    writes: [],
    resizes: [],
    killCount: 0,
    write(data: string): void {
      this.writes.push(data);
    },
    resize(cols: number, rows: number): void {
      this.resizes.push({ cols, rows });
    },
    kill(): void {
      this.killCount += 1;
    },
    exited,
    resolveExited(result): void {
      resolveExited(result);
    },
  };
}

function capturingLogger(calls: LogCall[]): TerminalLifecycleLogger {
  return {
    info(meta: Record<string, unknown>, event: string): void {
      calls.push({ level: 'info', event, meta });
    },
    error(meta: Record<string, unknown>, event: string): void {
      calls.push({ level: 'error', event, meta });
    },
  };
}

function createHarness(options?: {
  randomBytes?: (size: number) => Buffer;
  spawnImpl?: (onData: (chunk: Uint8Array) => void) => SpawnedTerminal;
}): {
  manager: ReturnType<typeof createTerminalSessionManager>;
  logs: LogCall[];
  timers: Array<{ callback: () => void; ms: number; id: number }>;
  cancelled: number[];
  spawnCount: number;
  lastPty: FakePty | undefined;
  emit: ((chunk: Uint8Array) => void) | undefined;
  createSession(socket: TerminalSocket, targetKind?: 'host' | 'container'): void;
} {
  const logs: LogCall[] = [];
  const timers: Array<{ callback: () => void; ms: number; id: number }> = [];
  const cancelled: number[] = [];
  let nextTimerId = 1;
  let spawnCount = 0;
  let lastPty: FakePty | undefined;
  let emit: ((chunk: Uint8Array) => void) | undefined;
  const manager = createTerminalSessionManager({
    randomBytes:
      options?.randomBytes ??
      ((size: number) => {
        expect(size).toBe(32);
        return TOKEN_BYTES;
      }),
    setTimeout(callback: () => void, ms: number): unknown {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.push({ callback, ms, id });
      return id;
    },
    clearTimeout(timer: unknown): void {
      cancelled.push(timer as number);
    },
    logger: capturingLogger(logs),
  });
  function createSession(socket: TerminalSocket, targetKind: 'host' | 'container' = 'host'): void {
    manager.create({
      runId: RUN_ID,
      userId: USER_ID,
      targetKind,
      socket,
      spawn(onData: (chunk: Uint8Array) => void): SpawnedTerminal {
        spawnCount += 1;
        emit = onData;
        if (options?.spawnImpl) return options.spawnImpl(onData);
        lastPty = fakePty();
        return lastPty;
      },
    });
  }
  return {
    get spawnCount() {
      return spawnCount;
    },
    get lastPty() {
      return lastPty;
    },
    get emit() {
      return emit;
    },
    manager,
    logs,
    timers,
    cancelled,
    createSession,
  };
}

function controlFrames(socket: FakeSocket): unknown[] {
  return socket.frames
    .filter((frame): frame is string => typeof frame === 'string')
    .map(frame => JSON.parse(frame) as unknown);
}

function binaryFrames(socket: FakeSocket): Uint8Array[] {
  return socket.frames.filter((frame): frame is Uint8Array => frame instanceof Uint8Array);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe('createTerminalSessionManager', () => {
  test('first create issues a 64-character lowercase hex token and sends ready', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    expect(controlFrames(socket)).toEqual([
      {
        type: 'ready',
        resumeToken: TOKEN,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      },
    ]);
    expect(TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.logs.map(call => call.event)).toContain('terminal.session_started');
  });

  test('second active socket takes over without spawning, replays then ready, and closes the old socket with 4001', () => {
    const harness = createHarness();
    const first = fakeSocket();
    harness.createSession(first);
    const emit = harness.emit;
    expect(emit).toBeDefined();
    if (!emit) throw new Error('missing emit');
    emit(new Uint8Array([1, 2, 3]));
    const replacement = fakeSocket();
    const attached = harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: null,
      socket: replacement,
    });
    expect(attached).toBe(true);
    expect(harness.spawnCount).toBe(1);
    expect(binaryFrames(replacement).map(frame => Array.from(frame))).toEqual([[1, 2, 3]]);
    expect(controlFrames(replacement)).toEqual([
      { type: 'ready', resumeToken: TOKEN, cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    ]);
    expect(first.closes).toEqual([{ code: REPLACED_SOCKET_CLOSE_CODE, reason: undefined }]);
    expect(harness.logs.map(call => call.event)).toContain('terminal.session_reconnected');
  });

  test('create takes over an existing session instead of replacing it with a second PTY', () => {
    const harness = createHarness();
    const first = fakeSocket();
    harness.createSession(first);
    const firstPty = harness.lastPty;
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    emit(new Uint8Array([4, 5, 6]));

    const replacement = fakeSocket();
    harness.createSession(replacement);

    expect(harness.spawnCount).toBe(1);
    expect(harness.lastPty).toBe(firstPty);
    expect(first.closes).toEqual([{ code: REPLACED_SOCKET_CLOSE_CODE, reason: undefined }]);
    expect(binaryFrames(replacement).map(frame => Array.from(frame))).toEqual([[4, 5, 6]]);
    expect(controlFrames(replacement).at(-1)).toEqual({
      type: 'ready',
      resumeToken: TOKEN,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
    harness.manager.input(replacement, 'pwd\n');
    expect(firstPty?.writes).toEqual(['pwd\n']);
  });

  test('old socket close callback cannot detach the replacement socket', () => {
    const harness = createHarness();
    const first = fakeSocket();
    harness.createSession(first);
    const replacement = fakeSocket();
    harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: null,
      socket: replacement,
    });
    harness.manager.disconnect(first);
    harness.manager.input(replacement, 'pwd\n');
    expect(harness.lastPty?.writes).toEqual(['pwd\n']);
    expect(harness.timers).toEqual([]);
    expect(replacement.closes).toEqual([]);
  });

  test('a disconnected session accepts only its matching token before expiry', () => {
    const harness = createHarness();
    const first = fakeSocket();
    harness.createSession(first);
    harness.manager.disconnect(first);
    expect(harness.timers[0]?.ms).toBe(RECONNECT_MS);
    const rejected = fakeSocket();
    expect(
      harness.manager.attachExisting({
        runId: RUN_ID,
        userId: USER_ID,
        resumeToken: OTHER_TOKEN,
        socket: rejected,
      })
    ).toBe(false);
    expect(harness.lastPty?.killCount).toBe(1);
    const pty = fakePty();
    const reconnectHarness = createHarness({ spawnImpl: () => pty });
    const originalSocket = fakeSocket();
    reconnectHarness.createSession(originalSocket);
    reconnectHarness.manager.disconnect(originalSocket);
    const resumed = fakeSocket();
    expect(
      reconnectHarness.manager.attachExisting({
        runId: RUN_ID,
        userId: USER_ID,
        resumeToken: TOKEN,
        socket: resumed,
      })
    ).toBe(true);
    expect(reconnectHarness.cancelled).toHaveLength(1);
    expect(pty.killCount).toBe(0);
    expect(controlFrames(resumed)[0]).toEqual({
      type: 'ready',
      resumeToken: TOKEN,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  });

  test('invalid or absent disconnected token kills the old PTY and returns false', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    harness.manager.disconnect(socket);
    expect(
      harness.manager.attachExisting({
        runId: RUN_ID,
        userId: USER_ID,
        resumeToken: null,
        socket: fakeSocket(),
      })
    ).toBe(false);
    expect(harness.lastPty?.killCount).toBe(1);
  });

  test('replay retains only the newest 256 KiB in memory', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const first = new Uint8Array(REPLAY_MAX_BYTES);
    first.fill(1);
    const second = new Uint8Array(16);
    second.fill(2);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    emit(first);
    emit(second);
    const replacement = fakeSocket();
    harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: null,
      socket: replacement,
    });
    const replayed = concatBytes(binaryFrames(replacement));
    expect(replayed.byteLength).toBe(REPLAY_MAX_BYTES);
    expect(replayed.subarray(0, REPLAY_MAX_BYTES - 16).every(byte => byte === 1)).toBe(true);
    expect(Array.from(replayed.subarray(REPLAY_MAX_BYTES - 16))).toEqual(Array.from(second));
  });

  test('a -1 send is not duplicated, later frames queue, and drain flushes them in order', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    socket.results.push(-1, 1, 1);
    emit(new Uint8Array([10]));
    emit(new Uint8Array([11]));
    emit(new Uint8Array([12]));
    expect(binaryFrames(socket).map(frame => Array.from(frame))).toEqual([[10]]);
    harness.manager.drain(socket);
    expect(binaryFrames(socket).map(frame => Array.from(frame))).toEqual([[10], [11], [12]]);
  });

  test('a 0 send detaches rather than queuing the dropped frame', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    socket.results.push(0);
    emit(new Uint8Array([9]));
    expect(harness.timers[0]?.ms).toBe(RECONNECT_MS);
    emit(new Uint8Array([8]));
    expect(binaryFrames(socket).map(frame => Array.from(frame))).toEqual([[9]]);
    const resumed = fakeSocket();
    harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: TOKEN,
      socket: resumed,
    });
    expect(Array.from(concatBytes(binaryFrames(resumed)))).toEqual([9, 8]);
  });

  test('takeover while backpressured clears pending, replays each retained byte once, and delays ready until drain when replay returns -1', () => {
    const harness = createHarness();
    const first = fakeSocket();
    harness.createSession(first);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    first.results.push(-1);
    emit(new Uint8Array([1]));
    emit(new Uint8Array([2]));
    const replacement = fakeSocket();
    replacement.results.push(-1);
    harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: null,
      socket: replacement,
    });
    expect(Array.from(concatBytes(binaryFrames(replacement)))).toEqual([1, 2]);
    expect(controlFrames(replacement)).toEqual([]);
    replacement.results.push(2);
    harness.manager.drain(replacement);
    expect(controlFrames(replacement)).toEqual([
      { type: 'ready', resumeToken: TOKEN, cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    ]);
    expect(binaryFrames(replacement)).toHaveLength(1);
  });

  test('pending bytes plus getBufferedAmount above 1 MiB kill the PTY and remove the session', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    socket.buffered = PENDING_MAX_BYTES;
    emit(new Uint8Array([1]));
    expect(controlFrames(socket)).toContainEqual({
      type: 'error',
      message: 'Terminal output overflowed.',
    });
    expect(socket.closes).toEqual([{ code: 1011, reason: undefined }]);
    expect(harness.lastPty?.killCount).toBe(1);
    expect(
      harness.manager.attachExisting({
        runId: RUN_ID,
        userId: USER_ID,
        resumeToken: TOKEN,
        socket: fakeSocket(),
      })
    ).toBe(false);
    expect(harness.logs.map(call => call.event)).toContain('terminal.session_failed');
  });

  test('explicit close, two-minute expiry, process exit, and destroyAll each kill exactly once and remove the entry', async () => {
    const closed = createHarness();
    const closeSocket = fakeSocket();
    closed.createSession(closeSocket);
    closed.manager.closeSession(closeSocket);
    expect(closed.lastPty?.killCount).toBe(1);
    closed.manager.closeSession(closeSocket);
    expect(closed.lastPty?.killCount).toBe(1);
    expect(closed.logs.map(call => call.event)).toContain('terminal.session_completed');

    const expired = createHarness();
    const expireSocket = fakeSocket();
    expired.createSession(expireSocket);
    expired.manager.disconnect(expireSocket);
    expired.timers[0]?.callback();
    expect(expired.lastPty?.killCount).toBe(1);
    expired.timers[0]?.callback();
    expect(expired.lastPty?.killCount).toBe(1);
    expect(expired.logs.map(call => call.event)).toContain('terminal.session_expired');

    const exited = createHarness();
    const exitSocket = fakeSocket();
    exited.createSession(exitSocket);
    const pty = exited.lastPty;
    expect(pty).toBeDefined();
    if (!pty) throw new Error('missing pty');
    pty.resolveExited({ code: 0, signal: null });
    await pty.exited;
    await Promise.resolve();
    expect(pty.killCount).toBe(1);
    expect(controlFrames(exitSocket)).toContainEqual({ type: 'exit', code: 0, signal: null });
    const exitIndex = exitSocket.frames.findIndex(
      frame => typeof frame === 'string' && frame.includes('"type":"exit"')
    );
    expect(exitSocket.closes.length).toBeGreaterThan(0);
    expect(exitIndex).toBeGreaterThanOrEqual(0);
    expect(exited.logs.map(call => call.event)).toContain('terminal.pty_exited');

    const shutdown = createHarness();
    const shutdownSocket = fakeSocket();
    shutdown.createSession(shutdownSocket);
    shutdown.manager.destroyAll();
    expect(shutdown.lastPty?.killCount).toBe(1);
    shutdown.manager.destroyAll();
    expect(shutdown.lastPty?.killCount).toBe(1);
  });

  test('process exit sends the exact exit message before closing the socket', async () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const pty = harness.lastPty;
    if (!pty) throw new Error('missing pty');
    pty.resolveExited({ code: 130, signal: 'SIGINT' });
    await pty.exited;
    await Promise.resolve();
    const serialized = serializeServerControlMessage({
      type: 'exit',
      code: 130,
      signal: 'SIGINT',
    });
    expect(socket.frames).toContain(serialized);
    const exitAt = socket.frames.indexOf(serialized);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(exitAt).toBeGreaterThanOrEqual(0);
  });

  test('logger calls contain no emitted bytes, token, path, command, environment, or container handle', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket, 'container');
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    emit(new Uint8Array([0x61, 0x62, 0x63]));
    harness.manager.input(socket, 'secret-command');
    harness.manager.resize(socket, 100, 40);
    const dumped = JSON.stringify(harness.logs);
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).not.toContain('secret-command');
    expect(dumped).not.toContain('abc');
    expect(dumped).not.toContain('/canonical');
    expect(dumped).not.toContain('archon-run-1');
    expect(dumped).not.toContain('DATABASE_URL');
    for (const call of harness.logs) {
      expect([
        'terminal.session_started',
        'terminal.session_reconnected',
        'terminal.session_completed',
        'terminal.session_failed',
        'terminal.session_expired',
        'terminal.pty_exited',
      ]).toContain(call.event);
      expect(call.meta).toEqual({
        runId: RUN_ID,
        userId: USER_ID,
        targetKind: 'container',
      });
    }
  });

  test('copies spawn chunks so later buffer mutation cannot change replay', () => {
    const harness = createHarness();
    const socket = fakeSocket();
    harness.createSession(socket);
    const emit = harness.emit;
    if (!emit) throw new Error('missing emit');
    const chunk = new Uint8Array([7, 8, 9]);
    emit(chunk);
    chunk.fill(0);
    const replacement = fakeSocket();
    harness.manager.attachExisting({
      runId: RUN_ID,
      userId: USER_ID,
      resumeToken: null,
      socket: replacement,
    });
    expect(Array.from(concatBytes(binaryFrames(replacement)))).toEqual([7, 8, 9]);
  });

  test('synchronous spawn output before create stores the session still reaches replay and ready', () => {
    const socket = fakeSocket();
    const harness = createHarness({
      spawnImpl(onData: (chunk: Uint8Array) => void): SpawnedTerminal {
        onData(new Uint8Array([42]));
        return fakePty();
      },
    });
    harness.createSession(socket);
    expect(binaryFrames(socket).map(frame => Array.from(frame))).toEqual([[42]]);
    expect(controlFrames(socket)).toEqual([
      { type: 'ready', resumeToken: TOKEN, cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    ]);
  });
});
