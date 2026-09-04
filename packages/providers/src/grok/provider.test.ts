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

function usageTerminalLines(sessionId = 'session-usage'): string[] {
  return [
    '{"type":"text","data":"hello"}\n',
    JSON.stringify({
      type: 'end',
      stopReason: 'end_turn',
      sessionId,
      requestId: 'request-1',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      total_cost_usd: 0.25,
      modelUsage: { 'grok-build': { modelCalls: 2 } },
    }) + '\n',
  ];
}

function processWithStderrReject(stdout: string[]): GrokProcess {
  return {
    stdout: stream(stdout),
    stderr: new ReadableStream({
      start(controller): void {
        controller.error(new Error('stderr read failed'));
      },
    }),
    exited: Promise.resolve(0),
    kill: (): void => {},
  };
}

function processWithExitReject(stdout: string[]): GrokProcess {
  const exited = Promise.reject(new Error('exit wait failed'));
  void exited.catch(() => undefined);
  return {
    stdout: stream(stdout),
    stderr: stream([]),
    exited,
    kill: (): void => {},
  };
}

function processWithStdoutFailAfter(stdoutText: string): GrokProcess {
  const encoder = new TextEncoder();
  const payload = encoder.encode(stdoutText.endsWith('\n') ? stdoutText : `${stdoutText}\n`);
  let delivered = false;
  return {
    stdout: new ReadableStream({
      pull(controller): void {
        if (!delivered) {
          delivered = true;
          controller.enqueue(payload);
          return;
        }
        controller.error(new Error('stdout read failed'));
      },
    }),
    stderr: stream([]),
    exited: Promise.resolve(0),
    kill: (): void => {},
  };
}

async function collect(
  provider: GrokProvider,
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

  test('preserves parsed usage once when stderr rejects after a terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStderrReject(usageTerminalLines('usage-stderr')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo']);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-stderr',
      stopReason: 'end_turn',
      tokens: { input: 10, output: 5, total: 15, cost: 0.25 },
      cost: 0.25,
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['stderr read failed'],
    });
  });

  test('preserves parsed usage once when process.exited rejects after a terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithExitReject(usageTerminalLines('usage-exit')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo']);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-exit',
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['exit wait failed'],
    });
  });

  test('preserves parsed usage once when stdout fails after the terminal end event', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStdoutFailAfter(usageTerminalLines('usage-stdout').join('')),
      resolveBinary: async () => '/bin/grok',
    });
    const chunks = await collect(provider, ['hello', '/repo']);
    const results = chunks.filter(
      (chunk): chunk is Record<string, unknown> =>
        typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === 'result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_transport_error',
      sessionId: 'usage-stdout',
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
      errors: ['stdout read failed'],
    });
  });

  test('throws on early stderr rejection with no parsed usage', async () => {
    const provider = new GrokProvider({
      spawn: () => processWithStderrReject([]),
      resolveBinary: async () => '/bin/grok',
    });
    await expect(collect(provider, ['hello', '/repo'])).rejects.toThrow('stderr read failed');
  });

  test('keeps nonzero exit subtype and message when usage was observed', async () => {
    const provider = new GrokProvider({
      spawn: () => processFor(usageTerminalLines('usage-nonzero'), 'not authenticated', 1),
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
      sessionId: 'usage-nonzero',
      resumed: false,
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-build',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
          requests: 2,
        },
      ],
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
