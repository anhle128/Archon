import { describe, expect, test } from 'bun:test';
import { BACK_EDGE_GUTTER, NODE_HEIGHT, NODE_WIDTH, RANK_SEP } from './constants';
import { buildRoutes } from './routes';
import type { LayoutEdge, LayoutRoute, NodeState, Point } from './types';

const V = NODE_HEIGHT + RANK_SEP;

function route(overrides: {
  positions: Readonly<Record<string, Point>>;
  layers?: Readonly<Record<string, number>>;
  backEdgeIds?: ReadonlySet<string>;
  edges: readonly LayoutEdge[];
  states?: Readonly<Record<string, NodeState>>;
}): LayoutRoute[] {
  return buildRoutes({
    positions: overrides.positions,
    layers: overrides.layers ?? {},
    backEdgeIds: overrides.backEdgeIds ?? new Set<string>(),
    edges: overrides.edges,
    states: overrides.states ?? {},
  });
}

describe('buildRoutes', () => {
  test('adjacent-layer forward edge leaves bottom and enters top', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, b: { x: 0, y: V } },
      layers: { a: 0, b: 1 },
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('bottom');
    expect(routes[0].targetPort).toBe('top');
    expect(routes[0].backEdge).toBe(false);
    expect(routes[0].path).toBe('M 104 58 C 104 78.7 104 83.3 104 104');
    expect(routes[0].labelPosition).toEqual({ x: 112, y: 81 });
  });

  test('collinear multi-layer skip enters the target from the right flank', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, c: { x: 0, y: 2 * V } },
      layers: { a: 0, c: 2 },
      edges: [{ id: 'a-c', source: 'a', target: 'c' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('bottom');
    expect(routes[0].targetPort).toBe('right');
    const lane = NODE_WIDTH + BACK_EDGE_GUTTER;
    expect(routes[0].path).toBe(`M 104 58 C ${lane} 58 ${lane} 237 208 237`);
    expect(routes[0].labelPosition).toEqual({ x: lane + 4, y: 147.5 });
  });

  test('clarify-chain then stays on the spine while skips take distinct right lanes', () => {
    const routes = route({
      positions: {
        check: { x: 0, y: 0 },
        respond: { x: 0, y: V },
        apply: { x: 0, y: 2 * V },
        red: { x: 0, y: 3 * V },
      },
      layers: { check: 0, respond: 1, apply: 2, red: 3 },
      edges: [
        {
          id: 'check->respond',
          source: 'check',
          target: 'respond',
          kind: 'conditional',
          label: "$check.output == 'HAS_QUESTIONS'",
        },
        { id: 'respond->apply', source: 'respond', target: 'apply' },
        { id: 'apply->red', source: 'apply', target: 'red' },
        { id: 'check->red', source: 'check', target: 'red' },
        { id: 'respond->red', source: 'respond', target: 'red' },
      ],
    });
    const thenEdge = routes.find(item => item.edgeId === 'check->respond');
    const skip = routes.find(item => item.edgeId === 'check->red');
    const joinSkip = routes.find(item => item.edgeId === 'respond->red');
    expect(thenEdge?.sourcePort).toBe('bottom');
    expect(thenEdge?.targetPort).toBe('top');
    expect(skip?.targetPort).toBe('right');
    expect(joinSkip?.targetPort).toBe('right');
    expect(skip?.path).not.toBe(thenEdge?.path);
    expect(joinSkip?.path).not.toBe(skip?.path);
    expect(skip?.labelPosition).not.toEqual(thenEdge?.labelPosition);
  });

  test('parallel same-endpoint edges get distinct paths and label positions', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, b: { x: 0, y: V } },
      layers: { a: 0, b: 1 },
      edges: [
        {
          id: 'a->b:positive',
          source: 'a',
          target: 'b',
          kind: 'route',
          outcome: 'positive',
          label: 'positive',
        },
        {
          id: 'a->b:negative',
          source: 'a',
          target: 'b',
          kind: 'route',
          outcome: 'negative',
          label: 'negative',
        },
      ],
    });
    expect(routes).toHaveLength(2);
    expect(routes[0].path).not.toBe(routes[1].path);
    expect(routes[0].labelPosition).not.toEqual(routes[1].labelPosition);
  });

  test('long edge offset to the right leaves bottom and enters left', () => {
    const target = { x: 200, y: 2 * V };
    const routes = route({
      positions: { a: { x: 0, y: 0 }, b: target },
      layers: { a: 0, b: 2 },
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('bottom');
    expect(routes[0].targetPort).toBe('left');
    expect(routes[0].path).toBe('M 104 58 C 104 147.5 130 237 200 237');
    expect(routes[0].labelPosition).toEqual({ x: 152, y: 139.5 });
  });

  test('long edge offset to the left leaves bottom and enters right', () => {
    const routes = route({
      positions: { a: { x: 200, y: 0 }, b: { x: 0, y: 2 * V } },
      layers: { a: 0, b: 2 },
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('bottom');
    expect(routes[0].targetPort).toBe('right');
    expect(routes[0].path).toBe('M 304 58 C 304 147.5 278 237 208 237');
    expect(routes[0].labelPosition).toEqual({ x: 256, y: 139.5 });
  });

  test('retry back edge uses left-to-left ports and a left-flank lane', () => {
    const source = { x: 0, y: 2 * V };
    const target = { x: 0, y: V };
    const routes = route({
      positions: { review: source, work: target },
      layers: { work: 1, review: 2 },
      backEdgeIds: new Set(['review-work']),
      edges: [{ id: 'review-work', source: 'review', target: 'work' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('left');
    expect(routes[0].targetPort).toBe('left');
    expect(routes[0].backEdge).toBe(true);
    const lane = Math.min(source.x, target.x) - BACK_EDGE_GUTTER;
    expect(lane).toBe(-46);
    expect(routes[0].path).toBe('M 0 237 C -46 237 -46 133 0 133');
    expect(routes[0].labelPosition).toEqual({ x: -42, y: 185 });
  });

  test('self-edge emits a non-empty visible upper-left curve', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 } },
      layers: { a: 0 },
      backEdgeIds: new Set(['loop']),
      edges: [{ id: 'loop', source: 'a', target: 'a' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('left');
    expect(routes[0].targetPort).toBe('top');
    expect(routes[0].backEdge).toBe(true);
    expect(routes[0].path).toBe('M 0 29 C -46 29 -46 -46 104 0');
    expect(routes[0].labelPosition).toEqual({ x: -46, y: -46 });
    expect(routes[0].path.startsWith('M ')).toBe(true);
    expect(routes[0].path.includes(' C ')).toBe(true);
  });

  test('omits a route when either endpoint lacks a position', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 } },
      layers: { a: 0 },
      edges: [
        { id: 'ghost-out', source: 'a', target: 'missing' },
        { id: 'ghost-in', source: 'missing', target: 'a' },
      ],
    });
    expect(routes).toEqual([]);
  });

  test('preserves kind, label, and outcome and defaults missing kind', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, b: { x: 0, y: V } },
      layers: { a: 0, b: 1 },
      edges: [
        {
          id: 'cond',
          source: 'a',
          target: 'b',
          kind: 'conditional',
          label: 'when ready',
          outcome: 'positive',
        },
        { id: 'plain', source: 'a', target: 'b' },
      ],
    });
    expect(routes[0].kind).toBe('conditional');
    expect(routes[0].label).toBe('when ready');
    expect(routes[0].outcome).toBe('positive');
    expect(routes[1].kind).toBe('dependency');
    expect(routes[1].label).toBeUndefined();
    expect(routes[1].outcome).toBeUndefined();
  });

  test('an awaiting target produces taken true', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, b: { x: 0, y: V } },
      layers: { a: 0, b: 1 },
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      states: { b: 'awaiting' },
    });
    expect(routes[0].taken).toBe(true);
  });

  test('skipped, pending, or missing target state produces taken false', () => {
    const positions = { a: { x: 0, y: 0 }, b: { x: 0, y: V } };
    const layers = { a: 0, b: 1 };
    const edges: LayoutEdge[] = [{ id: 'a-b', source: 'a', target: 'b' }];
    expect(route({ positions, layers, edges, states: { b: 'skipped' } })[0].taken).toBe(false);
    expect(route({ positions, layers, edges, states: { b: 'pending' } })[0].taken).toBe(false);
    expect(route({ positions, layers, edges, states: {} })[0].taken).toBe(false);
  });
});
