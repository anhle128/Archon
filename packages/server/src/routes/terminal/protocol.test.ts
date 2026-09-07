import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  INPUT_MAX_BYTES,
  MAX_CLIENT_FRAME_BYTES,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  PENDING_MAX_BYTES,
  RECONNECT_MS,
  REPLAY_MAX_BYTES,
  REPLACED_SOCKET_CLOSE_CODE,
  SOLO_TERMINAL_USER_ID,
  TERMINAL_PATH_RE,
  isResumeToken,
  parseClientControlMessage,
  serializeServerControlMessage,
  unavailableMessage,
} from './protocol';

describe('protocol constants', () => {
  test('exports the locked path, timing, frame, and dimension values', () => {
    expect(TERMINAL_PATH_RE.source).toBe('^\\/api\\/workflows\\/runs\\/([^/]+)\\/terminal$');
    expect(RECONNECT_MS).toBe(120000);
    expect(REPLAY_MAX_BYTES).toBe(262144);
    expect(INPUT_MAX_BYTES).toBe(65536);
    expect(PENDING_MAX_BYTES).toBe(1048576);
    expect(MAX_CLIENT_FRAME_BYTES).toBe(394240);
    expect(MIN_COLS).toBe(1);
    expect(MAX_COLS).toBe(500);
    expect(MIN_ROWS).toBe(1);
    expect(MAX_ROWS).toBe(200);
    expect(DEFAULT_COLS).toBe(80);
    expect(DEFAULT_ROWS).toBe(24);
    expect(SOLO_TERMINAL_USER_ID).toBe('solo');
    expect(REPLACED_SOCKET_CLOSE_CODE).toBe(4001);
  });

  test('MAX_CLIENT_FRAME_BYTES fits JSON-escaped 64 KiB of null characters', () => {
    const frame = JSON.stringify({ type: 'input', data: '\0'.repeat(INPUT_MAX_BYTES) });
    expect(Buffer.byteLength(frame, 'utf8')).toBeLessThanOrEqual(MAX_CLIENT_FRAME_BYTES);
    expect(MAX_CLIENT_FRAME_BYTES).toBe(INPUT_MAX_BYTES * 6 + 1024);
  });
});

describe('isResumeToken', () => {
  test('accepts only 64-character lowercase hex', () => {
    expect(isResumeToken('a'.repeat(64))).toBe(true);
    expect(isResumeToken('A'.repeat(64))).toBe(false);
    expect(isResumeToken('g'.repeat(64))).toBe(false);
    expect(isResumeToken('a'.repeat(63))).toBe(false);
    expect(isResumeToken(null)).toBe(false);
    expect(isResumeToken(undefined)).toBe(false);
  });
});

describe('parseClientControlMessage', () => {
  test('parses input, resize, and close while stripping unknown fields', () => {
    expect(parseClientControlMessage('{"type":"input","data":"pwd\\n"}')).toEqual({
      type: 'input',
      data: 'pwd\n',
    });
    expect(
      parseClientControlMessage('{"type":"input","data":"x","cwd":"/etc","containerId":"forged"}')
    ).toEqual({ type: 'input', data: 'x' });
    expect(parseClientControlMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
    expect(parseClientControlMessage('{"type":"close"}')).toEqual({ type: 'close' });
  });

  test('rejects malformed JSON and non-integer resize', () => {
    expect(parseClientControlMessage('{')).toEqual({ error: 'invalid_message' });
    expect(parseClientControlMessage('{"type":"resize","cols":80.5,"rows":24}')).toEqual({
      error: 'invalid_resize',
    });
  });

  test('rejects input that exceeds INPUT_MAX_BYTES in UTF-8 byte length', () => {
    const oversize = '\u00a9'.repeat(INPUT_MAX_BYTES / 2 + 1);
    expect(Buffer.byteLength(oversize, 'utf8')).toBeGreaterThan(INPUT_MAX_BYTES);
    expect(oversize.length).toBeLessThanOrEqual(INPUT_MAX_BYTES);
    expect(parseClientControlMessage(JSON.stringify({ type: 'input', data: oversize }))).toEqual({
      error: 'invalid_input',
    });
    expect(
      parseClientControlMessage(
        JSON.stringify({ type: 'input', data: 'a'.repeat(INPUT_MAX_BYTES) })
      )
    ).toEqual({ type: 'input', data: 'a'.repeat(INPUT_MAX_BYTES) });
  });

  test('enforces all four integer resize bounds', () => {
    expect(
      parseClientControlMessage(JSON.stringify({ type: 'resize', cols: MIN_COLS, rows: MIN_ROWS }))
    ).toEqual({
      type: 'resize',
      cols: MIN_COLS,
      rows: MIN_ROWS,
    });
    expect(
      parseClientControlMessage(JSON.stringify({ type: 'resize', cols: MAX_COLS, rows: MAX_ROWS }))
    ).toEqual({
      type: 'resize',
      cols: MAX_COLS,
      rows: MAX_ROWS,
    });
    expect(parseClientControlMessage('{"type":"resize","cols":0,"rows":24}')).toEqual({
      error: 'invalid_resize',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":501,"rows":24}')).toEqual({
      error: 'invalid_resize',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":80,"rows":0}')).toEqual({
      error: 'invalid_resize',
    });
    expect(parseClientControlMessage('{"type":"resize","cols":80,"rows":201}')).toEqual({
      error: 'invalid_resize',
    });
  });
});

describe('serializeServerControlMessage', () => {
  test('serializes typed server control messages to JSON', () => {
    expect(
      serializeServerControlMessage({
        type: 'ready',
        resumeToken: 'a'.repeat(64),
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      })
    ).toBe(JSON.stringify({ type: 'ready', resumeToken: 'a'.repeat(64), cols: 80, rows: 24 }));
    expect(serializeServerControlMessage({ type: 'exit', code: 0, signal: null })).toBe(
      '{"type":"exit","code":0,"signal":null}'
    );
    expect(
      serializeServerControlMessage({
        type: 'unavailable',
        reason: 'no_checkout',
        message: unavailableMessage('no_checkout'),
      })
    ).toContain('"type":"unavailable"');
    expect(
      serializeServerControlMessage({ type: 'error', message: 'Terminal output overflowed.' })
    ).toBe('{"type":"error","message":"Terminal output overflowed."}');
  });
});

describe('unavailableMessage', () => {
  test('maps each TerminalUnavailableReason to locked copy', () => {
    expect(unavailableMessage('no_checkout')).toBe(
      "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up."
    );
    expect(unavailableMessage('container_missing')).toBe(
      "This run's container isn't available — it may have been stopped or cleaned up."
    );
    expect(unavailableMessage('container_stopped')).toBe(
      "This run's container isn't available — it may have been stopped or cleaned up."
    );
    expect(unavailableMessage('unsupported_provider')).toBe(
      'This run uses an isolation provider the terminal cannot open.'
    );
  });
});
