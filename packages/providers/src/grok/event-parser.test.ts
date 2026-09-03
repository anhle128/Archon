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

describe('usageBreakdown normalization (US-002)', () => {
  test('single model receives aggregate tokens/USD/requests', () => {
    const parser = new GrokEventParser('grok-requested');
    parser.consumeLine(
      JSON.stringify({
        type: 'end',
        stopReason: 'end_turn',
        sessionId: 's1',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        total_cost_usd: 0.25,
        modelUsage: { 'grok-build': { modelCalls: 2 } },
      })
    );
    expect(parser.buildResult(undefined).usageBreakdown).toEqual([
      {
        provider: 'xai',
        model: 'grok-build',
        modelSource: 'reported',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.25,
        requests: 2,
      },
    ]);
  });

  test('multiple models emit requests-only rows plus one unknown aggregate row', () => {
    const parser = new GrokEventParser('grok-requested');
    parser.consumeLine(
      JSON.stringify({
        type: 'end',
        stopReason: 'end_turn',
        sessionId: 's2',
        usage: { input_tokens: 30, output_tokens: 9, total_tokens: 39 },
        total_cost_usd: 1.5,
        modelUsage: {
          'grok-a': { modelCalls: 1 },
          'grok-b': { modelCalls: 3 },
        },
      })
    );
    const result = parser.buildResult(undefined);
    expect(result.modelUsage).toEqual({
      'grok-a': { modelCalls: 1 },
      'grok-b': { modelCalls: 3 },
    });
    expect(result.usageBreakdown).toEqual([
      {
        provider: 'xai',
        model: 'grok-a',
        modelSource: 'reported',
        requests: 1,
      },
      {
        provider: 'xai',
        model: 'grok-b',
        modelSource: 'reported',
        requests: 3,
      },
      {
        provider: 'xai',
        model: null,
        modelSource: 'unknown',
        inputTokens: 30,
        outputTokens: 9,
        costUsd: 1.5,
      },
    ]);
  });

  test('no model attaches aggregate to requested model; unknown when none requested', () => {
    const withRequested = new GrokEventParser('grok-4');
    withRequested.consumeLine(
      JSON.stringify({
        type: 'end',
        sessionId: 's3',
        usage: { input_tokens: 7, output_tokens: 1, total_tokens: 8 },
        total_cost_usd: 0,
        modelUsage: {},
      })
    );
    expect(withRequested.buildResult(undefined).usageBreakdown).toEqual([
      {
        provider: 'xai',
        model: 'grok-4',
        modelSource: 'requested',
        inputTokens: 7,
        outputTokens: 1,
        costUsd: 0,
      },
    ]);

    const unknown = new GrokEventParser();
    unknown.consumeLine(
      JSON.stringify({
        type: 'end',
        sessionId: 's4',
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        total_cost_usd: 0.1,
      })
    );
    expect(unknown.buildResult(undefined).usageBreakdown).toEqual([
      {
        provider: 'xai',
        model: null,
        modelSource: 'unknown',
        inputTokens: 2,
        outputTokens: 1,
        costUsd: 0.1,
      },
    ]);
  });

  test('malformed modelCalls still preserves aggregate without fabricating requests', () => {
    const parser = new GrokEventParser();
    parser.consumeLine(
      JSON.stringify({
        type: 'end',
        sessionId: 's5',
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        total_cost_usd: 0.2,
        modelUsage: { 'grok-build': { modelCalls: 'nope' } },
      })
    );
    expect(parser.buildResult(undefined).usageBreakdown).toEqual([
      {
        provider: 'xai',
        model: 'grok-build',
        modelSource: 'reported',
        inputTokens: 4,
        outputTokens: 2,
        costUsd: 0.2,
      },
    ]);
  });
});
