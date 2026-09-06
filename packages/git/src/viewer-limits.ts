export const VIEWER_FIRST_PAINT_BYTES = 256 * 1024;
export const VIEWER_FIRST_PAINT_LINES = 2000;
export const VIEWER_STREAM_BYTES = 1024 * 1024;
export const VIEWER_DOWNLOAD_ONLY_BYTES = 50 * 1024 * 1024;
export const VIEWER_HEX_PEEK_BYTES = 4 * 1024;
export const VIEWER_BINARY_PROBE_BYTES = 8 * 1024;
export const VIEWER_DIFF_CONTEXT_LINES = 3;

export type ViewerCursorAxis = 'o' | 'h';
export type ViewerCursorPayload = { o: number; v: string } | { h: number; v: string };
export type GitFilePresentation = 'text' | 'image' | 'hex' | 'download';

export interface TextPage {
  bytes: Uint8Array;
  consumedBytes: number;
  truncated: boolean;
}

export interface GitFileClassification {
  presentation: GitFilePresentation;
  binary: boolean;
  mediaType: string;
}

const VERSION_HEX = /^[0-9a-f]{64}$/;

export class ViewerCursorError extends Error {
  readonly code: 'invalid' | 'stale';

  constructor(code: 'invalid' | 'stale') {
    super(code === 'stale' ? 'File changed' : 'Invalid file cursor');
    this.name = 'ViewerCursorError';
    this.code = code;
  }
}

function throwInvalid(): never {
  throw new ViewerCursorError('invalid');
}

function assertCursorValue(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throwInvalid();
}

function assertCursorVersion(version: string): void {
  if (!VERSION_HEX.test(version)) throwInvalid();
}

export function encodeViewerCursor(axis: ViewerCursorAxis, value: number, version: string): string {
  assertCursorValue(value);
  assertCursorVersion(version);
  const payload: ViewerCursorPayload =
    axis === 'o' ? { o: value, v: version } : { h: value, v: version };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeViewerCursor(
  cursor: string,
  axis: ViewerCursorAxis,
  currentVersion: string
): number {
  if (cursor === '') return 0;

  let decoded: Buffer;
  try {
    decoded = Buffer.from(cursor, 'base64url');
  } catch {
    throwInvalid();
  }
  if (decoded.toString('base64url') !== cursor) throwInvalid();

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString('utf8')) as unknown;
  } catch {
    throwInvalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throwInvalid();

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !Object.hasOwn(record, axis) || !Object.hasOwn(record, 'v'))
    throwInvalid();

  const value = record[axis];
  const version = record.v;
  if (typeof value !== 'number' || typeof version !== 'string') throwInvalid();
  assertCursorValue(value);
  assertCursorVersion(version);
  if (version !== currentVersion) throw new ViewerCursorError('stale');
  return value;
}

function utf8LeadLength(lead: number): number {
  if ((lead & 0x80) === 0) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}

function utf8SafeEnd(window: Uint8Array, maxExclusive: number): number {
  const end = Math.min(window.byteLength, maxExclusive);
  if (end === 0) return 0;
  let lead = end - 1;
  while (lead > 0 && (window[lead] & 0xc0) === 0x80) {
    lead -= 1;
  }
  const expected = utf8LeadLength(window[lead] ?? 0);
  if (lead + expected <= end) return end;
  return lead;
}

function nthNewlineEnd(window: Uint8Array, searchEnd: number, count: number): number {
  let seen = 0;
  for (let i = 0; i < searchEnd; i += 1) {
    if (window[i] === 0x0a) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return -1;
}

export function sliceTextPage(window: Uint8Array, hasBytesAfterWindow: boolean): TextPage {
  const byteEnd = utf8SafeEnd(window, VIEWER_FIRST_PAINT_BYTES);
  const lineEnd = nthNewlineEnd(window, byteEnd, VIEWER_FIRST_PAINT_LINES);
  const end = lineEnd === -1 ? byteEnd : lineEnd;
  return {
    bytes: window.subarray(0, end),
    consumedBytes: end,
    truncated: hasBytesAfterWindow || end < window.byteLength,
  };
}

function probeHasNul(probe: Uint8Array): boolean {
  const limit = Math.min(probe.byteLength, VIEWER_BINARY_PROBE_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (probe[i] === 0) return true;
  }
  return false;
}

function startsWithBytes(probe: Uint8Array, signature: readonly number[]): boolean {
  if (probe.byteLength < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (probe[i] !== signature[i]) return false;
  }
  return true;
}

function asciiAt(probe: Uint8Array, start: number, length: number): string {
  if (probe.byteLength < start + length) return '';
  return Buffer.from(probe.subarray(start, start + length)).toString('latin1');
}

function skipBomAndWhitespace(probe: Uint8Array): number {
  let offset = 0;
  if (probe.byteLength >= 3 && probe[0] === 0xef && probe[1] === 0xbb && probe[2] === 0xbf) {
    offset = 3;
  }
  while (offset < probe.byteLength) {
    const byte = probe[offset];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      offset += 1;
      continue;
    }
    break;
  }
  return offset;
}

function isSvgProbe(probe: Uint8Array): boolean {
  const offset = skipBomAndWhitespace(probe);
  const rest = Buffer.from(probe.subarray(offset)).toString('utf8');
  if (rest.startsWith('<svg')) return true;
  if (!rest.startsWith('<?xml')) return false;
  return rest.includes('<svg');
}

function sniffImageMediaType(probe: Uint8Array): string {
  if (startsWithBytes(probe, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(probe, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const gif = asciiAt(probe, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  if (asciiAt(probe, 0, 4) === 'RIFF' && asciiAt(probe, 8, 4) === 'WEBP') return 'image/webp';
  if (isSvgProbe(probe)) return 'image/svg+xml';
  return '';
}

export function chooseGitFilePresentation(
  byteLength: number,
  probe: Uint8Array
): GitFileClassification {
  if (byteLength > VIEWER_DOWNLOAD_ONLY_BYTES) {
    return { presentation: 'download', binary: false, mediaType: '' };
  }
  const mediaType = sniffImageMediaType(probe);
  if (mediaType !== '') {
    return { presentation: 'image', binary: probeHasNul(probe), mediaType };
  }
  if (probeHasNul(probe)) {
    return { presentation: 'hex', binary: true, mediaType: '' };
  }
  return { presentation: 'text', binary: false, mediaType: '' };
}
