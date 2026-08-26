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
    expect(chunks).toEqual([
      { type: 'thinking', content: 'Think' },
      { type: 'assistant', content: 'Hello' },
      { type: 'tool', toolName: 'read', toolInput: { path: 'README.md' }, toolCallId: 'tool-1' },
      {
        type: 'tool_result',
        toolName: 'read',
        toolOutput: '{"content":[{"type":"text","text":"contents"}]}',
        toolCallId: 'tool-1',
      },
      { type: 'assistant', content: 'Done' },
    ]);
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
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hel' },
      })
    );
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_end' } })
      )
    ).toEqual([{ type: 'assistant', content: 'hel' }]);
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hello' }],
            model: 'gpt-5.6-sol',
            usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
            stopReason: 'stop',
          },
        })
      )
    ).toEqual([{ type: 'assistant', content: 'lo' }]);
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
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
          model: 'gpt-5.6-sol',
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
          model: 'gpt-5.6-sol',
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
    const recognizableTail = 'TAIL_MUST_NOT_APPEAR';
    const malformed = `${'x'.repeat(1_001)}${recognizableTail}`;
    let thrown: unknown;
    try {
      parser.consumeLine(malformed);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('invalid JSON');
    expect((thrown as Error).message).not.toContain(recognizableTail);
  });

  test('rejects records without a non-empty string event type', () => {
    for (const event of [{}, { type: '' }, { type: 42 }]) {
      const parser = new OmpEventParser(false);
      expect(() => parser.consumeLine(JSON.stringify(event))).toThrow(
        'non-empty string event type'
      );
    }
  });

  test('ignores unknown future string event types', () => {
    const parser = new OmpEventParser(false);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'future_event', payload: { version: 2 } }))
    ).toEqual([]);
  });

  test('fails incomplete success streams instead of inventing a result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-incomplete' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('fails an unfinished later assistant turn without emitting its tail', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-partial' }));
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('first') }));
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
      })
    );
    expect(parser.consumeLine(JSON.stringify({ type: 'agent_end' }))).toEqual([]);
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('rejects overlapping assistant messages and conflicting session headers', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-one' }));
    expect(() =>
      parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-two' }))
    ).toThrow('conflicting');
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    expect(() =>
      parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }))
    ).toThrow('unfinished');
  });

  test('rejects unpaired tools and tool errors without a result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-tools' }));
    expect(() =>
      parser.consumeLine(
        JSON.stringify({ type: 'tool_execution_start', toolName: 'read', args: {} })
      )
    ).toThrow('toolCallId');
    expect(() =>
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'missing',
          toolName: 'read',
          result: {},
        })
      )
    ).toThrow('unmatched');
    parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'one',
        toolName: 'read',
        args: {},
      })
    );
    expect(() =>
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'one',
          toolName: 'write',
          result: {},
        })
      )
    ).toThrow('mismatched');
    expect(() =>
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'one',
          toolName: 'read',
          isError: true,
        })
      )
    ).toThrow('result');
  });

  test('does not duplicate mismatched final text or use it as structured output', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-mismatch' }));
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"answer":"streamed"}' },
      })
    );
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_end' } })
      )
    ).toEqual([{ type: 'assistant', content: '{"answer":"streamed"}' }]);
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_end', message: completeMessage('{"answer":"final"}') })
      )
    ).toEqual([]);
    parser.consumeLine(JSON.stringify({ type: 'agent_end' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_stream_mismatch',
    });
    expect(parser.buildResult(undefined)).not.toHaveProperty('structuredOutput');
  });

  test('rejects invalid assistant terminals and outstanding tools at agent_end', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-terminal' }));
    expect(() =>
      parser.consumeLine(
        JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [] } })
      )
    ).toThrow('usage');
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('done') }));
    parser.consumeLine(JSON.stringify({ type: 'agent_end' }));

    const withTool = new OmpEventParser(false);
    withTool.consumeLine(JSON.stringify({ type: 'session', id: 'session-open-tool' }));
    withTool.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'one',
        toolName: 'read',
        args: {},
      })
    );
    expect(() => withTool.consumeLine(JSON.stringify({ type: 'agent_end' }))).toThrow(
      'outstanding tool'
    );
  });

  test('treats agent_end as turn end and ignores trailing maintenance events', () => {
    const parser = new OmpEventParser(false);
    for (const line of OMP_SUCCESS_LINES) parser.consumeLine(line);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'notice', message: 'Todo completion reminder' }))
    ).toEqual([]);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'custom_message', customType: 'advisor' }))
    ).toEqual([]);
    expect(parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }))).toEqual([]);
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({
      sessionId: 'omp-session-1',
      stopReason: 'stop',
    });
    expect(result).not.toHaveProperty('isError');
  });

  test('parses a follow-up assistant turn after agent_end', () => {
    const parser = new OmpEventParser(false);
    for (const line of OMP_SUCCESS_LINES) parser.consumeLine(line);
    const chunks = [
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Again' },
      }),
      JSON.stringify({ type: 'message_end', message: completeMessage('Again') }),
      JSON.stringify({ type: 'agent_end' }),
    ].flatMap(line => parser.consumeLine(line));
    expect(chunks).toEqual([{ type: 'assistant', content: 'Again' }]);
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({
      sessionId: 'omp-session-1',
      stopReason: 'stop',
    });
    expect(result).not.toHaveProperty('isError');
  });
});

function completeMessage(text: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'gpt-5.6-sol',
    usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
    stopReason: 'stop',
  };
}
