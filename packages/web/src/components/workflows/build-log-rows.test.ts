import { describe, expect, test } from 'bun:test';

import { buildLogRows } from './build-log-rows';
import type { WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

function nodeState(
  overrides: Pick<WorkflowNodeStateResponse, 'nodeId' | 'name' | 'status'> &
    Partial<WorkflowNodeStateResponse>
): WorkflowNodeStateResponse {
  return {
    retryEpoch: 0,
    ...overrides,
  };
}

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
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

function routeEvent(overrides: {
  id: string;
  step_name: string;
  executionSeq: number;
}): WorkflowEventResponse {
  return {
    id: overrides.id,
    workflow_run_id: 'run-1',
    event_type: 'node_routed',
    step_index: null,
    step_name: overrides.step_name,
    data: {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: '$review.output.approved == true',
      condition_result: false,
      negative_count: 1,
      max_iterations: 2,
      attempt: 1,
      execution_seq: overrides.executionSeq,
    },
    created_at: '2026-06-21T00:00:00.000Z',
  };
}

describe('buildLogRows', () => {
  test('normal rows use the exact server status', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
      [
        workflowEvent({ id: 'start-1', event_type: 'node_started', step_name: 'review' }),
        workflowEvent({ id: 'done-1', event_type: 'node_completed', step_name: 'review' }),
      ]
    );

    expect(rows).toEqual([
      {
        id: 'start-1',
        nodeId: 'review',
        label: 'Review',
        status: 'running',
        order: 0,
        sourceIndex: 0,
        selection: { kind: 'node' },
      },
    ]);
  });

  test('loop events replace the base row with distinct iteration rows', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' })],
      [
        workflowEvent({
          id: 'loop-start-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'loop-done-1',
          event_type: 'loop_iteration_completed',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'loop-start-2',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 2 },
        }),
      ]
    );

    expect(rows.map(row => ({ id: row.id, label: row.label, selection: row.selection }))).toEqual([
      {
        id: 'loop-start-1',
        label: 'Loop ×1',
        selection: { kind: 'loop_iteration', iteration: 1 },
      },
      {
        id: 'loop-start-2',
        label: 'Loop ×2',
        selection: { kind: 'loop_iteration', iteration: 2 },
      },
    ]);
  });

  test('iteration completion and failure determine iteration status', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'loop', name: 'Loop', status: 'failed' })],
      [
        workflowEvent({
          id: 'loop-start-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'loop-done-1',
          event_type: 'loop_iteration_completed',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'loop-start-2',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 2 },
        }),
        workflowEvent({
          id: 'loop-fail-2',
          event_type: 'loop_iteration_failed',
          step_name: 'loop',
          data: { iteration: 2 },
        }),
        workflowEvent({
          id: 'loop-start-3',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 3 },
        }),
      ]
    );

    expect(rows.map(row => ({ label: row.label, status: row.status, id: row.id }))).toEqual([
      { label: 'Loop ×1', status: 'completed', id: 'loop-start-1' },
      { label: 'Loop ×2', status: 'failed', id: 'loop-start-2' },
      { label: 'Loop ×3', status: 'running', id: 'loop-start-3' },
    ]);
  });

  test('route-loop events replace the base row with one completed row per execution_seq', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'router', name: 'Router', status: 'running' })],
      [
        routeEvent({ id: 'route-1', step_name: 'router', executionSeq: 1 }),
        routeEvent({ id: 'route-2', step_name: 'router', executionSeq: 2 }),
      ]
    );

    expect(rows).toEqual([
      {
        id: 'route-1',
        nodeId: 'router',
        label: 'Router #1',
        status: 'completed',
        order: 0,
        sourceIndex: 0,
        selection: { kind: 'route_iteration', executionSeq: 1 },
      },
      {
        id: 'route-2',
        nodeId: 'router',
        label: 'Router #2',
        status: 'completed',
        order: 1,
        sourceIndex: 0,
        selection: { kind: 'route_iteration', executionSeq: 2 },
      },
    ]);
  });

  test('rows interleave by event position instead of grouping all base rows first', () => {
    const rows = buildLogRows(
      [
        nodeState({ nodeId: 'alpha', name: 'Alpha', status: 'completed' }),
        nodeState({ nodeId: 'loop', name: 'Loop', status: 'running' }),
        nodeState({ nodeId: 'beta', name: 'Beta', status: 'running' }),
      ],
      [
        workflowEvent({ id: 'alpha-start', event_type: 'node_started', step_name: 'alpha' }),
        workflowEvent({
          id: 'loop-start-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({ id: 'beta-start', event_type: 'node_started', step_name: 'beta' }),
        workflowEvent({
          id: 'loop-done-1',
          event_type: 'loop_iteration_completed',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        workflowEvent({
          id: 'loop-start-2',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 2 },
        }),
      ]
    );

    expect(rows.map(row => row.label)).toEqual(['Alpha', 'Loop ×1', 'Beta', 'Loop ×2']);
  });

  test('a re-executed ordinary node appears once at the latest node_started', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
      [
        workflowEvent({ id: 'start-1', event_type: 'node_started', step_name: 'review' }),
        workflowEvent({ id: 'done-1', event_type: 'node_completed', step_name: 'review' }),
        workflowEvent({ id: 'start-2', event_type: 'node_started', step_name: 'review' }),
      ]
    );

    expect(rows).toEqual([
      {
        id: 'start-2',
        nodeId: 'review',
        label: 'Review',
        status: 'running',
        order: 2,
        sourceIndex: 0,
        selection: { kind: 'node' },
      },
    ]);
  });

  test('approval requests anchor gate rows when no node_started event exists', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
      [
        workflowEvent({
          id: 'done-old',
          event_type: 'node_completed',
          step_name: 'review',
          data: { approval_decision: 'rejected' },
        }),
        workflowEvent({
          id: 'gate-new',
          event_type: 'approval_requested',
          step_name: 'review',
          data: { gateType: 'approval', nodeId: 'review', message: 'Try again?' },
        }),
      ]
    );

    expect(rows).toEqual([
      {
        id: 'gate-new',
        nodeId: 'review',
        label: 'Review',
        status: 'running',
        order: 1,
        sourceIndex: 0,
        selection: { kind: 'node' },
      },
    ]);
  });

  test('invalid iteration numbers and execution_seq values are ignored', () => {
    const rows = buildLogRows(
      [
        nodeState({ nodeId: 'loop', name: 'Loop', status: 'pending' }),
        nodeState({ nodeId: 'router', name: 'Router', status: 'pending' }),
      ],
      [
        workflowEvent({
          id: 'loop-missing',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: {},
        }),
        workflowEvent({
          id: 'loop-zero',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 0 },
        }),
        workflowEvent({
          id: 'loop-float',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 1.5 },
        }),
        workflowEvent({
          id: 'loop-start-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop',
          data: { iteration: 1 },
        }),
        routeEvent({ id: 'route-zero', step_name: 'router', executionSeq: 0 }),
        workflowEvent({
          id: 'route-missing',
          event_type: 'node_routed',
          step_name: 'router',
          data: {},
        }),
      ]
    );

    expect(rows.map(row => ({ id: row.id, label: row.label, selection: row.selection }))).toEqual([
      {
        id: 'loop-start-1',
        label: 'Loop ×1',
        selection: { kind: 'loop_iteration', iteration: 1 },
      },
      {
        id: 'node:router',
        label: 'Router',
        selection: { kind: 'node' },
      },
    ]);
  });

  test('equal positions retain the input nodeStates order', () => {
    const rows = buildLogRows(
      [
        nodeState({ nodeId: 'bravo', name: 'Bravo', status: 'pending' }),
        nodeState({ nodeId: 'alpha', name: 'Alpha', status: 'pending' }),
      ],
      []
    );

    expect(rows.map(row => row.label)).toEqual(['Bravo', 'Alpha']);
    expect(rows.map(row => row.id)).toEqual(['node:bravo', 'node:alpha']);
  });

  test('ordinary rows without node_started use the latest lifecycle event id', () => {
    const rows = buildLogRows(
      [nodeState({ nodeId: 'skip', name: 'Skip', status: 'skipped' })],
      [workflowEvent({ id: 'skip-1', event_type: 'node_skipped', step_name: 'skip' })]
    );

    expect(rows[0]).toMatchObject({
      id: 'skip-1',
      label: 'Skip',
      status: 'skipped',
      order: 0,
      selection: { kind: 'node' },
    });
  });
});
