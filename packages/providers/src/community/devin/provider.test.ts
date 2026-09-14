import { describe, expect, test } from 'bun:test';

import { AskHumanAwaitingError, type MessageChunk, type NativeTool } from '../../types';
import type { DevinProcessInput } from './acp-client';
import { DEVIN_CAPABILITIES } from './capabilities';
import { DevinProviderError } from './errors';
import { DevinProvider, type DevinTurnRunner } from './provider';

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function successChunks(): MessageChunk[] {
  return [
    { type: 'assistant', content: 'PONG' },
    { type: 'result', sessionId: 'sess-1', stopReason: 'end_turn' },
  ];
}

function recordingRunner(
  calls: DevinProcessInput[],
  chunks: MessageChunk[] = successChunks()
): DevinTurnRunner {
  return async function* (input: DevinProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    for (const chunk of chunks) yield chunk;
  };
}

function throwingRunner(calls: DevinProcessInput[], error: unknown): DevinTurnRunner {
  return async function* (input: DevinProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    throw error;
  };
}

function askTool(): NativeTool {
  return {
    name: 'AskHuman',
    description: 'ask',
    inputSchema: { type: 'object' },
    handler: async () => 'x',
  };
}

function provider(
  runner: DevinTurnRunner,
  overrides: { binary?: () => string; loggedIn?: () => void } = {}
): DevinProvider {
  return new DevinProvider({
    runTurn: runner,
    resolveBinary: overrides.binary ?? ((): string => '/stub/devin'),
    assertLoggedIn: overrides.loggedIn ?? ((): void => undefined),
  });
}

describe('DevinProvider', () => {
  test('exposes type and capabilities', () => {
    const p = provider(recordingRunner([]));
    expect(p.getType()).toBe('devin');
    expect(p.getCapabilities()).toBe(DEVIN_CAPABILITIES);
  });

  test('builds the turn input from config, request options, and env; stamps resumed on resume', async () => {
    const calls: DevinProcessInput[] = [];
    const p = provider(recordingRunner(calls));
    const ask = askTool();
    const abort = new AbortController();
    const chunks = await collect(
      p.sendQuery('do it', '/repo', 'sess-1', {
        model: 'claude-opus-5-low',
        env: { FOO: 'bar' },
        assistantConfig: { agentType: 'review', refusalFallback: ['a'] },
        outputFormat: { type: 'json_schema', schema: { type: 'object' } },
        abortSignal: abort.signal,
        nativeTools: [
          ask,
          { name: 'manage_run', description: 'x', inputSchema: {}, handler: async () => '' },
        ],
        resumeInteractions: [{ tool_use_id: 'call_1', payload: 'declined', declined: true }],
      })
    );
    expect(calls).toHaveLength(1);
    const input = calls[0]!;
    expect(input).toMatchObject({
      cwd: '/repo',
      prompt: 'do it',
      resumeSessionId: 'sess-1',
      model: 'claude-opus-5-low',
      binaryPath: '/stub/devin',
      spawnArgs: [
        '--permission-mode',
        'yolo',
        'acp',
        '--agent-type',
        'review',
        '--refusal-fallback',
        'a',
      ],
      outputSchema: { type: 'object' },
      resumeInteractions: [{ tool_use_id: 'call_1', payload: 'declined', declined: true }],
    });
    expect(input.askHuman).toBe(ask);
    expect(input.abortSignal).toBe(abort.signal);
    expect(input.env.FOO).toBe('bar');
    expect(input.env.PATH).toBe(process.env.PATH);
    expect(chunks.at(-1)).toMatchObject({ type: 'result', sessionId: 'sess-1', resumed: true });
  });

  test('config model is the fallback when the request has none', async () => {
    const calls: DevinProcessInput[] = [];
    await collect(
      provider(recordingRunner(calls)).sendQuery('x', '/repo', undefined, {
        assistantConfig: { model: 'cfg-model' },
      })
    );
    expect(calls[0]?.model).toBe('cfg-model');
    expect(calls[0]?.askHuman).toBeUndefined();
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  test('pre-aborted signal yields devin_aborted without preflight', async () => {
    const calls: DevinProcessInput[] = [];
    let resolved = false;
    const abort = new AbortController();
    abort.abort();
    const p = provider(recordingRunner(calls), {
      binary: () => {
        resolved = true;
        return '/stub/devin';
      },
    });
    const chunks = await collect(
      p.sendQuery('x', '/repo', undefined, { abortSignal: abort.signal })
    );
    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'devin_aborted',
        errors: ['Devin turn aborted before start.'],
      },
    ]);
    expect(calls).toEqual([]);
    expect(resolved).toBe(false);
  });

  test('invalid config, missing binary, and missing login become terminal results before spawn', async () => {
    const calls: DevinProcessInput[] = [];
    const bad = await collect(
      provider(recordingRunner(calls)).sendQuery('x', '/repo', undefined, {
        assistantConfig: { permissionMode: 'auto' },
      })
    );
    expect(bad[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'devin_unsupported_config',
    });

    const noBin = await collect(
      provider(recordingRunner(calls), {
        binary: () => {
          throw new DevinProviderError('devin_binary_missing', 'no devin');
        },
      }).sendQuery('x', '/repo')
    );
    expect(noBin[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'devin_binary_missing',
      errors: ['no devin'],
    });

    const noLogin = await collect(
      provider(recordingRunner(calls), {
        loggedIn: () => {
          throw new DevinProviderError('devin_not_logged_in', 'login');
        },
      }).sendQuery('x', '/repo')
    );
    expect(noLogin[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'devin_not_logged_in',
    });
    expect(calls).toEqual([]);
  });

  test('runner failures become redacted terminal results', async () => {
    const calls: DevinProcessInput[] = [];
    const p = provider(
      throwingRunner(calls, new DevinProviderError('devin_child_exited', 'died: tok-secret-9999'))
    );
    const chunks = await collect(
      p.sendQuery('x', '/repo', undefined, { env: { DEVIN_API_TOKEN: 'tok-secret-9999' } })
    );
    expect(chunks).toEqual([
      {
        type: 'result',
        isError: true,
        errorSubtype: 'devin_child_exited',
        errors: ['died: [REDACTED]'],
      },
    ]);
  });

  test('AskHuman control errors are thrown out of sendQuery, not converted', async () => {
    const awaiting = new AskHumanAwaitingError('call_1', 'node', 'run');
    const p = provider(throwingRunner([], awaiting));
    let thrown: unknown;
    try {
      await collect(p.sendQuery('x', '/repo', undefined, { nativeTools: [askTool()] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
  });
});
