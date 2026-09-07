/**
 * Chronological Logs rows for the legacy node-run list.
 *
 * When server nodeExecutions are available they are the authoritative source:
 * each occurrence gets its own row keyed by occurrence_id (or attempt_id when
 * present), which prevents node-id + iteration number from acting as a
 * composite key and losing distinct retries or parallel branches.
 *
 * When nodeExecutions is absent the function falls back to the event-based
 * reconstruction so existing runs remain displayable.
 */
import type { NodeExecution, WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';

export type LogRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number }
  | { kind: 'occurrence'; occurrenceId: string; attemptId?: string };

export interface LogRow {
  id: string;
  nodeId: string;
  label: string;
  status: WorkflowNodeStateResponse['status'];
  order: number;
  sourceIndex: number;
  selection: LogRowSelection;
  /** ISO string – present when built from server nodeExecutions */
  startedAt?: string;
  /** ms duration – present when built from server nodeExecutions */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Server-occurrence path
// ---------------------------------------------------------------------------

function statusFromNodeExecution(raw: string): WorkflowNodeStateResponse['status'] {
  switch (raw) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
      return 'pending';
    case 'skipped':
    case 'skipped_prior_success':
    case 'cancelled':
      return 'skipped';
    default:
      return 'running';
  }
}

function labelForExecution(baseName: string, exec: NodeExecution): string {
  if (exec.loop_ancestry && exec.loop_ancestry.length > 0) {
    const last = exec.loop_ancestry[exec.loop_ancestry.length - 1];
    if (last) return `${baseName} ×${String(last.iteration)}`;
  }
  if (typeof exec.route_activation_seq === 'number') {
    return `${baseName} #${String(exec.route_activation_seq)}`;
  }
  return baseName;
}

function buildFromOccurrences(
  nodeExecutions: readonly NodeExecution[],
  nameById: Map<string, string>
): LogRow[] {
  return nodeExecutions.map((exec, order) => {
    const nodeId = exec.node_id;
    const baseName = nameById.get(nodeId) ?? nodeId;
    const rowId = exec.attempt_id ?? exec.occurrence_id ?? `exec:${nodeId}:${String(order)}`;
    const selection: LogRowSelection =
      exec.occurrence_id !== undefined
        ? { kind: 'occurrence', occurrenceId: exec.occurrence_id, attemptId: exec.attempt_id }
        : { kind: 'node' };
    return {
      id: rowId,
      nodeId,
      label: labelForExecution(baseName, exec),
      status: statusFromNodeExecution(exec.status),
      order,
      sourceIndex: order,
      selection,
      startedAt: exec.started_at,
      durationMs: exec.duration_ms,
    };
  });
}

// ---------------------------------------------------------------------------
// Event-based fallback (unchanged from original)
// ---------------------------------------------------------------------------

export function buildLogRows(
  nodeStates: readonly WorkflowNodeStateResponse[],
  events: readonly WorkflowEventResponse[],
  nodeExecutions?: readonly NodeExecution[]
): LogRow[] {
  if (nodeExecutions && nodeExecutions.length > 0) {
    const nameById = new Map<string, string>(nodeStates.map(s => [s.nodeId, s.name]));
    return buildFromOccurrences(nodeExecutions, nameById);
  }

  const statesById = new Map<string, { state: WorkflowNodeStateResponse; index: number }>();
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
      const iteration = event.data.iteration;
      if (typeof iteration !== 'number' || !Number.isSafeInteger(iteration) || iteration < 1)
        return;
      const rows = loopRowsByNode.get(nodeId) ?? new Map<number, LogRow>();
      const existing = rows.get(iteration);
      const status: WorkflowNodeStateResponse['status'] =
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
      const executionSeq = event.data.execution_seq;
      if (
        typeof executionSeq !== 'number' ||
        !Number.isSafeInteger(executionSeq) ||
        executionSeq < 1
      ) {
        return;
      }
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
