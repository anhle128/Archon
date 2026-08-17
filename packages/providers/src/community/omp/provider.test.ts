import { describe, expect, test } from 'bun:test';

import type { MessageChunk, SendQueryOptions } from '../../types';
import {
  OmpProvider,
  buildOmpArgs,
  type OmpProcess,
  type OmpSpawner,
  type OmpSpawnOptions,
} from './provider';

const encoder = new TextEncoder();

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface FakeProcess extends OmpProcess {
  signals: NodeJS.Signals[];
  pushStdout?: (text: string) => void;
}

function makeProcess(stdoutChunks: string[], stderr = '', exitCode = 0): FakeProcess {
  const proc: FakeProcess = {
    stdout: streamFromChunks(stdoutChunks),
    stderr: streamFromChunks([stderr]),
    exited: Promise.resolve(exitCode),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
    },
  };
  return proc;
}

function makeRunningProcess(exitOn: NodeJS.Signals, stdoutFailure?: Error): FakeProcess {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveExit: ((code: number) => void) | undefined;
  let reaped = false;
  const proc: FakeProcess = {
    stdout: new ReadableStream<Uint8Array>({
      start(controller): void {
        stdoutController = controller;
      },
    }),
    stderr: streamFromChunks([]),
    exited: new Promise<number>(resolve => {
      resolveExit = resolve;
    }),
    signals: [],
    pushStdout: (text): void => {
      stdoutController?.enqueue(encoder.encode(text));
    },
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
      if (signal === exitOn && !reaped) {
        reaped = true;
        if (stdoutFailure) stdoutController?.error(stdoutFailure);
        else stdoutController?.close();
        resolveExit?.(0);
      }
    },
  };
  return proc;
}

function makeStderrRejectingProcess(): FakeProcess {
  const proc: FakeProcess = {
    stdout: streamFromChunks([]),
    stderr: new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.error(new Error('stderr read failed'));
      },
    }),
    exited: new Promise<number>(resolve => {
      setTimeout(() => resolve(0), 20);
    }),
    signals: [],
    kill: (signal = 'SIGTERM'): void => {
      proc.signals.push(signal);
    },
  };
  return proc;
}

function successfulLines(sessionId = 'omp-session-1', text = 'Hello'): string[] {
  return [
    JSON.stringify({ type: 'session', id: sessionId }),
    JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: text },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.1 } },
        stopReason: 'stop',
      },
    }),
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: 'contents',
      isError: false,
    }),
    JSON.stringify({ type: 'agent_end', messages: [] }),
  ];
}

function modelErrorLines(): string[] {
  return [
    JSON.stringify({ type: 'session', id: 'model-error-session' }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"answer":"partial"}' }],
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        usage: { input: 7, output: 4, totalTokens: 11, cost: { total: 0.3 } },
        stopReason: 'error',
        errorMessage: 'rate limited',
      },
    }),
    '{bad json',
  ];
}

function makeSpawner(
  proc: FakeProcess,
  calls: { command: string[]; options: OmpSpawnOptions }[]
): OmpSpawner {
  return (command, options): OmpProcess => {
    calls.push({ command, options });
    return proc;
  };
}

