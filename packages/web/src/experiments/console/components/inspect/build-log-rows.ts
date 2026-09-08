/**
 * Chronological console Log rows.
 *
 * When server nodeExecutions are available they are the authoritative source:
 * each occurrence is keyed by occurrence_id (or attempt_id), which avoids
 * using node-id + iteration as a composite identity for distinct executions.
 *
 * Absent nodeExecutions the function falls back to event-based reconstruction
 * so runs started before Phase 2 server support remain displayable.
 */
import type { NodeExecution, WorkflowEvent, WorkflowNodeState } from '../../skills/runs';

export type LogRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number }
  | {
      kind: 'occurrence';
      occurrenceId: string;
      attemptId?: string;
      retryEpoch?: number;
      iteration?: number;
    };

export interface LogRow {
  id: string;
  nodeId: string;
  label: string;
  status: WorkflowNodeState['status'];
  order: number;
  sourceIndex: number;
  selection: LogRowSelection;
  /** ISO string – present when built from server nodeExecutions */
  startedAt?: string;
  /** ms duration – present when built from server nodeExecutions */
  durationMs?: number;
  startedOffsetMs?: number;
  unknownScope?: boolean;
}

function startedOffsetMs(
  startedAt: string | undefined,
  runStartedAt: string | undefined
): number | undefined {
  if (startedAt === undefined || runStartedAt === undefined || runStartedAt.length === 0) {
    return undefined;
  }
  const started = Date.parse(startedAt);
  const runStarted = Date.parse(runStartedAt);
  if (!Number.isFinite(started) || !Number.isFinite(runStarted)) return undefined;
  return Math.max(0, started - runStarted);
}

function derivedTiming(
  unknownScope: boolean,
  startedAt: string | undefined,
  runStartedAt: string | undefined
): Pick<LogRow, 'unknownScope' | 'startedOffsetMs'> {
  const offset = startedOffsetMs(startedAt, runStartedAt);
  return offset === undefined ? { unknownScope } : { unknownScope, startedOffsetMs: offset };
}

function eventData(event: WorkflowEvent): Record<string, unknown> {
  return event.data;
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

// ---------------------------------------------------------------------------
// Server-occurrence path
// ---------------------------------------------------------------------------

function statusFromNodeExecution(raw: string): WorkflowNodeState['status'] {
  switch (raw) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'awaiting':
      return 'awaiting';
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

function occurrenceSelection(exec: NodeExecution): LogRowSelection {
  if (exec.occurrence_id === undefined) return { kind: 'node' };
  const lastLoop = exec.loop_ancestry?.[exec.loop_ancestry.length - 1];
  return {
    kind: 'occurrence',
    occurrenceId: exec.occurrence_id,
    attemptId: exec.attempt_id,
    ...(exec.retry_epoch !== undefined ? { retryEpoch: exec.retry_epoch } : {}),
    ...(lastLoop !== undefined ? { iteration: lastLoop.iteration } : {}),
  };
}

function buildFromOccurrences(
  nodeExecutions: readonly NodeExecution[],
  nameById: Map<string, string>,
  runStartedAt: string | undefined
): LogRow[] {
  return nodeExecutions.map((exec, order) => {
    const nodeId = exec.node_id;
    const baseName = nameById.get(nodeId) ?? nodeId;
    const rowId = exec.attempt_id ?? exec.occurrence_id ?? `exec:${nodeId}:${String(order)}`;
    return {
      id: rowId,
      nodeId,
      label: labelForExecution(baseName, exec),
      status: statusFromNodeExecution(exec.status),
      order,
      sourceIndex: order,
      selection: occurrenceSelection(exec),
      startedAt: exec.started_at,
      durationMs: exec.duration_ms,
      ...derivedTiming(exec.occurrence_id === undefined, exec.started_at, runStartedAt),
    };
  });
}

// ---------------------------------------------------------------------------
// Event-based fallback (unchanged from original)
// ---------------------------------------------------------------------------

export function buildLogRows(
  nodeStates: readonly WorkflowNodeState[],
  events: readonly WorkflowEvent[],
  nodeExecutions?: readonly NodeExecution[],
  runStartedAt?: string
): LogRow[] {
  if (nodeExecutions && nodeExecutions.length > 0) {
    const nameById = new Map<string, string>(nodeStates.map(s => [s.nodeId, s.name]));
    return buildFromOccurrences(nodeExecutions, nameById, runStartedAt);
  }

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
        ...derivedTiming(true, existing === undefined ? event.created_at : undefined, runStartedAt),
        ...(existing?.startedOffsetMs !== undefined
          ? { startedOffsetMs: existing.startedOffsetMs }
          : {}),
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
          ...derivedTiming(true, event.created_at, runStartedAt),
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
      ...derivedTiming(
        true,
        eventIndex >= 0 ? events[eventIndex]?.created_at : undefined,
        runStartedAt
      ),
    });
  });
  return rows.sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
}
