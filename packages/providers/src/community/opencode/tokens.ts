import type { ModelUsageEntry, TokenUsage, UsageBreakdown } from '../../types';
import { toUsageBreakdown } from '../../usage-breakdown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Map OpenCode assistant message info to legacy TokenUsage.
 * Reasoning is an output subset in the pinned SDK — never added to output again.
 */
export function normalizeTokens(info: Record<string, unknown> | undefined): TokenUsage | undefined {
  const tokens = isRecord(info?.tokens) ? info.tokens : undefined;
  if (!tokens) return undefined;

  const input = typeof tokens.input === 'number' ? tokens.input : 0;
  const output = typeof tokens.output === 'number' ? tokens.output : 0;
  const total = input + output;

  return {
    input,
    output,
    ...(total > 0 ? { total } : {}),
    ...(typeof info?.cost === 'number' ? { cost: info.cost } : {}),
  };
}

export function sumTokenUsages(
  usages: readonly (TokenUsage | undefined)[]
): TokenUsage | undefined {
  let acc: TokenUsage | undefined;
  for (const next of usages) {
    if (!next) continue;
    if (!acc) {
      acc = { ...next };
      continue;
    }
    acc = {
      input: acc.input + next.input,
      output: acc.output + next.output,
      total: (acc.total ?? acc.input + acc.output) + (next.total ?? next.input + next.output),
      cost: (acc.cost ?? 0) + (next.cost ?? 0),
    };
  }
  return acc;
}

/**
 * One normalized observation for a distinct OpenCode assistant message.
 * Multi-agent children pass `kind: 'subagent'`; the single-session path omits kind.
 */
export function assistantInfoToUsageEntry(
  info: Record<string, unknown>,
  options?: { kind?: 'subagent' }
): ModelUsageEntry | undefined {
  const providerRaw = typeof info.providerID === 'string' ? info.providerID.trim() : '';
  if (providerRaw.length === 0) return undefined;

  const modelRaw = typeof info.modelID === 'string' ? info.modelID.trim() : '';
  const tokens = isRecord(info.tokens) ? info.tokens : undefined;
  const cache = tokens && isRecord(tokens.cache) ? tokens.cache : undefined;

  const entry: ModelUsageEntry = {
    provider: providerRaw,
    model: modelRaw.length > 0 ? modelRaw : null,
    modelSource: modelRaw.length > 0 ? 'reported' : 'unknown',
  };

  if (typeof tokens?.input === 'number') entry.inputTokens = tokens.input;
  if (typeof tokens?.output === 'number') entry.outputTokens = tokens.output;
  if (typeof tokens?.reasoning === 'number') entry.reasoningTokens = tokens.reasoning;
  if (typeof cache?.read === 'number') entry.cacheReadTokens = cache.read;
  if (typeof cache?.write === 'number') entry.cacheWriteTokens = cache.write;
  if (typeof info.cost === 'number') entry.costUsd = info.cost;
  entry.requests = 1;
  if (options?.kind) entry.kind = options.kind;

  return entry;
}

export function usageBreakdownFromAssistantInfos(
  infos: readonly Record<string, unknown>[],
  options?: { kind?: 'subagent' }
): UsageBreakdown | undefined {
  const entries = infos
    .map(info => assistantInfoToUsageEntry(info, options))
    .filter((entry): entry is ModelUsageEntry => entry !== undefined);
  if (entries.length === 0) return undefined;
  const breakdown = toUsageBreakdown(entries);
  return breakdown.length > 0 ? breakdown : undefined;
}
