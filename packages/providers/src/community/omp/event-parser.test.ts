import { describe, expect, test } from 'bun:test';

import { OmpEventParser } from './event-parser';

const OMP_SUCCESS_LINES = [
  JSON.stringify({
    type: 'session',
    version: 3,
    id: 'omp-session-1',
    timestamp: '2026-08-06T00:00:00.000Z',
    cwd: '/repo',
  }),
  JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Think' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Hel' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'lo' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Think' },
        { type: 'text', text: 'Hello' },
      ],
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 0,
        totalTokens: 17,
        cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 },
      },
      stopReason: 'toolUse',
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
    result: { content: [{ type: 'text', text: 'contents' }] },
    isError: false,
  }),
  JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      usage: {
        input: 8,
        output: 2,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 11,
        cost: { input: 0.02, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.05 },
      },
      stopReason: 'stop',
    },
  }),
  JSON.stringify({ type: 'agent_end', messages: [] }),
];

describe('OmpEventParser', () => {
  test('maps session, thinking, coalesced text, tools, usage, and model', () => {
    const parser = new OmpEventParser(true);
    const chunks = OMP_SUCCESS_LINES.flatMap(line => parser.consumeLine(line));
    const result = parser.buildResult(true);
    expect(chunks).toContainEqual({ type: 'thinking', content: 'Think' });
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Hello' });
    expect(chunks).toContainEqual({ type: 'assistant', content: 'Done' });
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'read',
      toolInput: { path: 'README.md' },
      toolCallId: 'tool-1',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'read',
      toolOutput: '{"content":[{"type":"text","text":"contents"}]}',
      toolCallId: 'tool-1',
    });
    expect(result).toMatchObject({
      type: 'result',
      sessionId: 'omp-session-1',
      tokens: { input: 18, output: 7, total: 28, cost: 0.25 },
      cost: 0.25,
      stopReason: 'stop',
      numTurns: 2,
      resolvedModel: { id: 'openai-codex/gpt-5.6-sol' },
      resumed: true,
    });
  });

  test('repairs only a strict missing suffix from message_end', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-tail' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hel' },
      })
    );
    const chunks = parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(chunks).toEqual([{ type: 'assistant', content: 'hello' }]);
  });

  test('marks model errors on the terminal result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-error' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          usage: { input: 2, output: 0, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'error',
          errorMessage: 'rate limited',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(parser.buildResult(undefined)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'error',
      errors: ['rate limited'],
    });
  });

  test('parses best-effort structured output from assistant text', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-json' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"answer":"ok"}' },
      })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '{"answer":"ok"}' }],
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(parser.buildResult(undefined)).toMatchObject({ structuredOutput: { answer: 'ok' } });
  });

  test('rejects malformed NDJSON with a bounded preview', () => {
    const parser = new OmpEventParser(false);
    expect(() => parser.consumeLine('{bad json')).toThrow('invalid JSON');
  });

  test('fails incomplete success streams instead of inventing a result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-incomplete' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });
});
