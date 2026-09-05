import { describe, expect, test } from 'bun:test';
import type { ModelUsage } from '@anthropic-ai/claude-agent-sdk';

import { mapClaudeModelUsage } from './provider';

/**
 * Contract test: anchors the Claude usage parser to the SDK's OWN per-model type.
 *
 * Claude reports usage in memory via the SDK result's `modelUsage` record
 * (`Record<string, ModelUsage>`), so the anchor is the type: the fixture below
 * is declared `satisfies ModelUsage`. If the SDK renames `costUSD`,
 * `cacheReadInputTokens`, etc. or reshapes ModelUsage, this stops compiling —
 * the drift an untyped fixture would miss. Claude is the reported-cost path, so
 * the mapping must carry costUSD → costUsd.
 */

// Realistic values from an actual Claude turn (claude-sonnet-5); shape enforced by ModelUsage.
const realModelUsage = {
  inputTokens: 2,
  outputTokens: 4,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 61742,
  costUSD: 0.370518,
  webSearchRequests: 0,
  contextWindow: 200000,
} satisfies ModelUsage;

describe('Claude usage contract (SDK ModelUsage shape)', () => {
  test('parser maps a modelUsage record onto the expected ModelUsageEntry', () => {
    const breakdown = mapClaudeModelUsage({ 'claude-sonnet-5': realModelUsage });
    expect(breakdown).toBeDefined();
    const entry = breakdown?.[0];
    if (!entry) throw new Error('parser produced no usage breakdown for a real modelUsage record');

    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-sonnet-5');
    expect(entry.modelSource).toBe('reported');

    expect(entry.inputTokens).toBe(2);
    expect(entry.outputTokens).toBe(4);
    expect(entry.cacheReadTokens).toBe(0);
    expect(entry.cacheWriteTokens).toBe(61742);

    // Load-bearing: Claude reports USD, mapped from ModelUsage.costUSD.
    expect(entry.costUsd).toBe(0.370518);
  });
});
