import { describe, expect, test } from 'bun:test';

import { GrokEventParser } from './event-parser';

describe('GrokEventParser', () => {
  test('maps text, thought, tools, and authoritative end metadata', () => {
    const parser = new GrokEventParser();

    expect(parser.consumeLine('{"type":"text","data":"hello"}')).toEqual([
      { type: 'assistant', content: 'hello' },
    ]);
    expect(parser.consumeLine('{"type":"thought","data":"hmm"}')).toEqual([
      { type: 'thinking', content: 'hmm' },
    ]);
    expect(
      parser.consumeLine(
        '{"type":"tool_call","toolCallId":"call-1","toolName":"read_file","rawInput":{"path":"a.ts"}}'
      )
    ).toEqual([
      {
        type: 'tool',
        toolName: 'read_file',
        toolCallId: 'call-1',
        toolInput: { path: 'a.ts' },
      },
    ]);
    expect(
      parser.consumeLine(
        '{"type":"tool_call_update","toolCallId":"call-1","status":"completed","rawOutput":{"lines":3}}'
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'read_file',
        toolCallId: 'call-1',
        toolOutput: '{"lines":3}',
        toolOutcome: 'success',
      },
    ]);
    expect(
      parser.consumeLine(
        '{"type":"end","stopReason":"end_turn","sessionId":"session-1","requestId":"request-1","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15},"total_cost_usd":0.25,"num_turns":2,"modelUsage":{"grok-build":{"modelCalls":2}},"structuredOutput":{"ok":true}}'
      )
    ).toEqual([]);

    expect(parser.buildResult(true)).toEqual({
      type: 'result',
      sessionId: 'session-1',
      tokens: { input: 10, output: 5, total: 15, cost: 0.25 },
      cost: 0.25,
      stopReason: 'end_turn',
      numTurns: 2,
      modelUsage: { 'grok-build': { modelCalls: 2 } },
      structuredOutput: { ok: true },
      resumed: true,
    });
  });

  test('ignores forward-compatible events and closes outstanding tools', () => {
    const parser = new GrokEventParser();
    expect(parser.consumeLine('{"type":"future_event","value":1}')).toEqual([]);
    parser.consumeLine(
      '{"type":"tool_call","toolCallId":"call-1","toolName":"bash","rawInput":{}}'
    );
    expect(parser.closeOutstandingTools()).toEqual([
      {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'call-1',
        toolOutput: 'Grok ended before reporting a tool result.',
        toolOutcome: 'unknown',
      },
    ]);
  });

  test('rejects malformed protocol and missing terminal output', () => {
    const parser = new GrokEventParser();
    expect(() => parser.consumeLine('not json')).toThrow('invalid JSON');
    expect(parser.buildResult(undefined)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_incomplete_output',
    });
  });

  test('turns an upstream error event into an error result', () => {
    const parser = new GrokEventParser();
    expect(parser.consumeLine('{"type":"error","message":"bad auth"}')).toEqual([
      { type: 'system', content: 'bad auth' },
    ]);
    expect(parser.buildResult(false)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'grok_error',
      errors: ['bad auth'],
      resumed: false,
    });
  });
});
