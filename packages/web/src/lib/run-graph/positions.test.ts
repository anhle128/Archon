import { describe, expect, test } from 'bun:test';
import { NODE_HEIGHT, NODE_SEP, NODE_WIDTH, RANK_SEP } from './constants';
import { computePositions } from './positions';
import type { LayoutEdge } from './types';

const H = NODE_WIDTH + NODE_SEP;
const V = NODE_HEIGHT + RANK_SEP;

function edge(id: string, source: string, target: string): LayoutEdge {
  return { id, source, target };
}

function layerOriginX(nodeCount: number, maxCount: number): number {
  return ((maxCount - nodeCount) * H) / 2;
}

function backEdgeIds(result: { backEdgeIds: ReadonlySet<string> }): string[] {
  return [...result.backEdgeIds].sort();
}

describe('computePositions', () => {
  test('returns empty positions, layers, and back-edge ids for empty input', () => {
    const result = computePositions([], []);
    expect(result.positions).toEqual({});
    expect(result.layers).toEqual({});
    expect(result.backEdgeIds.size).toBe(0);
  });

  test('places a single node at the origin', () => {
    const result = computePositions(['a'], []);
    expect(result.positions).toEqual({ a: { x: 0, y: 0 } });
    expect(result.layers).toEqual({ a: 0 });
    expect(result.backEdgeIds.size).toBe(0);
  });

  test('deduplicates node ids preserving the first appearance', () => {
    const result = computePositions(['b', 'a', 'b'], []);
    expect(Object.keys(result.positions)).toEqual(['b', 'a']);
    expect(result.positions).toEqual({
      b: { x: 0, y: 0 },
      a: { x: H, y: 0 },
    });
    expect(result.layers).toEqual({ b: 0, a: 0 });
  });

  test('ignores edges whose source or target is missing', () => {
    const base = computePositions(['a', 'b'], []);
    const withMissing = computePositions(
      ['a', 'b'],
      [edge('ghost-out', 'a', 'missing'), edge('ghost-in', 'missing', 'b')]
    );
    expect(withMissing.positions).toEqual(base.positions);
    expect(withMissing.layers).toEqual(base.layers);
    expect(withMissing.backEdgeIds.size).toBe(0);
  });

  test('centers a one-node parent layer over its two-node child layer', () => {
    const result = computePositions(
      ['parent', 'left', 'right'],
      [edge('to-left', 'parent', 'left'), edge('to-right', 'parent', 'right')]
    );
    expect(result.layers).toEqual({ parent: 0, left: 1, right: 1 });
    expect(result.positions.parent).toEqual({ x: layerOriginX(1, 2), y: 0 });
    expect(result.positions.left).toEqual({ x: 0, y: V });
    expect(result.positions.right).toEqual({ x: H, y: V });
  });

  test('reorders a crossing second layer from a->d and b->c to d, c', () => {
    const result = computePositions(
      ['a', 'b', 'c', 'd'],
      [edge('a-d', 'a', 'd'), edge('b-c', 'b', 'c')]
    );
    expect(result.layers).toEqual({ a: 0, b: 0, d: 1, c: 1 });
    expect(result.positions.a).toEqual({ x: 0, y: 0 });
    expect(result.positions.b).toEqual({ x: H, y: 0 });
    expect(result.positions.d).toEqual({ x: 0, y: V });
    expect(result.positions.c).toEqual({ x: H, y: V });
  });

  test('marks only the retry loop back edge and keeps three successive layers', () => {
    const result = computePositions(
      ['start', 'work', 'review'],
      [
        edge('start-work', 'start', 'work'),
        edge('work-review', 'work', 'review'),
        edge('review-work', 'review', 'work'),
      ]
    );
    expect(backEdgeIds(result)).toEqual(['review-work']);
    expect(result.layers).toEqual({ start: 0, work: 1, review: 2 });
    expect(result.positions.start).toEqual({ x: 0, y: 0 });
    expect(result.positions.work).toEqual({ x: 0, y: V });
    expect(result.positions.review).toEqual({ x: 0, y: 2 * V });
  });

  test('does not flatten a two-node cycle into one layer', () => {
    const result = computePositions(['a', 'b'], [edge('a-b', 'a', 'b'), edge('b-a', 'b', 'a')]);
    expect(backEdgeIds(result)).toEqual(['b-a']);
    expect(result.layers.a).not.toBe(result.layers.b);
    expect(result.layers).toEqual({ a: 0, b: 1 });
    expect(result.positions.a.y).toBe(0);
    expect(result.positions.b.y).toBe(V);
  });

  test('returns byte-for-byte identical output on repeated calls', () => {
    const nodeIds = ['start', 'work', 'review', 'done'] as const;
    const edges = [
      edge('start-work', 'start', 'work'),
      edge('work-review', 'work', 'review'),
      edge('review-work', 'review', 'work'),
      edge('review-done', 'review', 'done'),
    ];
    const first = computePositions(nodeIds, edges);
    const second = computePositions(nodeIds, edges);
    expect(JSON.stringify(first.positions)).toBe(JSON.stringify(second.positions));
    expect(JSON.stringify(first.layers)).toBe(JSON.stringify(second.layers));
    expect(JSON.stringify(backEdgeIds(first))).toBe(JSON.stringify(backEdgeIds(second)));
    expect(first.positions).toEqual(second.positions);
    expect(first.layers).toEqual(second.layers);
    expect(backEdgeIds(first)).toEqual(backEdgeIds(second));
  });
});