async function collect(
  provider: OmpProvider,
  resumeSessionId?: string,
  requestOptions: SendQueryOptions = {}
): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of provider.sendQuery('hello', '/repo', resumeSessionId, {
    ...requestOptions,
    env: { OMP_BIN_PATH: process.execPath, ...requestOptions.env },
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for test condition.');
}

describe('buildOmpArgs', () => {
  test('builds a safe headless OMP command', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {
        model: 'openai-codex/gpt-5.6-sol',
        modelReasoningEffort: 'high',
      },
      requestOptions: {
        systemPrompt: ['first', 'second'],
        nodeConfig: { skills: ['archon', 'review-*'] },
      },
    });

    expect(result.args).toEqual([
      '--mode',
      'json',
      '--cwd',
      '/repo',
      '--yolo',
      '--no-title',
      '--no-extensions',
      '--model',
      'openai-codex/gpt-5.6-sol',
      '--thinking',
      'high',
      '--system-prompt',
      'first\n\nsecond',
      '--skills',
      'archon,review-*',
      '--',
      'hello',
    ]);
  });

  test('uses request model and string thinking before assistant defaults', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { model: 'fallback/model', modelReasoningEffort: 'low' },
      requestOptions: {
        model: 'selected/model',
        nodeConfig: { thinking: 'off', effort: 'future-effort' },
      },
    });
    expect(result.args).toContain('selected/model');
    expect(result.thinking).toBe('off');
  });

  test('passes raw effort unchanged when string thinking is absent', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: {},
      requestOptions: { nodeConfig: { effort: '  future-omp  ' } },
    });
    expect(result.thinking).toBe('  future-omp  ');
  });

  test('uses resume, fork, and in-memory flags without inventing session ids', () => {
    const resumeArgs = buildOmpArgs({
      prompt: 'a',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
    }).args;
    const resumeIndex = resumeArgs.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(resumeArgs[resumeIndex + 1]).toBe('session-1');

    const forkArgs = buildOmpArgs({
      prompt: 'b',
      cwd: '/repo',
      config: {},
      resumeSessionId: 'session-1',
      requestOptions: { forkSession: true },
    }).args;
    const forkIndex = forkArgs.indexOf('--fork');
    expect(forkIndex).toBeGreaterThan(-1);
    expect(forkArgs[forkIndex + 1]).toBe('session-1');

    expect(
      buildOmpArgs({
        prompt: 'c',
        cwd: '/repo',
        config: {},
        requestOptions: { persistSession: false },
      }).args
    ).toContain('--no-session');
  });

  test('rejects resume when persistence is disabled', () => {
    expect(() =>
      buildOmpArgs({
        prompt: 'hello',
        cwd: '/repo',
        config: {},
        resumeSessionId: 'session-1',
        requestOptions: { persistSession: false },
      })
    ).toThrow('cannot resume');
  });

  test('omits no-extensions only after explicit opt-in', () => {
    const result = buildOmpArgs({
      prompt: 'hello',
      cwd: '/repo',
      config: { enableExtensions: true },
    });
    expect(result.args).not.toContain('--no-extensions');
  });
});

