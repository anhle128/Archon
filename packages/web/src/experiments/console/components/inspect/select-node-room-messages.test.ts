import { describe, expect, test } from 'bun:test';
import type { WorkflowNodeMessage } from '../../skills/runs';
import { selectNodeRoomMessages } from './select-node-room-messages';

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const ITERATION_TWO_STARTED: WorkflowNodeMessage = {
  id: 'm5',
  seq: 5,
  kind: 'status',
  payload: { state: 'iteration_started', detail: '2' },
  created_at: CREATED_AT,
};

const TOOL_READ: WorkflowNodeMessage = {
  id: 'm6',
  seq: 6,
  kind: 'tool',
  payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
  created_at: CREATED_AT,
};

const FIXTURE: readonly WorkflowNodeMessage[] = [
  { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
  {
    id: 'm2',
    seq: 2,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '1' },
    created_at: CREATED_AT,
  },
  { id: 'm3', seq: 3, kind: 'text', payload: { text: 'first' }, created_at: CREATED_AT },
  {
    id: 'm4',
    seq: 4,
    kind: 'status',
    payload: { state: 'iteration_completed', detail: '1' },
    created_at: CREATED_AT,
  },
  ITERATION_TWO_STARTED,
  TOOL_READ,
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  { id: 'm8', seq: 8, kind: 'status', payload: { state: 'failed' }, created_at: CREATED_AT },
];

function ids(messages: readonly WorkflowNodeMessage[]): string[] {
  return messages.map(message => message.id);
}

describe('selectNodeRoomMessages', () => {
  test('sorts a copy by seq and returns all rows for non-loop selections', () => {
    const reversed = [...FIXTURE].reverse();
    const nodeRows = selectNodeRoomMessages(reversed, { kind: 'node' });
    const routeRows = selectNodeRoomMessages(reversed, {
      kind: 'route_iteration',
      executionSeq: 4,
    });

    expect(ids(nodeRows)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(ids(routeRows)).toEqual(ids(nodeRows));
    expect(ids(reversed)).toEqual(['m8', 'm7', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1']);
  });

  test('selecting a closed loop iteration returns only the marker-bounded rows', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm7']);
  });

  test('a missing iteration start marker returns the full sorted transcript', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 9 });
    expect(ids(sliced)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  });

  test('without a terminal marker, the slice stops before the next iteration start', () => {
    const openIteration: readonly WorkflowNodeMessage[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm9',
        seq: 9,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '3' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openIteration, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6']);
  });

  test('without a terminal or next start marker, the slice continues to the end', () => {
    const openEnd: readonly WorkflowNodeMessage[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm10',
        seq: 10,
        kind: 'text',
        payload: { text: 'still going' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openEnd, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm10']);
  });
});
