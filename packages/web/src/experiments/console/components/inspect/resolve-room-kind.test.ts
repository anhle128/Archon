import { describe, expect, test } from 'bun:test';
import type { DagNode } from '../../skills/workflows';
import type { WorkflowEvent } from '../../skills/runs';
import { nodeBodyKind, resolveRoomKind } from './resolve-room-kind';

function event(overrides: {
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
    created_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

function routeEvent(stepName: string): WorkflowEvent {
  return {
    id: 'route-1',
    workflow_run_id: 'run-1',
    event_type: 'node_routed',
    step_index: null,
    step_name: stepName,
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
    created_at: '2026-09-06T00:00:00.000Z',
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
  { id: 'include__agent' },
];

describe('nodeBodyKind', () => {
  test('identifies each body by schema keys rather than labels', () => {
    expect(nodes.map(node => [node.id, nodeBodyKind(node)])).toEqual([
      ['command', 'command'],
      ['prompt', 'prompt'],
      ['loop', 'loop'],
      ['bash', 'bash'],
      ['script', 'script'],
      ['approval', 'approval'],
      ['plannotator', 'plannotator_gate'],
      ['workflow', 'workflow'],
      ['router', 'route_loop'],
      ['group', 'loop_group'],
      ['include__agent', 'unknown'],
    ]);
  });
});

describe('resolveRoomKind', () => {
  test('maps every authored body mode to its room', () => {
    expect(
      nodes.map(node => {
        const resolved = resolveRoomKind(node.id, nodes, [], null);
        return { id: node.id, kind: resolved.kind, nodeType: resolved.nodeType };
      })
    ).toEqual([
      { id: 'command', kind: 'agent', nodeType: 'command' },
      { id: 'prompt', kind: 'agent', nodeType: 'prompt' },
      { id: 'loop', kind: 'agent', nodeType: 'loop' },
      { id: 'bash', kind: 'stdout', nodeType: 'bash' },
      { id: 'script', kind: 'stdout', nodeType: 'script' },
      { id: 'approval', kind: 'gate', nodeType: 'approval' },
      { id: 'plannotator', kind: 'gate', nodeType: 'plannotator_gate' },
      { id: 'workflow', kind: 'workflow', nodeType: 'workflow' },
      { id: 'router', kind: 'route_loop', nodeType: 'route_loop' },
      { id: 'group', kind: 'loop_group', nodeType: 'loop_group' },
      { id: 'include__agent', kind: 'agent', nodeType: 'unknown' },
    ]);
  });

  test('recursively resolves qualified loop-group body ids', () => {
    expect(resolveRoomKind('group.body', nodes, [], null).nodeType).toBe('prompt');
    expect(resolveRoomKind('group.nested', nodes, [], null).kind).toBe('loop_group');
    expect(resolveRoomKind('group.nested.check', nodes, [], null).kind).toBe('stdout');
    expect(resolveRoomKind('group.nested.check', nodes, [], null).nodeType).toBe('bash');
  });

  test('definition data outranks event and approval fallbacks', () => {
    expect(
      resolveRoomKind('prompt', nodes, [event({ step_name: 'prompt', data: { type: 'bash' } })], {
        nodeId: 'prompt',
        message: 'Ship?',
        type: 'approval',
      })
    ).toMatchObject({ kind: 'agent', nodeType: 'prompt' });
  });

  test('uses matching ApprovalContext when the current definition is unavailable', () => {
    expect(
      resolveRoomKind('gate', [], [], {
        nodeId: 'gate',
        message: 'Review',
        type: 'plannotator_gate',
      })
    ).toMatchObject({ kind: 'gate', nodeType: 'plannotator_gate', definitionNode: null });
    expect(
      resolveRoomKind('child', [], [], {
        nodeId: 'child',
        message: 'Child paused',
        type: 'child_workflow',
        childRunId: 'child-1',
      })
    ).toMatchObject({ kind: 'workflow', nodeType: 'workflow' });
    expect(resolveRoomKind('gate', [], [], { nodeId: 'gate', message: 'Approve?' })).toMatchObject({
      kind: 'gate',
      nodeType: 'approval',
    });
  });

  test('uses persisted non-agent event hints before the agent fallback', () => {
    expect(
      resolveRoomKind('shell', [], [event({ step_name: 'shell', data: { type: 'script' } })], null)
    ).toMatchObject({ kind: 'stdout', nodeType: 'script' });
    expect(
      resolveRoomKind(
        'shell',
        [],
        [event({ event_type: 'node_failed', step_name: 'shell', data: { type: 'bash' } })],
        null
      )
    ).toMatchObject({ kind: 'stdout', nodeType: 'bash' });
    expect(resolveRoomKind('router', [], [routeEvent('router')], null).kind).toBe('route_loop');
    expect(
      resolveRoomKind(
        'child',
        [],
        [
          event({
            event_type: 'node_completed',
            step_name: 'child',
            data: { type: 'workflow' },
          }),
        ],
        null
      ).kind
    ).toBe('workflow');
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
      )
    ).toMatchObject({ kind: 'gate', nodeType: 'approval' });
    expect(resolveRoomKind('include__agent', nodes, [], null).kind).toBe('agent');
    expect(resolveRoomKind('ghost', [], [], null)).toEqual({
      kind: 'agent',
      nodeType: 'unknown',
      definitionNode: null,
    });
  });
});
