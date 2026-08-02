import { describe, expect, test } from 'bun:test';
import { instrumentProvider, redactTraceValue, type LangfuseRuntime } from './observability';
import type { IAgentProvider, MessageChunk, ProviderCapabilities, SendQueryOptions } from './types';

interface RecordedObservation {
  name: string;
  type: string;
  attributes: Record<string, unknown>;
  updates: Record<string, unknown>[];
  children: RecordedObservation[];
  ended: boolean;
}

function capabilities(): ProviderCapabilities {
  return {
    sessionResume: true,
    mcp: true,
    hooks: true,
    skills: true,
    agents: true,
    toolRestrictions: true,
    structuredOutput: true,
    envInjection: true,
    costControl: true,
    effortControl: true,
    thinkingControl: true,
    fallbackModel: true,
    sandbox: true,
    nativeTools: true,
    containerExec: false,
  };
}

function makeProvider(chunks: readonly MessageChunk[]): IAgentProvider {
  return {
    getType: () => 'test-provider',
    getCapabilities: capabilities,
    async *sendQuery(): AsyncGenerator<MessageChunk> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeRuntime(): {
  runtime: LangfuseRuntime;
  roots: RecordedObservation[];
  propagated: Record<string, unknown>[];
} {
  const roots: RecordedObservation[] = [];
  const propagated: Record<string, unknown>[] = [];

  const makeObservation = (
    name: string,
    attributes: Record<string, unknown>,
    type: string
  ): RecordedObservation & {
    update: (update: Record<string, unknown>) => void;
    end: () => void;
    startObservation: (
      childName: string,
      childAttributes: Record<string, unknown>,
      options: { asType?: string }
    ) => unknown;
  } => {
    const observation = {
      name,
      type,
      attributes,
      updates: [],
      children: [],
      ended: false,
      update(update: Record<string, unknown>): void {
        observation.updates.push(update);
      },
      end(): void {
        observation.ended = true;
      },
      startObservation(
        childName: string,
        childAttributes: Record<string, unknown>,
        options: { asType?: string }
      ): unknown {
        const child = makeObservation(childName, childAttributes, options.asType ?? 'span');
        observation.children.push(child);
        return child;
      },
    };
    return observation;
  };

  const runtime = {
    sdk: { shutdown: async () => undefined },
    startObservation: ((
      name: string,
      attributes: Record<string, unknown>,
      options: {
        asType?: string;
      }
    ) => {
      const root = makeObservation(name, attributes, options.asType ?? 'span');
      roots.push(root);
      return root;
    }) as LangfuseRuntime['startObservation'],
    propagateAttributes: ((attributes: Record<string, unknown>, fn: () => unknown) => {
      propagated.push(attributes);
      return fn();
    }) as LangfuseRuntime['propagateAttributes'],
  };

  return { runtime, roots, propagated };
}

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('Langfuse provider observability', () => {
  test('preserves the stream and records agent, generation, tool, and subagent observations', async () => {
    const secret = 'super-secret-api-key';
    const chunks: MessageChunk[] = [
      { type: 'assistant', content: 'Working. ' },
      {
        type: 'tool',
        toolName: 'Read',
        toolCallId: 'tool-1',
        toolInput: { path: 'README.md', apiKey: secret },
      },
      {
        type: 'tool_result',
        toolName: 'Read',
        toolCallId: 'tool-1',
        toolOutput: 'contents',
      },
      {
        type: 'task_started',
        taskId: 'task-1',
        taskType: 'research',
        description: 'Research the codebase',
        prompt: `Do not expose ${secret}`,
      },
      {
        type: 'task_progress',
        taskId: 'task-1',
        description: 'Researching',
        summary: 'Found the provider boundary',
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 50 },
      },
      {
        type: 'task_notification',
        taskId: 'task-1',
        status: 'completed',
        summary: 'Research complete',
        outputFile: '/tmp/result',
      },
      { type: 'assistant', content: 'Done.' },
      {
        type: 'result',
        tokens: { input: 12, output: 4 },
        cost: 0.25,
        stopReason: 'end_turn',
        numTurns: 2,
      },
    ];
    const { runtime, roots, propagated } = makeRuntime();
    const provider = instrumentProvider(makeProvider(chunks), async () => runtime);
    const options: SendQueryOptions = {
      model: 'test-model',
      env: { TEST_API_KEY: secret },
      traceContext: {
        name: 'generate-chat-response',
        input: `User asked with ${secret}`,
        sessionId: 'conversation-1',
        userId: 'user-1',
        tags: ['feature:chat'],
        metadata: { platform: 'web' },
      },
    };

    const output = await collect(
      provider.sendQuery(`Full prompt ${secret}`, '/workspace', undefined, options)
    );

    expect(output).toEqual(chunks);
    expect(propagated).toEqual([
      {
        traceName: 'generate-chat-response',
        sessionId: 'conversation-1',
        userId: 'user-1',
        tags: ['feature:chat'],
        metadata: { provider: 'test-provider', platform: 'web' },
      },
    ]);

    const root = roots[0];
    expect(root?.type).toBe('agent');
    expect(root?.attributes.input).toBe('User asked with [REDACTED]');
    expect(root?.ended).toBe(true);

    const generation = root?.children.find(child => child.type === 'generation');
    expect(generation?.name).toBe('generate-response');
    expect(generation?.attributes.input).toBe('Full prompt [REDACTED]');
    expect(generation?.attributes.model).toBe('test-model');
    expect(generation?.updates).toContainEqual(
      expect.objectContaining({
        usageDetails: { input: 12, output: 4, total: 16 },
        costDetails: { total: 0.25 },
      })
    );
    expect(generation?.ended).toBe(true);

    const tool = root?.children.find(child => child.type === 'tool');
    expect(tool?.name).toBe('read');
    expect(tool?.attributes.input).toEqual({ path: 'README.md', apiKey: '[REDACTED]' });
    expect(tool?.updates).toContainEqual({ output: 'contents' });
    expect(tool?.ended).toBe(true);

    const subagent = root?.children.find(child => child.name === 'run-research');
    expect(subagent?.type).toBe('agent');
    expect(subagent?.attributes.input).toBe('Do not expose [REDACTED]');
    expect(subagent?.updates).toContainEqual(
      expect.objectContaining({ output: 'Research complete' })
    );
    expect(subagent?.ended).toBe(true);
  });

  test('ends observations with errors while preserving provider exceptions', async () => {
    const provider: IAgentProvider = {
      getType: () => 'failing-provider',
      getCapabilities: capabilities,
      async *sendQuery(): AsyncGenerator<MessageChunk> {
        yield { type: 'assistant', content: 'partial' };
        throw new Error('provider exploded');
      },
    };
    const { runtime, roots } = makeRuntime();
    const traced = instrumentProvider(provider, async () => runtime);

    await expect(collect(traced.sendQuery('prompt', '/workspace'))).rejects.toThrow(
      'provider exploded'
    );

    const root = roots[0];
    const generation = root?.children.find(child => child.type === 'generation');
    expect(root?.updates).toContainEqual(
      expect.objectContaining({ level: 'ERROR', statusMessage: 'provider exploded' })
    );
    expect(generation?.updates).toContainEqual(
      expect.objectContaining({ level: 'ERROR', statusMessage: 'provider exploded' })
    );
    expect(root?.ended).toBe(true);
    expect(generation?.ended).toBe(true);
  });

  test('redacts sensitive fields, bearer tokens, embedded credentials, and oversized text', () => {
    const redacted = redactTraceValue({
      password: 'hunter2',
      message:
        'Authorization: Bearer abcdefghijklmnop https://alice:secret@example.com ' +
        'x'.repeat(25_000),
    });

    expect(redacted).toEqual({
      password: '[REDACTED]',
      message: expect.not.stringContaining('abcdefghijklmnop'),
    });
    expect((redacted as { message: string }).message).not.toContain('alice:secret');
    expect((redacted as { message: string }).message.endsWith('[TRUNCATED]')).toBe(true);
  });
});
