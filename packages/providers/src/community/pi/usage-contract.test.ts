import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';

import { assistantMessageToUsageEntry } from './event-bridge';

/**
 * Contract test: anchors the Pi usage parser to the pi-ai `Usage` type.
 *
 * Pi reports usage in memory on the assistant message (`message.usage: Usage`),
 * so the anchor is the type: the `usage` fixture is declared `satisfies Usage`.
 * If pi-ai reshapes `Usage` (moves `cost.total`, renames a token field), this
 * stops compiling — the drift an untyped fixture would miss. Pi is a
 * reported-cost path, so the mapping must carry usage.cost.total → costUsd.
 */

// Usage shape enforced by the pi-ai type; realistic values.
const realUsage = {
  input: 100,
  output: 50,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 150,
  reasoning: 10,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
} satisfies Usage;

// Only the identity + usage fields matter to the parser; the rest of the
// assistant message is irrelevant to the usage contract, so cast the wrapper.
const realMessage = {
  provider: 'anthropic',
  model: 'anthropic/claude-sonnet-5',
  responseModel: 'claude-sonnet-5',
  usage: realUsage,
} as AssistantMessage;

describe('Pi usage contract (pi-ai Usage shape)', () => {
  test('parser maps an assistant message onto the expected ModelUsageEntry', () => {
    const entry = assistantMessageToUsageEntry(realMessage);
    expect(entry).toBeDefined();
    if (!entry) throw new Error('parser produced no entry for a real Pi assistant message');

    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-sonnet-5');
    expect(entry.modelSource).toBe('reported');

    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.reasoningTokens).toBe(10);

    // Load-bearing: Pi's cost lives at usage.cost.total.
    expect(entry.costUsd).toBe(0.3);
  });
});
