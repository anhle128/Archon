import type { WorkflowNodeStateResponse } from '@/lib/api';

import type { LogRow } from './build-log-rows';

export interface GraphRoomLiveStatus {
  nodeId: string;
  name: string;
  status: WorkflowNodeStateResponse['status'];
}

export function resolveGraphRoomRow(input: {
  rows: readonly LogRow[];
  nodeId: string | null;
  liveStatus: readonly GraphRoomLiveStatus[];
}): LogRow | null {
  if (input.nodeId === null) return null;
  const nodeId = input.nodeId;

  let lastOrdinary: LogRow | null = null;
  let lastMatching: LogRow | null = null;
  for (const row of input.rows) {
    if (row.nodeId !== nodeId) continue;
    lastMatching = row;
    if (row.selection.kind === 'node') lastOrdinary = row;
  }
  if (lastOrdinary !== null) return lastOrdinary;
  if (lastMatching !== null) return lastMatching;

  let live: GraphRoomLiveStatus | undefined;
  for (const status of input.liveStatus) {
    if (status.nodeId === nodeId) live = status;
  }

  return {
    id: `node:${nodeId}`,
    nodeId,
    label: live?.name ?? nodeId,
    status: live?.status ?? 'pending',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  };
}
