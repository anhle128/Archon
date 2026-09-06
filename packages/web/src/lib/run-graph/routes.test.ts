import { describe, expect, test } from 'bun:test';
import { BACK_EDGE_GUTTER, NODE_HEIGHT, RANK_SEP } from './constants';
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
    expect(routes[0].path).toBe('M 90 80 C 90 116 90 124 90 160');
    expect(routes[0].labelPosition).toEqual({ x: 98, y: 120 });
  });

  test('vertically aligned multi-layer edge still enters the target top', () => {
    const routes = route({
      positions: { a: { x: 0, y: 0 }, c: { x: 0, y: 2 * V } },
      layers: { a: 0, c: 2 },
      edges: [{ id: 'a-c', source: 'a', target: 'c' }],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].sourcePort).toBe('bottom');
    expect(routes[0].targetPort).toBe('top');
    expect(routes[0].path).toBe('M 90 80 C 90 188 90 212 90 320');
    expect(routes[0].labelPosition).toEqual({ x: 98, y: 200 });
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
    expect(routes[0].path).toBe('M 90 80 C 90 220 130 360 200 360');
    expect(routes[0].labelPosition).toEqual({ x: 145, y: 212 });
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
    expect(routes[0].path).toBe('M 290 80 C 290 220 250 360 180 360');
    expect(routes[0].labelPosition).toEqual({ x: 235, y: 212 });
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
    expect(routes[0].path).toBe('M 0 360 C -46 360 -46 200 0 200');
    expect(routes[0].labelPosition).toEqual({ x: -42, y: 280 });
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
    expect(routes[0].path).toBe('M 0 40 C -46 40 -46 -46 90 0');
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
