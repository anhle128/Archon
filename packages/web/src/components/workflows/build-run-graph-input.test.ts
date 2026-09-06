import { describe, expect, test } from 'bun:test';
import type { DagNode } from '@/lib/api';
import type { WorkflowStepStatus } from '@/lib/types';
import { buildRunGraphInput, layoutRunGraph } from './build-run-graph-input';

const LIVE_STATUSES: readonly WorkflowStepStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting',
];

function routeLoopNode(): DagNode {
  return {
    id: 'review_router',
    depends_on: ['review'],
    route_loop: {
      condition: "$review.output.status == 'approved'",
      max_iterations: 3,
      routes: {
        positive: 'done',
        negative: 'fix',
        exhausted: 'escalate',
      },
    },
  };
}

function routeLoopDagNodes(): DagNode[] {
  return [
    { id: 'fix', prompt: 'Revise the implementation.' },
    { id: 'review', depends_on: ['fix'], prompt: 'Review the implementation.' },
    routeLoopNode(),
    { id: 'done', bash: "echo 'approved'" },
    { id: 'escalate', bash: "echo 'review exhausted'" },
  ];
}

function routeTargetDagNodes(): DagNode[] {
  return [
    { id: 'code-review', prompt: 'Review the implementation.' },
    {
      id: 'code-review-gate',
      depends_on: ['code-review'],
      route_loop: {
        condition: "$code-review.output.status == 'approved'",
        max_iterations: 3,
        routes: {
          positive: 'tea-rv',
          negative: 'fix-feedback',
          exhausted: 'review-loop-error',
        },
      },
    },
    { id: 'tea-rv', depends_on: ['code-review-gate'], command: 'bmad-tea-rv-findings-step' },
    { id: 'tea-nr', depends_on: ['tea-rv'], command: 'bmad-tea-nr-findings-step' },
    { id: 'fix-feedback', depends_on: ['code-review-gate'], prompt: 'Fix review feedback.' },
    {
      id: 'review-loop-error',
      depends_on: ['code-review-gate'],
      bash: 'echo review loop exhausted',
    },
  ];
}

