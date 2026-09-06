import { describe, expect, test } from 'bun:test';

import { assignCommitLanes } from './commit-lanes';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const E = 'e'.repeat(40);

function oidAt(index: number): string {
  return index.toString(16).padStart(40, '0');
}

describe('assignCommitLanes', () => {
  test('places a linear history on lane 0', () => {
    const graph = assignCommitLanes([
      { oid: C, parents: [B] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(graph.rows).toEqual([
      {
        oid: C,
        lane: 0,
        incomingLanes: [],
        throughLanes: [],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: B,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: A,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [],
        parentLanes: [],
        isMerge: false,
      },
    ]);
    expect(graph.laneCount).toBe(1);
  });

  test('draws merge fan-out, a through lane, and later convergence with literal lanes', () => {
    const graph = assignCommitLanes([
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(graph).toEqual({
      laneCount: 2,
      rows: [
        {
          oid: D,
          lane: 0,
          incomingLanes: [],
          throughLanes: [],
          parentLanes: [0, 1],
          isMerge: true,
        },
        {
          oid: C,
          lane: 0,
          incomingLanes: [0],
          throughLanes: [1],
          parentLanes: [0],
          isMerge: false,
        },
        {
          oid: B,
          lane: 1,
          incomingLanes: [1],
          throughLanes: [0],
          parentLanes: [0],
          isMerge: false,
        },
        {
          oid: A,
          lane: 0,
          incomingLanes: [0],
          throughLanes: [],
          parentLanes: [],
          isMerge: false,
        },
      ],
    });
  });

  test('keeps an octopus merge on one row with three parent lanes', () => {
    const graph = assignCommitLanes([
      { oid: E, parents: [A, B, C] },
      { oid: A, parents: [] },
      { oid: B, parents: [] },
      { oid: C, parents: [] },
    ]);
    expect(graph.rows[0]).toEqual({
      oid: E,
      lane: 0,
      incomingLanes: [],
      throughLanes: [],
      parentLanes: [0, 1, 2],
      isMerge: true,
    });
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 1, 2]);
    expect(graph.laneCount).toBe(3);
  });

  test('places a root commit with empty parents on lane 0', () => {
    const graph = assignCommitLanes([{ oid: A, parents: [] }]);

    expect(graph).toEqual({
      laneCount: 1,
      rows: [
        {
          oid: A,
          lane: 0,
          incomingLanes: [],
          throughLanes: [],
          parentLanes: [],
          isMerge: false,
        },
      ],
    });
  });

  test('returns an empty graph', () => {
    expect(assignCommitLanes([])).toEqual({ rows: [], laneCount: 0 });
  });

  test('keeps literal lane continuity when callers window the already-computed rows', () => {
    const full = assignCommitLanes([
      { oid: D, parents: [C, B] },
      { oid: C, parents: [A] },
      { oid: B, parents: [A] },
      { oid: A, parents: [] },
    ]);

    expect(full.rows.slice(1, 3)).toEqual([
      {
        oid: C,
        lane: 0,
        incomingLanes: [0],
        throughLanes: [1],
        parentLanes: [0],
        isMerge: false,
      },
      {
        oid: B,
        lane: 1,
        incomingLanes: [1],
        throughLanes: [0],
        parentLanes: [0],
        isMerge: false,
      },
    ]);
  });

  test('keeps a 500-commit linear history on lane 0', () => {
    const oids = Array.from({ length: 500 }, (_, index) => oidAt(index));
    const commits = oids.map((oid, index) => ({
      oid,
      parents: index === 499 ? [] : [oids[index + 1] ?? ''],
    }));

    const graph = assignCommitLanes(commits);

    expect(graph.laneCount).toBe(1);
    expect(graph.rows).toHaveLength(500);
    expect(graph.rows.every(row => row.lane === 0)).toBe(true);
    expect(graph.rows[0]?.parentLanes).toEqual([0]);
    expect(graph.rows[499]?.parentLanes).toEqual([]);
    expect(assignCommitLanes(commits)).toEqual(graph);
  });
});
