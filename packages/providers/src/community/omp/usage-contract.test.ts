import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageUsageToEntry } from './event-parser';

/**
 * Contract test: anchors the OMP usage parser to a REAL response shape.
 *
 * `real-omp-transcript.jsonl` is one assistant message captured verbatim from an
 * actual OMP session transcript on disk (~/.omp/agent/sessions/…). Only the free
 * text (thinking / text / signatures / ids) is redacted; the structural keys and
 * the `usage`/`cost` object are exactly as OMP wrote them. This is the anchor that
 * keeps the hand-written parser fixtures honest: if OMP's real output shape drifts
 * (a renamed field, cost moved out of `usage.cost.total`, a new nesting), this
 * test breaks where an invented fixture would stay green.
 *
 * To refresh after an OMP upgrade: re-capture a usage-bearing transcript line,
 * redact the prose, and update the fixture + expected numbers below.
 */

interface OmpTranscriptLine {
  type: string;
  message: Record<string, unknown> & { usage: Record<string, unknown> };
}

function loadRealMessage(): OmpTranscriptLine {
  const raw = readFileSync(
    join(import.meta.dir, '__fixtures__', 'real-omp-transcript.jsonl'),
    'utf8'
  )
    .split('\n')
    .filter(Boolean)[0];
  return JSON.parse(raw) as OmpTranscriptLine;
}

describe('OMP usage contract (real transcript shape)', () => {
  test('parser maps a real OMP transcript message to the expected ModelUsageEntry', () => {
    const line = loadRealMessage();
    expect(line.type).toBe('message');

    const entry = messageUsageToEntry(line.message, line.message.usage);
    expect(entry).toBeDefined();
    if (!entry) throw new Error('parser returned no entry for a real usage-bearing message');

    // Identity comes from the message, not fabricated.
    expect(entry.provider).toBe('xai-oauth');
    expect(entry.model).toBe('grok-4.6');
    expect(entry.modelSource).toBe('reported');

    // Token measures map straight from usage.*
    expect(entry.inputTokens).toBe(23494);
    expect(entry.outputTokens).toBe(98);
    expect(entry.cacheReadTokens).toBe(2560);
    expect(entry.cacheWriteTokens).toBe(0);
    expect(entry.reasoningTokens).toBe(92);

    // The load-bearing one: OMP's real cost lives at usage.cost.total, and that
    // is exactly what becomes costUsd (reported → wins over any estimate).
    expect(entry.costUsd).toBe(0.09696);
  });

  test('reasoning never exceeds output in the real sample (ledger schema invariant)', () => {
    const line = loadRealMessage();
    const entry = messageUsageToEntry(line.message, line.message.usage);
    expect(entry?.reasoningTokens).toBeLessThanOrEqual(entry?.outputTokens ?? 0);
  });
});
