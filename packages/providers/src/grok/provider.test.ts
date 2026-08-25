import { describe, expect, test } from 'bun:test';

import { buildGrokArgs, GrokProvider, type GrokProcess, type GrokSpawner } from './provider';

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function processFor(stdout: string[], stderr = '', exitCode = 0): GrokProcess {
  return {
    stdout: stream(stdout),
    stderr: stream([stderr]),
    exited: Promise.resolve(exitCode),
    kill: (): void => {},
  };
}

async function collect(
  provider: ompProvider,
  options: Parameters<GrokProvider['sendQuery']>
): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of provider.sendQuery(...options)) chunks.push(chunk);
  return chunks;
}

describe('buildGrokArgs', () => {
  test('maps the supported headless CLI surface', () => {
    expect(
      buildGrokArgs({
        prompt: 'do it',
        cwd: '/repo',
        config: { model: 'default', permissionMode: 'acceptEdits' },
        resumeSessionId: 'old-session',
        requestOptions: {
          model: 'grok-build',
          systemPrompt: { type: 'preset', preset: 'claude_code', append: 'extra rules' },
          forkSession: true,
          outputFormat: { type: 'json_schema', schema: { type: 'object' } },
          nodeConfig: {
            effort: 'high',
            allowed_tools: ['read_file', 'grep'],
            denied_tools: ['run_terminal_cmd'],
            agents: {
              reviewer: { description: 'Review', prompt: 'Review carefully' },
            },
          },
        },
      }).args
    ).toEqual([
      '--single',
      'do it',
      '--verbatim',
      '--cwd',
      '/repo',
      '--output-format',
      'streaming-json',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'grok-build',
      '--reasoning-effort',
      'high',
      '--rules',
      'extra rules',
      '--tools',
      'read_file,grep',
      '--disallowed-tools',
      'run_terminal_cmd',
      '--agents',
      '{"reviewer":{"description":"Review","prompt":"Review carefully"}}',
      '--json-schema',
      '{"type":"object"}',
      '--resume',
      'old-session',
      '--fork-session',
    ]);
  });

  test('defaults to bypass permissions and rejects impossible non-persistent resume', () => {
    expect(buildGrokArgs({ prompt: 'hi', cwd: '/repo', config: {} }).args).toContain(
      'bypassPermissions'
    );
    expect(() =>
      buildGrokArgs({
        prompt: 'hi',
        cwd: '/repo',
        config: {},
        requestOptions: { nodeConfig: { allowed_tools: [] } },
      })
    ).toThrow('cannot be enforced');
    expect(() =>
      buildGrokArgs({
        prompt: 'hi',
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session',
        requestOptions: { persistSession: false },
      })
    ).toThrow('persistSession is false');
  });
});

describe('GrokProvider', () => {
  test('streams fragmented NDJSON, injects env, and returns the concrete session', async () => {
    let spawnedCommand: string[] = [];
    let spawnedEnv: Record<string, string> = {};
    const spawn: GrokSpawner = (command, options) => {
      spawnedCommand = command;
      spawnedEnv = options.env;
      return processFor([
        '{"type":"text","data":"hel',
        'lo"}\n{"type":"end","stopReason":"end_turn","sessionId":"session-1","requestId":"request-1"}\n',
      ]);
    };
    const provider = new GrokProvider({ spawn, resolveBinary: async () => '/bin/grok' });

    await expect(
      collect(provider, ['hello', '/repo', undefined, { env: { XAI_API_KEY: 'managed' } }])
    ).resolves.toEqual([
      { type: 'assistant', content: 'hello' },
      { type: 'result', sessionId: 'session-1', stopReason: 'end_turn' },
    ]);
    expect(spawnedCommand[0]).toBe('/bin/grok');
    expect(spawnedEnv.XAI_API_KEY).toBe('managed');
  });

  test('maps nonzero authentication exits and unsuccessful resumes', async () => {
    const provider = new GrokProvider({
      spawn: () => processFor([], 'not authenticated', 1),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo', 'old-session']);
    expect(chunks).toContainEqual({
      type: 'system',
      content: expect.stringContaining('grok login'),
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_exit_nonzero',
      resumed: false,
    });
  });

  test('terminates a running process when aborted', async () => {
    const signals: (NodeJS.Signals | undefined)[] = [];
    let resolveExit: ((value: number) => void) | undefined;
    let closeStdout: (() => void) | undefined;
    const exited = new Promise<number>(resolve => {
      resolveExit = resolve;
    });
    const spawn: GrokSpawner = () => ({
      stdout: new ReadableStream({
        start(controller): void {
          closeStdout = (): void => controller.close();
        },
      }),
      stderr: stream([]),
      exited,
      kill: signal => {
        signals.push(signal);
        closeStdout?.();
        resolveExit?.(143);
      },
    });
    const controller = new AbortController();
    const provider = new GrokProvider({ spawn, resolveBinary: async () => '/bin/grok' });
    const result = collect(provider, [
      'hello',
      '/repo',
      undefined,
      { abortSignal: controller.signal },
    ]);
    await Promise.resolve();
    controller.abort();

    await expect(result).rejects.toThrow('Query aborted');
    expect(signals).toContain('SIGTERM');
  });
});
