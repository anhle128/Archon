import { randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto';

import { createLogger } from '@archon/paths';

import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  PENDING_MAX_BYTES,
  RECONNECT_MS,
  REPLAY_MAX_BYTES,
  REPLACED_SOCKET_CLOSE_CODE,
  isResumeToken,
  serializeServerControlMessage,
} from './protocol';
import type { SpawnedTerminal } from './pty';

export interface TerminalSocket {
  send(data: string | Uint8Array): number;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
}

export interface TerminalLifecycleLogger {
  info(meta: Record<string, unknown>, event: string): void;
  error(meta: Record<string, unknown>, event: string): void;
}

export interface TerminalSessionManagerOptions {
  randomBytes?(size: number): Buffer;
  setTimeout?(callback: () => void, ms: number): unknown;
  clearTimeout?(timer: unknown): void;
  logger?: TerminalLifecycleLogger;
}

export interface TerminalSessionManager {
  attachExisting(input: {
    runId: string;
    userId: string;
    resumeToken: string | null;
    socket: TerminalSocket;
  }): boolean;
  create(input: {
    runId: string;
    userId: string;
    targetKind: 'host' | 'container';
    socket: TerminalSocket;
    spawn(onData: (chunk: Uint8Array) => void): SpawnedTerminal;
  }): void;
  input(socket: TerminalSocket, data: string): void;
  resize(socket: TerminalSocket, cols: number, rows: number): void;
  closeSession(socket: TerminalSocket): void;
  disconnect(socket: TerminalSocket): void;
  drain(socket: TerminalSocket): void;
  destroyAll(): void;
}

interface TerminalSession {
  key: string;
  runId: string;
  userId: string;
  targetKind: 'host' | 'container';
  resumeToken: string;
  cols: number;
  rows: number;
  socket: TerminalSocket | null;
  pty: SpawnedTerminal;
  replay: Uint8Array[];
  replayBytes: number;
  pending: Uint8Array[];
  pendingBytes: number;
  backpressured: boolean;
  readyPending: boolean;
  disconnectTimer: unknown;
}

type DestroyReason = 'completed' | 'failed' | 'expired' | 'pty_exited';
type LifecycleReason = DestroyReason | 'started' | 'reconnected';

const OVERFLOW_CLOSE_CODE = 1011;
const OVERFLOW_MESSAGE = 'Terminal output overflowed.';

const LIFECYCLE_EVENTS: Record<LifecycleReason, string> = {
  started: 'terminal.session_started',
  reconnected: 'terminal.session_reconnected',
  completed: 'terminal.session_completed',
  failed: 'terminal.session_failed',
  expired: 'terminal.session_expired',
  pty_exited: 'terminal.pty_exited',
};

function copyBytes(chunk: Uint8Array): Uint8Array {
  const copied = new Uint8Array(chunk.byteLength);
  copied.set(chunk);
  return copied;
}

function sessionKey(userId: string, runId: string): string {
  return `${userId}:${runId}`;
}

