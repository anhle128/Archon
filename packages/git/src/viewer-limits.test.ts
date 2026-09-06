import { describe, expect, test } from 'bun:test';

import {
  ViewerCursorError,
  chooseGitFilePresentation,
  decodeViewerCursor,
  encodeViewerCursor,
  sliceTextPage,
} from './viewer-limits';

const VERSION = 'a'.repeat(64);
const FILE_CURSOR =
  'eyJvIjo0MDk2LCJ2IjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSJ9';

describe('viewer cursors', () => {
  test('encodes a canonical route-specific versioned file cursor', () => {
    expect(encodeViewerCursor('o', 4096, VERSION)).toBe(FILE_CURSOR);
    expect(decodeViewerCursor(FILE_CURSOR, 'o', VERSION)).toBe(4096);
    expect(decodeViewerCursor('', 'o', VERSION)).toBe(0);
  });

  test('rejects a hunk cursor on the file route and rejects extra fields', () => {
    const hunk = Buffer.from('{"h":2,"v":"' + VERSION + '"}', 'utf8').toString('base64url');
    const extra = Buffer.from('{"o":2,"v":"' + VERSION + '","x":1}', 'utf8').toString('base64url');
    expect(() => decodeViewerCursor(hunk, 'o', VERSION)).toThrow(ViewerCursorError);
    expect(() => decodeViewerCursor(extra, 'o', VERSION)).toThrow(ViewerCursorError);
  });

  test('distinguishes malformed and stale cursors', () => {
    try {
      decodeViewerCursor('not+base64url', 'o', VERSION);
      expect.unreachable('expected invalid cursor');
    } catch (error) {
      expect(error).toMatchObject({ name: 'ViewerCursorError', code: 'invalid' });
    }
    try {
      decodeViewerCursor(FILE_CURSOR, 'o', 'b'.repeat(64));
      expect.unreachable('expected stale cursor');
    } catch (error) {
      expect(error).toMatchObject({ name: 'ViewerCursorError', code: 'stale' });
    }
  });
});

describe('text first paint', () => {
  test('stops after exactly 2000 newline-terminated lines', () => {
    const raw = Array.from({ length: 2001 }, (_unused, index) => 'L' + String(index) + '\n').join(
      ''
    );
    const page = sliceTextPage(Buffer.from(raw, 'utf8'), false);
    expect(Buffer.from(page.bytes).toString('utf8').endsWith('L1999\n')).toBe(true);
    expect(Buffer.from(page.bytes).toString('utf8')).not.toContain('L2000\n');
    expect(page.truncated).toBe(true);
  });

  test('never exceeds 262144 bytes and does not split a UTF-8 code point', () => {
    const raw = 'x'.repeat(262143) + '🙂tail';
    const page = sliceTextPage(Buffer.from(raw, 'utf8'), false);
    expect(page.bytes.byteLength).toBeLessThanOrEqual(262144);
    expect(Buffer.from(page.bytes).toString('utf8')).not.toContain('�');
    expect(page.consumedBytes).toBeGreaterThan(0);
    expect(page.truncated).toBe(true);
  });

  test('returns every byte of a short final page', () => {
    const page = sliceTextPage(Buffer.from('one\ntwo\n', 'utf8'), false);
    expect(Buffer.from(page.bytes).toString('utf8')).toBe('one\ntwo\n');
    expect(page.consumedBytes).toBe(8);
    expect(page.truncated).toBe(false);
  });
});

describe('presentation selection', () => {
  test('makes every file above 52428800 bytes download-only before probing', () => {
    expect(chooseGitFilePresentation(52428801, new Uint8Array([0]))).toEqual({
      presentation: 'download',
      binary: false,
      mediaType: '',
    });
  });

  test('detects each approved image before applying the NUL heuristic', () => {
    const cases: Array<[Uint8Array, string]> = [
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
      [Uint8Array.from([0xff, 0xd8, 0xff, 0]), 'image/jpeg'],
      [Buffer.from('GIF89a\0', 'binary'), 'image/gif'],
      [Buffer.from('RIFF0000WEBP\0', 'binary'), 'image/webp'],
      [Buffer.from('\uFEFF  <?xml version="1.0"?>\\n<svg></svg>', 'utf8'), 'image/svg+xml'],
    ];
    for (const [bytes, mediaType] of cases) {
      expect(chooseGitFilePresentation(bytes.byteLength, bytes)).toEqual({
        presentation: 'image',
        binary: bytes.includes(0),
        mediaType,
      });
    }
  });

  test('classifies an ordinary NUL payload as hex and ordinary UTF-8 as text', () => {
    expect(chooseGitFilePresentation(3, Uint8Array.from([1, 0, 2])).presentation).toBe('hex');
    expect(chooseGitFilePresentation(6, Buffer.from('hello\n')).presentation).toBe('text');
  });
});
