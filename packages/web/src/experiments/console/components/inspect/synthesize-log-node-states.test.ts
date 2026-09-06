import { describe, expect, test } from 'bun:test';
import { synthesizeLogNodeStates } from './synthesize-log-node-states';
import type { WorkflowEvent, WorkflowNodeState } from '../../skills/runs';

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'> & Partial<WorkflowNodeState>
): WorkflowNodeState {
  return {
    retryEpoch: 0,
    ...overrides,
  };
}

function workflowEvent(overrides: {
  id?: string;
  event_type?: string;
  step_name?: string | null;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('synthesizeLogNodeStates', () => {
  test('adds a synthetic state for a missing loop-group projection', () => {
    const states = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          id: 'loop-start-1',
          event_type: 'loop_iteration_started',
          step_name: 'group',
          data: { iteration: 1, nodeId: 'group' },
        }),
        workflowEvent({
          id: 'loop-done-1',
          event_type: 'loop_iteration_completed',
          step_name: 'group',
          data: { iteration: 1, nodeId: 'group' },
        }),
      ],
      'completed',
      null
    );

    expect(states).toEqual([
      { nodeId: 'group', name: 'group', status: 'completed', retryEpoch: 0 },
    ]);
  });

  test('resolves a synthetic node id from data.nodeId when step_name is empty', () => {
    const states = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          event_type: 'loop_iteration_failed',
          step_name: '',
          data: { iteration: 1, nodeId: 'fixer' },
        }),
      ],
      'failed',
      null
    );

    expect(states).toEqual([{ nodeId: 'fixer', name: 'fixer', status: 'failed', retryEpoch: 0 }]);
  });

  test('ignores synthetic events that have neither step_name nor data.nodeId', () => {
    const states = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          event_type: 'loop_iteration_started',
          step_name: null,
          data: { iteration: 1 },
        }),
        workflowEvent({
          event_type: 'loop_iteration_started',
          step_name: '',
          data: { iteration: 1, nodeId: 7 },
        }),
      ],
      'running',
      null
    );

    expect(states).toEqual([]);
  });

  test('adds a paused declared approval when the node is missing', () => {
    const states = synthesizeLogNodeStates([], [], 'paused', {
      nodeId: 'gate',
      message: 'Ship it?',
      type: 'approval',
    });

    expect(states).toEqual([{ nodeId: 'gate', name: 'gate', status: 'running', retryEpoch: 0 }]);
  });

  test('adds a paused child workflow when the node is missing', () => {
    const states = synthesizeLogNodeStates([], [], 'paused', {
      nodeId: 'child',
      message: 'Waiting on child run',
      type: 'child_workflow',
      childRunId: 'child-1',
    });

    expect(states).toEqual([{ nodeId: 'child', name: 'child', status: 'running', retryEpoch: 0 }]);
  });

  test('adds a historical paused approval whose type is omitted', () => {
    const states = synthesizeLogNodeStates([], [], 'paused', {
      nodeId: 'gate',
      message: 'Approve?',
    });

    expect(states.map(state => state.nodeId)).toEqual(['gate']);
  });

  test('existing projected states always win over loop and approval synthetics', () => {
    const existing = nodeState({ nodeId: 'group', name: 'Group', status: 'failed' });
    const states = synthesizeLogNodeStates(
      [existing],
      [
        workflowEvent({
          event_type: 'loop_iteration_started',
          step_name: 'group',
          data: { iteration: 1 },
        }),
      ],
      'paused',
      { nodeId: 'group', message: 'Approve?', type: 'approval' }
    );

    expect(states).toEqual([existing]);
  });

  test('ordinary node_started or terminal raw events never create a second lifecycle projector', () => {
    const states = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({ id: 'start-1', event_type: 'node_started', step_name: 'build' }),
        workflowEvent({ id: 'done-1', event_type: 'node_completed', step_name: 'build' }),
        workflowEvent({ id: 'fail-1', event_type: 'node_failed', step_name: 'test' }),
        workflowEvent({ id: 'skip-1', event_type: 'node_skipped', step_name: 'lint' }),
      ],
      'completed',
      null
    );

    expect(states).toEqual([]);
  });

  test('excludes interactive_loop and writeback approval data from the Epic 5 projector', () => {
    const interactive = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          event_type: 'approval_requested',
          step_name: 'loop',
          data: { gateType: 'interactive_loop', nodeId: 'loop', message: 'Continue?' },
        }),
      ],
      'paused',
      { nodeId: 'loop', message: 'Continue?', type: 'interactive_loop' }
    );
    const writeback = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          event_type: 'approval_requested',
          step_name: 'writeback',
          data: { gateType: 'writeback', nodeId: 'writeback', message: 'Apply?' },
        }),
      ],
      'paused',
      { nodeId: 'writeback', message: 'Apply?', type: 'writeback' }
    );

    expect(interactive).toEqual([]);
    expect(writeback).toEqual([]);
  });

  test('treats approval_requested with approval or plannotator_gate as selectable synthetics', () => {
    const states = synthesizeLogNodeStates(
      [],
      [
        workflowEvent({
          event_type: 'approval_requested',
          step_name: 'review',
          data: { gateType: 'plannotator_gate', nodeId: 'review', message: 'Review plan' },
        }),
      ],
      'completed',
      null
    );

    expect(states).toEqual([
      { nodeId: 'review', name: 'review', status: 'running', retryEpoch: 0 },
    ]);
  });

  test('does not use a non-paused approval context as a fallback', () => {
    const states = synthesizeLogNodeStates([], [], 'running', {
      nodeId: 'gate',
      message: 'Ship it?',
      type: 'approval',
    });

    expect(states).toEqual([]);
  });
});
