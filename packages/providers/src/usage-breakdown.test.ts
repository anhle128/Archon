import { describe, expect, test } from 'bun:test';
import type { ModelUsageEntry } from './types';
import {
  normalizeModelUsageEntry,
  normalizeUsageBreakdown,
  toUsageBreakdown,
} from './usage-breakdown';

function validEntry(overrides: Partial<ModelUsageEntry> = {}): ModelUsageEntry {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    modelSource: 'reported',
    inputTokens: 10,
    outputTokens: 4,
    ...overrides,
  };
}

describe('normalizeModelUsageEntry', () => {
  test('accepts a complete valid entry and preserves zero cost', () => {
    const result = normalizeModelUsageEntry(
      validEntry({
        costUsd: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 2,
        reasoningTokens: 1,
        requests: 1,
      })
    );
    expect(result).toEqual({
      ok: true,
      entry: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
        inputTokens: 10,
        outputTokens: 4,
        reasoningTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 2,
        requests: 1,
        costUsd: 0,
      },
    });
  });

  test('preserves slash-containing model ids intact', () => {
    const result = normalizeModelUsageEntry(
      validEntry({
        provider: 'openrouter',
        model: 'openai/gpt-4.1',
        modelSource: 'requested',
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.model).toBe('openai/gpt-4.1');
      expect(result.entry.modelSource).toBe('requested');
    }
  });

  test('accepts unknown models with null model identity', () => {
    const result = normalizeModelUsageEntry({
      provider: 'openai',
      model: null,
      modelSource: 'unknown',
      inputTokens: 3,
      outputTokens: 1,
    });
    expect(result).toEqual({
      ok: true,
      entry: {
        provider: 'openai',
        model: null,
        modelSource: 'unknown',
        inputTokens: 3,
        outputTokens: 1,
      },
    });
  });

  test('keeps absent optional fields undefined rather than zero', () => {
    const result = normalizeModelUsageEntry({
      provider: 'xai',
      model: 'grok-4',
      modelSource: 'reported',
      requests: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry).toEqual({
        provider: 'xai',
        model: 'grok-4',
        modelSource: 'reported',
        requests: 2,
      });
      expect(Object.hasOwn(result.entry, 'inputTokens')).toBe(false);
      expect(Object.hasOwn(result.entry, 'costUsd')).toBe(false);
    }
  });

  test('trims provider and model identity', () => {
    const result = normalizeModelUsageEntry(
      validEntry({ provider: '  anthropic  ', model: '  claude-haiku-4-5  ' })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.provider).toBe('anthropic');
      expect(result.entry.model).toBe('claude-haiku-4-5');
    }
  });

  test('rejects empty provider and empty model', () => {
    expect(normalizeModelUsageEntry(validEntry({ provider: '   ' })).issue).toBe('provider_empty');
    expect(normalizeModelUsageEntry(validEntry({ model: '' })).issue).toBe('model_empty');
  });

  test('rejects model/source mismatches', () => {
    expect(
      normalizeModelUsageEntry({
        provider: 'openai',
        model: 'gpt-5',
        modelSource: 'unknown',
        inputTokens: 1,
      }).issue
    ).toBe('model_source_unknown_requires_null_model');

    expect(
      normalizeModelUsageEntry({
        provider: 'openai',
        model: null,
        modelSource: 'reported',
        inputTokens: 1,
      }).issue
    ).toBe('model_invalid');

    expect(
      normalizeModelUsageEntry({
        provider: 'openai',
        model: 'gpt-5',
        modelSource: 'guessed',
        inputTokens: 1,
      }).issue
    ).toBe('model_source_invalid');
  });

  test('rejects unsafe integers, NaN, infinity, and negatives on token fields', () => {
    expect(
      normalizeModelUsageEntry(validEntry({ inputTokens: Number.MAX_SAFE_INTEGER + 1 })).issue
    ).toBe('inputTokens_invalid');
    expect(normalizeModelUsageEntry(validEntry({ outputTokens: 1.5 })).issue).toBe(
      'outputTokens_invalid'
    );
    expect(normalizeModelUsageEntry(validEntry({ cacheReadTokens: -1 })).issue).toBe(
      'cacheReadTokens_invalid'
    );
    expect(normalizeModelUsageEntry(validEntry({ cacheWriteTokens: Number.NaN })).issue).toBe(
      'cacheWriteTokens_invalid'
    );
    expect(
      normalizeModelUsageEntry(validEntry({ reasoningTokens: Number.POSITIVE_INFINITY })).issue
    ).toBe('reasoningTokens_invalid');
  });

  test('rejects zero, negative, non-integer, and unsafe requests', () => {
    expect(normalizeModelUsageEntry(validEntry({ requests: 0 })).issue).toBe('requests_invalid');
    expect(normalizeModelUsageEntry(validEntry({ requests: -2 })).issue).toBe('requests_invalid');
    expect(normalizeModelUsageEntry(validEntry({ requests: 1.2 })).issue).toBe('requests_invalid');
    expect(
      normalizeModelUsageEntry(validEntry({ requests: Number.MAX_SAFE_INTEGER + 1 })).issue
    ).toBe('requests_invalid');
  });

  test('rejects non-finite and negative costUsd while keeping zero', () => {
    expect(normalizeModelUsageEntry(validEntry({ costUsd: -0.01 })).issue).toBe('cost_usd_invalid');
    expect(normalizeModelUsageEntry(validEntry({ costUsd: Number.NaN })).issue).toBe(
      'cost_usd_invalid'
    );
    expect(normalizeModelUsageEntry(validEntry({ costUsd: Number.POSITIVE_INFINITY })).issue).toBe(
      'cost_usd_invalid'
    );
    expect(normalizeModelUsageEntry(validEntry({ costUsd: 0 })).ok).toBe(true);
  });

  test('rejects reasoning tokens that exceed output tokens', () => {
    expect(
      normalizeModelUsageEntry(validEntry({ outputTokens: 4, reasoningTokens: 5 })).issue
    ).toBe('reasoning_exceeds_output');
  });

  test('allows reasoning tokens when output is absent', () => {
    const result = normalizeModelUsageEntry({
      provider: 'openai',
      model: 'gpt-5',
      modelSource: 'requested',
      reasoningTokens: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.reasoningTokens).toBe(3);
      expect(Object.hasOwn(result.entry, 'outputTokens')).toBe(false);
    }
  });

  test('rejects entries with no numeric measure', () => {
    expect(
      normalizeModelUsageEntry({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
      }).issue
    ).toBe('missing_numeric_measure');
  });

  test('rejects forbidden estimate and context fields without logging payloads', () => {
    const forbidden = [
      'estimatedCostUsd',
      'estimate',
      'runId',
      'nodeId',
      'prompt',
      'transcript',
      'sessionId',
    ];
    for (const field of forbidden) {
      const result = normalizeModelUsageEntry({
        ...validEntry(),
        [field]: 'should-not-appear-in-issue',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue).toBe(`forbidden_field:${field}`);
        expect(result.issue).not.toContain('should-not-appear-in-issue');
      }
    }
  });

  test('rejects non-object entries', () => {
    expect(normalizeModelUsageEntry(null).issue).toBe('entry_not_object');
    expect(normalizeModelUsageEntry('anthropic').issue).toBe('entry_not_object');
    expect(normalizeModelUsageEntry([{ inputTokens: 1 }]).issue).toBe('entry_not_object');
  });

  test('accepts advisor and subagent kinds', () => {
    expect(normalizeModelUsageEntry(validEntry({ kind: 'advisor' })).ok).toBe(true);
    expect(normalizeModelUsageEntry(validEntry({ kind: 'subagent' })).ok).toBe(true);
    expect(normalizeModelUsageEntry(validEntry({ kind: 'primary' as never })).issue).toBe(
      'kind_invalid'
    );
  });
});

