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
import type { GlobalConfig, PricingModelRate } from '../config/config-types';
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
  /**
   * Exact `(provider, model)` pairs that appeared in global pricing but were
   * rejected (invalid rates or duplicates). Catalog fallback must not price
   * these pairs — the operator attempted config and it failed closed.
   */
  configBlockedByProviderModel: ReadonlyMap<string, ReadonlySet<string>>;
  catalogByProviderModel: ReadonlyMap<string, ReadonlyMap<string, PricingRates>>;
}

/** Result of parsing global `pricing.models` at use time. */
export interface ConfigPricingIndex {
  rates: Map<string, Map<string, PricingRates>>;
  blocked: Map<string, Set<string>>;
}

/** Ledger cost columns produced for one usage observation. */
export interface MaterializedUsageCost {
  cost_usd: number | null;
  cost_estimated_usd: number | null;
  pricing_source: UsageLedgerPricingSource | null;
}

const EMPTY_LOOKUPS: PricingLookups = {
  configByProviderModel: new Map(),
  configBlockedByProviderModel: new Map(),
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

function isConfigPairBlocked(
  blocked: ReadonlyMap<string, ReadonlySet<string>>,
  provider: string,
  model: string
): boolean {
  return blocked.get(provider)?.has(model) === true;
}

function blockPair(blocked: Map<string, Set<string>>, provider: string, model: string): void {
  let models = blocked.get(provider);
  if (!models) {
    models = new Set();
    blocked.set(provider, models);
  }
  models.add(model);
}

function tryReadPricingIdentity(
  raw: Record<string, unknown>
): { provider: string; model: string } | null {
  if (typeof raw.provider !== 'string' || typeof raw.model !== 'string') return null;
  const provider = raw.provider.trim();
  const model = raw.model.trim();
  if (provider.length === 0 || model.length === 0) return null;
  return { provider, model };
}

/**
 * Emit a structured pricing warning. Logs source + issue (+ optional identity)
 * only — never operator config contents, rate values, or credentials.
 */
interface PricingWarnFields {
  source: 'config' | 'catalog' | 'estimate';
  issue: string;
  index?: number;
  provider?: string;
  model?: string;
}

/** @internal test seam — captures structured warnings without payload contents. */
let pricingWarnSinkForTest: ((message: string, fields: PricingWarnFields) => void) | undefined;

/** @internal */ export function setPricingWarnSinkForTest(
  sink: ((message: string, fields: PricingWarnFields) => void) | undefined
): void {
  pricingWarnSinkForTest = sink;
}

function warnPricing(message: string, fields: PricingWarnFields): void {
  getLog().warn(fields, message);
  pricingWarnSinkForTest?.(message, fields);
}

/**
 * Validate one operator pricing entry at use time. Returns null + logs when
 * invalid; never partially applies a bad entry.
 */
function parsePricingModelRate(raw: unknown, index: number): PricingModelRate | null {
  if (!isPlainObject(raw)) {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      issue: 'entry_not_object',
    });
    return null;
  }

  if (typeof raw.provider !== 'string') {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      issue: 'provider_invalid',
    });
    return null;
  }
  const provider = raw.provider.trim();
  if (provider.length === 0) {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      issue: 'provider_empty',
    });
    return null;
  }

  if (typeof raw.model !== 'string') {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      issue: 'model_invalid',
    });
    return null;
  }
  const model = raw.model.trim();
  if (model.length === 0) {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      issue: 'model_empty',
    });
    return null;
  }

  const rates: PricingModelRate = { provider, model };
  let hasRate = false;
  for (const field of RATE_FIELDS) {
    if (!(field in raw) || raw[field] === undefined) continue;
    if (!isFiniteNonNegative(raw[field])) {
      warnPricing('usage.pricing_entry_invalid', {
        source: 'config',
        index,
        provider,
        model,
        issue: `${field}_invalid`,
      });
      return null;
    }
    rates[field] = raw[field];
    hasRate = true;
  }

  if (!hasRate) {
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      provider,
      model,
      issue: 'missing_rate',
    });
    return null;
  }

  // Reject unknown keys so typos don't silently no-op.
  for (const key of Object.keys(raw)) {
    if (key === 'provider' || key === 'model' || (RATE_FIELDS as readonly string[]).includes(key)) {
      continue;
    }
    warnPricing('usage.pricing_entry_invalid', {
      source: 'config',
      index,
      provider,
      model,
      issue: `unknown_field:${key}`,
    });
    return null;
  }

  return rates;
}

