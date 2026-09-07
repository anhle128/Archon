import type { LogRow, LogRowSelection } from './build-log-rows';
import type { ChatTimelineEntry } from './build-chat-timeline';
import { resolveGraphRoomRow, type GraphRoomLiveStatus } from './resolve-graph-room-row';

function selectionsEqual(left: LogRowSelection, right: LogRowSelection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'node') return true;
  if (left.kind === 'loop_iteration' && right.kind === 'loop_iteration') {
    return left.iteration === right.iteration;
  }
  if (left.kind === 'route_iteration' && right.kind === 'route_iteration') {
    return left.executionSeq === right.executionSeq;
  }
  if (left.kind === 'occurrence' && right.kind === 'occurrence') {
    return left.occurrenceId === right.occurrenceId && left.attemptId === right.attemptId;
  }
  return false;
}

export function resolveTimelineRoomRow(input: {
  rows: readonly LogRow[];
  entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow {
  for (let index = input.rows.length - 1; index >= 0; index -= 1) {
    const row = input.rows[index];
    if (row === undefined) continue;
    if (
      row.nodeId === input.entry.nodeId &&
      selectionsEqual(row.selection, input.entry.selection)
    ) {
      return row;
    }
  }
  const fallback = resolveGraphRoomRow({
    rows: input.rows,
    nodeId: input.entry.nodeId,
    liveStatus: input.liveStatus,
  });
  if (fallback === null) {
    throw new Error('Timeline node selection did not resolve a room row');
  }
  return fallback;
}
