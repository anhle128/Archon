import { describe, expect, test } from 'bun:test';
import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { resolveRoomKind } from './resolve-room-kind';

function event(overrides: Partial<WorkflowEventResponse>): WorkflowEventResponse {
  return {
    id: 'event-1',
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: null,
    data: {},
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

const nodes: DagNode[] = [
  { id: 'command', command: 'review' },
  { id: 'prompt', prompt: 'Write' },
  { id: 'loop', loop: { max_iterations: 2, fresh_context: false } },
  { id: 'bash', bash: 'echo hi' },
  { id: 'script', script: 'console.log(1)' },
  { id: 'approval', approval: { message: 'Ship?' } },
  {
    id: 'plannotator',
    plannotator_gate: { document: 'review.md', rework: { prompt: 'Fix' } },
  },
  { id: 'workflow', workflow: 'child' },
  {
    id: 'router',
    route_loop: {
      condition: '$review.output',
      max_iterations: 2,
      routes: { positive: 'done', negative: 'fix', exhausted: 'stop' },
    },
  },
  {
    id: 'group',
    loop_group: {
      max_iterations: 2,
      fresh_context: false,
      nodes: [
        { id: 'body', prompt: 'Work' },
        {
          id: 'nested',
          loop_group: {
            max_iterations: 2,
            fresh_context: false,
            nodes: [{ id: 'check', bash: 'echo ok' }],
          },
        },
      ],
    },
  },
];

describe('resolveRoomKind', () => {
  test('maps every authored body mode without resolveNodeDisplay collapse', () => {
    expect(nodes.map(node => resolveRoomKind(node.id, nodes, [], null).kind)).toEqual([
      'agent',
      'agent',
      'agent',
      'stdout',
      'stdout',
      'gate',
      'gate',
      'workflow',
      'route_loop',
      'loop_group',
    ]);
  });

  test('recursively resolves qualified loop-group body ids', () => {
    expect(resolveRoomKind('group.body', nodes, [], null).nodeType).toBe('prompt');
    expect(resolveRoomKind('group.nested', nodes, [], null).kind).toBe('loop_group');
    expect(resolveRoomKind('group.nested.check', nodes, [], null).kind).toBe('stdout');
  });

  test('uses matching ApprovalContext when the current definition is unavailable', () => {
    expect(
      resolveRoomKind('gate', [], [], {
        nodeId: 'gate',
        message: 'Review',
        type: 'plannotator_gate',
      })
    ).toMatchObject({ kind: 'gate', nodeType: 'plannotator_gate' });
    expect(
      resolveRoomKind('child', [], [], {
        nodeId: 'child',
        message: 'Child paused',
        type: 'child_workflow',
        childRunId: 'child-1',
      }).kind
    ).toBe('workflow');
  });

  test('uses persisted non-agent event hints before the agent fallback', () => {
    expect(
      resolveRoomKind('shell', [], [event({ step_name: 'shell', data: { type: 'script' } })], null)
        .kind
    ).toBe('stdout');
    expect(
      resolveRoomKind(
        'router',
        [],
        [event({ event_type: 'node_routed', step_name: 'router' })],
        null
      ).kind
    ).toBe('route_loop');
    expect(
      resolveRoomKind(
        'gate',
        [],
        [
          event({
            event_type: 'approval_requested',
            step_name: 'gate',
            data: { gateType: 'approval', message: 'Review' },
          }),
        ],
        null
      ).kind
    ).toBe('gate');
    expect(resolveRoomKind('include__agent', nodes, [], null).kind).toBe('agent');
  });
});
