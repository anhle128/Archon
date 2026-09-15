import { describe, expect, test } from 'bun:test';
import type {
  MessageResponse,
  PendingInteraction,
  WorkflowEventResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';

import { buildChatTimeline, type ChatTimelineEntry } from './build-chat-timeline';
import type { LogRow } from './build-log-rows';
import type { NodeBodyKind } from './resolve-room-kind';

const message = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
  id: 'message-1',
  conversation_id: 'parent-1',
  role: 'user',
  content: 'Ship it',
  metadata: '{}',
  user_id: 'user-1',
  created_at: '2026-09-06T00:00:00.000Z',
  ...overrides,
});

const event = (overrides: Partial<WorkflowEventResponse> = {}): WorkflowEventResponse => ({
  id: 'event-1',
  workflow_run_id: 'run-1',
  event_type: 'node_started',
  step_index: null,
  step_name: 'review',
  data: {},
  created_at: '2026-09-06T00:00:01.000Z',
  ...overrides,
});

const nodeState = (
  overrides: Partial<WorkflowNodeStateResponse> = {}
): WorkflowNodeStateResponse => ({
  nodeId: 'review',
  name: 'Review',
  status: 'running',
  retryEpoch: 0,
  ...overrides,
});

const build = (input: Partial<Parameters<typeof buildChatTimeline>[0]> = {}): ChatTimelineEntry[] =>
  buildChatTimeline({
    messages: [],
    events: [],
    nodeStates: [nodeState()],
    resolveNodeType: (): NodeBodyKind => 'command',
    ...input,
  });

