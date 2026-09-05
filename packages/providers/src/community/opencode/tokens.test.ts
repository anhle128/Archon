import { describe, expect, test } from 'bun:test';

import { normalizeUsageBreakdown } from '../../usage-breakdown';

import {
  assistantInfoToUsageEntry,
  mergeUsageBreakdowns,
  normalizeTokens,
  packageAssistantUsage,
  sumTokenUsages,
  usageBreakdownFromAssistantInfos,
} from './tokens';

describe('normalizeTokens', () => {
  test('does not double-count reasoning as extra output', () => {
    expect(
      normalizeTokens({
        cost: 0.5,
        tokens: { input: 11, output: 7, reasoning: 3, cache: { read: 1, write: 2 } },
      })
    ).toEqual({ input: 11, output: 7, total: 18, cost: 0.5 });
  });
});

describe('assistantInfoToUsageEntry', () => {
  test('maps provider/model/cost/cache/reasoning fields and omits fabricated requests', () => {
    const entry = assistantInfoToUsageEntry({
      providerID: 'anthropic',
      modelID: 'claude-sonnet',
      cost: 0.42,
      tokens: { input: 11, output: 7, reasoning: 3, cache: { read: 1, write: 2 } },
    });

    expect(entry).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet',
      modelSource: 'reported',
      inputTokens: 11,
      outputTokens: 7,
      reasoningTokens: 3,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      costUsd: 0.42,
    });
    // Upstream OpenCode assistant info has no request-count field — absence must stay absent.
    expect(entry).not.toHaveProperty('requests');
    expect(entry?.requests).toBeUndefined();
  });

  test('marks multi-agent child observations as subagent without inventing requests', () => {
    const entry = assistantInfoToUsageEntry(
      {
        providerID: 'openai',
        modelID: 'gpt-5',
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      { kind: 'subagent' }
    );
    expect(entry?.kind).toBe('subagent');
    expect(entry).not.toHaveProperty('requests');
  });

  test('normalized boundary keeps missing requests observable (ledger null path)', () => {
    const entry = assistantInfoToUsageEntry({
      providerID: 'anthropic',
      modelID: 'claude-sonnet',
      cost: 0.42,
      tokens: { input: 11, output: 7, reasoning: 3, cache: { read: 1, write: 2 } },
    });
    expect(entry).toBeDefined();

    const { breakdown, rejected } = normalizeUsageBreakdown([entry!]);
    expect(rejected).toEqual([]);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).not.toHaveProperty('requests');
    expect(breakdown[0]?.requests).toBeUndefined();
    // Mirrors usage-recorder / report path: missing measure → SQL NULL → missingRequests++.
    expect(breakdown[0]?.requests ?? null).toBeNull();
  });
});

describe('usageBreakdownFromAssistantInfos', () => {
  test('emits one observation per distinct assistant message in order', () => {
    const breakdown = usageBreakdownFromAssistantInfos([
      {
        id: 'a',
        providerID: 'anthropic',
        modelID: 'one',
        cost: 0.1,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      {
        id: 'b',
        providerID: 'anthropic',
        modelID: 'two',
        cost: 0.2,
        tokens: { input: 3, output: 4, reasoning: 1, cache: { read: 5, write: 6 } },
      },
    ]);
    expect(breakdown).toHaveLength(2);
    expect(breakdown?.[0]?.model).toBe('one');
    expect(breakdown?.[1]?.model).toBe('two');
    expect(breakdown?.[0]).not.toHaveProperty('requests');
    expect(breakdown?.[1]).not.toHaveProperty('requests');
  });
});

describe('sumTokenUsages', () => {
  test('sums distinct message tokens', () => {
    expect(
      sumTokenUsages([
        { input: 1, output: 2, total: 3, cost: 0.1 },
        { input: 4, output: 5, total: 9, cost: 0.2 },
      ])
    ).toEqual({ input: 5, output: 7, total: 12, cost: 0.1 + 0.2 });
  });
});

describe('mergeUsageBreakdowns', () => {
  test('appends attempt observations in source order and skips empty parts', () => {
    const first = usageBreakdownFromAssistantInfos([
      {
        providerID: 'anthropic',
        modelID: 'one',
        cost: 0.1,
        tokens: { input: 1, output: 1 },
      },
    ]);
    const second = usageBreakdownFromAssistantInfos([
      {
        providerID: 'anthropic',
        modelID: 'two',
        cost: 0.2,
        tokens: { input: 2, output: 2 },
      },
    ]);
    expect(mergeUsageBreakdowns(undefined, first, undefined, second, [])).toEqual([
      expect.objectContaining({ model: 'one', costUsd: 0.1 }),
      expect.objectContaining({ model: 'two', costUsd: 0.2 }),
    ]);
  });
});

describe('packageAssistantUsage', () => {
  test('returns empty object when no authoritative usage was observed', () => {
    expect(packageAssistantUsage([])).toEqual({});
    expect(packageAssistantUsage([{ role: 'assistant', modelID: 'x' }])).toEqual({});
  });

  test('packages tokens and subagent kind for multi-agent failure carry', () => {
    const packaged = packageAssistantUsage(
      [
        {
          providerID: 'anthropic',
          modelID: 'haiku',
          cost: 0.2,
          tokens: { input: 8, output: 4, reasoning: 0, cache: { read: 1, write: 0 } },
        },
      ],
      { kind: 'subagent' }
    );
    expect(packaged.usageBreakdown).toEqual([
      expect.objectContaining({
        kind: 'subagent',
        model: 'haiku',
        costUsd: 0.2,
        cacheReadTokens: 1,
      }),
    ]);
    expect(packaged.tokens).toEqual({ input: 8, output: 4, total: 12, cost: 0.2 });
    expect(packaged.cost).toBe(0.2);
  });
});
