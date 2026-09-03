import { describe, expect, test } from 'bun:test';
import type { ModelUsageEntry } from '@archon/providers/types';
import type { PiModelInfo } from '@archon/providers';
import type { PricingConfig } from '../config/config-types';
import {
  buildCatalogPricingIndex,
  buildConfigPricingIndex,
  estimateTokensUsd,
  loadPricingLookups,
  materializeUsageCost,
  selectRatesForAggregate,
  type PricingLookups,
  type PricingRates,
} from './estimate';

function entry(overrides: Partial<ModelUsageEntry> = {}): ModelUsageEntry {
  return {
    provider: 'openai',
    model: 'gpt-5.4',
    modelSource: 'reported',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    ...overrides,
  };
}

function lookups(partial: {
  config?: Array<{ provider: string; model: string; rates: PricingRates }>;
  catalog?: Array<{ provider: string; model: string; rates: PricingRates }>;
}): PricingLookups {
  const configByProviderModel = new Map<string, Map<string, PricingRates>>();
  const catalogByProviderModel = new Map<string, Map<string, PricingRates>>();
  for (const row of partial.config ?? []) {
    let byModel = configByProviderModel.get(row.provider);
    if (!byModel) {
      byModel = new Map();
      configByProviderModel.set(row.provider, byModel);
    }
    byModel.set(row.model, row.rates);
  }
  for (const row of partial.catalog ?? []) {
    let byModel = catalogByProviderModel.get(row.provider);
    if (!byModel) {
      byModel = new Map();
      catalogByProviderModel.set(row.provider, byModel);
    }
    byModel.set(row.model, row.rates);
  }
  return { configByProviderModel, catalogByProviderModel };
}

describe('buildConfigPricingIndex', () => {
  test('indexes exact provider/model pairs including slash-containing model ids', () => {
    const pricing: PricingConfig = {
      models: [
        { provider: 'openai', model: 'gpt-5.4', input: 2.5, output: 15 },
        { provider: 'openrouter', model: 'org/model-v1', input: 1, output: 2 },
      ],
    };
    const index = buildConfigPricingIndex(pricing);
    expect(index.get('openai')?.get('gpt-5.4')).toEqual({ input: 2.5, output: 15 });
    expect(index.get('openrouter')?.get('org/model-v1')).toEqual({ input: 1, output: 2 });
  });

  test('rejects duplicate provider/model pairs without using either entry', () => {
    const pricing: PricingConfig = {
      models: [
        { provider: 'openai', model: 'gpt-5.4', input: 1, output: 2 },
        { provider: 'openai', model: 'gpt-5.4', input: 9, output: 9 },
        { provider: 'anthropic', model: 'claude-sonnet', input: 3, output: 15 },
      ],
    };
    const index = buildConfigPricingIndex(pricing);
    expect(index.get('openai')?.get('gpt-5.4')).toBeUndefined();
    expect(index.get('anthropic')?.get('claude-sonnet')).toEqual({ input: 3, output: 15 });
  });

  test('skips invalid rate objects and keeps valid siblings', () => {
    const pricing = {
      models: [
        { provider: 'openai', model: 'ok', input: 1, output: 2 },
        { provider: 'openai', model: 'bad-neg', input: -1, output: 2 },
        { provider: 'openai', model: 'bad-empty' },
        { provider: '  ', model: 'x', input: 1 },
        { provider: 'openai', model: '  ', input: 1 },
        'not-an-object',
        { provider: 'openai', model: 'nan', input: Number.NaN, output: 1 },
        { provider: 'openai', model: 'inf', output: Number.POSITIVE_INFINITY },
      ],
    } as PricingConfig;
    const index = buildConfigPricingIndex(pricing);
    expect([...index.get('openai')!.keys()]).toEqual(['ok']);
    expect(index.get('openai')?.get('ok')).toEqual({ input: 1, output: 2 });
  });

  test('returns empty index for missing or non-array models', () => {
    expect(buildConfigPricingIndex(undefined).size).toBe(0);
    expect(buildConfigPricingIndex({}).size).toBe(0);
    expect(buildConfigPricingIndex({ models: null as unknown as [] }).size).toBe(0);
  });
});

