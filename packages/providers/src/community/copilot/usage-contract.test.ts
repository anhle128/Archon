import { describe, expect, test } from 'bun:test';
import type { SessionEvent } from '@github/copilot-sdk';

import { mapCopilotUsageEntry } from './event-bridge';

/**
 * Contract test: anchors the Copilot usage parser to the SDK's OWN event type.
 *
 * Copilot reports usage in memory via `@github/copilot-sdk`'s `SessionEvent`
 * (`assistant.usage` variant), so the anchor is the type: the whole event below
 * is declared `satisfies SessionEvent`. If the SDK reshapes the `assistant.usage`
 * event's `data` (renames a token field, changes nesting), this stops compiling.
 * Copilot deliberately treats `data.cost` as a multiplier, not USD, so it is a
 * tokens-only path (no costUsd → estimate fills it downstream).
 */

const realUsageEvent = {
  type: 'assistant.usage',
  data: {
    model: 'claude-sonnet-4',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 50,
    cost: 1,
  },
} satisfies SessionEvent;

describe('Copilot usage contract (SDK SessionEvent shape)', () => {
  test('parser maps an assistant.usage event onto the expected ModelUsageEntry', () => {
    const entry = mapCopilotUsageEntry(realUsageEvent.data);
    expect(entry).toBeDefined();
    if (!entry) throw new Error('parser produced no entry for a real assistant.usage event');

    expect(entry.provider).toBe('github-copilot');
    expect(entry.model).toBe('claude-sonnet-4');
    expect(entry.modelSource).toBe('reported');

    expect(entry.inputTokens).toBe(1000);
    expect(entry.outputTokens).toBe(500);
    expect(entry.cacheReadTokens).toBe(200);
    expect(entry.reasoningTokens).toBe(50);

    // Copilot's data.cost is a request multiplier, never USD → tokens-only.
    expect(entry.costUsd).toBeUndefined();
  });
});
