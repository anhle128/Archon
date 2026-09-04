import { afterEach, describe, expect, test } from 'bun:test';
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
  setPricingWarnSinkForTest,
  type PricingLookups,
  type PricingRates,
} from './estimate';

type CapturedWarn = { message: string; fields: Record<string, unknown> };

function captureWarns(): CapturedWarn[] {
  const warns: CapturedWarn[] = [];
  setPricingWarnSinkForTest((message, fields) => {
    warns.push({ message, fields: { ...fields } });
  });
  return warns;
}

afterEach(() => {
  setPricingWarnSinkForTest(undefined);
});

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
  blocked?: Array<{ provider: string; model: string }>;
  catalog?: Array<{ provider: string; model: string; rates: PricingRates }>;
}): PricingLookups {
  const configByProviderModel = new Map<string, Map<string, PricingRates>>();
  const configBlockedByProviderModel = new Map<string, Set<string>>();
  const catalogByProviderModel = new Map<string, Map<string, PricingRates>>();
  for (const row of partial.config ?? []) {
    let byModel = configByProviderModel.get(row.provider);
    if (!byModel) {
      byModel = new Map();
      configByProviderModel.set(row.provider, byModel);
    }
    byModel.set(row.model, row.rates);
  }
  for (const row of partial.blocked ?? []) {
    let models = configBlockedByProviderModel.get(row.provider);
    if (!models) {
      models = new Set();
      configBlockedByProviderModel.set(row.provider, models);
    }
    models.add(row.model);
  }
  for (const row of partial.catalog ?? []) {
    let byModel = catalogByProviderModel.get(row.provider);
    if (!byModel) {
      byModel = new Map();
      catalogByProviderModel.set(row.provider, byModel);
    }
    byModel.set(row.model, row.rates);
  }
  return { configByProviderModel, configBlockedByProviderModel, catalogByProviderModel };
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
    expect(index.rates.get('openai')?.get('gpt-5.4')).toEqual({ input: 2.5, output: 15 });
    expect(index.rates.get('openrouter')?.get('org/model-v1')).toEqual({ input: 1, output: 2 });
    expect(index.blocked.size).toBe(0);
  });

  test('rejects duplicate provider/model pairs without using either entry and blocks them', () => {
    const pricing: PricingConfig = {
      models: [
        { provider: 'openai', model: 'gpt-5.4', input: 1, output: 2 },
        { provider: 'openai', model: 'gpt-5.4', input: 9, output: 9 },
        { provider: 'anthropic', model: 'claude-sonnet', input: 3, output: 15 },
      ],
    };
    const index = buildConfigPricingIndex(pricing);
    expect(index.rates.get('openai')?.get('gpt-5.4')).toBeUndefined();
    expect(index.blocked.get('openai')?.has('gpt-5.4')).toBe(true);
    expect(index.rates.get('anthropic')?.get('claude-sonnet')).toEqual({ input: 3, output: 15 });
  });

  test('null-byte and slash identities stay exact structured pairs under duplicate detection', () => {
    // The pre-fix duplicate tracker joined provider/model with '\0' and later
    // re-parsed on the first null byte. That collides these two distinct pairs:
    //   ('a\0b', 'c')  vs  ('a', 'b\0c')
    const pricing: PricingConfig = {
      models: [
        { provider: 'a\0b', model: 'c', input: 1, output: 2 },
        { provider: 'a\0b', model: 'c', input: 9, output: 9 },
        { provider: 'a', model: 'b\0c', input: 3, output: 4 },
        { provider: 'open/router', model: 'org/model', input: 5, output: 6 },
        { provider: 'open', model: 'router/org/model', input: 7, output: 8 },
      ],
    };
    const index = buildConfigPricingIndex(pricing);

    // Exact duplicate blocked and removed from rates
    expect(index.rates.get('a\0b')?.get('c')).toBeUndefined();
    expect(index.blocked.get('a\0b')?.has('c')).toBe(true);

    // Neighbor that shares the old concatenated key remains independently priceable
    expect(index.rates.get('a')?.get('b\0c')).toEqual({ input: 3, output: 4 });
    expect(index.blocked.get('a')?.has('b\0c')).toBeFalsy();

    // Slash-containing provider/model pairs never shadow each other
    expect(index.rates.get('open/router')?.get('org/model')).toEqual({ input: 5, output: 6 });
    expect(index.rates.get('open')?.get('router/org/model')).toEqual({ input: 7, output: 8 });
    expect(index.blocked.size).toBe(1);
  });

  test('duplicate separator-containing pair still blocks catalog fallback for that exact pair only', () => {
    const index = buildConfigPricingIndex({
      models: [
        { provider: 'prov\0x', model: 'mod/y', input: 1, output: 2 },
        { provider: 'prov\0x', model: 'mod/y', input: 3, output: 4 },
        { provider: 'prov', model: 'x\0mod/y', input: 5, output: 6 },
      ],
    });
    const catalogByProviderModel = lookups({
      catalog: [
        { provider: 'prov\0x', model: 'mod/y', rates: { input: 10, output: 20 } },
        { provider: 'prov', model: 'x\0mod/y', rates: { input: 10, output: 20 } },
      ],
    }).catalogByProviderModel;
    const materializeLookups: PricingLookups = {
      configByProviderModel: index.rates,
      configBlockedByProviderModel: index.blocked,
      catalogByProviderModel,
    };

    // Rejected exact pair: config blocked, no config rate, catalog must not price it
    expect(
      materializeUsageCost(
        entry({
          provider: 'prov\0x',
          model: 'mod/y',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        materializeLookups
      )
    ).toEqual({ cost_usd: null, cost_estimated_usd: null, pricing_source: null });

    // Neighbor remains priceable from config rates (not blocked)
    expect(
      materializeUsageCost(
        entry({
          provider: 'prov',
          model: 'x\0mod/y',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        materializeLookups
      )
    ).toEqual({
      cost_usd: null,
      cost_estimated_usd: 11,
      pricing_source: 'config',
    });
  });

  test('skips invalid rate objects, blocks identifiable pairs, keeps valid siblings', () => {
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
    expect([...index.rates.get('openai')!.keys()]).toEqual(['ok']);
    expect(index.rates.get('openai')?.get('ok')).toEqual({ input: 1, output: 2 });
    expect(index.blocked.get('openai')?.has('bad-neg')).toBe(true);
    expect(index.blocked.get('openai')?.has('bad-empty')).toBe(true);
    expect(index.blocked.get('openai')?.has('nan')).toBe(true);
    expect(index.blocked.get('openai')?.has('inf')).toBe(true);
  });

  test('returns empty index for missing or non-array models', () => {
    expect(buildConfigPricingIndex(undefined).rates.size).toBe(0);
    expect(buildConfigPricingIndex({}).rates.size).toBe(0);
    expect(buildConfigPricingIndex({ models: [] }).rates.size).toBe(0);
    expect(buildConfigPricingIndex({ models: null as unknown as [] }).rates.size).toBe(0);
  });

  test('preserves valid zero rates', () => {
    const index = buildConfigPricingIndex({
      models: [
        { provider: 'openai', model: 'free', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ],
    });
    expect(index.rates.get('openai')?.get('free')).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(index.blocked.size).toBe(0);
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

  test('rejects negative base rates even when siblings are positive', () => {
    const warns = captureWarns();
    // Negative input would be offset by large positive output if only the sum were checked.
    const catalog: PiModelInfo[] = [
      {
        ref: 'openai/bad-neg',
        provider: 'openai',
        id: 'bad-neg',
        name: 'Bad',
        reasoning: false,
        cost: { input: -5, output: 100, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
      },
      {
        ref: 'openai/ok',
        provider: 'openai',
        id: 'ok',
        name: 'Ok',
        reasoning: false,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
      },
    ];
    const index = buildCatalogPricingIndex(catalog);
    expect(index.get('openai')?.get('bad-neg')).toBeUndefined();
    expect(index.get('openai')?.get('ok')).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(
      warns.some(w => w.fields.source === 'catalog' && w.fields.issue === 'input_invalid')
    ).toBe(true);
    // No rate values or full cost objects in the warning payload
    for (const w of warns) {
      expect(w.fields).not.toHaveProperty('input');
      expect(w.fields).not.toHaveProperty('output');
      expect(w.fields).not.toHaveProperty('cost');
      expect(JSON.stringify(w.fields)).not.toContain('-5');
    }

    // Cannot produce an estimate via materialize either
    expect(
      materializeUsageCost(
        entry({
          provider: 'openai',
          model: 'bad-neg',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        {
          configByProviderModel: new Map(),
          configBlockedByProviderModel: new Map(),
          catalogByProviderModel: index,
        }
      )
    ).toEqual({ cost_usd: null, cost_estimated_usd: null, pricing_source: null });
  });

  test('rejects non-finite rates, invalid tier thresholds, and invalid tier rates', () => {
    const warns = captureWarns();
    const catalog = [
      {
        ref: 'p/nan',
        provider: 'p',
        id: 'nan',
        name: 'n',
        reasoning: false,
        cost: { input: Number.NaN, output: 1, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1,
      },
      {
        ref: 'p/inf',
        provider: 'p',
        id: 'inf',
        name: 'i',
        reasoning: false,
        cost: { input: 1, output: Number.POSITIVE_INFINITY, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1,
      },
      {
        ref: 'p/tier-neg-threshold',
        provider: 'p',
        id: 'tier-neg-threshold',
        name: 't',
        reasoning: false,
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          tiers: [{ inputTokensAbove: -1, input: 3, output: 4, cacheRead: 0, cacheWrite: 0 }],
        },
        contextWindow: 1,
      },
      {
        ref: 'p/tier-nan-threshold',
        provider: 'p',
        id: 'tier-nan-threshold',
        name: 't',
        reasoning: false,
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          tiers: [
            {
              inputTokensAbove: Number.NaN,
              input: 3,
              output: 4,
              cacheRead: 0,
              cacheWrite: 0,
            },
          ],
        },
        contextWindow: 1,
      },
      {
        ref: 'p/tier-bad-rate',
        provider: 'p',
        id: 'tier-bad-rate',
        name: 't',
        reasoning: false,
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          tiers: [{ inputTokensAbove: 100, input: -3, output: 4, cacheRead: 0, cacheWrite: 0 }],
        },
        contextWindow: 1,
      },
      {
        ref: 'p/good-zero',
        provider: 'p',
        id: 'good-zero',
        name: 'g',
        reasoning: false,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          tiers: [{ inputTokensAbove: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
        },
        contextWindow: 1,
      },
    ] as unknown as PiModelInfo[];

    const index = buildCatalogPricingIndex(catalog);
    expect(index.get('p')?.get('nan')).toBeUndefined();
    expect(index.get('p')?.get('inf')).toBeUndefined();
    expect(index.get('p')?.get('tier-neg-threshold')).toBeUndefined();
    expect(index.get('p')?.get('tier-nan-threshold')).toBeUndefined();
    expect(index.get('p')?.get('tier-bad-rate')).toBeUndefined();
    expect(index.get('p')?.get('good-zero')).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tiers: [{ inputTokensAbove: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
    });

    const issues = warns.map(w => w.fields.issue);
    expect(issues).toContain('input_invalid');
    expect(issues).toContain('output_invalid');
    expect(issues).toContain('tier_threshold_invalid');
    expect(issues).toContain('tier_input_invalid');
    expect(warns.every(w => w.fields.source === 'catalog')).toBe(true);
  });

  test('estimateTokensUsd rejects negative component rates before summing', () => {
    // Defense in depth: even if a bad rate slipped into PricingRates, a negative
    // input offset by a larger positive output must not yield a plausible total.
    const warns = captureWarns();
    expect(
      estimateTokensUsd(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { input: -5, output: 100 }
      )
    ).toBeNull();
    expect(warns.some(w => w.fields.issue === 'input_invalid')).toBe(true);
    // Sum-only check would have returned 95 — ensure we never publish that.
    expect(
      estimateTokensUsd(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { input: -5, output: 100 }
      )
    ).toBeNull();
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

  test('zero token count may omit that category rate', () => {
    // inputTokens=0 with no input rate; output charged alone
    expect(estimateTokensUsd({ inputTokens: 0, outputTokens: 1_000_000 }, { output: 2 })).toBe(2);
    expect(estimateTokensUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { input: 3 })).toBe(3);
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

  test('invalid config pair blocks catalog fallback for the same identity', () => {
    const blockedLookups = lookups({
      blocked: [{ provider: 'openai', model: 'gpt-5.4' }],
      catalog: [
        {
          provider: 'openai',
          model: 'gpt-5.4',
          rates: { input: 99, output: 99 },
        },
      ],
    });
    expect(
      materializeUsageCost(
        entry({
          provider: 'openai',
          model: 'gpt-5.4',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        blockedLookups
      )
    ).toEqual({
      cost_usd: null,
      cost_estimated_usd: null,
      pricing_source: null,
    });
  });

  test('duplicate config pair blocks catalog fallback for the same identity', async () => {
    const loaded = await loadPricingLookups({
      globalConfig: {
        pricing: {
          models: [
            { provider: 'openai', model: 'gpt-5.4', input: 1, output: 2 },
            { provider: 'openai', model: 'gpt-5.4', input: 9, output: 9 },
          ],
        },
      },
      catalog: [
        {
          ref: 'openai/gpt-5.4',
          provider: 'openai',
          id: 'gpt-5.4',
          name: 'GPT',
          reasoning: false,
          cost: { input: 99, output: 99, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
        },
      ],
    });
    expect(loaded.configByProviderModel.get('openai')?.get('gpt-5.4')).toBeUndefined();
    expect(loaded.configBlockedByProviderModel.get('openai')?.has('gpt-5.4')).toBe(true);
    expect(
      materializeUsageCost(
        entry({
          provider: 'openai',
          model: 'gpt-5.4',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        loaded
      ).cost_estimated_usd
    ).toBeNull();
  });

  test('invalid config rate object blocks catalog fallback for that pair', async () => {
    const loaded = await loadPricingLookups({
      globalConfig: {
        pricing: {
          models: [{ provider: 'openai', model: 'gpt-5.4', input: -1, output: 2 }],
        },
      },
      catalog: [
        {
          ref: 'openai/gpt-5.4',
          provider: 'openai',
          id: 'gpt-5.4',
          name: 'GPT',
          reasoning: false,
          cost: { input: 99, output: 99, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
        },
      ],
    });
    expect(loaded.configBlockedByProviderModel.get('openai')?.has('gpt-5.4')).toBe(true);
    expect(
      materializeUsageCost(
        entry({
          provider: 'openai',
          model: 'gpt-5.4',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        loaded
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

  test('malformed present pricing values warn and yield empty config index', async () => {
    const cases: Array<{ label: string; pricing: unknown; issue: string }> = [
      { label: 'string', pricing: 'not-pricing', issue: 'pricing_not_object' },
      { label: 'number', pricing: 42, issue: 'pricing_not_object' },
      { label: 'boolean', pricing: true, issue: 'pricing_not_object' },
      {
        label: 'array',
        pricing: [{ provider: 'x', model: 'y', input: 1 }],
        issue: 'pricing_not_object',
      },
      { label: 'models-string', pricing: { models: 'nope' }, issue: 'models_not_array' },
      { label: 'models-object', pricing: { models: { provider: 'x' } }, issue: 'models_not_array' },
    ];

    for (const c of cases) {
      const warns = captureWarns();
      const loaded = await loadPricingLookups({
        globalConfig: { pricing: c.pricing as PricingConfig },
        catalog: [],
      });
      expect(loaded.configByProviderModel.size).toBe(0);
      expect(loaded.configBlockedByProviderModel.size).toBe(0);
      expect(
        warns.some(
          w =>
            w.message === 'usage.pricing_config_invalid' &&
            w.fields.source === 'config' &&
            w.fields.issue === c.issue
        ),
        `${c.label} should warn ${c.issue}`
      ).toBe(true);
      // Never dump the malformed value into the log fields
      for (const w of warns) {
        expect(w.fields).not.toHaveProperty('pricing');
        expect(w.fields).not.toHaveProperty('models');
        expect(w.fields).not.toHaveProperty('value');
      }
      setPricingWarnSinkForTest(undefined);
    }
  });

  test('missing pricing and empty pricing objects remain silent no-pricing states', async () => {
    const warns = captureWarns();
    const missing = await loadPricingLookups({ globalConfig: {}, catalog: [] });
    const emptyObj = await loadPricingLookups({
      globalConfig: { pricing: {} },
      catalog: [],
    });
    const emptyModels = await loadPricingLookups({
      globalConfig: { pricing: { models: [] } },
      catalog: [],
    });
    expect(missing.configByProviderModel.size).toBe(0);
    expect(emptyObj.configByProviderModel.size).toBe(0);
    expect(emptyModels.configByProviderModel.size).toBe(0);
    expect(warns.filter(w => w.message === 'usage.pricing_config_invalid')).toHaveLength(0);
  });

  test('reported provider USD still bypasses estimation after malformed catalog', async () => {
    const loaded = await loadPricingLookups({
      globalConfig: { pricing: 'bad' as unknown as PricingConfig },
      catalog: [
        {
          ref: 'openai/gpt-5.4',
          provider: 'openai',
          id: 'gpt-5.4',
          name: 'GPT',
          reasoning: false,
          cost: { input: -1, output: 99, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
        } as unknown as PiModelInfo,
      ],
    });
    expect(loaded.configByProviderModel.size).toBe(0);
    expect(loaded.catalogByProviderModel.get('openai')?.get('gpt-5.4')).toBeUndefined();
    expect(
      materializeUsageCost(entry({ costUsd: 1.25, inputTokens: 10, outputTokens: 10 }), loaded)
    ).toEqual({
      cost_usd: 1.25,
      cost_estimated_usd: null,
      pricing_source: null,
    });
  });
});
