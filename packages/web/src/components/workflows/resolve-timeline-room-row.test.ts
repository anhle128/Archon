import { describe, expect, test } from 'bun:test';

import type { LogRow } from './build-log-rows';
import type { ChatTimelineEntry } from './build-chat-timeline';
import { resolveTimelineRoomRow } from './resolve-timeline-room-row';
import type { GraphRoomLiveStatus } from './resolve-graph-room-row';

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

function nodeStatus(
  overrides: Partial<Extract<ChatTimelineEntry, { kind: 'node_status' }>> &
    Pick<Extract<ChatTimelineEntry, { kind: 'node_status' }>, 'id' | 'nodeId' | 'selection'>
): Extract<ChatTimelineEntry, { kind: 'node_status' }> {
  return {
    kind: 'node_status',
    createdAt: '2026-09-06T00:00:00.000Z',
    label: overrides.label ?? overrides.nodeId,
    nodeType: 'command',
    status: 'running',
    detail: 'started',
    ...overrides,
  };
}

const rows: readonly LogRow[] = [
  {
    id: 'ordinary',
    nodeId: 'group',
    label: 'Group',
    status: 'running',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  },
  {
    id: 'iteration-2',
    nodeId: 'group',
    label: 'Group ×2',
    status: 'completed',
    order: 1,
    sourceIndex: 0,
    selection: { kind: 'loop_iteration', iteration: 2 },
  },
];

describe('resolveTimelineRoomRow', () => {
  test('returns the last ordinary row for a node selection, not an earlier iteration row', () => {
    const laterOrdinary = row({
      id: 'ordinary-later',
      nodeId: 'group',
      label: 'Group',
      status: 'completed',
      order: 2,
      selection: { kind: 'node' },
    });
    const mixed: readonly LogRow[] = [rows[0]!, rows[1]!, laterOrdinary];

    expect(
      resolveTimelineRoomRow({
        rows: mixed,
        entry: nodeStatus({
          id: 'ordinary-finished',
          nodeId: 'group',
          label: 'Group',
          status: 'completed',
          detail: 'completed',
          selection: { kind: 'node' },
        }),
        liveStatus: [],
      })
    ).toBe(laterOrdinary);
  });

  test('returns the exact loop iteration before graph fallback', () => {
    expect(
      resolveTimelineRoomRow({
        rows,
        entry: {
          kind: 'node_status',
          id: 'iteration-finished',
          createdAt: '2026-09-06T00:00:02.000Z',
          nodeId: 'group',
          label: 'Group ×2',
          nodeType: 'loop_group',
          status: 'completed',
          detail: 'iteration 2 completed',
          selection: { kind: 'loop_iteration', iteration: 2 },
        },
        liveStatus: [],
      })
    ).toBe(rows[1]);
  });

  test('returns the matching route row for a route iteration selection', () => {
    const routeFour = row({
      id: 'route-4',
      nodeId: 'router',
      label: 'Router #4',
      status: 'completed',
      order: 1,
      selection: { kind: 'route_iteration', executionSeq: 4 },
    });
    const routeRows: readonly LogRow[] = [
      row({
        id: 'router-ordinary',
        nodeId: 'router',
        label: 'Router',
        status: 'running',
        order: 0,
        selection: { kind: 'node' },
      }),
      row({
        id: 'route-3',
        nodeId: 'router',
        label: 'Router #3',
        status: 'completed',
        order: 1,
        selection: { kind: 'route_iteration', executionSeq: 3 },
      }),
      routeFour,
    ];

    expect(
      resolveTimelineRoomRow({
        rows: routeRows,
        entry: nodeStatus({
          id: 'routed-4',
          nodeId: 'router',
          label: 'Router #4',
          nodeType: 'route_loop',
          status: 'completed',
          detail: 'routed success → next',
          selection: { kind: 'route_iteration', executionSeq: 4 },
        }),
        liveStatus: [],
      })
    ).toBe(routeFour);
  });

  test('falls through to resolveGraphRoomRow when no matching loop iteration exists', () => {
    expect(
      resolveTimelineRoomRow({
        rows,
        entry: nodeStatus({
          id: 'iteration-3',
          nodeId: 'group',
          label: 'Group ×3',
          nodeType: 'loop_group',
          status: 'running',
          detail: 'iteration 3 started',
          selection: { kind: 'loop_iteration', iteration: 3 },
        }),
        liveStatus: [],
      })
    ).toBe(rows[0]);
  });

  test('falls through to a synthetic pending row when the node has no log rows', () => {
    expect(
      resolveTimelineRoomRow({
        rows: [
          row({
            id: 'other',
            nodeId: 'other',
            label: 'Other',
            selection: { kind: 'loop_iteration', iteration: 2 },
          }),
        ],
        entry: nodeStatus({
          id: 'missing',
          nodeId: 'group',
          label: 'Group ×2',
          nodeType: 'loop_group',
          selection: { kind: 'loop_iteration', iteration: 2 },
        }),
        liveStatus: [live('group', 'Group', 'pending')],
      })
    ).toEqual({
      id: 'node:group',
      nodeId: 'group',
      label: 'Group',
      status: 'pending',
      order: 0,
      sourceIndex: 0,
      selection: { kind: 'node' },
    });
  });

  test('rows for other nodes are ignored', () => {
    const target = row({
      id: 'review-ordinary',
      nodeId: 'review',
      label: 'Review',
      status: 'running',
      selection: { kind: 'node' },
    });

    expect(
      resolveTimelineRoomRow({
        rows: [
          row({
            id: 'other-ordinary',
            nodeId: 'other',
            label: 'Other',
            status: 'completed',
            selection: { kind: 'node' },
          }),
          row({
            id: 'other-loop',
            nodeId: 'other',
            label: 'Other ×2',
            status: 'completed',
            selection: { kind: 'loop_iteration', iteration: 2 },
          }),
          target,
        ],
        entry: nodeStatus({
          id: 'review-started',
          nodeId: 'review',
          label: 'Review',
          selection: { kind: 'node' },
        }),
        liveStatus: [],
      })
    ).toBe(target);
  });

  test('returned nodeId always equals entry.nodeId', () => {
    const exact = resolveTimelineRoomRow({
      rows,
      entry: nodeStatus({
        id: 'iteration-finished',
        nodeId: 'group',
        label: 'Group ×2',
        nodeType: 'loop_group',
        status: 'completed',
        detail: 'iteration 2 completed',
        selection: { kind: 'loop_iteration', iteration: 2 },
      }),
      liveStatus: [],
    });
    expect(exact.nodeId).toBe('group');

    const fallback = resolveTimelineRoomRow({
      rows: [row({ id: 'other', nodeId: 'other', selection: { kind: 'node' } })],
      entry: nodeStatus({
        id: 'review-started',
        nodeId: 'review',
        label: 'Review',
        selection: { kind: 'node' },
      }),
      liveStatus: [live('review', 'Review', 'running')],
    });
    expect(fallback.nodeId).toBe('review');
  });
});