describe('buildCatalogPricingIndex', () => {
  test('indexes by exact provider and id, not concatenated ref', () => {
    const catalog: PiModelInfo[] = [
      {
        ref: 'openai/gpt-5.4',
        provider: 'openai',
        id: 'gpt-5.4',
        name: 'GPT',
        reasoning: false,
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
        contextWindow: 128000,
      },
      {
        ref: 'openrouter/org/model',
        provider: 'openrouter',
        id: 'org/model',
        name: 'Nested',
        reasoning: true,
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0.1,
          cacheWrite: 0,
          tiers: [{ inputTokensAbove: 1000, input: 5, output: 10, cacheRead: 1, cacheWrite: 0 }],
        },
        contextWindow: 200000,
      },
    ];
    const index = buildCatalogPricingIndex(catalog);
    expect(index.get('openai')?.get('gpt-5.4')?.input).toBe(2);
    expect(index.get('openrouter')?.get('org/model')?.tiers?.[0]?.inputTokensAbove).toBe(1000);
    // Never key by concatenated ref alone
    expect(index.get('openrouter/org')?.get('model')).toBeUndefined();
  });
});

describe('selectRatesForAggregate', () => {
  test('picks highest tier strictly below aggregate (Pi calculateCost rule)', () => {
    const base: PricingRates = {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 0,
      tiers: [
        { inputTokensAbove: 100, input: 3, output: 6, cacheRead: 0.3, cacheWrite: 0 },
        { inputTokensAbove: 1000, input: 5, output: 10, cacheRead: 0.5, cacheWrite: 0 },
      ],
    };
    expect(selectRatesForAggregate(base, 100).input).toBe(1); // not strictly above 100
    expect(selectRatesForAggregate(base, 101).input).toBe(3);
    expect(selectRatesForAggregate(base, 1000).input).toBe(3);
    expect(selectRatesForAggregate(base, 1001).input).toBe(5);
  });
});

describe('estimateTokensUsd', () => {
  test('requires both input and output token counts', () => {
    const rates: PricingRates = { input: 1, output: 2 };
    expect(estimateTokensUsd({ inputTokens: 10 }, rates)).toBeNull();
    expect(estimateTokensUsd({ outputTokens: 10 }, rates)).toBeNull();
    expect(estimateTokensUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, rates)).toBe(3);
  });

  test('applies cache rates only to reported cache dimensions', () => {
    const rates: PricingRates = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 4 };
    // No cache fields → no cache charge
    expect(estimateTokensUsd({ inputTokens: 1_000_000, outputTokens: 0 }, rates)).toBe(1);
    // With cache
    expect(
      estimateTokensUsd(
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 1_000_000,
        },
        rates
      )
    ).toBe(1 + 0.5 + 4);
  });

  test('leaves whole estimate null when positive category lacks a rate', () => {
    const rates: PricingRates = { input: 1, output: 2 }; // no cache rates
    expect(
      estimateTokensUsd({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 5 }, rates)
    ).toBeNull();
    // Zero cache with missing rate is fine
    expect(
      estimateTokensUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, rates)
    ).toBe(1);
  });

  test('never charges reasoning separately from output', () => {
    const rates: PricingRates = { input: 0, output: 10 };
    // reasoningTokens are ignored by the estimator signature; output already includes them
    const usd = estimateTokensUsd({ inputTokens: 0, outputTokens: 1_000_000 }, rates);
    expect(usd).toBe(10);
  });

  test('rejects non-finite multiplication results', () => {
    const rates: PricingRates = { input: Number.MAX_VALUE, output: Number.MAX_VALUE };
    expect(
      estimateTokensUsd(
        { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER },
        rates
      )
    ).toBeNull();
  });

  test('uses tier rates for aggregate input including cache tokens', () => {
    const rates: PricingRates = {
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheWrite: 1,
      tiers: [
        { inputTokensAbove: 1_500_000, input: 10, output: 10, cacheRead: 10, cacheWrite: 10 },
      ],
    };
    // aggregate = 1M + 1M cacheRead = 2M > 1.5M → tier
    expect(
      estimateTokensUsd(
        { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 },
        rates
      )
    ).toBe(10 + 10);
  });
});

