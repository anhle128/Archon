import { describe, expect, test } from 'bun:test';
import type { WorkflowNodeState } from '../../skills/runs';
import type { LogRow } from './build-log-rows';
import {
  readNodeSearchParam,
  resolveInitialInspectSelection,
  selectInspectNode,
} from './console-inspect-selection';

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'> & Partial<WorkflowNodeState>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function row(overrides: Pick<LogRow, 'id' | 'nodeId'> & Partial<LogRow>): LogRow {
  return {
    label: overrides.nodeId,
    status: 'pending',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
    ...overrides,
  };
}

describe('readNodeSearchParam', () => {
  test('reads a non-empty node query and ignores unrelated params', () => {
    expect(readNodeSearchParam('?node=review&view=graph')).toBe('review');
    expect(readNodeSearchParam('node=review%2Fa')).toBe('review/a');
    expect(readNodeSearchParam('?view=log')).toBeNull();
    expect(readNodeSearchParam('?node=')).toBeNull();
    expect(readNodeSearchParam('')).toBeNull();
  });
});

describe('resolveInitialInspectSelection', () => {
  const states = [
    nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' }),
    nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' }),
    nodeState({ nodeId: 'ship', name: 'Ship', status: 'pending' }),
  ];
  const rows = [
    row({ id: 'plan-row', nodeId: 'plan', status: 'completed', order: 0 }),
    row({ id: 'review-row', nodeId: 'review', status: 'awaiting', order: 1 }),
    row({ id: 'ship-row', nodeId: 'ship', status: 'pending', order: 2 }),
  ];

  test('valid ?node= wins over a live node and declared approval', () => {
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: 'ship',
        nodeStates: states,
        rows,
        approvalNodeId: 'review',
      })
    ).toEqual({ nodeId: 'ship', logRowId: null });
  });

  test('an invalid query falls back to the first inspect-running node', () => {
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: 'ghost',
        nodeStates: states,
        rows,
        approvalNodeId: 'ship',
      })
    ).toEqual({ nodeId: 'review', logRowId: 'review-row' });
  });

  test('declared approval is next when no inspect-running node exists', () => {
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: null,
        nodeStates: [
          nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' }),
          nodeState({ nodeId: 'review', name: 'Review', status: 'pending' }),
        ],
        rows: [
          row({ id: 'plan-row', nodeId: 'plan' }),
          row({ id: 'review-row', nodeId: 'review' }),
        ],
        approvalNodeId: 'review',
      })
    ).toEqual({ nodeId: 'review', logRowId: 'review-row' });
  });

  test('the first log row is last and an empty run selects nothing', () => {
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: 'ghost',
        nodeStates: [nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' })],
        rows: [row({ id: 'plan-row', nodeId: 'plan', status: 'completed' })],
        approvalNodeId: null,
      })
    ).toEqual({ nodeId: 'plan', logRowId: 'plan-row' });
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: 'ghost',
        nodeStates: [],
        rows: [],
        approvalNodeId: null,
      })
    ).toEqual({ nodeId: null, logRowId: null });
  });

  test('attaches a log row id only when it belongs to the selected node', () => {
    expect(
      resolveInitialInspectSelection({
        requestedNodeId: null,
        nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
        rows: [
          row({ id: 'other-row', nodeId: 'other' }),
          row({ id: 'review-row', nodeId: 'review' }),
        ],
        approvalNodeId: null,
      })
    ).toEqual({ nodeId: 'review', logRowId: 'review-row' });
  });
});

describe('selectInspectNode', () => {
  test('keeps a log-row selection and graph selection clears it', () => {
    expect(selectInspectNode('review', 'review-row')).toEqual({
      nodeId: 'review',
      logRowId: 'review-row',
    });
    expect(selectInspectNode('review', null)).toEqual({ nodeId: 'review', logRowId: null });
  });
});
