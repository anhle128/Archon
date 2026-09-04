import { describe, test, expect } from 'bun:test';
import { usageLedgerRowSchema } from './usage-ledger';

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ledger-1',
    workflow_event_id: 'event-1',
    entry_index: 0,
    agent_provider: 'claude',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    model_source: 'reported' as const,
    kind: null,
    tokens_input: 10,
    tokens_output: 5,
    tokens_reasoning: null,
    tokens_cache_read: null,
    tokens_cache_write: null,
    requests: null,
    cost_usd: 0.01,
    cost_estimated_usd: null,
    pricing_source: null,
    ...overrides,
  };
}

describe('usageLedgerRowSchema', () => {
  test('parses a full reported-cost row with snake_case columns 1:1', () => {
    const row = validRow();
    const parsed = usageLedgerRowSchema.parse(row);
    expect(parsed).toEqual(row);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'id',
        'workflow_event_id',
        'entry_index',
        'agent_provider',
        'provider',
        'model',
        'model_source',
        'kind',
        'tokens_input',
        'tokens_output',
        'tokens_reasoning',
        'tokens_cache_read',
        'tokens_cache_write',
        'requests',
        'cost_usd',
        'cost_estimated_usd',
        'pricing_source',
      ].sort()
    );
  });

  test('accepts unknown model_source with null model and estimated cost + pricing_source', () => {
    const row = validRow({
      model: null,
      model_source: 'unknown',
      tokens_input: 1,
      tokens_output: 1,
      cost_usd: null,
      cost_estimated_usd: 0.002,
      pricing_source: 'catalog',
    });
    expect(usageLedgerRowSchema.parse(row)).toEqual(row);
  });

  test('accepts request-only observation with null costs', () => {
    const row = validRow({
      tokens_input: null,
      tokens_output: null,
      requests: 1,
      cost_usd: null,
    });
    expect(usageLedgerRowSchema.parse(row).requests).toBe(1);
  });

  test('rejects empty measure set', () => {
    expect(() =>
      usageLedgerRowSchema.parse(
        validRow({
          tokens_input: null,
          tokens_output: null,
          tokens_reasoning: null,
          tokens_cache_read: null,
          tokens_cache_write: null,
          requests: null,
          cost_usd: null,
          cost_estimated_usd: null,
        })
      )
    ).toThrow(/at least one/i);
  });

  test('rejects reported and estimated USD together', () => {
    expect(() =>
      usageLedgerRowSchema.parse(
        validRow({
          cost_usd: 0.01,
          cost_estimated_usd: 0.02,
          pricing_source: 'config',
        })
      )
    ).toThrow(/mutually exclusive/i);
  });

  test('rejects pricing_source without estimate and estimate without pricing_source', () => {
    expect(() =>
      usageLedgerRowSchema.parse(validRow({ cost_usd: null, pricing_source: 'config' }))
    ).toThrow(/pricing_source/i);
    expect(() =>
      usageLedgerRowSchema.parse(
        validRow({
          cost_usd: null,
          cost_estimated_usd: 0.01,
          pricing_source: null,
        })
      )
    ).toThrow(/pricing_source/i);
  });

  test('rejects model/model_source nullability disagreement', () => {
    expect(() =>
      usageLedgerRowSchema.parse(validRow({ model_source: 'unknown', model: 'x' }))
    ).toThrow(/model must be null/i);
    expect(() =>
      usageLedgerRowSchema.parse(validRow({ model_source: 'reported', model: null }))
    ).toThrow(/model is required/i);
  });

  test('rejects reasoning above output and non-positive requests', () => {
    expect(() =>
      usageLedgerRowSchema.parse(validRow({ tokens_output: 2, tokens_reasoning: 3 }))
    ).toThrow(/tokens_reasoning/i);
    expect(() => usageLedgerRowSchema.parse(validRow({ requests: 0 }))).toThrow();
    expect(() => usageLedgerRowSchema.parse(validRow({ requests: -1 }))).toThrow();
  });

  test('rejects empty agent_provider/provider and negative entry_index', () => {
    expect(() => usageLedgerRowSchema.parse(validRow({ agent_provider: '' }))).toThrow();
    expect(() => usageLedgerRowSchema.parse(validRow({ provider: '' }))).toThrow();
    expect(() => usageLedgerRowSchema.parse(validRow({ entry_index: -1 }))).toThrow();
  });

  test('rejects unknown keys (strict) and non-finite costs', () => {
    expect(() => usageLedgerRowSchema.parse(validRow({ extra: 1 }))).toThrow();
    expect(() => usageLedgerRowSchema.parse(validRow({ cost_usd: Number.NaN }))).toThrow();
    expect(() =>
      usageLedgerRowSchema.parse(validRow({ cost_usd: Number.POSITIVE_INFINITY }))
    ).toThrow();
  });
});