describe('OmpProvider', () => {
  test('streams fragmented NDJSON and emits the concrete session result', async () => {
    const ndjson = successfulLines().join('\r\n');
    const proc = makeProcess([ndjson.slice(0, 17), ndjson.slice(17, 91), ndjson.slice(91)]);
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }));

    expect(calls).toHaveLength(1);
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Hello' });
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'read',
      toolInput: { path: 'README.md' },
      toolCallId: 'tool-1',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolOutput: 'contents',
      toolCallId: 'tool-1',
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'omp-session-1',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      stopReason: 'stop',
      resolvedModel: { id: 'openai-codex/gpt-5.6-sol' },
    });
  });

  test('marks a successful resumed stream as resumed', async () => {
    const proc = makeProcess([successfulLines('new-session').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'old-session');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'new-session',
      resumed: true,
    });
  });

  test('maps a non-zero exit with stderr diagnostics', async () => {
    const proc = makeProcess([], 'missing credentials', 2);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), 'old-session');
    expect(chunks.at(-2)).toMatchObject({
      type: 'system',
      content: expect.stringContaining('setup'),
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'omp_exit_nonzero',
      resumed: false,
    });
  });

  test('preserves parser metadata on a non-zero exit result', async () => {
    const proc = makeProcess(
      [successfulLines('exit-session', '{"answer":"ok"}').join('\n')],
      'process failed',
      2
    );
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'exit-session',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      stopReason: 'stop',
      numTurns: 1,
      resolvedModel: { id: 'openai-codex/gpt-5.6-sol' },
      structuredOutput: { answer: 'ok' },
      isError: true,
      errorSubtype: 'omp_exit_nonzero',
    });
  });

  test('maps exit zero without agent_end to incomplete output', async () => {
    const proc = makeProcess([[JSON.stringify({ type: 'session', id: 'incomplete' })].join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'incomplete',
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('maps malformed JSON to a protocol error and kills the child', async () => {
    const proc = makeRunningProcess('SIGTERM');
    const chunksPromise = collect(new OmpProvider({ spawn: makeSpawner(proc, []) }));
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(
      `${JSON.stringify({ type: 'session', id: 'protocol-session' })}\n{bad json\n`
    );
    const chunks = await chunksPromise;
    expect(proc.signals).toContain('SIGTERM');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'protocol-session',
      isError: true,
      errorSubtype: 'omp_protocol_error',
    });
  });

  test('preserves parser metadata and model errors on a protocol error result', async () => {
    const proc = makeProcess([modelErrorLines().join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, []) }), undefined, {
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      sessionId: 'model-error-session',
      tokens: { input: 7, output: 4, total: 11, cost: 0.3 },
      cost: 0.3,
      stopReason: 'error',
      numTurns: 1,
      resolvedModel: { id: 'openai-codex/gpt-5.6-sol' },
      structuredOutput: { answer: 'partial' },
      isError: true,
      errorSubtype: 'omp_protocol_error',
      errors: expect.arrayContaining(['rate limited']),
    });
  });

  test('warns before spawn for object-form thinking and falls back to effort', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const proc = makeProcess([successfulLines().join('\n')]);
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, calls) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      {
        env: { OMP_BIN_PATH: process.execPath },
        nodeConfig: { thinking: { type: 'enabled' }, effort: 'high' },
      }
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'system', content: expect.stringContaining('object-form') },
    });
    expect(calls).toHaveLength(0);
    await iterator.next();
    expect(calls[0]?.command).toContain('high');
    await iterator.return(undefined);
  });

  test('rejects a pre-aborted request without spawning', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    controller.abort();
    const provider = new OmpProvider({ spawn: makeSpawner(makeProcess([]), calls) });
    await expect(
      collect(provider, undefined, { abortSignal: controller.signal, env: { OMP_BIN_PATH: '' } })
    ).rejects.toThrow('Query aborted');
    expect(calls).toHaveLength(0);
  });

  test('escalates an aborted stream from SIGTERM to SIGKILL', async () => {
    const proc = makeRunningProcess('SIGKILL');
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      abortSignal: controller.signal,
    });
    await waitFor(() => calls.length === 1);
    controller.abort();
    await expect(run).rejects.toThrow('Query aborted');
    expect(proc.signals).toEqual(['SIGTERM', 'SIGKILL']);
  }, 7_000);

  test('reports abort when SIGTERM makes stdout reject', async () => {
    const proc = makeRunningProcess('SIGTERM', new Error('stdout read failed'));
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const controller = new AbortController();
    const run = collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      abortSignal: controller.signal,
    });
    await waitFor(() => calls.length === 1);
    controller.abort();
    await expect(run).rejects.toThrow('Query aborted');
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('tears down and reaps after an early stderr read rejection', async () => {
    const proc = makeStderrRejectingProcess();
    await expect(collect(new OmpProvider({ spawn: makeSpawner(proc, []) }))).rejects.toThrow(
      'stderr read failed'
    );
    expect(proc.signals).toEqual(['SIGTERM']);
  });

  test('overlays request environment values on defined process values', async () => {
    const key = 'ARCHON_OMP_PROVIDER_TEST';
    const original = process.env[key];
    process.env[key] = 'base';
    try {
      const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
      const proc = makeProcess([successfulLines().join('\n')]);
      await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
        env: { [key]: 'request' },
      });
      expect(calls[0]?.options.env[key]).toBe('request');
      const envPath = calls[0]?.options.env.PATH ?? calls[0]?.options.env.Path;
      expect(envPath).toBeDefined();
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  test('augments JSON-schema prompts and returns parsed structured output', async () => {
    const calls: { command: string[]; options: OmpSpawnOptions }[] = [];
    const proc = makeProcess([successfulLines('json-session', '{"answer":"ok"}').join('\n')]);
    const chunks = await collect(new OmpProvider({ spawn: makeSpawner(proc, calls) }), undefined, {
      outputFormat: {
        type: 'json_schema',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    });
    expect(calls[0]?.command.at(-1)).toContain('CRITICAL: Respond with ONLY a JSON object');
    expect(chunks.at(-1)).toMatchObject({
      type: 'result',
      structuredOutput: { answer: 'ok' },
    });
  });

  test('clears the escalation timer after early close reaps the child', async () => {
    const proc = makeRunningProcess('SIGTERM');
    const iterator = new OmpProvider({ spawn: makeSpawner(proc, []) }).sendQuery(
      'hello',
      '/repo',
      undefined,
      { env: { OMP_BIN_PATH: process.execPath } }
    );
    const firstChunk = iterator.next();
    await waitFor(() => proc.stdout?.locked === true);
    proc.pushStdout?.(`${successfulLines().slice(0, 4).join('\n')}\n`);
    await expect(firstChunk).resolves.toMatchObject({
      value: { type: 'assistant', content: 'Hello' },
    });
    await iterator.return(undefined);
    await new Promise(resolve => setTimeout(resolve, 5_100));
    expect(proc.signals).toEqual(['SIGTERM']);
  }, 7_000);
});
