import { describe, expect, test } from 'bun:test';
import * as runGraph from './index';
import { layout } from './layout';
import type { LayoutEdge, LayoutNode } from './types';

function node(id: string, nodeState: LayoutNode['nodeState'] = 'pending'): LayoutNode {
  return { id, nodeState };
}

function edge(id: string, source: string, target: string): LayoutEdge {
  return { id, source, target };
}

describe('layout', () => {
  test('empty input returns empty positions and routes', () => {
    expect(layout({ nodes: [], edges: [] })).toEqual({ positions: {}, routes: [] });
  });

  test('changing only node states leaves positions byte-for-byte equal', () => {
    const edges = [edge('a-b', 'a', 'b')];
    const pending = layout({
      nodes: [node('a', 'pending'), node('b', 'pending')],
      edges,
    });
    const running = layout({
      nodes: [node('a', 'completed'), node('b', 'running')],
      edges,
    });
    expect(JSON.stringify(pending.positions)).toBe(JSON.stringify(running.positions));
    expect(pending.positions).toEqual(running.positions);
  });

  test('completed to awaiting is taken', () => {
    const result = layout({
      nodes: [node('a', 'completed'), node('b', 'awaiting')],
      edges: [edge('a-b', 'a', 'b')],
    });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].taken).toBe(true);
  });

  test('completed to skipped is not taken', () => {
    const result = layout({
      nodes: [node('a', 'completed'), node('b', 'skipped')],
      edges: [edge('a-b', 'a', 'b')],
    });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].taken).toBe(false);
  });

  test('retry loop keeps progressive layers and one left-flank back route', () => {
    const result = layout({
      nodes: [node('start', 'completed'), node('work', 'running'), node('review', 'pending')],
      edges: [
        edge('start-work', 'start', 'work'),
        edge('work-review', 'work', 'review'),
        edge('review-work', 'review', 'work'),
      ],
    });
    expect(result.positions.start).toEqual({ x: 0, y: 0 });
    expect(result.positions.work.y).toBeGreaterThan(result.positions.start.y);
    expect(result.positions.review.y).toBeGreaterThan(result.positions.work.y);
    expect(result.routes.map(item => item.edgeId)).toEqual([
      'start-work',
      'work-review',
      'review-work',
    ]);
    const back = result.routes[2];
    expect(back.backEdge).toBe(true);
    expect(back.sourcePort).toBe('left');
    expect(back.targetPort).toBe('left');
    expect(back.path).toBe('M 0 237 C -46 237 -46 133 0 133');
    expect(result.routes.filter(item => item.backEdge)).toHaveLength(1);
  });

  test('duplicate node ids keep the first position and last state', () => {
    const result = layout({
      nodes: [node('a', 'completed'), node('b', 'pending'), node('b', 'awaiting')],
      edges: [edge('a-b', 'a', 'b')],
    });
    const unique = layout({
      nodes: [node('a', 'completed'), node('b', 'awaiting')],
      edges: [edge('a-b', 'a', 'b')],
    });
    expect(result.positions).toEqual(unique.positions);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].taken).toBe(true);
  });

  test('index exports layout as the only runtime value', () => {
    expect(Object.keys(runGraph)).toEqual(['layout']);
    expect(runGraph.layout).toBe(layout);
  });
});
