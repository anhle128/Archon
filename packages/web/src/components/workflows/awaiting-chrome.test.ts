import { describe, expect, test } from 'bun:test';

import type { PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';

import {
  countPendingAsks,
  firstAwaitingNodeId,
  firstPendingAskAwaitingInteraction,
  isAskAwaitingRun,
  isAskHumanUnsupportedError,
  nodeStatusLabel,
} from './awaiting-chrome';

const CREATED_AT = '2026-09-07T12:00:00.000Z';

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-a',
    kind: 'ask',
    status: 'pending',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function node(
  overrides: Partial<WorkflowNodeStateResponse> &
    Pick<WorkflowNodeStateResponse, 'nodeId' | 'status'>
): WorkflowNodeStateResponse {
  return {
    name: overrides.nodeId,
    retryEpoch: 0,
    ...overrides,
  };
}

describe('awaiting chrome helpers', () => {
  test('counts only pending Ask rows and derives awaiting from paused plus count', () => {
    const pendingAsk = interaction();
    const secondAsk = interaction({ id: 'ask-2', tool_use_id: 'tool-b', node_id: 'ship' });
    const permission = interaction({
      id: 'perm-1',
      kind: 'permission',
      tool_use_id: 'tool-p',
    });
    const answered = interaction({ id: 'ask-3', status: 'answered', tool_use_id: 'tool-c' });
    const purged = interaction({ id: 'ask-4', status: 'purged', tool_use_id: 'tool-d' });

    expect(countPendingAsks([permission, answered, purged])).toBe(0);
    expect(countPendingAsks([pendingAsk, permission, answered, purged, secondAsk])).toBe(2);
    expect(isAskAwaitingRun('paused', [pendingAsk, secondAsk])).toBe(true);
    expect(isAskAwaitingRun('paused', [permission])).toBe(false);
    expect(isAskAwaitingRun('paused', [])).toBe(false);
    expect(isAskAwaitingRun('running', [pendingAsk])).toBe(false);
    expect(isAskAwaitingRun('failed', [pendingAsk])).toBe(false);
  });

  test('first awaiting node uses input order and CAP-7 matching is an exact prefix', () => {
    expect(
      firstAwaitingNodeId([
        node({ nodeId: 'setup', status: 'completed' }),
        node({ nodeId: 'review', status: 'awaiting' }),
        node({ nodeId: 'ship', status: 'awaiting' }),
      ])
    ).toBe('review');
    expect(firstAwaitingNodeId([node({ nodeId: 'setup', status: 'running' })])).toBeNull();

    expect(isAskHumanUnsupportedError('AskHuman is not supported by provider')).toBe(true);
    expect(isAskHumanUnsupportedError('AskHuman is not supported by provider: grok')).toBe(true);
    expect(isAskHumanUnsupportedError('Could not resume the AskHuman session')).toBe(false);
    expect(isAskHumanUnsupportedError('')).toBe(false);
    expect(isAskHumanUnsupportedError(null)).toBe(false);
    expect(isAskHumanUnsupportedError(undefined)).toBe(false);

    expect(nodeStatusLabel('awaiting')).toBe('waiting on you');
    expect(nodeStatusLabel('running')).toBe('running');
    expect(nodeStatusLabel('failed')).toBe('failed');
  });

  test('selects a pending Ask instead of an earlier permission awaiting node', () => {
    const permission = interaction({
      id: 'permission',
      node_id: 'approve',
      tool_use_id: 'tool-permission',
      kind: 'permission',
    });
    const pendingAsk = interaction({ node_id: 'review' });
    expect(
      firstPendingAskAwaitingInteraction({
        pending: [permission, pendingAsk],
        nodes: [
          node({ nodeId: 'approve', status: 'awaiting' }),
          node({ nodeId: 'review', status: 'awaiting' }),
        ],
      })
    ).toBe(pendingAsk);
  });
});
