const BYTES_PER_ROW = 16;
const HEX_FIELD_WIDTH = 47;
const OFFSET_WIDTH = 8;

function printableAscii(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

export function formatHexPeek(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return '';
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BYTES_PER_ROW) {
    const end = Math.min(offset + BYTES_PER_ROW, bytes.byteLength);
    const hex: string[] = [];
    let ascii = '';
    for (let index = offset; index < end; index += 1) {
      const byte = bytes[index] ?? 0;
      hex.push(byte.toString(16).padStart(2, '0'));
      ascii += printableAscii(byte);
    }
    const offsetField = offset.toString(16).padStart(OFFSET_WIDTH, '0');
    const hexField = hex.join(' ').padEnd(HEX_FIELD_WIDTH, ' ');
    lines.push(`${offsetField}  ${hexField}  |${ascii.padEnd(BYTES_PER_ROW, ' ')}|`);
  }
  return lines.join('\n');
}
