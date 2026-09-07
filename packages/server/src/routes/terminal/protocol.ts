import type { TerminalUnavailableReason } from './target';

export const TERMINAL_PATH_RE = /^\/api\/workflows\/runs\/([^/]+)\/terminal$/;
export const RECONNECT_MS = 120_000;
export const REPLAY_MAX_BYTES = 256 * 1024;
export const INPUT_MAX_BYTES = 64 * 1024;
export const PENDING_MAX_BYTES = 1024 * 1024;
export const MAX_CLIENT_FRAME_BYTES = INPUT_MAX_BYTES * 6 + 1024;
export const MIN_COLS = 1;
export const MAX_COLS = 500;
export const MIN_ROWS = 1;
export const MAX_ROWS = 200;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const SOLO_TERMINAL_USER_ID = 'solo';
export const REPLACED_SOCKET_CLOSE_CODE = 4001;

export type ClientControlMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'close' };

export type ServerControlMessage =
  | { type: 'ready'; resumeToken: string; cols: number; rows: number }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'unavailable'; reason: TerminalUnavailableReason; message: string }
  | { type: 'error'; message: string };

export type ClientMessageParseResult = ClientControlMessage | { error: string };

export function isResumeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function parseClientControlMessage(raw: string): ClientMessageParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'invalid_message' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'invalid_message' };
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'input') {
    if (
      typeof record.data !== 'string' ||
      Buffer.byteLength(record.data, 'utf8') > INPUT_MAX_BYTES
    ) {
      return { error: 'invalid_input' };
    }
    return { type: 'input', data: record.data };
  }
  if (record.type === 'resize') {
    const cols = record.cols;
    const rows = record.rows;
    if (
      typeof cols !== 'number' ||
      typeof rows !== 'number' ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < MIN_COLS ||
      cols > MAX_COLS ||
      rows < MIN_ROWS ||
      rows > MAX_ROWS
    ) {
      return { error: 'invalid_resize' };
    }
    return { type: 'resize', cols, rows };
  }
  if (record.type === 'close') return { type: 'close' };
  return { error: 'invalid_message' };
}

export function serializeServerControlMessage(message: ServerControlMessage): string {
  return JSON.stringify(message);
}

export function unavailableMessage(reason: TerminalUnavailableReason): string {
  switch (reason) {
    case 'no_checkout':
      return "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up.";
    case 'container_missing':
    case 'container_stopped':
      return "This run's container isn't available — it may have been stopped or cleaned up.";
    case 'unsupported_provider':
      return 'This run uses an isolation provider the terminal cannot open.';
  }
}