describe('materializeUsageCost', () => {
  const fullLookups = lookups({
    config: [
      {
        provider: 'openai',
        model: 'gpt-5.4',
        rates: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      {
        provider: 'openrouter',
        model: 'org/model',
        rates: { input: 1, output: 2 },
      },
    ],
    catalog: [
      {
        provider: 'openai',
        model: 'gpt-5.4',
        rates: { input: 99, output: 99, cacheRead: 99, cacheWrite: 99 },
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });

  test('stores provider-reported costUsd including zero and suppresses estimation', () => {
    expect(materializeUsageCost(entry({ costUsd: 0.42 }), fullLookups)).toEqual({
      cost_usd: 0.42,
      cost_estimated_usd: null,
      pricing_source: null,
    });
    expect(materializeUsageCost(entry({ costUsd: 0 }), fullLookups)).toEqual({
      cost_usd: 0,
      cost_estimated_usd: null,
      pricing_source: null,
    });
  });

  test('exact config pair overrides exact catalog pair, including slash ids', () => {
    const result = materializeUsageCost(
      entry({
        provider: 'openai',
        model: 'gpt-5.4',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      fullLookups
    );
    expect(result).toEqual({
      cost_usd: null,
      cost_estimated_usd: 2.5 + 15,
      pricing_source: 'config',
    });

    const slash = materializeUsageCost(
      entry({
        provider: 'openrouter',
        model: 'org/model',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      fullLookups
    );
    expect(slash.pricing_source).toBe('config');
    expect(slash.cost_estimated_usd).toBe(3);
  });

  test('falls back to exact catalog provider/id pair', () => {
    const result = materializeUsageCost(
      entry({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
      fullLookups
    );
    expect(result).toEqual({
      cost_usd: null,
      cost_estimated_usd: 3,
      pricing_source: 'catalog',
    });
  });

  test('never matches unknown, bare model, prefix, substring, case-folded, or fuzzy identity', () => {
    expect(
      materializeUsageCost(
        entry({ model: null, modelSource: 'unknown', costUsd: undefined }),
        fullLookups
      )
    ).toEqual({
      cost_usd: null,
      cost_estimated_usd: null,
      pricing_source: null,
    });
    // bare model name alone — provider must also match
    expect(
      materializeUsageCost(entry({ provider: 'other', model: 'gpt-5.4' }), fullLookups)
        .cost_estimated_usd
    ).toBeNull();
    // prefix
    expect(
      materializeUsageCost(entry({ model: 'gpt-5' }), fullLookups).cost_estimated_usd
    ).toBeNull();
    // substring / case
    expect(
      materializeUsageCost(entry({ model: 'GPT-5.4' }), fullLookups).cost_estimated_usd
    ).toBeNull();
    expect(
      materializeUsageCost(entry({ provider: 'OpenAI', model: 'gpt-5.4' }), fullLookups)
        .cost_estimated_usd
    ).toBeNull();
  });

  test('request-only observations stay unpriced', () => {
    expect(
      materializeUsageCost(
        entry({
          inputTokens: undefined,
          outputTokens: undefined,
          requests: 1,
          costUsd: undefined,
        }),
        fullLookups
      )
    ).toEqual({
      cost_usd: null,
      cost_estimated_usd: null,
      pricing_source: null,
    });
  });

  test('missing input or output tokens is not estimated', () => {
    expect(
      materializeUsageCost(entry({ inputTokens: 10, outputTokens: undefined }), fullLookups)
        .cost_estimated_usd
    ).toBeNull();
  });

  test('positive cache without cache rate yields null estimate (no partial)', () => {
    const onlyIo = lookups({
      config: [{ provider: 'openai', model: 'gpt-5.4', rates: { input: 1, output: 2 } }],
    });
    expect(
      materializeUsageCost(
        entry({ cacheReadTokens: 100, inputTokens: 10, outputTokens: 10 }),
        onlyIo
      )
    ).toEqual({
      cost_usd: null,
      cost_estimated_usd: null,
      pricing_source: null,
    });
  });
});

describe('loadPricingLookups', () => {
  test('builds indexes from injected global config and catalog without I/O', async () => {
    const loaded = await loadPricingLookups({
      globalConfig: {
        pricing: {
          models: [{ provider: 'openai', model: 'gpt-test', input: 1, output: 2 }],
        },
      },
      catalog: [
        {
          ref: 'anthropic/claude-x',
          provider: 'anthropic',
          id: 'claude-x',
          name: 'X',
          reasoning: false,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          contextWindow: 200000,
        },
      ],
    });
    expect(loaded.configByProviderModel.get('openai')?.get('gpt-test')).toEqual({
      input: 1,
      output: 2,
    });
    expect(loaded.catalogByProviderModel.get('anthropic')?.get('claude-x')?.input).toBe(3);
  });

  test('catalog/config failure path yields empty maps (no throw)', async () => {
    const loaded = await loadPricingLookups({
      globalConfig: {
        pricing: { models: 'bad' as unknown as [] },
      },
      catalog: null,
    });
    expect(loaded.configByProviderModel.size).toBe(0);
    expect(loaded.catalogByProviderModel.size).toBe(0);
  });
});
