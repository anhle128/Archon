/**
 * Provider-local usage normalizer.
 *
 * Validates individual ModelUsageEntry observations without importing workflow
 * or core code. Missing numeric measures stay undefined; known zeros survive.
 * Callers may concatenate upstream observations; this module never invents
 * opaque identity keys or fabricates estimates.
 */

import type { ModelSource, ModelUsageEntry, UsageBreakdown } from './types';

const MODEL_SOURCES = new Set<ModelSource>(['reported', 'requested', 'unknown']);
const ENTRY_KINDS = new Set(['advisor', 'subagent']);

const ALLOWED_KEYS = new Set([
  'provider',
  'model',
  'modelSource',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'requests',
  'costUsd',
  'kind',
]);

const TOKEN_FIELDS = [
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const;

export interface UsageEntryIssue {
  /** Index in the caller-supplied array (or -1 for a single-entry normalize). */
  index: number;
  /** Schema issue code — never includes raw payload values. */
  issue: string;
}

export interface NormalizeUsageBreakdownResult {
  breakdown: UsageBreakdown;
  rejected: readonly UsageEntryIssue[];
}

export type NormalizeModelUsageEntryResult =
  | { ok: true; entry: ModelUsageEntry }
  | { ok: false; issue: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validate one usage observation. Returns a cleaned entry on success, or an
 * issue code on failure. Issue codes never embed raw provider payload values.
 */
export function normalizeModelUsageEntry(value: unknown): NormalizeModelUsageEntryResult {
  if (!isPlainObject(value)) {
    return { ok: false, issue: 'entry_not_object' };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, issue: `forbidden_field:${key}` };
    }
  }

  if (typeof value.provider !== 'string') {
    return { ok: false, issue: 'provider_invalid' };
  }
  const provider = value.provider.trim();
  if (provider.length === 0) {
    return { ok: false, issue: 'provider_empty' };
  }

  if (
    typeof value.modelSource !== 'string' ||
    !MODEL_SOURCES.has(value.modelSource as ModelSource)
  ) {
    return { ok: false, issue: 'model_source_invalid' };
  }
  const modelSource = value.modelSource as ModelSource;

  let model: string | null;
  if (modelSource === 'unknown') {
    if (value.model !== null && value.model !== undefined) {
      return { ok: false, issue: 'model_source_unknown_requires_null_model' };
    }
    model = null;
  } else {
    if (typeof value.model !== 'string') {
      return { ok: false, issue: 'model_invalid' };
    }
    const trimmedModel = value.model.trim();
    if (trimmedModel.length === 0) {
      return { ok: false, issue: 'model_empty' };
    }
    model = trimmedModel;
  }

  const entry: ModelUsageEntry = {
    provider,
    model,
    modelSource,
  };

  for (const field of TOKEN_FIELDS) {
    if (!(field in value) || value[field] === undefined) continue;
    const raw = value[field];
    if (!isNonNegativeSafeInteger(raw)) {
      return { ok: false, issue: `${field}_invalid` };
    }
    entry[field] = raw;
  }

  if ('requests' in value && value.requests !== undefined) {
    if (!isPositiveSafeInteger(value.requests)) {
      return { ok: false, issue: 'requests_invalid' };
    }
    entry.requests = value.requests;
  }

  if ('costUsd' in value && value.costUsd !== undefined) {
    if (!isFiniteNonNegative(value.costUsd)) {
      return { ok: false, issue: 'cost_usd_invalid' };
    }
    entry.costUsd = value.costUsd;
  }

  if ('kind' in value && value.kind !== undefined) {
    if (typeof value.kind !== 'string' || !ENTRY_KINDS.has(value.kind)) {
      return { ok: false, issue: 'kind_invalid' };
    }
    entry.kind = value.kind as ModelUsageEntry['kind'];
  }

  if (
    entry.reasoningTokens !== undefined &&
    entry.outputTokens !== undefined &&
    entry.reasoningTokens > entry.outputTokens
  ) {
    return { ok: false, issue: 'reasoning_exceeds_output' };
  }

  const hasMeasure =
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.reasoningTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined ||
    entry.requests !== undefined ||
    entry.costUsd !== undefined;

  if (!hasMeasure) {
    return { ok: false, issue: 'missing_numeric_measure' };
  }

  return { ok: true, entry };
}

/**
 * Normalize a runtime usage array. Valid entries are retained in order; invalid
 * entries are rejected by index/issue without logging raw payload values.
 */
export function normalizeUsageBreakdown(
  entries: readonly unknown[]
): NormalizeUsageBreakdownResult {
  const breakdown: ModelUsageEntry[] = [];
  const rejected: UsageEntryIssue[] = [];

  for (let index = 0; index < entries.length; index++) {
    const result = normalizeModelUsageEntry(entries[index]);
    if (result.ok) {
      breakdown.push(result.entry);
    } else {
      rejected.push({ index, issue: result.issue });
    }
  }

  return { breakdown, rejected };
}

/** Convenience: return only the validated breakdown (drop rejected entries). */
export function toUsageBreakdown(entries: readonly unknown[]): UsageBreakdown {
  return normalizeUsageBreakdown(entries).breakdown;
}
