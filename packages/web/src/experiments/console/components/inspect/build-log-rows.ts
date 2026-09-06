/**
 * Chronological console Log rows.
 *
 * Server-projected nodeStates remain the lifecycle source. Workflow events
 * only describe loop, route-loop, and approval-gate executions as list metadata.
 */
import type { WorkflowEvent, WorkflowNodeState } from '../../skills/runs';

export type LogRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number };

export interface LogRow {
  id: string;
  nodeId: string;
  label: string;
  status: WorkflowNodeState['status'];
  order: number;
  sourceIndex: number;
  selection: LogRowSelection;
}

function eventData(event: WorkflowEvent): Record<string, unknown> {
  return event.data;
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function buildLogRows(
  nodeStates: readonly WorkflowNodeState[],
  events: readonly WorkflowEvent[]
): LogRow[] {
  const statesById = new Map<string, { state: WorkflowNodeState; index: number }>();
  nodeStates.forEach((state, index) => statesById.set(state.nodeId, { state, index }));
  const loopRowsByNode = new Map<string, Map<number, LogRow>>();
  const routeRowsByNode = new Map<string, Map<number, LogRow>>();

  events.forEach((event, order) => {
    const nodeId = event.step_name;
    if (!nodeId) return;
    const stateEntry = statesById.get(nodeId);
    if (!stateEntry) return;
    if (
      event.event_type === 'loop_iteration_started' ||
      event.event_type === 'loop_iteration_completed' ||
      event.event_type === 'loop_iteration_failed'
    ) {
      const iteration = readPositiveSafeInteger(eventData(event).iteration);
      if (iteration === null) return;
      const rows = loopRowsByNode.get(nodeId) ?? new Map<number, LogRow>();
      const existing = rows.get(iteration);
      const status: WorkflowNodeState['status'] =
        event.event_type === 'loop_iteration_failed'
          ? 'failed'
          : event.event_type === 'loop_iteration_completed'
            ? 'completed'
            : 'running';
      rows.set(iteration, {
        id: existing?.id ?? event.id,
        nodeId,
        label: `${stateEntry.state.name} ×${String(iteration)}`,
        status,
        order: existing?.order ?? order,
        sourceIndex: stateEntry.index,
        selection: { kind: 'loop_iteration', iteration },
      });
      loopRowsByNode.set(nodeId, rows);
      return;
    }
    if (event.event_type === 'node_routed') {
      const executionSeq = readPositiveSafeInteger(eventData(event).execution_seq);
      if (executionSeq === null) return;
      const rows = routeRowsByNode.get(nodeId) ?? new Map<number, LogRow>();
      if (!rows.has(executionSeq)) {
        rows.set(executionSeq, {
          id: event.id,
          nodeId,
          label: `${stateEntry.state.name} #${String(executionSeq)}`,
          status: 'completed',
          order,
          sourceIndex: stateEntry.index,
          selection: { kind: 'route_iteration', executionSeq },
        });
      }
      routeRowsByNode.set(nodeId, rows);
    }
  });

  const lifecycleTypes = new Set([
    'node_started',
    'node_completed',
    'node_failed',
    'node_skipped',
    'node_skipped_prior_success',
    'approval_requested',
  ]);
  const rows: LogRow[] = [];
  nodeStates.forEach((state, sourceIndex) => {
    const loopRows = loopRowsByNode.get(state.nodeId);
    if (loopRows) {
      rows.push(...loopRows.values());
      return;
    }
    const routeRows = routeRowsByNode.get(state.nodeId);
    if (routeRows) {
      rows.push(...routeRows.values());
      return;
    }
    let eventIndex = -1;
    for (let index = events.length - 1; index >= 0; index--) {
      if (
        events[index]?.step_name === state.nodeId &&
        events[index]?.event_type === 'node_started'
      ) {
        eventIndex = index;
        break;
      }
    }
    if (eventIndex < 0) {
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event?.step_name === state.nodeId && lifecycleTypes.has(event.event_type)) {
          eventIndex = index;
          break;
        }
      }
    }
    rows.push({
      id:
        eventIndex >= 0
          ? (events[eventIndex]?.id ?? `node:${state.nodeId}`)
          : `node:${state.nodeId}`,
      nodeId: state.nodeId,
      label: state.name,
      status: state.status,
      order: eventIndex >= 0 ? eventIndex : events.length + sourceIndex,
      sourceIndex,
      selection: { kind: 'node' },
    });
  });
  return rows.sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
}
