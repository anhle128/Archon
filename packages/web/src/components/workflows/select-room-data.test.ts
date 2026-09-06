import { describe, expect, test } from 'bun:test';
import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import type { LogRow } from './build-log-rows';
import {
  selectChildRun,
  selectGateChrome,
  selectLoopGroupChrome,
  selectNodeStdout,
  selectRouteDecision,
} from './select-room-data';

function workflowEvent(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: 'setup',
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

const ROW: LogRow = {
  id: 'start-new',
  nodeId: 'setup',
  label: 'Setup',
  status: 'failed',
  order: 2,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

const GATE_ROW: LogRow = {
  id: 'gate-start',
  nodeId: 'review',
  label: 'Review',
  status: 'running',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

const CHILD_ROW: LogRow = {
  id: 'child-start-new',
  nodeId: 'child',
  label: 'Child',
  status: 'failed',
  order: 2,
  sourceIndex: 0,
  selection: { kind: 'node' },
};

const ROUTE_ROW: LogRow = {
  id: 'route-2',
  nodeId: 'router',
  label: 'Router #2',
  status: 'completed',
  order: 1,
  sourceIndex: 0,
  selection: { kind: 'route_iteration', executionSeq: 2 },
};

const GROUP_ROW: LogRow = {
  id: 'group-start',
  nodeId: 'group',
  label: 'Group ×2',
  status: 'failed',
  order: 0,
  sourceIndex: 0,
  selection: { kind: 'loop_iteration', iteration: 2 },
};

const GROUP_NODE: DagNode = {
  id: 'group',
  loop_group: {
    max_iterations: 2,
    fresh_context: false,
    nodes: [
      { id: 'body', prompt: 'Work' },
      { id: 'check', prompt: 'Check', depends_on: ['body'] },
    ],
  },
};

describe('selectNodeStdout', () => {
  test("returns the selected attempt's empty successful stdout", () => {
    const completedRow: LogRow = { ...ROW, status: 'completed' };
    const events = [
      workflowEvent({ id: 'start-old' }),
      workflowEvent({
        id: 'done-old',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'stale' },
      }),
      workflowEvent({ id: 'start-new' }),
      workflowEvent({
        id: 'done-new',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: '' },
      }),
    ];
    expect(selectNodeStdout(events, completedRow)).toEqual({
      text: '',
      status: 'completed',
      exitCode: 0,
      truncated: false,
      originalBytes: null,
      failedDetail: null,
    });
  });

  test('does not leak stdout from a successful attempt into a failed rerun', () => {
    const events = [
      workflowEvent({ id: 'start-old' }),
      workflowEvent({
        id: 'done-old',
        event_type: 'node_completed',
        data: { type: 'bash', node_output: 'stale' },
      }),
      workflowEvent({
        id: 'start-new',
        created_at: '2026-09-06T00:00:03.000Z',
      }),
      workflowEvent({
        id: 'failed-new',
        event_type: 'node_failed',
        data: { type: 'bash', error: 'new failure' },
        created_at: '2026-09-06T00:00:01.000Z',
      }),
    ];
    expect(selectNodeStdout(events, ROW)).toEqual({
      text: null,
      status: 'failed',
      exitCode: null,
      truncated: false,
      originalBytes: null,
      failedDetail: 'new failure',
    });
  });

  test('validates bash truncation metadata', () => {
    const completedRow: LogRow = { ...ROW, status: 'completed' };
    const events = [
      workflowEvent({ id: 'start-new' }),
      workflowEvent({
        id: 'done-new',
        event_type: 'node_completed',
        data: {
          type: 'bash',
          node_output: 'cut',
          node_output_truncated: true,
          node_output_original_bytes: 40000,
        },
      }),
    ];
    expect(selectNodeStdout(events, completedRow)).toEqual({
      text: 'cut',
      status: 'completed',
      exitCode: 0,
      truncated: true,
      originalBytes: 40000,
      failedDetail: null,
    });
  });

  test('ignores malformed truncation metadata', () => {
    const completedRow: LogRow = { ...ROW, status: 'completed' };
    const cases: unknown[] = [-1, 1.5, '40000'];
    for (const originalBytes of cases) {
      const events = [
        workflowEvent({ id: 'start-new' }),
        workflowEvent({
          id: 'done-new',
          event_type: 'node_completed',
          data: {
            type: 'bash',
            node_output: 'cut',
            node_output_truncated: true,
            node_output_original_bytes: originalBytes,
          },
        }),
      ];
      expect(selectNodeStdout(events, completedRow).originalBytes).toBe(null);
      expect(selectNodeStdout(events, completedRow).truncated).toBe(true);
    }
  });
});

describe('selectGateChrome', () => {
  test("exposes only the selected gate's active actions", () => {
    expect(
      selectGateChrome({
        definitionNode: { id: 'review', approval: { message: 'Ship?' } },
        events: [workflowEvent({ id: 'gate-start', step_name: 'review' })],
        row: GATE_ROW,
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        runStatus: 'paused',
        gateType: 'approval',
      })
    ).toEqual({
      gateType: 'approval',
      message: 'Ship?',
      document: null,
      decision: null,
      canDecide: true,
      showInactiveNotice: false,
      reviewUrl: null,
    });
  });

  test('suppresses incompatible or resolved gate actions', () => {
    const events = [workflowEvent({ id: 'gate-start', step_name: 'review' })];
    const definitionNode: DagNode = { id: 'review', approval: { message: 'Ship?' } };
    const variants = [
      {
        approval: { nodeId: 'review', message: 'Child paused', type: 'child_workflow' },
        runStatus: 'paused' as const,
      },
      {
        approval: { nodeId: 'other', message: 'Other gate', type: 'approval' },
        runStatus: 'paused' as const,
      },
      {
        approval: {
          nodeId: 'review',
          message: 'Ship?',
          type: 'approval',
          resolved: 'approved' as const,
        },
        runStatus: 'paused' as const,
      },
      {
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        runStatus: 'running' as const,
      },
    ];
    for (const variant of variants) {
      expect(
        selectGateChrome({
          definitionNode,
          events,
          row: GATE_ROW,
          approval: variant.approval,
          runStatus: variant.runStatus,
          gateType: 'approval',
        }).canDecide
      ).toBe(false);
    }
  });

  test('suppresses Plannotator links for incompatible gate selections', () => {
    expect(
      selectGateChrome({
        definitionNode: { id: 'review', approval: { message: 'Ship?' } },
        events: [workflowEvent({ id: 'gate-start', step_name: 'review' })],
        row: GATE_ROW,
        approval: {
          nodeId: 'review',
          message: 'Review the plan',
          type: 'plannotator_gate',
          reviewUrl: 'https://plannotator.example/run-1',
        },
        runStatus: 'paused',
        gateType: 'approval',
      }).reviewUrl
    ).toBeNull();
  });

  test('reads a completed gate decision from the selected attempt', () => {
    const completedRow: LogRow = { ...GATE_ROW, status: 'completed' };
    const events = [
      workflowEvent({ id: 'gate-start', step_name: 'review' }),
      workflowEvent({
        id: 'gate-done',
        step_name: 'review',
        event_type: 'node_completed',
        data: { approval_decision: 'approved', node_output: '' },
      }),
    ];
    expect(
      selectGateChrome({
        definitionNode: { id: 'review', approval: { message: 'Ship?' } },
        events,
        row: completedRow,
        approval: null,
        runStatus: 'completed',
        gateType: 'approval',
      })
    ).toEqual({
      gateType: 'approval',
      message: 'Ship?',
      document: null,
      decision: 'approved',
      canDecide: false,
      showInactiveNotice: false,
      reviewUrl: null,
    });
  });

  test('reads the current gate resolution while auto-resume is pending', () => {
    expect(
      selectGateChrome({
        definitionNode: { id: 'review', approval: { message: 'Ship?' } },
        events: [workflowEvent({ id: 'gate-start', step_name: 'review' })],
        row: GATE_ROW,
        approval: {
          nodeId: 'review',
          message: 'Ship?',
          type: 'approval',
          resolved: 'rejected',
        },
        runStatus: 'paused',
        gateType: 'approval',
      })
    ).toEqual({
      gateType: 'approval',
      message: 'Ship?',
      document: null,
      decision: 'rejected',
      canDecide: false,
      showInactiveNotice: false,
      reviewUrl: null,
    });
  });

  test('does not leak stale decisions into a metadata-only active pause', () => {
    const metadataOnlyRow: LogRow = { ...GATE_ROW, id: 'node:review' };
    expect(
      selectGateChrome({
        definitionNode: { id: 'review', approval: { message: 'Ship?' } },
        events: [
          workflowEvent({
            id: 'done-old',
            step_name: 'review',
            event_type: 'node_completed',
            data: { approval_decision: 'rejected' },
          }),
        ],
        row: metadataOnlyRow,
        approval: { nodeId: 'review', message: 'Ship?', type: 'approval' },
        runStatus: 'paused',
        gateType: 'approval',
      }).decision
    ).toBeNull();
  });
});

describe('selectChildRun', () => {
  test('selects a paused child before completion history', () => {
    const pausedRow: LogRow = { ...CHILD_ROW, status: 'running' };
    const events = [
      workflowEvent({
        id: 'child-done-old',
        step_name: 'child',
        event_type: 'node_completed',
        data: { type: 'workflow', child_run_id: 'old-child', node_output: 'stale' },
      }),
      workflowEvent({ id: 'child-start-new', step_name: 'child' }),
    ];
    expect(
      selectChildRun({
        events,
        approval: {
          nodeId: 'child',
          message: 'Child needs review',
          type: 'child_workflow',
          childRunId: 'child-1',
        },
        row: pausedRow,
        runStatus: 'paused',
      })
    ).toEqual({
      childRunId: 'child-1',
      fanOut: false,
      output: null,
      paused: true,
      message: 'Child needs review',
      status: 'running',
    });
  });

  test('does not leak an old child id into a failed rerun', () => {
    const events = [
      workflowEvent({ id: 'child-start-old', step_name: 'child' }),
      workflowEvent({
        id: 'child-done-old',
        step_name: 'child',
        event_type: 'node_completed',
        data: { type: 'workflow', child_run_id: 'old-child', node_output: 'stale' },
      }),
      workflowEvent({
        id: 'child-start-new',
        step_name: 'child',
        created_at: '2026-09-06T00:00:03.000Z',
      }),
      workflowEvent({
        id: 'child-failed-new',
        step_name: 'child',
        event_type: 'node_failed',
        data: { type: 'workflow', error: 'new child failure' },
        created_at: '2026-09-06T00:00:01.000Z',
      }),
    ];
    expect(
      selectChildRun({
        events,
        approval: null,
        row: CHILD_ROW,
        runStatus: 'failed',
      })
    ).toEqual({
      childRunId: null,
      fanOut: false,
      output: null,
      paused: false,
      message: null,
      status: 'failed',
    });
  });

  test('represents fan-out without one child link', () => {
    const completedRow: LogRow = { ...CHILD_ROW, id: 'child-start-new', status: 'completed' };
    const events = [
      workflowEvent({ id: 'child-start-new', step_name: 'child' }),
      workflowEvent({
        id: 'child-done-new',
        step_name: 'child',
        event_type: 'node_completed',
        data: { type: 'workflow', fan_out: true, node_output: '3 children completed' },
      }),
    ];
    expect(
      selectChildRun({
        events,
        approval: null,
        row: completedRow,
        runStatus: 'completed',
      })
    ).toEqual({
      childRunId: null,
      fanOut: true,
      output: '3 children completed',
      paused: false,
      message: null,
      status: 'completed',
    });
  });
});

describe('selectRouteDecision', () => {
  test('selects the exact route execution', () => {
    const events = [
      workflowEvent({
        id: 'route-1',
        step_name: 'router',
        event_type: 'node_routed',
        data: {
          sources: ['review'],
          outcome: 'negative',
          to: 'fix',
          condition: '$review.output',
          condition_result: false,
          negative_count: 1,
          max_iterations: 2,
          attempt: 1,
          execution_seq: 1,
        },
      }),
      workflowEvent({
        id: 'route-2',
        step_name: 'router',
        event_type: 'node_routed',
        data: {
          sources: ['review'],
          outcome: 'positive',
          to: 'done',
          condition: '$review.output',
          condition_result: true,
          negative_count: 1,
          max_iterations: 2,
          attempt: 2,
          execution_seq: 2,
        },
      }),
    ];
    expect(selectRouteDecision(events, ROUTE_ROW)).toEqual({
      outcome: 'positive',
      to: 'done',
      condition: '$review.output',
      conditionResult: 'true',
      attempt: '2',
      executionSeq: '2',
      negativeCount: '1',
      maxIterations: '2',
    });
  });

  test('returns null for a missing route execution', () => {
    const events = [
      workflowEvent({
        id: 'route-1',
        step_name: 'router',
        event_type: 'node_routed',
        data: {
          sources: ['review'],
          outcome: 'negative',
          to: 'fix',
          condition: '$review.output',
          condition_result: false,
          negative_count: 1,
          max_iterations: 2,
          attempt: 1,
          execution_seq: 1,
        },
      }),
      workflowEvent({
        id: 'route-2',
        step_name: 'router',
        event_type: 'node_routed',
        data: {
          sources: ['review'],
          outcome: 'positive',
          to: 'done',
          condition: '$review.output',
          condition_result: true,
          negative_count: 1,
          max_iterations: 2,
          attempt: 2,
          execution_seq: 2,
        },
      }),
    ];
    expect(
      selectRouteDecision(events, {
        ...ROUTE_ROW,
        selection: { kind: 'route_iteration', executionSeq: 3 },
      })
    ).toBe(null);
  });

  test('stringifies only safe route primitives', () => {
    const events = [
      workflowEvent({
        id: 'route-2',
        step_name: 'router',
        event_type: 'node_routed',
        data: {
          sources: ['review'],
          outcome: 'negative',
          to: 'fix',
          condition: '$review.output',
          condition_result: false,
          negative_count: 1,
          max_iterations: Number.POSITIVE_INFINITY,
          attempt: { n: 2 },
          execution_seq: 2,
        },
      }),
    ];
    expect(selectRouteDecision(events, ROUTE_ROW)).toEqual({
      outcome: 'negative',
      to: 'fix',
      condition: '$review.output',
      conditionResult: 'false',
      attempt: null,
      executionSeq: '2',
      negativeCount: '1',
      maxIterations: null,
    });
  });
});

describe('selectLoopGroupChrome', () => {
  test('builds loop-group body and iteration state in authored order', () => {
    const events = [
      workflowEvent({
        id: 'group-start',
        step_name: 'group.body',
        event_type: 'node_started',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'body-1-done',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'check-1-done',
        step_name: 'group.check',
        event_type: 'node_completed',
        data: { iteration: 1 },
      }),
      workflowEvent({
        id: 'body-2-done',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: 2 },
      }),
      workflowEvent({
        id: 'check-2-fail',
        step_name: 'group.check',
        event_type: 'node_failed',
        data: { iteration: 2, error: 'check failed' },
      }),
    ];
    expect(
      selectLoopGroupChrome({
        definitionNode: GROUP_NODE,
        events,
        row: GROUP_ROW,
      })
    ).toEqual({
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [] },
        { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'] },
      ],
      iterations: [
        {
          iteration: 1,
          status: 'completed',
          body: [
            { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
            { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'], status: 'completed' },
          ],
        },
        {
          iteration: 2,
          status: 'failed',
          body: [
            { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
            { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'], status: 'failed' },
          ],
        },
      ],
      selectedIteration: 2,
    });
  });

  test('keeps container iteration history before body lifecycle arrives', () => {
    const events = [
      workflowEvent({
        id: 'iter-2-start',
        step_name: 'group',
        event_type: 'loop_iteration_started',
        data: { iteration: 2 },
      }),
      workflowEvent({
        id: 'iter-2-done',
        step_name: 'group',
        event_type: 'loop_iteration_completed',
        data: { iteration: 2 },
      }),
    ];
    expect(
      selectLoopGroupChrome({
        definitionNode: GROUP_NODE,
        events,
        row: GROUP_ROW,
      })
    ).toEqual({
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [] },
        { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'] },
      ],
      iterations: [
        {
          iteration: 2,
          status: 'completed',
          body: [
            { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'pending' },
            { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'], status: 'pending' },
          ],
        },
      ],
      selectedIteration: 2,
    });
  });

  test('ignores invalid loop iteration values', () => {
    const events = [
      workflowEvent({
        id: 'zero',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: 0 },
      }),
      workflowEvent({
        id: 'negative',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: -1 },
      }),
      workflowEvent({
        id: 'float',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: 1.5 },
      }),
      workflowEvent({
        id: 'string',
        step_name: 'group.body',
        event_type: 'node_completed',
        data: { iteration: '1' },
      }),
    ];
    expect(
      selectLoopGroupChrome({
        definitionNode: GROUP_NODE,
        events,
        row: GROUP_ROW,
      }).iterations
    ).toEqual([]);
  });
});
