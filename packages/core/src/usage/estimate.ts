/**
 * Point-in-time usage cost materialization for the usage ledger.
 *
 * Precedence:
 *   1. Provider-reported `costUsd` (including zero) → `cost_usd`, no estimate
 *   2. Exact global-config `(provider, model)` pair → `cost_estimated_usd` + `config`
 *   3. Exact Pi catalog `(provider, id)` pair → `cost_estimated_usd` + `catalog`
 *   4. No cost
 *
 * Estimates never enter provider results, workflow-event JSON, legacy run totals,
 * or `cost_usd`. Resolve lookups BEFORE opening a DB transaction — never read
 * config/catalog inside one.
 */
import { createLogger } from '@archon/paths';
import { listPiModels, type PiModelInfo } from '@archon/providers';
import type { ModelUsageEntry } from '@archon/providers/types';
import type { GlobalConfig, PricingConfig, PricingModelRate } from '../config/config-types';
import { loadGlobalConfig } from '../config/config-loader';
import type { UsageLedgerPricingSource } from '../schemas/usage-ledger';

const RATE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

/** USD-per-million rates used for one matched model identity. */
export interface PricingRates {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /**
   * Optional request-wide tiers. Highest tier with
   * `inputTokensAbove < aggregateInput` wins (Pi `calculateCost` rule).
   * Aggregate multi-call estimates remain approximate.
   */
  tiers?: readonly PricingRateTier[];
}

