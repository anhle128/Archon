import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { signHermesV2 } from './hermes-signer';

describe('signHermesV2', () => {
  test('computes lowercase HMAC-SHA256 over timestamp dot raw body', () => {
    const body = '{"eventId":"evt-1"}';
    const expected = createHmac('sha256', 'secret').update(`1760000000.${body}`).digest('hex');

    expect(signHermesV2('secret', 1760000000, body)).toEqual({
      timestamp: '1760000000',
      signature: expected,
    });
  });
});
