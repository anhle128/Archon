import { describe, expect, test } from 'bun:test';
import type { PendingInteraction, WorkflowNodeMessage } from '../../skills/runs';
import { selectVisibleNodeAskInteractions } from './select-visible-node-ask-interactions';

const CREATED_AT = '2026-09-07T00:00:00.000Z';

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-1',
    kind: 'ask',
    status: 'pending',
    envelope: { questions: [] },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function message(
  id: string,
  seq: number,
  kind: 'text' | 'tool',
  toolId?: string
): WorkflowNodeMessage {
  return kind === 'tool'
    ? {
        id,
        seq,
        kind,
        payload: { name: 'AskHuman', id: toolId ?? id, input: {} },
        created_at: CREATED_AT,
      }
    : { id, seq, kind, payload: { text: id }, created_at: CREATED_AT };
}

describe('selectVisibleNodeAskInteractions', () => {
  test('keeps only visible pending or answered Ask rows for the selected node', () => {
    const all = [message('m1', 1, 'tool', 'tool-1')];
    const selected = selectVisibleNodeAskInteractions({
      pending: [
        interaction(),
        interaction({ id: 'answered', tool_use_id: 'tool-1', status: 'answered' }),
        interaction({ id: 'purged', tool_use_id: 'tool-1', status: 'purged' }),
        interaction({ id: 'permission', tool_use_id: 'tool-1', kind: 'permission' }),
        interaction({ id: 'other-node', node_id: 'ship', tool_use_id: 'tool-1' }),
      ],
      nodeId: 'review',
      selection: { kind: 'node' },
      allMessages: all,
      visibleMessages: all,
      ownsUnscopedInteractions: true,
    });
    expect(selected.map(item => item.id)).toEqual(['ask-1', 'answered']);
  });

  test('keeps a scoped Ask out of a different occurrence room', () => {
    const scoped = interaction({
      tool_use_id: 'tool-missing',
      execution_scope: {
        occurrence_id: '11111111-1111-4111-8111-111111111111',
        attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });
    expect(
      selectVisibleNodeAskInteractions({
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
      })
    ).toEqual([]);
  });

  test('does not leak an anchored Ask into a different loop slice', () => {
    const first = message('m1', 1, 'tool', 'tool-1');
    const second = message('m2', 2, 'tool', 'tool-2');
    expect(
      selectVisibleNodeAskInteractions({
        pending: [interaction({ tool_use_id: 'tool-1' })],
        nodeId: 'review',
        selection: { kind: 'node' },
        allMessages: [first, second],
        visibleMessages: [second],
        ownsUnscopedInteractions: true,
      })
    ).toEqual([]);
  });

  test('shows an unanchored Ask only when the visible slice reaches the transcript tail', () => {
    const first = message('m1', 1, 'text');
    const last = message('m2', 2, 'text');
    const current = interaction({ tool_use_id: 'tool-missing' });
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        selection: { kind: 'node' },
        allMessages: [first, last],
        visibleMessages: [first],
        ownsUnscopedInteractions: true,
      })
    ).toEqual([]);
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        selection: { kind: 'node' },
        allMessages: [first, last],
        visibleMessages: [last],
        ownsUnscopedInteractions: true,
      }).map(item => item.id)
    ).toEqual(['ask-1']);
    expect(
      selectVisibleNodeAskInteractions({
        pending: [current],
        nodeId: 'review',
        selection: { kind: 'node' },
        allMessages: [],
        visibleMessages: [],
        ownsUnscopedInteractions: true,
      }).map(item => item.id)
    ).toEqual(['ask-1']);
  });

  test('assigns an unscoped Ask only to the latest execution when pages are scope-filtered', () => {
    const scopedPage = [message('m1', 1, 'tool', 'tool-1')];
    const common = {
      pending: [interaction()],
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
      }).map(item => item.id)
    ).toEqual(['ask-1']);
  });
});
