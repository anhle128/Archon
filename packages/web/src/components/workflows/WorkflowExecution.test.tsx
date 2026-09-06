import { describe, expect, test } from 'bun:test';

import { buildWorkflowDagNodeStates, resolveWorkflowExecutionBody } from './WorkflowExecution';
import type { WorkflowRunView } from './source-control/dag-run-tabs';
import type { WorkflowEventResponse } from '@/lib/api';

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

describe('buildWorkflowDagNodeStates', () => {
  test('enriches server-projected nodeStates with loop iteration events', () => {
    const nodes = buildWorkflowDagNodeStates(
      [
        {
          nodeId: 'loop-node',
          name: 'Loop',
          status: 'completed',
          retryEpoch: 0,
        },
      ],
      [
        workflowEvent({
          id: 'event-1',
          event_type: 'loop_iteration_started',
          step_name: 'loop-node',
          data: { iteration: 1, maxIterations: 2 },
        }),
        workflowEvent({
          id: 'event-2',
          event_type: 'loop_iteration_completed',
          step_name: 'loop-node',
          data: { iteration: 1, maxIterations: 2, duration_ms: 1500 },
        }),
      ]
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      nodeId: 'loop-node',
      status: 'completed',
      currentIteration: 1,
      maxIterations: 2,
      iterations: [{ iteration: 1, status: 'completed', duration: 1500 }],
    });
  });

  test('enriches the target loop node from node_completed loop_progress (REST replay)', () => {
    const nodes = buildWorkflowDagNodeStates(
      [
        { nodeId: 'preflight', name: 'Preflight', status: 'completed', retryEpoch: 0 },
        { nodeId: 'loop-node', name: 'Loop', status: 'running', retryEpoch: 0 },
      ],
      [
        workflowEvent({
          id: 'e1',
          event_type: 'node_completed',
          step_name: 'preflight',
          data: { loop_progress: { targetNodeId: 'loop-node', expectedIterations: 20 } },
        }),
      ]
    );
    expect(nodes.find(n => n.nodeId === 'loop-node')?.expectedIterations).toBe(20);
  });

  test('returns no DAG lifecycle when server nodeStates are absent', () => {
    expect(
      buildWorkflowDagNodeStates(undefined, [
        workflowEvent({ event_type: 'node_started', step_name: 'review' }),
        workflowEvent({ event_type: 'node_routed', step_name: 'router' }),
      ])
    ).toEqual([]);
  });

  test('route decisions enrich an existing node without overriding server status', () => {
    const routeDecision = {
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: "$review.output.approved == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 2,
      attempt: 1,
      execution_seq: 4,
    };

    const nodes = buildWorkflowDagNodeStates(
      [{ nodeId: 'router', name: 'Router', status: 'running', retryEpoch: 0 }],
      [workflowEvent({ event_type: 'node_routed', step_name: 'router', data: routeDecision })]
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.status).toBe('running');
    expect(nodes[0]?.routeDecision).toEqual(routeDecision);
  });

  describe('resolveWorkflowExecutionBody', () => {
    const views: WorkflowRunView[] = ['graph', 'logs', 'chat', 'source-control'];

    test('DAG Graph and Logs share the graph-logs pane', () => {
      expect(
        resolveWorkflowExecutionBody({
          isDag: true,
          activeView: 'graph',
          parentPlatformId: 'parent-1',
        })
      ).toBe('graph-logs-pane');
      expect(
        resolveWorkflowExecutionBody({
          isDag: true,
          activeView: 'logs',
          parentPlatformId: 'parent-1',
        })
      ).toBe('graph-logs-pane');
    });

    test('DAG Source Control returns source-control', () => {
      expect(
        resolveWorkflowExecutionBody({
          isDag: true,
          activeView: 'source-control',
          parentPlatformId: 'parent-1',
        })
      ).toBe('source-control');
    });

    test('DAG Chat with a parent returns chat', () => {
      expect(
        resolveWorkflowExecutionBody({
          isDag: true,
          activeView: 'chat',
          parentPlatformId: 'parent-1',
        })
      ).toBe('chat');
    });

    test('DAG Chat without a parent falls back to the graph-logs pane', () => {
      expect(
        resolveWorkflowExecutionBody({
          isDag: true,
          activeView: 'chat',
          parentPlatformId: null,
        })
      ).toBe('graph-logs-pane');
    });

    test('every non-DAG input returns sequential', () => {
      for (const activeView of views) {
        expect(
          resolveWorkflowExecutionBody({
            isDag: false,
            activeView,
            parentPlatformId: 'parent-1',
          })
        ).toBe('sequential');
        expect(
          resolveWorkflowExecutionBody({
            isDag: false,
            activeView,
            parentPlatformId: null,
          })
        ).toBe('sequential');
      }
    });
  });
});