describe('buildChatTimeline', () => {
  test('empty messages and events yield an empty timeline', () => {
    expect(build()).toEqual([]);
  });

  test('only user messages become user entries in input order when timestamps match', () => {
    const stamp = '2026-09-06T00:00:00.000Z';
    expect(
      build({
        messages: [
          message({ id: 'user-a', content: 'First', created_at: stamp }),
          message({ id: 'user-b', content: 'Second', created_at: stamp }),
        ],
      })
    ).toEqual([
      { kind: 'user', id: 'user-a', createdAt: stamp, content: 'First' },
      { kind: 'user', id: 'user-b', createdAt: stamp, content: 'Second' },
    ]);
  });

  test('omits assistant messages even when they sit between user messages', () => {
    expect(
      build({
        messages: [
          message({ id: 'user-a', content: 'First' }),
          message({ id: 'assistant-1', role: 'assistant', content: 'Working' }),
          message({ id: 'user-b', content: 'Second' }),
        ],
      })
    ).toMatchObject([
      { kind: 'user', id: 'user-a', content: 'First' },
      { kind: 'user', id: 'user-b', content: 'Second' },
    ]);
  });

  test('omits a user message whose content is only whitespace', () => {
    expect(build({ messages: [message({ id: 'blank', content: '   ' })] })).toEqual([]);
  });

  test('maps lifecycle events to node-status entries', () => {
    expect(
      build({
        events: [
          event({ id: 'started', event_type: 'node_started' }),
          event({ id: 'completed', event_type: 'node_completed' }),
          event({ id: 'failed', event_type: 'node_failed' }),
          event({ id: 'skipped', event_type: 'node_skipped' }),
          event({ id: 'skipped-prior', event_type: 'node_skipped_prior_success' }),
          event({ id: 'gate', event_type: 'approval_requested' }),
        ],
      })
    ).toMatchObject([
      {
        kind: 'node_status',
        id: 'started',
        nodeId: 'review',
        status: 'running',
        detail: 'started',
        selection: { kind: 'node' },
      },
      {
        kind: 'node_status',
        id: 'completed',
        status: 'completed',
        detail: 'completed',
        selection: { kind: 'node' },
      },
      {
        kind: 'node_status',
        id: 'failed',
        status: 'failed',
        detail: 'failed',
        selection: { kind: 'node' },
      },
      {
        kind: 'node_status',
        id: 'skipped',
        status: 'skipped',
        detail: 'skipped',
        selection: { kind: 'node' },
      },
      {
        kind: 'node_status',
        id: 'skipped-prior',
        status: 'skipped',
        detail: 'skipped',
        selection: { kind: 'node' },
      },
      {
        kind: 'node_status',
        id: 'gate',
        status: 'running',
        detail: 'gate requested',
        selection: { kind: 'node' },
      },
    ]);
  });

  test('maps a loop-iteration triple with iteration 2', () => {
    expect(
      build({
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review' })],
        events: [
          event({
            id: 'loop-start',
            event_type: 'loop_iteration_started',
            data: { iteration: 2 },
          }),
          event({
            id: 'loop-done',
            event_type: 'loop_iteration_completed',
            data: { iteration: 2 },
          }),
          event({
            id: 'loop-fail',
            event_type: 'loop_iteration_failed',
            data: { iteration: 2 },
          }),
        ],
      })
    ).toMatchObject([
      {
        kind: 'node_status',
        id: 'loop-start',
        label: 'Review ×2',
        status: 'running',
        detail: 'iteration 2 started',
        selection: { kind: 'loop_iteration', iteration: 2 },
      },
      {
        kind: 'node_status',
        id: 'loop-done',
        label: 'Review ×2',
        status: 'completed',
        detail: 'iteration 2 completed',
        selection: { kind: 'loop_iteration', iteration: 2 },
      },
      {
        kind: 'node_status',
        id: 'loop-fail',
        label: 'Review ×2',
        status: 'failed',
        detail: 'iteration 2 failed',
        selection: { kind: 'loop_iteration', iteration: 2 },
      },
    ]);
  });

  test('maps a routed event with execution_seq 4', () => {
    expect(
      build({
        events: [
          event({
            id: 'routed',
            event_type: 'node_routed',
            data: { execution_seq: 4, outcome: 'negative', to: 'fix' },
          }),
        ],
      })
    ).toMatchObject([
      {
        kind: 'node_status',
        id: 'routed',
        label: 'Review #4',
        status: 'completed',
        detail: 'routed negative → fix',
        selection: { kind: 'route_iteration', executionSeq: 4 },
      },
    ]);
  });

  test('falls back when node_routed is missing execution_seq or route fields', () => {
    expect(
      build({
        events: [event({ id: 'routed-unknown', event_type: 'node_routed', data: {} })],
      })
    ).toMatchObject([
      {
        kind: 'node_status',
        id: 'routed-unknown',
        label: 'Review',
        status: 'completed',
        detail: 'routed unknown → unknown',
        selection: { kind: 'node' },
      },
    ]);
  });

  test('omits tool, artifact, and Ask/HITL trigger rows', () => {
    expect(
      build({
        events: [
          event({ id: 'tool', event_type: 'tool_called' }),
          event({ id: 'tool-done', event_type: 'tool_completed' }),
          event({ id: 'artifact', event_type: 'workflow_artifact' }),
          event({ id: 'ask', event_type: 'node_awaiting' }),
          event({ id: 'resolved', event_type: 'interaction_resolved' }),
          event({ id: 'other', event_type: 'usage_recorded' }),
        ],
      })
    ).toEqual([]);
  });

  test('uses data.nodeId when step_name is empty', () => {
    expect(
      build({
        events: [event({ id: 'via-data', step_name: '', data: { nodeId: 'review' } })],
      })
    ).toMatchObject([{ kind: 'node_status', id: 'via-data', nodeId: 'review' }]);
  });

  test('omits an event with neither step_name nor data.nodeId', () => {
    expect(build({ events: [event({ id: 'orphan', step_name: null, data: {} })] })).toEqual([]);
  });

  test('omits a loop-iteration event with iteration 0', () => {
    expect(
      build({
        events: [
          event({
            id: 'loop-zero',
            event_type: 'loop_iteration_started',
            data: { iteration: 0 },
          }),
        ],
      })
    ).toEqual([]);
  });

  test('prefers nodeStates name over the raw node id', () => {
    expect(
      build({
        nodeStates: [nodeState({ nodeId: 'review', name: 'Human Review' })],
        events: [event({ id: 'named' }), event({ id: 'raw', step_name: 'orphan' })],
      })
    ).toMatchObject([
      { id: 'named', label: 'Human Review' },
      { id: 'raw', label: 'orphan' },
    ]);
  });

  test('copies resolveNodeType onto node-status entries and never calls it for users', () => {
    const calls: string[] = [];
    const resolveNodeType = (nodeId: string): NodeBodyKind => {
      calls.push(nodeId);
      return 'bash';
    };

    const withNode = build({
      messages: [message()],
      events: [event()],
      resolveNodeType,
    });
    expect(calls).toEqual(['review']);
    expect(withNode).toMatchObject([
      { kind: 'user', id: 'message-1' },
      { kind: 'node_status', id: 'event-1', nodeType: 'bash' },
    ]);

    calls.length = 0;
    build({ messages: [message()], events: [], resolveNodeType });
    expect(calls).toEqual([]);
  });

  test('merges user turns before node status at an equal timestamp', () => {
    expect(
      build({ messages: [message()], events: [event({ created_at: message().created_at })] })
    ).toMatchObject([
      { kind: 'user', id: 'message-1', content: 'Ship it' },
      {
        kind: 'node_status',
        id: 'event-1',
        nodeId: 'review',
        label: 'Review',
        nodeType: 'command',
        status: 'running',
        detail: 'started',
        selection: { kind: 'node' },
      },
    ]);
  });

  test('sorts a later timestamp after an earlier timestamp regardless of array order', () => {
    expect(
      build({
        events: [
          event({ id: 'later', created_at: '2026-09-06T00:00:05.000Z' }),
          event({ id: 'earlier', created_at: '2026-09-06T00:00:01.000Z' }),
        ],
      })
    ).toMatchObject([{ id: 'earlier' }, { id: 'later' }]);
  });

  test('invalid timestamps sort as epoch zero and retain kind/encounter tie breaks', () => {
    expect(
      build({
        messages: [
          message({ id: 'user-a', created_at: 'not-a-date' }),
          message({ id: 'user-b', created_at: 'also-invalid' }),
        ],
        events: [
          event({ id: 'event-a', created_at: 'nope' }),
          event({ id: 'event-b', created_at: '2026-09-06T00:00:02.000Z' }),
        ],
      })
    ).toMatchObject([
      { kind: 'user', id: 'user-a' },
      { kind: 'user', id: 'user-b' },
      { kind: 'node_status', id: 'event-a' },
      { kind: 'node_status', id: 'event-b' },
    ]);
  });

  test('never emits awaiting status or detail', () => {
    const entries = build({
      messages: [message()],
      events: [
        event({ id: 'started', event_type: 'node_started' }),
        event({ id: 'ask', event_type: 'node_awaiting' }),
        event({ id: 'resolved', event_type: 'interaction_resolved' }),
        event({ id: 'gate', event_type: 'approval_requested' }),
      ],
    });

    const nodeEntries = entries.filter(entry => entry.kind === 'node_status');
    const statuses: string[] = nodeEntries.map(entry => entry.status);
    const details: string[] = nodeEntries.map(entry => entry.detail);
    expect(statuses.includes('awaiting')).toBe(false);
    expect(details.some(detail => detail.includes('awaiting'))).toBe(false);
    expect(entries.map(entry => entry.id)).toEqual(['message-1', 'started', 'gate']);
  });
});

