import { describe, expect, test } from 'bun:test';
import { buildConsoleLogEntries } from './build-console-log-entries';
import { buildLogRows, type LogRow } from './build-log-rows';
import { foldNodeRuns, toRunEvent } from '../../primitives/event';
import type { WorkflowEvent, WorkflowNodeState } from '../../skills/runs';

const RUN_STARTED = '2026-06-21T00:00:00.000Z';

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
  created_at?: string;
}): WorkflowEvent {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: RUN_STARTED,
    ...overrides,
  };
}

function routeEvent(overrides: {
  id: string;
  step_name: string;
  executionSeq: number;
  created_at: string;
}): WorkflowEvent {
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
    created_at: overrides.created_at,
  };
}

function entriesFor(
  nodeStates: readonly WorkflowNodeState[],
  events: readonly WorkflowEvent[],
  runStartedAt = RUN_STARTED
) {
  const rows = buildLogRows(nodeStates, events);
  return buildConsoleLogEntries({
    rows,
    rawEvents: events,
    nodeRuns: foldNodeRuns(events.map(toRunEvent)),
    runStartedAt,
  });
}

describe('buildConsoleLogEntries', () => {
  test('ordinary rows take metadata from foldNodeRuns and the raw event timestamp first', () => {
    const events = [
      workflowEvent({
        id: 'start-1',
        event_type: 'node_started',
        step_name: 'plan',
        created_at: '2026-06-21T00:00:10.000Z',
      }),
      workflowEvent({
        id: 'done-1',
        event_type: 'node_completed',
        step_name: 'plan',
        created_at: '2026-06-21T00:00:20.000Z',
        data: { duration_ms: 11370, cost_usd: 0.1399, num_turns: 3, stop_reason: 'end_turn' },
      }),
    ];
    const [entry] = entriesFor(
      [nodeState({ nodeId: 'plan', name: 'Plan', status: 'completed' })],
      events
    );

    expect(entry).toMatchObject({
      displayStatus: 'completed',
      startedAt: '2026-06-21T00:00:10.000Z',
      durationMs: 11370,
      costUsd: 0.1399,
      numTurns: 3,
      stopReason: 'end_turn',
      skipReason: null,
      skipExpr: null,
      showNodeUsage: true,
    });
  });

  test('prefers the last node_started raw timestamp over the earliest folded start', () => {
    const events = [
      workflowEvent({
        id: 'start-1',
        event_type: 'node_started',
        step_name: 'plan',
        created_at: '2026-06-21T00:00:01.000Z',
      }),
      workflowEvent({
        id: 'done-1',
        event_type: 'node_completed',
        step_name: 'plan',
        created_at: '2026-06-21T00:00:02.000Z',
        data: { duration_ms: 900, cost_usd: 0.05 },
      }),
      workflowEvent({
        id: 'start-2',
        event_type: 'node_started',
        step_name: 'plan',
        created_at: '2026-06-21T00:00:09.000Z',
      }),
    ];
    const [entry] = entriesFor(
      [nodeState({ nodeId: 'plan', name: 'Plan', status: 'running' })],
      events
    );

    expect(entry?.row.id).toBe('start-2');
    expect(entry?.startedAt).toBe('2026-06-21T00:00:09.000Z');
    expect(entry?.durationMs).toBe(900);
    expect(entry?.costUsd).toBe(0.05);
  });

  test('skipped ordinary rows carry skip reason and expression from the folded run', () => {
    const events = [
      workflowEvent({
        id: 'skip-1',
        event_type: 'node_skipped',
        step_name: 'web-research',
        data: { reason: 'when_condition', expr: "$classify.output.type != 'bug'" },
      }),
    ];
    const [entry] = entriesFor(
      [nodeState({ nodeId: 'web-research', name: 'Web research', status: 'skipped' })],
      events
    );

    expect(entry).toMatchObject({
      displayStatus: 'skipped',
      startedAt: RUN_STARTED,
      skipReason: 'when_condition',
      skipExpr: "$classify.output.type != 'bug'",
      showNodeUsage: true,
    });
  });

  test('keeps awaiting as the display status', () => {
    const [entry] = entriesFor([nodeState({ nodeId: 'ask', name: 'Ask', status: 'awaiting' })], []);

    expect(entry?.displayStatus).toBe('awaiting');
    expect(entry?.startedAt).toBe(RUN_STARTED);
  });

  test('loop rows use the iteration start timestamp and finite non-negative terminal duration', () => {
    const events = [
      workflowEvent({
        id: 'loop-start-1',
        event_type: 'loop_iteration_started',
        step_name: 'loop',
        created_at: '2026-06-21T00:00:03.000Z',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'loop-done-1',
        event_type: 'loop_iteration_completed',
        step_name: 'loop',
        created_at: '2026-06-21T00:00:08.000Z',
        data: { iteration: 1, duration: 4200 },
      }),
      workflowEvent({
        id: 'loop-start-2',
        event_type: 'loop_iteration_started',
        step_name: 'loop',
        created_at: '2026-06-21T00:00:09.000Z',
        data: { iteration: 2 },
      }),
      workflowEvent({
        id: 'loop-fail-2',
        event_type: 'loop_iteration_failed',
        step_name: 'loop',
        created_at: '2026-06-21T00:00:11.000Z',
        data: { iteration: 2, duration: -1 },
      }),
    ];
    const result = entriesFor(
      [nodeState({ nodeId: 'loop', name: 'Loop', status: 'failed' })],
      events
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      startedAt: '2026-06-21T00:00:03.000Z',
      durationMs: 4200,
      costUsd: null,
      numTurns: null,
      showNodeUsage: false,
    });
    expect(result[1]).toMatchObject({
      startedAt: '2026-06-21T00:00:09.000Z',
      durationMs: null,
      showNodeUsage: true,
    });
  });

  test('route rows match executionSeq, use the route timestamp, and leave duration metadata null', () => {
    const events = [
      routeEvent({
        id: 'route-1',
        step_name: 'router',
        executionSeq: 1,
        created_at: '2026-06-21T00:00:04.000Z',
      }),
      routeEvent({
        id: 'route-2',
        step_name: 'router',
        executionSeq: 2,
        created_at: '2026-06-21T00:00:07.000Z',
      }),
    ];
    const result = entriesFor(
      [nodeState({ nodeId: 'router', name: 'Router', status: 'running' })],
      events
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      startedAt: '2026-06-21T00:00:04.000Z',
      durationMs: null,
      costUsd: null,
      numTurns: null,
      stopReason: null,
      skipReason: null,
      skipExpr: null,
      showNodeUsage: false,
    });
    expect(result[1]).toMatchObject({
      startedAt: '2026-06-21T00:00:07.000Z',
      durationMs: null,
      showNodeUsage: true,
    });
  });

  test('showNodeUsage is true only on the final chronological row for a node id', () => {
    const rows: LogRow[] = [
      {
        id: 'a-1',
        nodeId: 'a',
        label: 'A ×1',
        status: 'completed',
        order: 0,
        sourceIndex: 0,
        selection: { kind: 'loop_iteration', iteration: 1 },
      },
      {
        id: 'b-1',
        nodeId: 'b',
        label: 'B',
        status: 'completed',
        order: 1,
        sourceIndex: 1,
        selection: { kind: 'node' },
      },
      {
        id: 'a-2',
        nodeId: 'a',
        label: 'A ×2',
        status: 'running',
        order: 2,
        sourceIndex: 0,
        selection: { kind: 'loop_iteration', iteration: 2 },
      },
    ];
    const result = buildConsoleLogEntries({
      rows,
      rawEvents: [],
      nodeRuns: [],
      runStartedAt: RUN_STARTED,
    });

    expect(result.map(entry => [entry.row.id, entry.showNodeUsage])).toEqual([
      ['a-1', false],
      ['b-1', true],
      ['a-2', true],
    ]);
  });

  test('uses runStartedAt only as the final timestamp fallback', () => {
    const [entry] = buildConsoleLogEntries({
      rows: [
        {
          id: 'node:ghost',
          nodeId: 'ghost',
          label: 'Ghost',
          status: 'pending',
          order: 0,
          sourceIndex: 0,
          selection: { kind: 'node' },
        },
      ],
      rawEvents: [],
      nodeRuns: [],
      runStartedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(entry?.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
