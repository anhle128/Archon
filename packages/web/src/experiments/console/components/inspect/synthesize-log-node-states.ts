/**
 * Deterministic fallback nodeStates for incomplete historical payloads.
 *
 * Existing projected states always win. Synthetics are added only for missing
 * node ids represented by loop-iteration metadata or a selectable declared pause.
 */
import type { WorkflowEvent, WorkflowNodeState } from '../../skills/runs';
import { readApprovalContext } from './read-approval-context';

function eventData(event: WorkflowEvent): Record<string, unknown> {
  return event.data;
}

function resolveSyntheticNodeId(event: WorkflowEvent): string | null {
  if (typeof event.step_name === 'string' && event.step_name !== '') return event.step_name;
  const nodeId = eventData(event).nodeId;
  return typeof nodeId === 'string' && nodeId !== '' ? nodeId : null;
}

function loopSyntheticStatus(eventType: string): WorkflowNodeState['status'] | null {
  if (eventType === 'loop_iteration_started') return 'running';
  if (eventType === 'loop_iteration_completed') return 'completed';
  if (eventType === 'loop_iteration_failed') return 'failed';
  return null;
}

function isSelectableApprovalRequested(event: WorkflowEvent): boolean {
  if (event.event_type !== 'approval_requested') return false;
  const gateType = eventData(event).gateType;
  return gateType === 'approval' || gateType === 'plannotator_gate';
}

function isSelectablePausedApproval(type: string | undefined): boolean {
  return (
    type === undefined ||
    type === 'approval' ||
    type === 'plannotator_gate' ||
    type === 'child_workflow'
  );
}

function syntheticState(nodeId: string, status: WorkflowNodeState['status']): WorkflowNodeState {
  return { nodeId, name: nodeId, status, retryEpoch: 0 };
}

export function synthesizeLogNodeStates(
  nodeStates: readonly WorkflowNodeState[],
  events: readonly WorkflowEvent[],
  runStatus: string,
  approval: unknown
): WorkflowNodeState[] {
  const originalIds = new Set(nodeStates.map(state => state.nodeId));
  const synthetics = new Map<string, WorkflowNodeState>();

  for (const event of events) {
    const loopStatus = loopSyntheticStatus(event.event_type);
    if (loopStatus === null && !isSelectableApprovalRequested(event)) continue;
    const nodeId = resolveSyntheticNodeId(event);
    if (nodeId === null || originalIds.has(nodeId)) continue;
    const status = loopStatus ?? 'running';
    synthetics.set(nodeId, syntheticState(nodeId, status));
  }

  if (runStatus === 'paused') {
    const parsed = readApprovalContext(approval);
    if (
      parsed !== null &&
      isSelectablePausedApproval(parsed.type) &&
      !originalIds.has(parsed.nodeId) &&
      !synthetics.has(parsed.nodeId)
    ) {
      synthetics.set(parsed.nodeId, syntheticState(parsed.nodeId, 'running'));
    }
  }

  return [...nodeStates, ...synthetics.values()];
}
