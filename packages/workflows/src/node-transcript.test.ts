/**
 * Awaited fail-open transcript append boundary.
 *
 * Own `bun test` shard: mock.module('@archon/paths') must not leak.
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { AppendNodeMessageInput, NodeMessage } from './schemas/node-message';
import type { IWorkflowNodeMessageStore } from './store';

const errorCalls: unknown[] = [];

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    fatal() {},
    error(...args: unknown[]) {
      errorCalls.push(args);
    },
    warn() {},
    info() {},
    debug() {},
    trace() {},
  }),
}));

const { appendNodeTranscript, appendToolResultTranscript } = await import('./node-transcript');

beforeEach(() => {
  errorCalls.length = 0;
});

function collectingStore(received: AppendNodeMessageInput[]): IWorkflowNodeMessageStore {
  return {
    appendNodeMessage: async (input: AppendNodeMessageInput): Promise<NodeMessage> => {
      received.push(input);
      return { ...input, id: 'message-1', seq: 1, created_at: new Date() };
    },
    listNodeMessages: async () => [],
  };
}

test('awaits and forwards one append', async () => {
  const received: AppendNodeMessageInput[] = [];
  await appendNodeTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    kind: 'text',
    payload: { text: 'hello' },
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'text',
      payload: { text: 'hello' },
    },
  ]);
  expect(errorCalls).toEqual([]);
});

test('fails open and excludes the payload from logs', async () => {
  const rejectingStore: IWorkflowNodeMessageStore = {
    appendNodeMessage: async () => {
      throw new Error('DO_NOT_LOG');
    },
    listNodeMessages: async () => [],
  };
  await expect(
    appendNodeTranscript(rejectingStore, {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', input: { secret: 'DO_NOT_LOG' } },
    })
  ).resolves.toBeUndefined();
  expect(errorCalls).toHaveLength(1);
  const logged = errorCalls[0] as unknown[];
  expect(logged[0]).toEqual({
    workflowRunId: 'run-1',
    nodeId: 'review',
    kind: 'tool',
    errorType: 'Error',
  });
  expect(logged[1]).toBe('workflow.node_message_append_failed');
  expect(JSON.stringify(errorCalls)).not.toContain('DO_NOT_LOG');
});

test('appends a second tool row with output and the same call id', async () => {
  const received: AppendNodeMessageInput[] = [];
  await appendToolResultTranscript(collectingStore(received), {
    workflow_run_id: 'run-1',
    node_id: 'review',
    name: 'Read',
    id: 'tool-1',
    output: 'HITL_TOOL_OUTPUT_VISIBLE',
  });
  expect(received).toEqual([
    {
      workflow_run_id: 'run-1',
      node_id: 'review',
      kind: 'tool',
      payload: { name: 'Read', id: 'tool-1', output: 'HITL_TOOL_OUTPUT_VISIBLE' },
    },
  ]);
});
