import { describe, expect, test } from 'bun:test';
import {
  buildDeliveryHeaderEvidence,
  mergeDeliveryHeaders,
  normalizeDeliveryHeaders,
  validateDeliveryHeaders,
} from './delivery-headers';

const archonHeaders = {
  'Content-Type': 'application/json',
  'X-Webhook-Signature-V2': 'sig',
  'X-Webhook-Timestamp': '1',
  'X-Request-ID': 'id-1',
};

describe('delivery headers', () => {
  test('accepts a valid string record', () => {
    expect(normalizeDeliveryHeaders({ Authorization: 'Bearer secret' })).toEqual({
      Authorization: 'Bearer secret',
    });
  });

  test('rejects non-string values with a constant non-secret error', () => {
    try {
      normalizeDeliveryHeaders({ Authorization: { secret: 'Bearer secret' } });
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as Error).message).toBe('unsafe-delivery-headers');
      expect((error as Error).message).not.toContain('Bearer secret');
    }
  });

  test('rejects every reserved name case-insensitively', () => {
    for (const name of [
      'content-type',
      'X-WEBHOOK-SIGNATURE-V2',
      'x-webhook-timestamp',
      'x-request-id',
      'Host',
      'Content-Length',
      'Connection',
      'Keep-Alive',
      'Proxy-Authenticate',
      'Proxy-Authorization',
      'Proxy-Connection',
      'TE',
      'Trailer',
      'Transfer-Encoding',
      'Upgrade',
    ]) {
      expect(() => validateDeliveryHeaders({ [name]: 'x' })).toThrow(/unsafe-delivery-headers/);
    }
  });

  test('rejects invalid names, line breaks, count, per-field bytes, and aggregate value bytes', () => {
    expect(() => validateDeliveryHeaders({ 'Bad Name': 'x' })).toThrow();
    expect(() => validateDeliveryHeaders({ 'Bad\rName': 'x' })).toThrow();
    expect(() => validateDeliveryHeaders({ Authorization: 'Bearer\nsecret' })).toThrow();
    for (const value of [
      'Bearer\0secret',
      'Bearer\u000Bsecret',
      'Bearer\u001Fsecret',
      'x\u007Fy',
    ]) {
      expect(() => validateDeliveryHeaders({ Authorization: value })).toThrow(
        /unsafe-delivery-headers/
      );
    }
    expect(() => validateDeliveryHeaders({ Authorization: 'Bearer\tsecret' })).not.toThrow();
    expect(() =>
      validateDeliveryHeaders(
        Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`X-H${index}`, 'v']))
      )
    ).toThrow();
    expect(() => validateDeliveryHeaders({ ['é'.repeat(65)]: 'v' })).toThrow();
    expect(() => validateDeliveryHeaders({ Authorization: 'é'.repeat(4_097) })).toThrow();
    expect(() =>
      validateDeliveryHeaders({
        'X-A': 'x'.repeat(8_192),
        'X-B': 'x'.repeat(8_192),
        'X-C': 'x'.repeat(8_192),
        'X-D': 'x'.repeat(8_192),
        'X-E': 'x',
      })
    ).toThrow();
  });

  test('merges valid receiver headers and redacts only their evidence values', () => {
    expect(mergeDeliveryHeaders(archonHeaders, { Authorization: 'Bearer secret' })).toEqual({
      ...archonHeaders,
      Authorization: 'Bearer secret',
    });
    expect(buildDeliveryHeaderEvidence(archonHeaders, { Authorization: 'Bearer secret' })).toEqual({
      ...archonHeaders,
      Authorization: '[REDACTED]',
    });
    expect(() => mergeDeliveryHeaders(archonHeaders, { 'content-type': 'text/plain' })).toThrow(
      /unsafe-delivery-headers/
    );
  });
});
