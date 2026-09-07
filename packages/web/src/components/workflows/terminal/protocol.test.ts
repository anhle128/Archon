import { describe, expect, test } from 'bun:test';

import {
  INPUT_MAX_BYTES,
  chunkTerminalInput,
  isResumeToken,
  parseServerControlMessage,
} from './protocol';

const TOKEN = 'a'.repeat(64);
const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

describe('parseServerControlMessage', () => {
  test('parses ready, exit, unavailable, and error while stripping unknown fields', () => {
    expect(
      parseServerControlMessage(
        JSON.stringify({
          type: 'ready',
          resumeToken: TOKEN,
          cols: 80,
          rows: 24,
          cwd: '/etc',
          containerId: 'forged',
        })
      )
    ).toEqual({ type: 'ready', resumeToken: TOKEN, cols: 80, rows: 24 });
    expect(parseServerControlMessage('{"type":"exit","code":0,"signal":null}')).toEqual({
      type: 'exit',
      code: 0,
      signal: null,
    });
    expect(parseServerControlMessage('{"type":"exit","code":null,"signal":"SIGTERM"}')).toEqual({
      type: 'exit',
      code: null,
      signal: 'SIGTERM',
    });
    expect(
      parseServerControlMessage(
        JSON.stringify({
          type: 'unavailable',
          reason: 'no_checkout',
          message: 'checkout gone',
          cwd: '/tmp',
        })
      )
    ).toEqual({
      type: 'unavailable',
      reason: 'no_checkout',
      message: 'checkout gone',
    });
    expect(
      parseServerControlMessage(
        '{"type":"unavailable","reason":"container_missing","message":"missing"}'
      )
    ).toEqual({
      type: 'unavailable',
      reason: 'container_missing',
      message: 'missing',
    });
    expect(
      parseServerControlMessage(
        '{"type":"unavailable","reason":"container_stopped","message":"stopped"}'
      )
    ).toEqual({
      type: 'unavailable',
      reason: 'container_stopped',
      message: 'stopped',
    });
    expect(
      parseServerControlMessage(
        '{"type":"unavailable","reason":"unsupported_provider","message":"vm"}'
      )
    ).toEqual({
      type: 'unavailable',
      reason: 'unsupported_provider',
      message: 'vm',
    });
    expect(parseServerControlMessage('{"type":"error","message":"overflow","cwd":"/"}')).toEqual({
      type: 'error',
      message: 'overflow',
    });
  });

  test('rejects malformed JSON, unknown types, wrong field types, and a non-hex ready token', () => {
    expect(parseServerControlMessage('{')).toBeNull();
    expect(parseServerControlMessage('[]')).toBeNull();
    expect(parseServerControlMessage('null')).toBeNull();
    expect(parseServerControlMessage('{"type":"input","data":"x"}')).toBeNull();
    expect(
      parseServerControlMessage(
        JSON.stringify({ type: 'ready', resumeToken: 'A'.repeat(64), cols: 80, rows: 24 })
      )
    ).toBeNull();
    expect(
      parseServerControlMessage(
        JSON.stringify({ type: 'ready', resumeToken: TOKEN, cols: 80.5, rows: 24 })
      )
    ).toBeNull();
    expect(
      parseServerControlMessage(
        JSON.stringify({ type: 'ready', resumeToken: TOKEN, cols: 80, rows: '24' })
      )
    ).toBeNull();
    expect(parseServerControlMessage('{"type":"exit","code":0.5,"signal":null}')).toBeNull();
    expect(parseServerControlMessage('{"type":"exit","code":0}')).toBeNull();
    expect(
      parseServerControlMessage('{"type":"unavailable","reason":"destroyed","message":"x"}')
    ).toBeNull();
    expect(parseServerControlMessage('{"type":"unavailable","reason":"no_checkout"}')).toBeNull();
    expect(parseServerControlMessage('{"type":"error","message":1}')).toBeNull();
  });
});

describe('isResumeToken', () => {
  test('accepts only 64-character lowercase hex', () => {
    expect(isResumeToken(TOKEN)).toBe(true);
    expect(isResumeToken('A'.repeat(64))).toBe(false);
    expect(isResumeToken('g'.repeat(64))).toBe(false);
    expect(isResumeToken('a'.repeat(63))).toBe(false);
    expect(isResumeToken(null)).toBe(false);
    expect(isResumeToken(undefined)).toBe(false);
  });
});

describe('chunkTerminalInput', () => {
  test('splits ASCII on INPUT_MAX_BYTES boundaries', () => {
    const data = 'a'.repeat(INPUT_MAX_BYTES + 10);
    expect(chunkTerminalInput(data)).toEqual(['a'.repeat(INPUT_MAX_BYTES), 'a'.repeat(10)]);
    expect(chunkTerminalInput('hi')).toEqual(['hi']);
    expect(chunkTerminalInput('')).toEqual([]);
  });

  test('splits a multi-byte string whose encoded size crosses 64 KiB on code-point boundaries', () => {
    const copyright = '\u00a9';
    const data = copyright.repeat(INPUT_MAX_BYTES / 2 + 8);
    expect(utf8Bytes(data)).toBeGreaterThan(INPUT_MAX_BYTES);
    const chunks = chunkTerminalInput(data);
    expect(chunks.length).toBeGreaterThan(1);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const chunk of chunks) {
      const encoded = encoder.encode(chunk);
      expect(encoded.byteLength).toBeLessThanOrEqual(INPUT_MAX_BYTES);
      expect(decoder.decode(encoded)).toBe(chunk);
    }
    expect(chunks.join('')).toBe(data);
  });

  test('does not split a 4-byte emoji across chunks at the byte limit', () => {
    const prefix = 'a'.repeat(INPUT_MAX_BYTES - 1);
    const emoji = '😀';
    const chunks = chunkTerminalInput(prefix + emoji);
    expect(utf8Bytes(chunks[0] ?? '')).toBe(INPUT_MAX_BYTES - 1);
    expect(chunks[1]).toBe(emoji);
    expect(chunks.join('')).toBe(prefix + emoji);
  });
});
