export const INPUT_MAX_BYTES = 64 * 1024;
export const RECONNECT_MS = 120_000;
export const MIN_COLS = 1;
export const MAX_COLS = 500;
export const MIN_ROWS = 1;
export const MAX_ROWS = 200;
export const REPLACED_SOCKET_CLOSE_CODE = 4001;

export const RESUME_STORAGE_KEY_PREFIX = 'archon.terminal.resume.';

export type TerminalUnavailableReason =
  | 'no_checkout'
  | 'container_missing'
  | 'container_stopped'
  | 'unsupported_provider';

export type ServerControlMessage =
  | { type: 'ready'; resumeToken: string; cols: number; rows: number }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'unavailable'; reason: TerminalUnavailableReason; message: string }
  | { type: 'error'; message: string };

const UNAVAILABLE_REASONS = new Set<TerminalUnavailableReason>([
  'no_checkout',
  'container_missing',
  'container_stopped',
  'unsupported_provider',
]);

export function isResumeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function validTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= MIN_COLS &&
    cols <= MAX_COLS &&
    rows >= MIN_ROWS &&
    rows <= MAX_ROWS
  );
}

export function parseServerControlMessage(raw: string): ServerControlMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type === 'ready' &&
    typeof record.resumeToken === 'string' &&
    isResumeToken(record.resumeToken) &&
    typeof record.cols === 'number' &&
    typeof record.rows === 'number' &&
    validTerminalSize(record.cols, record.rows)
  ) {
    return {
      type: 'ready',
      resumeToken: record.resumeToken,
      cols: record.cols,
      rows: record.rows,
    };
  }
  if (
    record.type === 'exit' &&
    (record.code === null || (typeof record.code === 'number' && Number.isInteger(record.code))) &&
    (record.signal === null || typeof record.signal === 'string')
  ) {
    return { type: 'exit', code: record.code, signal: record.signal };
  }
  if (
    record.type === 'unavailable' &&
    typeof record.reason === 'string' &&
    UNAVAILABLE_REASONS.has(record.reason as TerminalUnavailableReason) &&
    typeof record.message === 'string'
  ) {
    return {
      type: 'unavailable',
      reason: record.reason as TerminalUnavailableReason,
      message: record.message,
    };
  }
  if (record.type === 'error' && typeof record.message === 'string') {
    return { type: 'error', message: record.message };
  }
  return null;
}

export function chunkTerminalInput(data: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const codePoint of data) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (chunk && chunkBytes + codePointBytes > INPUT_MAX_BYTES) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += codePointBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function resumeStorageKey(runId: string): string {
  return `${RESUME_STORAGE_KEY_PREFIX}${runId}`;
}
