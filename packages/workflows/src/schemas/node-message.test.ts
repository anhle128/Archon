import { describe, expect, test } from 'bun:test';
import { appendNodeMessageSchema, nodeMessageSchema } from './node-message';

describe('nodeMessageSchema', () => {
  test('keeps kind and payload correlated', () => {
    const valid = nodeMessageSchema.parse({
      id: 'message-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      seq: 1,
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
      created_at: '2026-09-06T00:00:00.000Z',
    });
    expect(valid.kind).toBe('tool');
    expect(
      nodeMessageSchema.safeParse({
        ...valid,
        kind: 'text',
        payload: { state: 'started' },
      }).success
    ).toBe(false);
  });

  test('rejects invalid row identity and accepts a future status note', () => {
    expect(
      appendNodeMessageSchema.parse({
        workflow_run_id: 'run-1',
        node_id: 'review',
        kind: 'status',
        payload: { state: 'future_note', detail: 'kept extensible' },
      })
    ).toEqual({
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'status',
      payload: { state: 'future_note', detail: 'kept extensible' },
    });
    expect(
      nodeMessageSchema.safeParse({
        id: 'message-1',
        workflow_run_id: 'run-1',
        node_id: '',
        seq: 0,
        kind: 'text',
        payload: { text: 'hello' },
        created_at: new Date(),
      }).success
    ).toBe(false);
  });
});