function tokensEqual(left: string, right: string): boolean {
  if (!isResumeToken(left) || !isResumeToken(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function concatReplay(session: TerminalSession): Uint8Array {
  if (session.replayBytes === 0) return new Uint8Array(0);
  const out = new Uint8Array(session.replayBytes);
  let offset = 0;
  for (const part of session.replay) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function createTerminalSessionManager(
  options: TerminalSessionManagerOptions = {}
): TerminalSessionManager {
  function generateResumeToken(): string {
    const bytes = options.randomBytes ? options.randomBytes(32) : cryptoRandomBytes(32);
    return bytes.toString('hex');
  }
  function schedule(callback: () => void, ms: number): unknown {
    if (options.setTimeout) return options.setTimeout(callback, ms);
    return globalThis.setTimeout(callback, ms);
  }
  function cancel(timer: unknown): void {
    if (options.clearTimeout) {
      options.clearTimeout(timer);
      return;
    }
    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
  }
  const logger: TerminalLifecycleLogger = options.logger ?? createLogger('terminal');
  const sessions = new Map<string, TerminalSession>();
  const socketKeys = new WeakMap<TerminalSocket, string>();

  function logLifecycle(session: TerminalSession, reason: LifecycleReason): void {
    const meta = {
      runId: session.runId,
      userId: session.userId,
      targetKind: session.targetKind,
    };
    const event = LIFECYCLE_EVENTS[reason];
    if (reason === 'failed') logger.error(meta, event);
    else logger.info(meta, event);
  }

  function sessionForSocket(socket: TerminalSocket): TerminalSession | undefined {
    const key = socketKeys.get(socket);
    if (key === undefined) return undefined;
    const session = sessions.get(key);
    if (session?.socket !== socket) return undefined;
    return session;
  }

  function appendBoundedReplay(session: TerminalSession, chunk: Uint8Array): void {
    const copied = copyBytes(chunk);
    if (copied.byteLength >= REPLAY_MAX_BYTES) {
      session.replay = [copyBytes(copied.subarray(copied.byteLength - REPLAY_MAX_BYTES))];
      session.replayBytes = REPLAY_MAX_BYTES;
      return;
    }
    session.replay.push(copied);
    session.replayBytes += copied.byteLength;
    while (session.replayBytes > REPLAY_MAX_BYTES) {
      const extra = session.replayBytes - REPLAY_MAX_BYTES;
      const oldest = session.replay[0];
      if (oldest === undefined) break;
      if (oldest.byteLength <= extra) {
        session.replay.shift();
        session.replayBytes -= oldest.byteLength;
      } else {
        session.replay[0] = copyBytes(oldest.subarray(extra));
        session.replayBytes -= extra;
      }
    }
  }

  function closeOwnedSocket(session: TerminalSession, reason: DestroyReason): void {
    const socket = session.socket;
    session.socket = null;
    if (socket === null) return;
    if (reason === 'failed') {
      try {
        socket.send(serializeServerControlMessage({ type: 'error', message: OVERFLOW_MESSAGE }));
      } catch {
        // Close still has to run if the overflow frame cannot be delivered.
      }
      socket.close(OVERFLOW_CLOSE_CODE);
      return;
    }
    socket.close();
  }

  function destroy(key: string, reason: DestroyReason): void {
    const session = sessions.get(key);
    if (session === undefined) return;
    sessions.delete(key);
    if (session.disconnectTimer !== null) {
      cancel(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    session.pty.kill();
    closeOwnedSocket(session, reason);
    logLifecycle(session, reason);
  }

  function overflowAndDestroy(session: TerminalSession): void {
    destroy(session.key, 'failed');
  }

  function disconnectSocket(socket: TerminalSocket): void {
    const session = sessionForSocket(socket);
    if (session === undefined) return;
    session.socket = null;
    session.pending = [];
    session.pendingBytes = 0;
    session.backpressured = false;
    session.readyPending = false;
    if (session.disconnectTimer !== null) {
      cancel(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    const key = session.key;
    session.disconnectTimer = schedule(() => {
      destroy(key, 'expired');
    }, RECONNECT_MS);
  }

  function enqueuePendingOrDestroy(session: TerminalSession, chunk: Uint8Array): void {
    const socket = session.socket;
    if (socket === null) return;
    if (socket.getBufferedAmount() + session.pendingBytes + chunk.byteLength > PENDING_MAX_BYTES) {
      overflowAndDestroy(session);
      return;
    }
    const copied = copyBytes(chunk);
    session.pending.push(copied);
    session.pendingBytes += copied.byteLength;
  }

  function sendReady(session: TerminalSession): void {
    const socket = session.socket;
    if (socket === null) return;
    session.readyPending = false;
    const result = socket.send(
      serializeServerControlMessage({
        type: 'ready',
        resumeToken: session.resumeToken,
        cols: session.cols,
        rows: session.rows,
      })
    );
    if (result === -1) session.backpressured = true;
    if (result === 0) disconnectSocket(socket);
  }

  function sendReadyIfPending(session: TerminalSession): void {
    if (!session.readyPending) return;
    sendReady(session);
  }

  function sendOutput(session: TerminalSession, chunk: Uint8Array): void {
    const copied = copyBytes(chunk);
    appendBoundedReplay(session, copied);
    const socket = session.socket;
    if (socket === null) return;
    if (session.backpressured) {
      enqueuePendingOrDestroy(session, copied);
      return;
    }
    if (socket.getBufferedAmount() + session.pendingBytes + copied.byteLength > PENDING_MAX_BYTES) {
      overflowAndDestroy(session);
      return;
    }
    const result = socket.send(copied);
    if (result === -1) session.backpressured = true;
    if (result === 0) disconnectSocket(socket);
  }

  function replayThenReady(session: TerminalSession): void {
    const socket = session.socket;
    if (socket === null) return;
    const replay = concatReplay(session);
    if (replay.byteLength > 0) {
      if (
        socket.getBufferedAmount() + session.pendingBytes + replay.byteLength >
        PENDING_MAX_BYTES
      ) {
        overflowAndDestroy(session);
        return;
      }
      const result = socket.send(replay);
      if (result === -1) {
        session.backpressured = true;
        session.readyPending = true;
        return;
      }
      if (result === 0) {
        disconnectSocket(socket);
        return;
      }
    }
    sendReady(session);
  }

  function attachSocket(session: TerminalSession, socket: TerminalSocket): void {
    const replaced = session.socket;
    session.socket = socket;
    socketKeys.set(socket, session.key);
    session.pending = [];
    session.pendingBytes = 0;
    session.backpressured = false;
    session.readyPending = false;
    if (session.disconnectTimer !== null) {
      cancel(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    replayThenReady(session);
    if (replaced !== null && replaced !== socket) {
      replaced.close(REPLACED_SOCKET_CLOSE_CODE);
    }
  }

  function onPtyExit(
    pty: SpawnedTerminal,
    key: string,
    result: { code: number | null; signal: string | null }
  ): void {
    const session = sessions.get(key);
    if (session?.pty !== pty) return;
    const socket = session.socket;
    if (socket !== null) {
      socket.send(
        serializeServerControlMessage({
          type: 'exit',
          code: result.code,
          signal: result.signal,
        })
      );
    }
    destroy(key, 'pty_exited');
  }

  return {
    attachExisting(input: {
      runId: string;
      userId: string;
      resumeToken: string | null;
      socket: TerminalSocket;
    }): boolean {
      const key = sessionKey(input.userId, input.runId);
      const session = sessions.get(key);
      if (session === undefined) return false;
      if (session.socket !== null) {
        attachSocket(session, input.socket);
        logLifecycle(session, 'reconnected');
        return true;
      }
      if (input.resumeToken === null || !tokensEqual(input.resumeToken, session.resumeToken)) {
        destroy(key, 'failed');
        return false;
      }
      attachSocket(session, input.socket);
      logLifecycle(session, 'reconnected');
      return true;
    },
    create(input: {
      runId: string;
      userId: string;
      targetKind: 'host' | 'container';
      socket: TerminalSocket;
      spawn(onData: (chunk: Uint8Array) => void): SpawnedTerminal;
    }): void {
      const key = sessionKey(input.userId, input.runId);
      const existing = sessions.get(key);
      if (existing !== undefined) {
        attachSocket(existing, input.socket);
        logLifecycle(existing, 'reconnected');
        return;
      }
      const early: Uint8Array[] = [];
      const pty = input.spawn((chunk: Uint8Array): void => {
        const copied = copyBytes(chunk);
        const current = sessions.get(key);
        if (current === undefined) {
          early.push(copied);
          return;
        }
        sendOutput(current, copied);
      });
      const session: TerminalSession = {
        key,
        runId: input.runId,
        userId: input.userId,
        targetKind: input.targetKind,
        resumeToken: generateResumeToken(),
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        socket: input.socket,
        pty,
        replay: [],
        replayBytes: 0,
        pending: [],
        pendingBytes: 0,
        backpressured: false,
        readyPending: false,
        disconnectTimer: null,
      };
      sessions.set(key, session);
      socketKeys.set(input.socket, key);
      for (const chunk of early) sendOutput(session, chunk);
      if (sessions.get(key) !== session) return;
      logLifecycle(session, 'started');
      if (session.backpressured) session.readyPending = true;
      else sendReady(session);
      void pty.exited.then((result: { code: number | null; signal: string | null }) => {
        onPtyExit(pty, key, result);
      });
    },
    input(socket: TerminalSocket, data: string): void {
      sessionForSocket(socket)?.pty.write(data);
    },
    resize(socket: TerminalSocket, cols: number, rows: number): void {
      const session = sessionForSocket(socket);
      if (session === undefined) return;
      session.cols = cols;
      session.rows = rows;
      session.pty.resize(cols, rows);
    },
    closeSession(socket: TerminalSocket): void {
      const session = sessionForSocket(socket);
      if (session === undefined) return;
      destroy(session.key, 'completed');
    },
    disconnect(socket: TerminalSocket): void {
      disconnectSocket(socket);
    },
    drain(socket: TerminalSocket): void {
      const session = sessionForSocket(socket);
      if (session === undefined) return;
      while (session.pending.length > 0) {
        const chunk = session.pending[0];
        if (chunk === undefined) break;
        if (socket.getBufferedAmount() + session.pendingBytes > PENDING_MAX_BYTES) {
          overflowAndDestroy(session);
          return;
        }
        const result = socket.send(chunk);
        if (result === 0) {
          disconnectSocket(socket);
          return;
        }
        if (result === -1 || result > 0) {
          session.pending.shift();
          session.pendingBytes -= chunk.byteLength;
          if (result === -1) {
            session.backpressured = true;
            if (session.pending.length === 0) sendReadyIfPending(session);
            return;
          }
          continue;
        }
        return;
      }
      session.backpressured = false;
      sendReadyIfPending(session);
    },
    destroyAll(): void {
      for (const key of [...sessions.keys()]) destroy(key, 'completed');
    },
  };
}
