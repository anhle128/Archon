import { describe, expect, test } from 'bun:test';
import { pendingInteractionSchema } from './pending-interaction';

const valid = {
  id: 'pending-1',
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'tool-1',
  kind: 'ask',
  status: 'pending',
  envelope: { questions: [] },
  answer: null,
  provider_session_id: 'session-1',
  created_at: '2026-09-06T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

describe('pendingInteractionSchema', () => {
  test('accepts the adopted empty-embed row contract', () => {
    expect(pendingInteractionSchema.parse(valid)).toEqual(valid);
  });

  test('rejects forked kind and status values', () => {
    expect(pendingInteractionSchema.safeParse({ ...valid, kind: 'question' }).success).toBe(false);
    expect(pendingInteractionSchema.safeParse({ ...valid, status: 'open' }).success).toBe(false);
  });
});