describe('buildRunGraphInput', () => {
  test('copies definition nodes in definition order', () => {
    const dagNodes: DagNode[] = [
      { id: 'z', prompt: 'last alphabetically' },
      { id: 'a', prompt: 'first alphabetically' },
      { id: 'm', prompt: 'middle' },
    ];
    expect(buildRunGraphInput(dagNodes, []).nodes.map(node => node.id)).toEqual(['z', 'a', 'm']);
  });

  test('last matching live status wins', () => {
    const input = buildRunGraphInput(
      [{ id: 'a', prompt: 'n' }],
      [
        { nodeId: 'a', status: 'running' },
        { nodeId: 'a', status: 'failed' },
        { nodeId: 'a', status: 'completed' },
      ]
    );
    expect(input.nodes).toEqual([{ id: 'a', nodeState: 'completed' }]);
  });

  test('missing live status defaults to pending', () => {
    const input = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', depends_on: ['a'], prompt: 'n' },
      ],
      [{ nodeId: 'a', status: 'completed' }]
    );
    expect(input.nodes).toEqual([
      { id: 'a', nodeState: 'completed' },
      { id: 'b', nodeState: 'pending' },
    ]);
  });

  test('maps every WorkflowStepStatus directly', () => {
    for (const status of LIVE_STATUSES) {
      const input = buildRunGraphInput([{ id: 'a', prompt: 'n' }], [{ nodeId: 'a', status }]);
      expect(input.nodes[0]?.nodeState).toBe(status);
    }
  });

  test('ordinary depends_on edges become dependency edges', () => {
    const input = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', depends_on: ['a'], prompt: 'n' },
        { id: 'c', depends_on: ['a', 'b'], prompt: 'n' },
      ],
      []
    );
    expect(input.edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', kind: 'dependency' },
      { id: 'a->c', source: 'a', target: 'c', kind: 'dependency' },
      { id: 'b->c', source: 'b', target: 'c', kind: 'dependency' },
    ]);
  });

  test('non-empty when makes each incoming ordinary edge conditional', () => {
    const when = "$a.output.ok == 'true'";
    const input = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', prompt: 'n' },
        { id: 'c', depends_on: ['a', 'b'], when, prompt: 'n' },
      ],
      []
    );
    expect(input.edges).toEqual([
      { id: 'a->c', source: 'a', target: 'c', kind: 'conditional', label: when },
      { id: 'b->c', source: 'b', target: 'c', kind: 'conditional', label: when },
    ]);
  });

  test('empty when stays a dependency edge without a label', () => {
    const input = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', depends_on: ['a'], when: '', prompt: 'n' },
      ],
      []
    );
    expect(input.edges).toEqual([{ id: 'a->b', source: 'a', target: 'b', kind: 'dependency' }]);
  });

  test('route_loop targets suppress ordinary controller-to-target dependencies', () => {
    const input = buildRunGraphInput(routeTargetDagNodes(), []);
    expect(
      input.edges.filter(edge => edge.source === 'code-review-gate' && edge.kind !== 'route')
    ).toEqual([]);
    expect(
      input.edges.filter(edge => edge.source === 'code-review-gate' && edge.target === 'tea-rv')
    ).toEqual([
      {
        id: 'code-review-gate->tea-rv',
        source: 'code-review-gate',
        target: 'tea-rv',
        kind: 'route',
        label: 'positive',
        outcome: 'positive',
      },
    ]);
    expect(
      input.edges.filter(
        edge => edge.source === 'code-review-gate' && edge.target === 'review-loop-error'
      )
    ).toEqual([
      {
        id: 'code-review-gate->review-loop-error',
        source: 'code-review-gate',
        target: 'review-loop-error',
        kind: 'route',
        label: 'exhausted',
        outcome: 'exhausted',
      },
    ]);
  });

  test('route_loop edges emit in exhausted, negative, positive order', () => {
    const input = buildRunGraphInput(routeLoopDagNodes(), []);
    const routeEdges = input.edges.filter(edge => edge.kind === 'route');
    expect(routeEdges).toEqual([
      {
        id: 'review_router->escalate',
        source: 'review_router',
        target: 'escalate',
        kind: 'route',
        label: 'exhausted',
        outcome: 'exhausted',
      },
      {
        id: 'review_router->fix',
        source: 'review_router',
        target: 'fix',
        kind: 'route',
        label: 'negative',
        outcome: 'negative',
      },
      {
        id: 'review_router->done',
        source: 'review_router',
        target: 'done',
        kind: 'route',
        label: 'positive',
        outcome: 'positive',
      },
    ]);
  });

  test('repeated route targets receive unique ids', () => {
    const dagNodes: DagNode[] = [
      { id: 'controller', prompt: 'n' },
      { id: 'shared', prompt: 'n' },
      { id: 'other', prompt: 'n' },
      {
        id: 'router',
        depends_on: ['controller'],
        route_loop: {
          condition: 'true',
          max_iterations: 2,
          routes: {
            positive: 'shared',
            negative: 'shared',
            exhausted: 'other',
          },
        },
      },
    ];
    const routeEdges = buildRunGraphInput(dagNodes, []).edges.filter(edge => edge.kind === 'route');
    expect(routeEdges.map(edge => edge.id)).toEqual([
      'router->other',
      'router->shared',
      'router->shared:positive',
    ]);
    expect(new Set(routeEdges.map(edge => edge.id)).size).toBe(3);
  });
});

describe('layoutRunGraph', () => {
  test('returns a position for every definition node', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
      { id: 'c', depends_on: ['b'], prompt: 'n' },
    ];
    const result = layoutRunGraph(dagNodes, [
      { nodeId: 'a', status: 'completed' },
      { nodeId: 'b', status: 'running' },
    ]);
    expect(Object.keys(result.positions).sort()).toEqual(['a', 'b', 'c']);
    expect(result.positions.a).toEqual({ x: 0, y: 0 });
    expect(result.positions.b.y).toBeGreaterThan(result.positions.a.y);
    expect(result.positions.c.y).toBeGreaterThan(result.positions.b.y);
  });

  test('skipped target incoming route is not taken', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'taken', depends_on: ['a'], prompt: 'n' },
      { id: 'skipped', depends_on: ['a'], prompt: 'n' },
    ];
    const result = layoutRunGraph(dagNodes, [
      { nodeId: 'a', status: 'completed' },
      { nodeId: 'taken', status: 'completed' },
      { nodeId: 'skipped', status: 'skipped' },
    ]);
    const takenRoute = result.routes.find(route => route.target === 'taken');
    const skippedRoute = result.routes.find(route => route.target === 'skipped');
    expect(takenRoute?.taken).toBe(true);
    expect(skippedRoute?.taken).toBe(false);
  });
});
