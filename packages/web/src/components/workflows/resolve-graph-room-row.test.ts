import { describe, expect, test } from 'bun:test';

import type { LogRow } from './build-log-rows';
import { resolveGraphRoomRow, type GraphRoomLiveStatus } from './resolve-graph-room-row';

function row(overrides: Partial<LogRow> & Pick<LogRow, 'id' | 'nodeId'>): LogRow {
  return {
    label: overrides.label ?? overrides.nodeId,
    status: overrides.status ?? 'pending',
    order: overrides.order ?? 0,
    sourceIndex: overrides.sourceIndex ?? 0,
    selection: overrides.selection ?? { kind: 'node' },
    ...overrides,
  };
}

function live(
  nodeId: string,
  name: string,
  status: GraphRoomLiveStatus['status']
): GraphRoomLiveStatus {
  return { nodeId, name, status };
}

describe('resolveGraphRoomRow', () => {
  test('null node selection returns null', () => {
    expect(
      resolveGraphRoomRow({
        rows: [row({ id: 'node:a', nodeId: 'a' })],
        nodeId: null,
        liveStatus: [live('a', 'A', 'running')],
      })
    ).toBeNull();
  });

  test('an ordinary matching row wins over iteration rows regardless of array position', () => {
    const ordinary = row({
      id: 'node:loop',
      nodeId: 'loop',
      label: 'Loop',
      status: 'completed',
      order: 9,
      sourceIndex: 0,
      selection: { kind: 'node' },
    });
    const firstIteration = row({
      id: 'iter-1',
      nodeId: 'loop',
      label: 'Loop ×1',
      status: 'completed',
      order: 1,
      sourceIndex: 0,
      selection: { kind: 'loop_iteration', iteration: 1 },
    });
    const lastIteration = row({
      id: 'iter-2',
      nodeId: 'loop',
      label: 'Loop ×2',
      status: 'running',
      order: 2,
      sourceIndex: 0,
      selection: { kind: 'loop_iteration', iteration: 2 },
    });
    expect(
      resolveGraphRoomRow({
        rows: [firstIteration, lastIteration, ordinary],
        nodeId: 'loop',
        liveStatus: [],
      })
    ).toBe(ordinary);
    expect(
      resolveGraphRoomRow({
        rows: [ordinary, firstIteration, lastIteration],
        nodeId: 'loop',
        liveStatus: [],
      })
    ).toBe(ordinary);
  });

  test('when no ordinary row exists, the last matching iteration row wins', () => {
    const firstIteration = row({
      id: 'iter-1',
      nodeId: 'loop',
      label: 'Loop ×1',
      status: 'completed',
      selection: { kind: 'loop_iteration', iteration: 1 },
    });
    const lastIteration = row({
      id: 'iter-2',
      nodeId: 'loop',
      label: 'Loop ×2',
      status: 'failed',
      selection: { kind: 'loop_iteration', iteration: 2 },
    });
    expect(
      resolveGraphRoomRow({
        rows: [firstIteration, lastIteration],
        nodeId: 'loop',
        liveStatus: [live('loop', 'Loop', 'failed')],
      })
    ).toBe(lastIteration);
  });

  test('rows for other nodes are ignored', () => {
    const other = row({ id: 'node:other', nodeId: 'other', label: 'Other' });
    const match = row({ id: 'node:work', nodeId: 'work', label: 'Work', status: 'running' });
    expect(
      resolveGraphRoomRow({
        rows: [other, match],
        nodeId: 'work',
        liveStatus: [live('other', 'Other', 'completed')],
      })
    ).toBe(match);
  });

  test('no row plus live status produces the exact synthetic row', () => {
    expect(
      resolveGraphRoomRow({
        rows: [row({ id: 'node:other', nodeId: 'other' })],
        nodeId: 'setup',
        liveStatus: [live('setup', 'Setup', 'completed')],
      })
    ).toEqual({
      id: 'node:setup',
      nodeId: 'setup',
      label: 'Setup',
      status: 'completed',
      order: 0,
      sourceIndex: 0,
      selection: { kind: 'node' },
      unknownScope: true,
    });
  });

  test('no row and no live status produces a pending synthetic row labelled with the node id', () => {
    expect(
      resolveGraphRoomRow({
        rows: [],
        nodeId: 'ghost',
        liveStatus: [],
      })
    ).toEqual({
      id: 'node:ghost',
      nodeId: 'ghost',
      label: 'ghost',
      status: 'pending',
      order: 0,
      sourceIndex: 0,
      selection: { kind: 'node' },
      unknownScope: true,
    });
  });

  test('duplicate live statuses use the last match', () => {
    expect(
      resolveGraphRoomRow({
        rows: [],
        nodeId: 'work',
        liveStatus: [live('work', 'First', 'pending'), live('work', 'Last', 'failed')],
      })
    ).toEqual({
      id: 'node:work',
      nodeId: 'work',
      label: 'Last',
      status: 'failed',
      order: 0,
      sourceIndex: 0,
      selection: { kind: 'node' },
      unknownScope: true,
    });
  });
});
