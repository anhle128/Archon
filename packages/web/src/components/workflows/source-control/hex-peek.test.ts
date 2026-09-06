import { expect, test } from 'bun:test';

import { formatHexPeek } from './hex-peek';

test('formats sixteen-byte rows with offset, padded hex, and printable ASCII', () => {
  expect(formatHexPeek(Uint8Array.from([0x00, 0x41, 0xff]))).toBe(
    '00000000  00 41 ff                                         |.A.             |'
  );
});
