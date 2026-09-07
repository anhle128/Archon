import { describe, expect, test } from 'bun:test';
import { PassThrough, Readable, Writable } from 'node:stream';

describe('ACP ndJsonStream on Bun', () => {
  test('loopback writes and reads a JSON-RPC message through ndJsonStream', async () => {
    const pipe = new PassThrough();
    const output = Writable.toWeb(pipe) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(pipe) as ReadableStream<Uint8Array>;
    const { ndJsonStream } = await import('@agentclientprotocol/sdk');
    const stream = ndJsonStream(output, input);
    const message = { jsonrpc: '2.0', method: 'test/ping' } as const;
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    await writer.write(message);
    expect((await reader.read()).value).toEqual(message);
    await writer.close();
  });
});
