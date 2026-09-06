import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type { WorkflowExecutionBody } from './WorkflowExecution';
import type { WorkflowRunView } from './source-control/dag-run-tabs';
import { getWorkflowRun, type WorkflowEventResponse } from '@/lib/api';

const workflowExecutionImportWindow = new Window({ url: 'https://localhost/' });
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
Object.assign(globalThis as object, {
  document: workflowExecutionImportWindow.document,
  window: workflowExecutionImportWindow,
  self: workflowExecutionImportWindow,
  HTMLElement: workflowExecutionImportWindow.HTMLElement,
});
const {
  buildWorkflowDagNodeStates,
  emptyAskActionStates,
  mapWorkflowRunDetail,
  resolveWorkflowExecutionBody,
} = await import('./WorkflowExecution');
// Radix keeps import-time DOM references; restore globals but keep the window alive.
if (previousDocument === undefined) {
  Reflect.deleteProperty(globalThis, 'document');
} else {
  Object.defineProperty(globalThis, 'document', previousDocument);
}
if (previousWindow === undefined) {
  Reflect.deleteProperty(globalThis, 'window');
} else {
  Object.defineProperty(globalThis, 'window', previousWindow);
}
if (previousSelf === undefined) {
  Reflect.deleteProperty(globalThis, 'self');
} else {
  Object.defineProperty(globalThis, 'self', previousSelf);
}
if (previousHTMLElement === undefined) {
  Reflect.deleteProperty(globalThis, 'HTMLElement');
} else {
  Object.defineProperty(globalThis, 'HTMLElement', previousHTMLElement);
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

    test('every DAG inspect view shares the pane and source control stays separate', () => {
      const expected: Record<WorkflowRunView, WorkflowExecutionBody> = {
        graph: 'graph-logs-pane',
        logs: 'graph-logs-pane',
        chat: 'graph-logs-pane',
        'source-control': 'source-control',
      };
      for (const activeView of views) {
        expect(resolveWorkflowExecutionBody({ isDag: true, activeView })).toBe(
          expected[activeView]
        );
      }
      expect(Object.values(expected)).not.toContain('chat');
    });

    test('every non-DAG input returns sequential', () => {
      for (const activeView of views) {
        expect(resolveWorkflowExecutionBody({ isDag: false, activeView })).toBe('sequential');
      }
    });
  });
});

describe('mapWorkflowRunDetail', () => {
  function runDetail(
    overrides: {
      pending_interactions?: Awaited<ReturnType<typeof getWorkflowRun>>['pending_interactions'];
      viewer_is_starter?: boolean;
      starter_display_name?: string | null;
      metadata?: Record<string, unknown>;
    } = {}
  ): Awaited<ReturnType<typeof getWorkflowRun>> {
    return {
      run: {
        id: 'run-1',
        workflow_name: 'demo',
        conversation_id: 'conv-1',
        parent_conversation_id: null,
        codebase_id: 'cb-1',
        status: 'paused',
        user_message: 'go',
        metadata: overrides.metadata ?? { error: 'AskHuman is not supported by provider claude' },
        started_at: '2026-09-07T00:00:00.000Z',
        completed_at: null,
        last_activity_at: null,
        working_path: null,
        user_id: 'user-1',
        parent_run_id: null,
        output_root: null,
        parent_platform_id: 'parent-1',
        conversation_platform_id: null,
      },
      events: [],
      nodeStates: [],
      pending_interactions: overrides.pending_interactions ?? [
        {
          id: 'ask-1',
          workflow_run_id: 'run-1',
          node_id: 'review',
          tool_use_id: 'tool-ask',
          kind: 'ask',
          status: 'pending',
          envelope: { questions: [] },
          answer: null,
          provider_session_id: 'sess-1',
          created_at: '2026-09-07T00:00:00.000Z',
          resolved_at: null,
          resolved_by: null,
        },
      ],
      usage: null,
      viewer_is_starter: overrides.viewer_is_starter ?? true,
      starter_display_name:
        overrides.starter_display_name === undefined ? 'Avery' : overrides.starter_display_name,
    };
  }

  test('maps Ask read-model fields', () => {
    const mapped = mapWorkflowRunDetail(runDetail());
    expect(mapped.pendingInteractions).toHaveLength(1);
    expect(mapped.pendingInteractions[0]?.id).toBe('ask-1');
    expect(mapped.viewerIsStarter).toBe(true);
    expect(mapped.starterDisplayName).toBe('Avery');
    expect(mapped.runError).toBe('AskHuman is not supported by provider claude');

    const nonStringError = mapWorkflowRunDetail(runDetail({ metadata: { error: { code: 7 } } }));
    expect(nonStringError.runError).toBeNull();
  });
});

describe('emptyAskActionStates', () => {
  test('creates fresh Ask action state per run', () => {
    const first = emptyAskActionStates();
    const second = emptyAskActionStates();
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(first).not.toBe(second);
    first['tool-ask'] = { phase: 'sending' };
    expect(second).toEqual({});
  });
});
