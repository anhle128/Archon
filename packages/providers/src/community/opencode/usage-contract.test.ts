import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assistantInfoToUsageEntry } from './tokens';

/**
 * Contract test: anchors the OpenCode usage parser to a REAL message shape.
 *
 * `real-opencode-message.json` is an assistant message captured verbatim from
 * OpenCode's on-disk store (~/.local/share/opencode/storage/message/…). Only the
 * ids/paths are redacted; `providerID`, `modelID`, `tokens`, and `cost` are as
 * OpenCode wrote them. OpenCode's embedded server hands the parser an untyped
 * `Record<string, unknown>`, so a recorded fixture (not a type) is the anchor:
 * if OpenCode moves `cost`, renames `tokens.cache.read`, etc., this test breaks
 * where an invented fixture would stay green. OpenCode reports USD in `cost`.
 *
 * To refresh after an OpenCode upgrade: re-capture an assistant message, redact
 * the ids/paths, and update the fixture + expected numbers.
 */

function loadRealInfo(): Record<string, unknown> {
  const raw = readFileSync(
    join(import.meta.dir, '__fixtures__', 'real-opencode-message.json'),
    'utf8'
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('OpenCode usage contract (real message shape)', () => {
  test('parser maps a real OpenCode assistant message onto the expected ModelUsageEntry', () => {
    const entry = assistantInfoToUsageEntry(loadRealInfo());
    expect(entry).toBeDefined();
    if (!entry) throw new Error('parser produced no entry for a real OpenCode assistant message');

    expect(entry.provider).toBe('openai');
    expect(entry.model).toBe('gpt-5.2-chat-latest');
    expect(entry.modelSource).toBe('reported');

    expect(entry.inputTokens).toBe(11760);
    expect(entry.outputTokens).toBe(7);
    expect(entry.reasoningTokens).toBe(0);
    expect(entry.cacheReadTokens).toBe(0);
    expect(entry.cacheWriteTokens).toBe(0);

    // Load-bearing: OpenCode reports USD directly on the message `cost`.
    expect(entry.costUsd).toBe(0.020678);
  });
});