export interface PricingRateTier {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Pre-resolved pricing lookups. Nested maps keyed by exact provider then exact
 * model — never a concatenated `${provider}/${model}` string (ids may contain `/`).
 */
export interface PricingLookups {
  configByProviderModel: ReadonlyMap<string, ReadonlyMap<string, PricingRates>>;
  catalogByProviderModel: ReadonlyMap<string, ReadonlyMap<string, PricingRates>>;
}

/** Ledger cost columns produced for one usage observation. */
export interface MaterializedUsageCost {
  cost_usd: number | null;
  cost_estimated_usd: number | null;
  pricing_source: UsageLedgerPricingSource | null;
}

const EMPTY_LOOKUPS: PricingLookups = {
  configByProviderModel: new Map(),
  catalogByProviderModel: new Map(),
};

const NO_COST: MaterializedUsageCost = {
  cost_usd: null,
  cost_estimated_usd: null,
  pricing_source: null,
};

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('usage.estimate');
  return cachedLog;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function setNestedRate(
  root: Map<string, Map<string, PricingRates>>,
  provider: string,
  model: string,
  rates: PricingRates
): void {
  let byModel = root.get(provider);
  if (!byModel) {
    byModel = new Map();
    root.set(provider, byModel);
  }
  byModel.set(model, rates);
}

function getNestedRate(
  root: ReadonlyMap<string, ReadonlyMap<string, PricingRates>>,
  provider: string,
  model: string
): PricingRates | undefined {
  return root.get(provider)?.get(model);
}

/**
 * Validate one operator pricing entry at use time. Returns null + logs when
 * invalid; never partially applies a bad entry.
 */
function parsePricingModelRate(raw: unknown, index: number): PricingModelRate | null {
  if (!isPlainObject(raw)) {
    getLog().warn({ index, issue: 'entry_not_object' }, 'usage.pricing_entry_invalid');
    return null;
  }

  if (typeof raw.provider !== 'string') {
    getLog().warn({ index, issue: 'provider_invalid' }, 'usage.pricing_entry_invalid');
    return null;
  }
  const provider = raw.provider.trim();
  if (provider.length === 0) {
    getLog().warn({ index, issue: 'provider_empty' }, 'usage.pricing_entry_invalid');
    return null;
  }

  if (typeof raw.model !== 'string') {
    getLog().warn({ index, issue: 'model_invalid' }, 'usage.pricing_entry_invalid');
    return null;
  }
  const model = raw.model.trim();
  if (model.length === 0) {
    getLog().warn({ index, issue: 'model_empty' }, 'usage.pricing_entry_invalid');
    return null;
  }

  const rates: PricingModelRate = { provider, model };
  let hasRate = false;
  for (const field of RATE_FIELDS) {
    if (!(field in raw) || raw[field] === undefined) continue;
    if (!isFiniteNonNegative(raw[field])) {
      getLog().warn({ index, issue: `${field}_invalid` }, 'usage.pricing_entry_invalid');
      return null;
    }
    rates[field] = raw[field];
    hasRate = true;
  }

  if (!hasRate) {
    getLog().warn({ index, issue: 'missing_rate' }, 'usage.pricing_entry_invalid');
    return null;
  }

  // Reject unknown keys so typos don't silently no-op.
  for (const key of Object.keys(raw)) {
    if (key === 'provider' || key === 'model' || (RATE_FIELDS as readonly string[]).includes(key)) {
      continue;
    }
    getLog().warn({ index, issue: `unknown_field:${key}` }, 'usage.pricing_entry_invalid');
    return null;
  }

  return rates;
}

/**
 * Build the exact-match config rate index from a global pricing block.
 * Duplicate `(provider, model)` pairs are rejected (neither entry is used).
 * Invalid entries are skipped with a structured warning.
 */
export function buildConfigPricingIndex(
  pricing: PricingConfig | undefined | null
): Map<string, Map<string, PricingRates>> {
  const root = new Map<string, Map<string, PricingRates>>();
  if (!pricing || typeof pricing !== 'object') return root;

  const models = pricing.models;
  if (models === undefined) return root;
  if (!Array.isArray(models)) {
    getLog().warn({ issue: 'models_not_array' }, 'usage.pricing_config_invalid');
    return root;
  }

  const seen = new Map<string, Map<string, number>>();
  const duplicates = new Set<string>();

  for (let index = 0; index < models.length; index++) {
    const parsed = parsePricingModelRate(models[index], index);
    if (!parsed) continue;

    let byModel = seen.get(parsed.provider);
    if (!byModel) {
      byModel = new Map();
      seen.set(parsed.provider, byModel);
    }
    if (byModel.has(parsed.model)) {
      duplicates.add(`${parsed.provider}\0${parsed.model}`);
      getLog().warn(
        { provider: parsed.provider, model: parsed.model, issue: 'duplicate_provider_model' },
        'usage.pricing_entry_duplicate'
      );
      continue;
    }
    byModel.set(parsed.model, index);

    const rates: PricingRates = {};
    for (const field of RATE_FIELDS) {
      if (parsed[field] !== undefined) rates[field] = parsed[field];
    }
    setNestedRate(root, parsed.provider, parsed.model, rates);
  }

  // Drop both sides of any duplicate pair so estimation never picks one.
  for (const key of duplicates) {
    const sep = key.indexOf('\0');
    const provider = key.slice(0, sep);
    const model = key.slice(sep + 1);
    const byModel = root.get(provider);
    if (!byModel) continue;
    byModel.delete(model);
    if (byModel.size === 0) root.delete(provider);
  }

  return root;
}

function catalogCostToRates(cost: PiModelInfo['cost']): PricingRates {
  const rates: PricingRates = {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cacheRead,
    cacheWrite: cost.cacheWrite,
  };
  const tiers = cost.tiers;
  if (tiers && tiers.length > 0) {
    rates.tiers = tiers.map(tier => ({
      inputTokensAbove: tier.inputTokensAbove,
      input: tier.input,
      output: tier.output,
      cacheRead: tier.cacheRead,
      cacheWrite: tier.cacheWrite,
    }));
  }
  return rates;
}

/**
 * Build the exact-match Pi catalog rate index. Keys are catalog `provider` + `id`
 * (not `ref`, which concatenates with `/`).
 */
export function buildCatalogPricingIndex(
  catalog: readonly PiModelInfo[] | null | undefined
): Map<string, Map<string, PricingRates>> {
  const root = new Map<string, Map<string, PricingRates>>();
  if (!catalog) return root;

  for (const entry of catalog) {
    if (!entry || typeof entry.provider !== 'string' || typeof entry.id !== 'string') continue;
    const provider = entry.provider.trim();
    const model = entry.id.trim();
    if (provider.length === 0 || model.length === 0) continue;
    if (!entry.cost || typeof entry.cost !== 'object') continue;
    setNestedRate(root, provider, model, catalogCostToRates(entry.cost));
  }

  return root;
}

/**
 * Load process-cached global config + Pi catalog into exact-match lookups.
 * Failures yield empty maps and structured warnings — never throw into callers.
 */
export async function loadPricingLookups(options?: {
  /** Override global config (tests). Defaults to `loadGlobalConfig()`. */
  globalConfig?: GlobalConfig;
  /** Override Pi catalog (tests). Defaults to `listPiModels()`. */
  catalog?: readonly PiModelInfo[] | null;
}): Promise<PricingLookups> {
  let configByProviderModel: Map<string, Map<string, PricingRates>> = new Map();
  let catalogByProviderModel: Map<string, Map<string, PricingRates>> = new Map();

  try {
    const global =
      options?.globalConfig !== undefined ? options.globalConfig : await loadGlobalConfig();
    configByProviderModel = buildConfigPricingIndex(global.pricing);
  } catch (err) {
    getLog().warn({ err: err as Error }, 'usage.pricing_config_load_failed');
  }

  try {
    const catalog =
      options?.catalog !== undefined
        ? options.catalog
        : await listPiModels().catch(err => {
            getLog().warn({ err: err as Error }, 'usage.pricing_catalog_load_failed');
            return [] as PiModelInfo[];
          });
    catalogByProviderModel = buildCatalogPricingIndex(catalog);
  } catch (err) {
    getLog().warn({ err: err as Error }, 'usage.pricing_catalog_index_failed');
  }

  return { configByProviderModel, catalogByProviderModel };
}

/**
 * Select active rates for an aggregate input size using Pi's tier rule:
 * highest tier whose `inputTokensAbove` is strictly below the aggregate
 * (`input + cacheRead + cacheWrite`). Falls back to base rates when no tier
 * matches. Aggregate multi-call estimates are approximate.
 */
export function selectRatesForAggregate(
  base: PricingRates,
  aggregateInputTokens: number
): PricingRates {
  if (!base.tiers || base.tiers.length === 0) return base;

  let matchedThreshold = -1;
  let selected: PricingRateTier | undefined;
  for (const tier of base.tiers) {
    if (
      Number.isFinite(tier.inputTokensAbove) &&
      aggregateInputTokens > tier.inputTokensAbove &&
      tier.inputTokensAbove > matchedThreshold
    ) {
      selected = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }

  if (!selected) return base;
  return {
    input: selected.input,
    output: selected.output,
    cacheRead: selected.cacheRead,
    cacheWrite: selected.cacheWrite,
  };
}

function missingPositiveRate(tokens: number | undefined, rate: number | undefined): boolean {
  return tokens !== undefined && tokens > 0 && rate === undefined;
}

/**
 * Apply matched rates to reported token dimensions.
 * Returns null when estimation is impossible (missing required tokens/rates,
 * partial positive category without a rate, or non-finite product).
 * Reasoning is never charged separately — it is already inside output.
 */
export function estimateTokensUsd(
  entry: Pick<
    ModelUsageEntry,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  >,
  rates: PricingRates
): number | null {
  // Require both input and output token counts before estimating a model call.
  if (entry.inputTokens === undefined || entry.outputTokens === undefined) {
    return null;
  }

  const aggregate =
    entry.inputTokens + (entry.cacheReadTokens ?? 0) + (entry.cacheWriteTokens ?? 0);
  const active = selectRatesForAggregate(rates, aggregate);

  // Positive reported categories must have a rate; missing → whole estimate null.
  if (missingPositiveRate(entry.inputTokens, active.input)) return null;
  if (missingPositiveRate(entry.outputTokens, active.output)) return null;
  if (missingPositiveRate(entry.cacheReadTokens, active.cacheRead)) return null;
  if (missingPositiveRate(entry.cacheWriteTokens, active.cacheWrite)) return null;

  // Input + output are always present here; rates must exist (including explicit 0).
  if (active.input === undefined || active.output === undefined) return null;

  let total = 0;
  total += (active.input / 1_000_000) * entry.inputTokens;
  total += (active.output / 1_000_000) * entry.outputTokens;

  // Cache rates apply only to dimensions the provider reported.
  if (entry.cacheReadTokens !== undefined) {
    if (active.cacheRead === undefined) {
      // Zero cache-read with no rate is fine (nothing to charge).
      if (entry.cacheReadTokens > 0) return null;
    } else {
      total += (active.cacheRead / 1_000_000) * entry.cacheReadTokens;
    }
  }
  if (entry.cacheWriteTokens !== undefined) {
    if (active.cacheWrite === undefined) {
      if (entry.cacheWriteTokens > 0) return null;
    } else {
      total += (active.cacheWrite / 1_000_000) * entry.cacheWriteTokens;
    }
  }

  if (!Number.isFinite(total) || total < 0) {
    getLog().warn({ issue: 'non_finite_estimate' }, 'usage.pricing_estimate_invalid');
    return null;
  }

  return total;
}

/**
 * Materialize ledger cost columns for one validated usage observation.
 * Never invents model identity; never writes estimates into `cost_usd`.
 */
export function materializeUsageCost(
  entry: ModelUsageEntry,
  lookups: PricingLookups = EMPTY_LOOKUPS
): MaterializedUsageCost {
  // 1. Provider-reported USD (including known zero) wins and suppresses estimation.
  if (entry.costUsd !== undefined) {
    return {
      cost_usd: entry.costUsd,
      cost_estimated_usd: null,
      pricing_source: null,
    };
  }

  // Never estimate an unknown / missing model.
  if (entry.modelSource === 'unknown' || entry.model === null) {
    return NO_COST;
  }

  const provider = entry.provider;
  const model = entry.model;

  // 2. Exact global-config pair.
  const configRates = getNestedRate(lookups.configByProviderModel, provider, model);
  if (configRates) {
    const estimated = estimateTokensUsd(entry, configRates);
    if (estimated !== null) {
      return {
        cost_usd: null,
        cost_estimated_usd: estimated,
        pricing_source: 'config',
      };
    }
    // Matched but unpriceable (missing tokens / partial rates) → no estimate.
    return NO_COST;
  }

  // 3. Exact Pi catalog provider + id pair.
  const catalogRates = getNestedRate(lookups.catalogByProviderModel, provider, model);
  if (catalogRates) {
    const estimated = estimateTokensUsd(entry, catalogRates);
    if (estimated !== null) {
      return {
        cost_usd: null,
        cost_estimated_usd: estimated,
        pricing_source: 'catalog',
      };
    }
    return NO_COST;
  }

  // 4. No estimate.
  return NO_COST;
}
