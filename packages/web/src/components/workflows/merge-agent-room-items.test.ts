import { describe, expect, test } from 'bun:test';

import type { PendingInteraction, WorkflowNodeMessageResponse } from '@/lib/api';

import { mergeAgentRoomItems, selectVisibleNodeAskInteractions } from './merge-agent-room-items';

const CREATED_AT = '2026-09-06T00:00:00.000Z';

function interaction(
  overrides: Pick<PendingInteraction, 'id' | 'node_id' | 'tool_use_id' | 'kind' | 'status'>
): PendingInteraction {
  return {
    workflow_run_id: 'run-1',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function textMessage(id: string, seq: number, text: string): WorkflowNodeMessageResponse {
  return { id, seq, kind: 'text', payload: { text }, created_at: CREATED_AT };
}

function toolMessage(id: string, seq: number, toolId: string): WorkflowNodeMessageResponse {
  return {
    id,
    seq,
    kind: 'tool',
    payload: { name: 'AskHuman', id: toolId },
    created_at: CREATED_AT,
  };
}

function statusMessage(
  id: string,
  seq: number,
  state: 'iteration_started' | 'iteration_completed',
  detail: string
): WorkflowNodeMessageResponse {
  return { id, seq, kind: 'status', payload: { state, detail }, created_at: CREATED_AT };
}

const ITER1_START = statusMessage('m1', 1, 'iteration_started', '1');
const ITER1_TOOL = toolMessage('m2', 2, 'tool-iter-1');
const ITER1_END = statusMessage('m3', 3, 'iteration_completed', '1');
const ITER2_START = statusMessage('m4', 4, 'iteration_started', '2');
const ITER2_TOOL = toolMessage('m5', 5, 'tool-iter-2');
const TAIL_TEXT = textMessage('m6', 6, 'tail');

const FULL_TRANSCRIPT: readonly WorkflowNodeMessageResponse[] = [
  ITER1_START,
  ITER1_TOOL,
  ITER1_END,
  ITER2_START,
  ITER2_TOOL,
  TAIL_TEXT,
];

const ITER1_VISIBLE: readonly WorkflowNodeMessageResponse[] = [ITER1_START, ITER1_TOOL, ITER1_END];
const CURRENT_VISIBLE: readonly WorkflowNodeMessageResponse[] = [
  ITER2_START,
  ITER2_TOOL,
  TAIL_TEXT,
];

const ASK_NODE_A_PENDING = interaction({
  id: 'ask-a-pending',
  node_id: 'review',
  tool_use_id: 'tool-a',
  kind: 'ask',
  status: 'pending',
});
const PERMISSION_NODE_A = interaction({
  id: 'perm-a',
  node_id: 'review',
  tool_use_id: 'tool-perm',
  kind: 'permission',
  status: 'pending',
});
const ASK_NODE_B_PENDING = interaction({
  id: 'ask-b-pending',
  node_id: 'other',
  tool_use_id: 'tool-b',
  kind: 'ask',
  status: 'pending',
});
const ASK_NODE_A_ANSWERED = interaction({
  id: 'ask-a-answered',
  node_id: 'review',
  tool_use_id: 'tool-a-answered',
  kind: 'ask',
  status: 'answered',
});
const ASK_NODE_A_PURGED = interaction({
  id: 'ask-a-purged',
  node_id: 'review',
  tool_use_id: 'tool-a-purged',
  kind: 'ask',
  status: 'purged',
});

describe('selectVisibleNodeAskInteractions', () => {
  test('selects renderable Asks for one node', () => {
    const selected = selectVisibleNodeAskInteractions({
      pending: [
        ASK_NODE_A_PENDING,
        PERMISSION_NODE_A,
        ASK_NODE_B_PENDING,
        ASK_NODE_A_ANSWERED,
        ASK_NODE_A_PURGED,
      ],
      nodeId: 'review',
      selection: { kind: 'node' },
      allMessages: [],
      visibleMessages: [],
      ownsUnscopedInteractions: true,
    });

    expect(selected.map(row => row.id)).toEqual(['ask-a-pending', 'ask-a-answered']);
  });

  test('keeps a scoped Ask out of a different occurrence room', () => {
    const scoped = interaction({
      id: 'ask-scoped',
      node_id: 'review',
      tool_use_id: 'tool-missing',
      kind: 'ask',
      status: 'pending',
    });
    scoped.execution_scope = {
      occurrence_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const selected = selectVisibleNodeAskInteractions({
      pending: [scoped],
      nodeId: 'review',
      selection: {
        kind: 'occurrence',
        occurrenceId: '22222222-2222-4222-8222-222222222222',
        attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      allMessages: [],
      visibleMessages: [],
      ownsUnscopedInteractions: true,
    });
    expect(selected).toEqual([]);
  });

  test('keeps Asks inside the selected loop slice', () => {
    const anchoredIter1 = interaction({
      id: 'ask-iter-1',
      node_id: 'review',
      tool_use_id: 'tool-iter-1',
      kind: 'ask',
      status: 'pending',
    });
    const anchoredIter2 = interaction({
      id: 'ask-iter-2',
      node_id: 'review',
      tool_use_id: 'tool-iter-2',
      kind: 'ask',
      status: 'answered',
    });
    const unanchored = interaction({
      id: 'ask-unanchored',
      node_id: 'review',
      tool_use_id: 'tool-missing',
      kind: 'ask',
      status: 'pending',
    });
    const pending = [anchoredIter1, anchoredIter2, unanchored];

    const historical = selectVisibleNodeAskInteractions({
      pending,
      nodeId: 'review',
      selection: { kind: 'node' },
      allMessages: FULL_TRANSCRIPT,
      visibleMessages: ITER1_VISIBLE,
      ownsUnscopedInteractions: true,
    });
    expect(historical.map(row => row.id)).toEqual(['ask-iter-1']);

    const current = selectVisibleNodeAskInteractions({
      pending,
      nodeId: 'review',
      selection: { kind: 'node' },
      allMessages: FULL_TRANSCRIPT,
      visibleMessages: CURRENT_VISIBLE,
      ownsUnscopedInteractions: true,
    });
    expect(current.map(row => row.id)).toEqual(['ask-iter-2', 'ask-unanchored']);
  });

  test('assigns an unscoped Ask only to the latest execution when pages are scope-filtered', () => {
    const scopedPage = [toolMessage('m1', 1, 'tool-a')];
    const common = {
      pending: [ASK_NODE_A_PENDING],
      nodeId: 'review',
      selection: {
        kind: 'occurrence' as const,
        occurrenceId: '11111111-1111-4111-8111-111111111111',
        attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      allMessages: scopedPage,
      visibleMessages: scopedPage,
    };

    expect(
      selectVisibleNodeAskInteractions({
        ...common,
        ownsUnscopedInteractions: false,
      })
    ).toEqual([]);
    expect(
      selectVisibleNodeAskInteractions({
        ...common,
        ownsUnscopedInteractions: true,
      }).map(row => row.id)
    ).toEqual(['ask-a-pending']);
  });
});

describe('mergeAgentRoomItems', () => {
  test('interleaves Ask cards in stable order', () => {
    const text = textMessage('m1', 1, 'hello');
    const tool = toolMessage('m2', 2, 'shared-tool');
    const firstShared = interaction({
      id: 'a1',
      node_id: 'review',
      tool_use_id: 'shared-tool',
      kind: 'ask',
      status: 'pending',
    });
    const secondShared = interaction({
      id: 'a2',
      node_id: 'review',
      tool_use_id: 'shared-tool',
      kind: 'ask',
      status: 'answered',
    });
    const unanchored = interaction({
      id: 'u1',
      node_id: 'review',
      tool_use_id: 'missing-tool',
      kind: 'ask',
      status: 'pending',
    });

    const merged = mergeAgentRoomItems([tool, text], [firstShared, secondShared, unanchored]);
    expect(merged.map(item => `${item.kind}:${item.id}`)).toEqual([
      'message:m1',
      'message:m2',
      'ask:ask:a1',
      'ask:ask:a2',
      'ask:ask:u1',
    ]);
    expect(merged[2]).toMatchObject({ kind: 'ask', interaction: firstShared });
    expect(merged[3]).toMatchObject({ kind: 'ask', interaction: secondShared });
    expect(merged[4]).toMatchObject({ kind: 'ask', interaction: unanchored });
  });
});
