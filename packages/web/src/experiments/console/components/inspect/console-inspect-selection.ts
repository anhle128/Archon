/**
 * URL/live/replay inspect selection. Pure helpers; no browser globals.
 */
import type { WorkflowNodeState } from '../../skills/runs';
import type { LogRow } from './build-log-rows';
import { inspectStatus } from './inspect-status';

export interface InspectSelection {
  nodeId: string | null;
  logRowId: string | null;
}

function firstRowForNode(rows: readonly LogRow[], nodeId: string): LogRow | undefined {
  return rows.find(row => row.nodeId === nodeId);
}

function isKnownNode(
  nodeId: string,
  nodeStates: readonly WorkflowNodeState[],
  rows: readonly LogRow[]
): boolean {
  return (
    nodeStates.some(state => state.nodeId === nodeId) || rows.some(row => row.nodeId === nodeId)
  );
}

function selectionForNode(nodeId: string, rows: readonly LogRow[]): InspectSelection {
  return { nodeId, logRowId: firstRowForNode(rows, nodeId)?.id ?? null };
}

export function readNodeSearchParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get('node');
  return value !== null && value !== '' ? value : null;
}

export function resolveInitialInspectSelection(input: {
  requestedNodeId: string | null;
  nodeStates: readonly WorkflowNodeState[];
  rows: readonly LogRow[];
  approvalNodeId: string | null;
}): InspectSelection {
  const { requestedNodeId, nodeStates, rows, approvalNodeId } = input;
  if (requestedNodeId !== null && isKnownNode(requestedNodeId, nodeStates, rows)) {
    return { nodeId: requestedNodeId, logRowId: null };
  }

  const awaiting = nodeStates.find(state => inspectStatus(state.status) === 'awaiting');
  if (awaiting !== undefined) return selectionForNode(awaiting.nodeId, rows);

  const running = nodeStates.find(state => inspectStatus(state.status) === 'running');
  if (running !== undefined) return selectionForNode(running.nodeId, rows);

  if (approvalNodeId !== null) return selectionForNode(approvalNodeId, rows);

  const firstRow = rows[0];
  if (firstRow !== undefined) {
    return { nodeId: firstRow.nodeId, logRowId: firstRow.id };
  }

  return { nodeId: null, logRowId: null };
}

export function selectInspectNode(nodeId: string, rowId: string | null): InspectSelection {
  return { nodeId, logRowId: rowId };
}