/**
 * Build the exact-match config rate index from a global pricing block.
 * Duplicate `(provider, model)` pairs and identifiable invalid entries are
 * recorded in `blocked` so catalog fallback cannot price them. Invalid entries
 * without a recoverable identity are skipped with a warning only.
 *
 * Accepts `unknown` because global config is YAML-loaded without a runtime
 * schema — present malformed values must be diagnosed, not silently dropped.
 * Missing pricing and intentionally empty objects remain valid no-pricing states.
 */
export function buildConfigPricingIndex(
  // YAML-loaded config has no runtime schema — accept unknown present values.
  pricing: unknown
): ConfigPricingIndex {
  const rates = new Map<string, Map<string, PricingRates>>();
  const blocked = new Map<string, Set<string>>();

  // Absent pricing is a valid no-pricing state.
  if (pricing === undefined || pricing === null) return { rates, blocked };

  // Present but not a plain object (primitive, array, …) → diagnose + empty.
  if (!isPlainObject(pricing)) {
    warnPricing('usage.pricing_config_invalid', {
      source: 'config',
      issue: 'pricing_not_object',
    });
    return { rates, blocked };
  }

  // Intentionally empty object `{}` is a valid no-pricing state.
  if (!('models' in pricing) || pricing.models === undefined) {
    return { rates, blocked };
  }

  const models = pricing.models;
  if (!Array.isArray(models)) {
    warnPricing('usage.pricing_config_invalid', {
      source: 'config',
      issue: 'models_not_array',
    });
    return { rates, blocked };
  }

  // Nested (provider → model) structures only — never concatenate identities
  // (provider/model may contain '/' or the historical '\0' separator).
  const seen = new Map<string, Map<string, number>>();
  const duplicates = new Map<string, Set<string>>();

  for (let index = 0; index < models.length; index++) {
    const raw = models[index];
    const parsed = parsePricingModelRate(raw, index);
    if (!parsed) {
      // Identifiable invalid identity still blocks catalog for that pair.
      if (isPlainObject(raw)) {
        const identity = tryReadPricingIdentity(raw);
        if (identity) blockPair(blocked, identity.provider, identity.model);
      }
      continue;
    }

    let byModel = seen.get(parsed.provider);
    if (!byModel) {
      byModel = new Map();
      seen.set(parsed.provider, byModel);
    }
    if (byModel.has(parsed.model)) {
      blockPair(duplicates, parsed.provider, parsed.model);
      warnPricing('usage.pricing_entry_duplicate', {
        source: 'config',
        provider: parsed.provider,
        model: parsed.model,
        issue: 'duplicate_provider_model',
      });
      continue;
    }
    byModel.set(parsed.model, index);

    const entryRates: PricingRates = {};
    for (const field of RATE_FIELDS) {
      if (parsed[field] !== undefined) entryRates[field] = parsed[field];
    }
    setNestedRate(rates, parsed.provider, parsed.model, entryRates);
  }

  // Drop both sides of any duplicate pair and block catalog fallback.
  for (const [provider, modelsForProvider] of duplicates) {
    for (const model of modelsForProvider) {
      const byModel = rates.get(provider);
      if (byModel) {
        byModel.delete(model);
        if (byModel.size === 0) rates.delete(provider);
      }
      blockPair(blocked, provider, model);
    }
  }

  return { rates, blocked };
}

/**
 * Validate one catalog cost object before indexing. Every present base/tier
 * rate and threshold must be finite and non-negative. One invalid component
 * rejects the whole pair — estimation must never discover bad rates only via
 * the final sum (a negative rate can be offset by a positive sibling).
 * Returns null + structured warning; never indexes a partial invalid entry.
 */
