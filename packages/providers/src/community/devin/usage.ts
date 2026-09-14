import type { Usage } from '@agentclientprotocol/sdk';

import type { ModelUsageEntry, UsageBreakdown } from '../../types';

/**
 * Map ACP PromptResponse.usage (per prompt turn) to one usage row. Cost is
 * never derived: Devin bills in ACUs through its own account, not per token.
 */
export function devinPromptUsageToBreakdown(
  usage: Usage | null | undefined,
  model: string | undefined
): UsageBreakdown | undefined {
  if (usage === null || usage === undefined) return undefined;
  const entry: ModelUsageEntry = {
    provider: 'devin',
    model: model ?? null,
    modelSource: model !== undefined ? 'reported' : 'unknown',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
  if (typeof usage.thoughtTokens === 'number') entry.reasoningTokens = usage.thoughtTokens;
  if (typeof usage.cachedReadTokens === 'number') entry.cacheReadTokens = usage.cachedReadTokens;
  if (typeof usage.cachedWriteTokens === 'number') entry.cacheWriteTokens = usage.cachedWriteTokens;
  return [entry];
}
