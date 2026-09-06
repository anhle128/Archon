import { describe, expect, test } from 'bun:test';
import type { DagNode } from '../../skills/workflows';
import type { WorkflowNodeState } from '../../skills/runs';
import { buildRunGraphInput } from './build-run-graph-input';

function nodeState(
  nodeId: string,
  status: WorkflowNodeState['status'],
  name = nodeId
): WorkflowNodeState {
  return { nodeId, name, status, retryEpoch: 0 };
}

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
  test('copies definition nodes in definition order with attached definitions', () => {
    const dagNodes: DagNode[] = [
      { id: 'z', prompt: 'last alphabetically' },
      { id: 'a', prompt: 'first alphabetically' },
      { id: 'm', prompt: 'middle' },
    ];
    const model = buildRunGraphInput(dagNodes, []);
    expect(model.nodes.map(node => node.definition.id)).toEqual(['z', 'a', 'm']);
    expect(model.nodes.map(node => node.definition)).toEqual(dagNodes);
    expect(model.nodes.every(node => node.nodeState === 'pending')).toBe(true);
  });

  test('last matching projected state wins for a duplicated node id', () => {
    const dagNodes: DagNode[] = [{ id: 'a', prompt: 'n' }];
    const model = buildRunGraphInput(dagNodes, [
      nodeState('a', 'running'),
      nodeState('a', 'failed'),
      nodeState('a', 'completed'),
    ]);
    expect(model.nodes).toEqual([{ definition: dagNodes[0]!, nodeState: 'completed' }]);
  });

  test('missing projected state defaults to pending', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
    ];
    const model = buildRunGraphInput(dagNodes, [nodeState('a', 'completed')]);
    expect(model.nodes).toEqual([
      { definition: dagNodes[0]!, nodeState: 'completed' },
      { definition: dagNodes[1]!, nodeState: 'pending' },
    ]);
  });

  test('normalizes awaiting to running before layout', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
    ];
    const model = buildRunGraphInput(dagNodes, [
      nodeState('a', 'completed'),
      nodeState('b', 'awaiting'),
    ]);
    expect(model.nodes.map(node => node.nodeState)).toEqual(['completed', 'running']);
    expect(model.nodes.some(node => node.nodeState === 'awaiting')).toBe(false);
    const incoming = model.routes.find(route => route.target === 'b');
    expect(incoming?.taken).toBe(true);
  });

  test('ordinary depends_on edges become dependency edges', () => {
    const model = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', depends_on: ['a'], prompt: 'n' },
        { id: 'c', depends_on: ['a', 'b'], prompt: 'n' },
      ],
      []
    );
    expect(model.edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', kind: 'dependency' },
      { id: 'a->c', source: 'a', target: 'c', kind: 'dependency' },
      { id: 'b->c', source: 'b', target: 'c', kind: 'dependency' },
    ]);
  });

  test('non-empty when makes each incoming ordinary edge conditional', () => {
    const when = "$a.output.ok == 'true'";
    const model = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', prompt: 'n' },
        { id: 'c', depends_on: ['a', 'b'], when, prompt: 'n' },
      ],
      []
    );
    expect(model.edges).toEqual([
      { id: 'a->c', source: 'a', target: 'c', kind: 'conditional', label: when },
      { id: 'b->c', source: 'b', target: 'c', kind: 'conditional', label: when },
    ]);
  });

  test('empty when stays a dependency edge without a label', () => {
    const model = buildRunGraphInput(
      [
        { id: 'a', prompt: 'n' },
        { id: 'b', depends_on: ['a'], when: '', prompt: 'n' },
      ],
      []
    );
    expect(model.edges).toEqual([{ id: 'a->b', source: 'a', target: 'b', kind: 'dependency' }]);
  });

  test('route_loop targets suppress ordinary controller-to-target dependencies', () => {
    const model = buildRunGraphInput(routeTargetDagNodes(), []);
    expect(
      model.edges.filter(edge => edge.source === 'code-review-gate' && edge.kind !== 'route')
    ).toEqual([]);
    expect(
      model.edges.filter(edge => edge.source === 'code-review-gate' && edge.target === 'tea-rv')
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
      model.edges.filter(
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

  test('route_loop edges emit labels in exhausted, negative, positive order', () => {
    const model = buildRunGraphInput(routeLoopDagNodes(), []);
    const routeEdges = model.edges.filter(edge => edge.kind === 'route');
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
    expect(routeEdges.map(edge => edge.label)).toEqual(['exhausted', 'negative', 'positive']);
  });

  test('repeated route targets receive unique ids by appending outcome', () => {
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

  test('layout identifies the retry loop back-edge and positions every definition node', () => {
    const dagNodes = routeLoopDagNodes();
    const model = buildRunGraphInput(dagNodes, [
      nodeState('fix', 'completed'),
      nodeState('review', 'completed'),
      nodeState('review_router', 'running'),
    ]);
    expect(Object.keys(model.positions).sort()).toEqual([...dagNodes.map(node => node.id)].sort());
    expect(model.positions.fix?.y).toBe(0);
    expect(model.positions.review.y).toBeGreaterThan(model.positions.fix.y);
    const back = model.routes.find(
      route => route.source === 'review_router' && route.target === 'fix'
    );
    expect(back?.backEdge).toBe(true);
    expect(back?.kind).toBe('route');
    expect(back?.label).toBe('negative');
    expect(model.routes.filter(route => route.backEdge)).toHaveLength(1);
  });

  test('skipped target incoming route is not taken', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'taken', depends_on: ['a'], prompt: 'n' },
      { id: 'skipped', depends_on: ['a'], prompt: 'n' },
    ];
    const model = buildRunGraphInput(dagNodes, [
      nodeState('a', 'completed'),
      nodeState('taken', 'completed'),
      nodeState('skipped', 'skipped'),
    ]);
    expect(model.routes.find(route => route.target === 'taken')?.taken).toBe(true);
    expect(model.routes.find(route => route.target === 'skipped')?.taken).toBe(false);
  });
});