describe('normalizeUsageBreakdown', () => {
  test('retains valid entries in order and rejects invalid ones by index/issue', () => {
    const validA = validEntry({ model: 'claude-sonnet-4-6', inputTokens: 11 });
    const validB = validEntry({
      provider: 'openai',
      model: 'openai/gpt-4.1',
      modelSource: 'requested',
      outputTokens: 7,
      inputTokens: undefined,
    });
    const { breakdown, rejected } = normalizeUsageBreakdown([
      validA,
      { provider: 'xai', model: null, modelSource: 'reported', inputTokens: 1 },
      validB,
      { provider: 'openai', model: 'gpt-5', modelSource: 'requested' },
    ]);

    expect(breakdown).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
        inputTokens: 11,
        outputTokens: 4,
      },
      {
        provider: 'openai',
        model: 'openai/gpt-4.1',
        modelSource: 'requested',
        outputTokens: 7,
      },
    ]);
    expect(rejected).toEqual([
      { index: 1, issue: 'model_invalid' },
      { index: 3, issue: 'missing_numeric_measure' },
    ]);
    for (const item of rejected) {
      expect(JSON.stringify(item)).not.toMatch(/prompt|transcript|api[_-]?key/i);
    }
  });

  test('toUsageBreakdown returns only the validated array', () => {
    expect(
      toUsageBreakdown([
        validEntry({ costUsd: 0 }),
        { provider: '', model: 'x', modelSource: 'reported', requests: 1 },
      ])
    ).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSource: 'reported',
        inputTokens: 10,
        outputTokens: 4,
        costUsd: 0,
      },
    ]);
  });
});

describe('deprecated modelUsage compatibility', () => {
  test('result chunks still accept modelUsage alongside usageBreakdown', () => {
    const chunk = {
      type: 'result' as const,
      modelUsage: { 'claude-sonnet-4-6': { inputTokens: 1 } },
      usageBreakdown: toUsageBreakdown([validEntry({ inputTokens: 1, outputTokens: 0 })]),
    };
    expect(chunk.modelUsage).toEqual({ 'claude-sonnet-4-6': { inputTokens: 1 } });
    expect(chunk.usageBreakdown).toHaveLength(1);
  });
});
