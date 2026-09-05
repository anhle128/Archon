import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GrokEventParser } from './event-parser';

/**
 * Contract test: anchors the Grok usage parser to a REAL response shape.
 *
 * `real-grok-end-event.jsonl` is the `end` event captured verbatim from an actual
 * Grok CLI run (`grok --output-format streaming-json …`); only the ids are
 * redacted, the `usage` / `total_cost_usd` / `modelUsage` are exactly as Grok
 * emitted them. Grok is a CLI that streams untyped JSON (no SDK type to assert),
 * so a recorded fixture is the anchor: if Grok renames `total_cost_usd`, moves
 * cost out of `modelUsage`, etc., this test breaks where an invented fixture
 * would stay green. Grok reports USD on the `end` event, so it is a reported-cost
 * path (NOT tokens-only — the standalone `type:"usage"` event carries no cost and
 * is ignored; the parser reads usage + cost from `end`).
 *
 * To refresh after a Grok CLI upgrade: re-capture the streaming-json `end` line,
 * redact the ids, and update the fixture + expected numbers.
 */

function loadRealEndEvent(): string {
  return readFileSync(join(import.meta.dir, '__fixtures__', 'real-grok-end-event.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)[0];
}

describe('Grok usage contract (real end-event shape)', () => {
  test('parser maps a real Grok end event onto the expected ModelUsageEntry', () => {
    const parser = new GrokEventParser('grok-4.5-build');
    parser.consumeLine(loadRealEndEvent());
    const result = parser.buildResult(undefined);

    expect(result.isError).toBeUndefined();
    const entry = result.usageBreakdown?.[0];
    if (!entry) throw new Error('parser produced no usage breakdown for a real Grok end event');

    expect(entry.provider).toBe('xai');
    expect(entry.model).toBe('grok-4.5-build');
    expect(entry.modelSource).toBe('reported');

    expect(entry.inputTokens).toBe(71387);
    expect(entry.outputTokens).toBe(28);

    // Load-bearing: Grok reports USD via end.total_cost_usd (also modelUsage.costUSD).
    expect(entry.costUsd).toBe(0.04860028);
  });
});
