import { describe, expect, test } from 'bun:test';

import { devinPromptUsageToBreakdown } from './usage';

describe('devinPromptUsageToBreakdown', () => {
  test('maps per-turn prompt usage without cost', () => {
    expect(
      devinPromptUsageToBreakdown(
        {
          totalTokens: 60136,
          inputTokens: 60068,
          outputTokens: 68,
          cachedReadTokens: 59951,
          cachedWriteTokens: 114,
        },
        'claude-opus-5-low'
      )
    ).toEqual([
      {
        provider: 'devin',
        model: 'claude-opus-5-low',
        modelSource: 'reported',
        inputTokens: 60068,
        outputTokens: 68,
        cacheReadTokens: 59951,
        cacheWriteTokens: 114,
      },
    ]);
  });

  test('omits absent cache and reasoning fields and marks unknown model', () => {
    expect(
      devinPromptUsageToBreakdown({ totalTokens: 10, inputTokens: 8, outputTokens: 2 }, undefined)
    ).toEqual([
      { provider: 'devin', model: null, modelSource: 'unknown', inputTokens: 8, outputTokens: 2 },
    ]);
    expect(
      devinPromptUsageToBreakdown(
        {
          totalTokens: 12,
          inputTokens: 8,
          outputTokens: 2,
          thoughtTokens: 2,
          cachedReadTokens: null,
        },
        'm'
      )?.[0]
    ).toMatchObject({ reasoningTokens: 2 });
  });

  test('returns undefined when the response carried no usage', () => {
    expect(devinPromptUsageToBreakdown(undefined, 'm')).toBeUndefined();
    expect(devinPromptUsageToBreakdown(null, 'm')).toBeUndefined();
  });
});