const OCC_1 = '11111111-1111-4111-8111-111111111111';
const OCC_2 = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNSCOPED_LIMITATION = 'Execution scope was not recorded for this interaction.';

function occurrenceRow(id: string, occurrenceId: string, attemptId: string, order: number): LogRow {
  return {
    id,
    nodeId: 'review',
    label: 'Review',
    status: 'completed',
    order,
    sourceIndex: order,
    selection: { kind: 'occurrence', occurrenceId, attemptId },
  };
}

function pendingAsk(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-ask',
    kind: 'ask',
    status: 'pending',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: '2026-09-06T00:00:02.000Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('buildChatTimeline Ask and gate placement', () => {
  const first = occurrenceRow('row-1', OCC_1, ATTEMPT_1, 0);
  const second = occurrenceRow('row-2', OCC_2, ATTEMPT_2, 1);
  const startFirst = event({
    id: 'start-1',
    created_at: '2026-09-06T00:00:01.000Z',
  });
  const startSecond = event({
    id: 'start-2',
    created_at: '2026-09-06T00:00:02.000Z',
  });

  test('places a scoped Ask after only the matching occurrence', () => {
    const entries = build({
      events: [startFirst, startSecond],
      rows: [first, second],
      pendingInteractions: [
        pendingAsk({
          execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
        }),
      ],
    });
    const kinds = entries.map(entry => entry.kind);
    expect(kinds.filter(kind => kind === 'ask')).toEqual(['ask']);
    const ask = entries.find(entry => entry.kind === 'ask');
    if (ask === undefined || ask.kind !== 'ask') throw new Error('missing ask');
    expect(ask.rowId).toBe('row-2');
    expect(ask.scopeLimitation).toBeNull();
    expect(entries.indexOf(ask)).toBeGreaterThan(
      entries.findIndex(entry => entry.kind === 'node_status' && entry.id === 'start-2')
    );
    expect(entries.some(entry => entry.kind === 'ask' && entry.rowId === 'row-1')).toBe(false);
  });

  test('anchors a scoped Ask to its start when completion events are interleaved', () => {
    const scopedStartFirst = event({
      id: 'scoped-start-1',
      created_at: '2026-09-06T00:00:01.000Z',
      data: { occurrence_id: OCC_1, attempt_id: ATTEMPT_1 },
    });
    const scopedCompleteFirst = event({
      id: 'scoped-complete-1',
      event_type: 'node_completed',
      created_at: '2026-09-06T00:00:01.500Z',
      data: { occurrence_id: OCC_1, attempt_id: ATTEMPT_1 },
    });
    const scopedStartSecond = event({
      id: 'scoped-start-2',
      created_at: '2026-09-06T00:00:02.000Z',
      data: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
    });
    const scopedCompleteSecond = event({
      id: 'scoped-complete-2',
      event_type: 'node_completed',
      created_at: '2026-09-06T00:00:02.500Z',
      data: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
    });
    const entries = build({
      events: [scopedStartFirst, scopedCompleteFirst, scopedStartSecond, scopedCompleteSecond],
      rows: [first, second],
      pendingInteractions: [
        pendingAsk({
          execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
        }),
      ],
    });
    const ask = entries.find(entry => entry.kind === 'ask');
    if (ask === undefined || ask.kind !== 'ask') throw new Error('missing ask');
    expect(entries.indexOf(ask)).toBeGreaterThan(
      entries.findIndex(entry => entry.kind === 'node_status' && entry.id === 'scoped-start-2')
    );
    expect(entries.indexOf(ask)).toBeLessThan(
      entries.findIndex(entry => entry.kind === 'node_status' && entry.id === 'scoped-complete-2')
    );
  });

  test('places an unscoped Ask after the latest execution with a limitation', () => {
    const entries = build({
      events: [startFirst, startSecond],
      rows: [first, second],
      pendingInteractions: [pendingAsk()],
    });
    const ask = entries.find(entry => entry.kind === 'ask');
    if (ask === undefined || ask.kind !== 'ask') throw new Error('missing ask');
    expect(ask.rowId).toBe('row-2');
    expect(ask.scopeLimitation).toBe(UNSCOPED_LIMITATION);
    expect(entries.filter(entry => entry.kind === 'ask')).toHaveLength(1);
  });

  test('places an unscoped approval gate after the greatest-order row', () => {
    const entries = build({
      events: [startFirst, startSecond],
      rows: [first, second],
      approval: { nodeId: 'review', message: 'Approve the change', type: 'approval' },
    });
    const gate = entries.find(entry => entry.kind === 'gate');
    if (gate === undefined || gate.kind !== 'gate') throw new Error('missing gate');
    expect(gate.rowId).toBe('row-2');
    expect(gate.nodeId).toBe('review');
    expect(gate.scopeLimitation).toBe(UNSCOPED_LIMITATION);
    expect(entries.filter(entry => entry.kind === 'gate')).toHaveLength(1);
  });

  test('keeps ordinary user and node-status ordering unchanged', () => {
    const entries = build({
      messages: [message()],
      events: [event({ created_at: message().created_at })],
      rows: [first],
    });
    expect(entries.map(entry => [entry.kind, entry.id])).toEqual([
      ['user', 'message-1'],
      ['node_status', 'event-1'],
    ]);
  });
});