function parseCatalogCost(
  cost: unknown,
  identity: { provider: string; model: string }
): PricingRates | null {
  const { provider, model } = identity;
  if (!isPlainObject(cost)) {
    warnPricing('usage.pricing_catalog_entry_invalid', {
      source: 'catalog',
      provider,
      model,
      issue: 'cost_not_object',
    });
    return null;
  }

  const rates: PricingRates = {};
  for (const field of RATE_FIELDS) {
    if (!(field in cost) || cost[field] === undefined) continue;
    if (!isFiniteNonNegative(cost[field])) {
      warnPricing('usage.pricing_catalog_entry_invalid', {
        source: 'catalog',
        provider,
        model,
        issue: `${field}_invalid`,
      });
      return null;
    }
    rates[field] = cost[field];
  }

  if (cost.tiers !== undefined) {
    if (!Array.isArray(cost.tiers)) {
      warnPricing('usage.pricing_catalog_entry_invalid', {
        source: 'catalog',
        provider,
        model,
        issue: 'tiers_not_array',
      });
      return null;
    }

    if (cost.tiers.length > 0) {
      const tiers: PricingRateTier[] = [];
      for (const tierRaw of cost.tiers) {
        if (!isPlainObject(tierRaw)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_not_object',
          });
          return null;
        }

        const threshold = tierRaw.inputTokensAbove;
        const tierInput = tierRaw.input;
        const tierOutput = tierRaw.output;
        const tierCacheRead = tierRaw.cacheRead;
        const tierCacheWrite = tierRaw.cacheWrite;

        if (!isFiniteNonNegative(threshold)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_threshold_invalid',
          });
          return null;
        }
        if (!isFiniteNonNegative(tierInput)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_input_invalid',
          });
          return null;
        }
        if (!isFiniteNonNegative(tierOutput)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_output_invalid',
          });
          return null;
        }
        if (!isFiniteNonNegative(tierCacheRead)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_cacheRead_invalid',
          });
          return null;
        }
        if (!isFiniteNonNegative(tierCacheWrite)) {
          warnPricing('usage.pricing_catalog_entry_invalid', {
            source: 'catalog',
            provider,
            model,
            issue: 'tier_cacheWrite_invalid',
          });
          return null;
        }

        tiers.push({
          inputTokensAbove: threshold,
          input: tierInput,
          output: tierOutput,
          cacheRead: tierCacheRead,
          cacheWrite: tierCacheWrite,
        });
      }
      rates.tiers = tiers;
    }
  }

  return rates;
}

/**
 * Build the exact-match Pi catalog rate index. Keys are catalog `provider` + `id`
 * (not `ref`, which concatenates with `/`). Invalid rate sets are omitted with
 * a structured warning — they remain unpriced (not config-blocked).
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
    if (entry.cost === undefined || entry.cost === null) continue;

    const rates = parseCatalogCost(entry.cost, { provider, model });
    if (!rates) continue;
    setNestedRate(root, provider, model, rates);
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
  let configBlockedByProviderModel: Map<string, Set<string>> = new Map();
  let catalogByProviderModel: Map<string, Map<string, PricingRates>> = new Map();

  try {
    const global =
      options?.globalConfig !== undefined ? options.globalConfig : await loadGlobalConfig();
    const index = buildConfigPricingIndex(global.pricing);
    configByProviderModel = index.rates;
    configBlockedByProviderModel = index.blocked;
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

  return { configByProviderModel, configBlockedByProviderModel, catalogByProviderModel };
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
 * partial positive category without a rate, invalid component rates, or
 * non-finite product). Reasoning is never charged separately — it is already
 * inside output.
 *
 * Component rates are checked individually before multiplication so a negative
 * rate cannot hide behind a larger positive sibling and produce a plausible sum.
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

  // Defense in depth: every present rate component must be finite non-negative
  // before any multiplication. Indexing already validates external sources;
  // this catches injected/stale rates without relying on the final sum.
  for (const field of RATE_FIELDS) {
    const rate = active[field];
    if (rate !== undefined && !isFiniteNonNegative(rate)) {
      warnPricing('usage.pricing_estimate_invalid', {
        source: 'estimate',
        issue: `${field}_invalid`,
      });
      return null;
    }
  }

  // Positive reported categories must have a rate; missing → whole estimate null.
  // Zero-count categories may omit the rate (contribute nothing).
  if (missingPositiveRate(entry.inputTokens, active.input)) return null;
  if (missingPositiveRate(entry.outputTokens, active.output)) return null;
  if (missingPositiveRate(entry.cacheReadTokens, active.cacheRead)) return null;
  if (missingPositiveRate(entry.cacheWriteTokens, active.cacheWrite)) return null;

  let total = 0;
  if (active.input !== undefined) {
    total += (active.input / 1_000_000) * entry.inputTokens;
  }
  if (active.output !== undefined) {
    total += (active.output / 1_000_000) * entry.outputTokens;
  }

  // Cache rates apply only to dimensions the provider reported.
  if (entry.cacheReadTokens !== undefined && active.cacheRead !== undefined) {
    total += (active.cacheRead / 1_000_000) * entry.cacheReadTokens;
  }
  if (entry.cacheWriteTokens !== undefined && active.cacheWrite !== undefined) {
    total += (active.cacheWrite / 1_000_000) * entry.cacheWriteTokens;
  }

  if (!Number.isFinite(total) || total < 0) {
    warnPricing('usage.pricing_estimate_invalid', {
      source: 'estimate',
      issue: 'non_finite_estimate',
    });
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

  // Operator authored an exact config pair that was rejected (invalid/duplicate):
  // leave unpriced — do not fall through to catalog for the same identity.
  if (isConfigPairBlocked(lookups.configBlockedByProviderModel, provider, model)) {
    return NO_COST;
  }

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
