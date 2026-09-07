/**
 * Server-owned workflow execution history.
 *
 * Groups lifecycle events into ordered occurrences without selecting
 * transcript bodies. Old rows without occurrence_id are paired from
 * unambiguous start/terminal markers; overlapping unmarked starts stay
 * unknown-scope rather than being assigned to the first iteration.
 */
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import { nodeExecutionSchema, type NodeExecution } from '@archon/workflows/schemas/node-execution';
import type { PendingInteraction } from '@archon/workflows/schemas/pending-interaction';

const START_EVENTS = new Set(['node_started', 'loop_iteration_started']);
const TERMINAL_EVENTS = new Set([
  'node_completed',
  'node_failed',
  'node_skipped',
  'node_skipped_prior_success',
  'loop_iteration_completed',
  'loop_iteration_failed',
]);

export interface ProjectWorkflowExecutionHistoryInput {
  events: readonly WorkflowEventRow[];
  pendingInteractions?: readonly PendingInteraction[];
  runStartedAt?: string;
}

function asRecord(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asEpoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asLoopAncestry(value: unknown): NodeExecution['loop_ancestry'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: NonNullable<NodeExecution['loop_ancestry']> = [];
  for (const item of value) {
    const rec = asRecord(item);
    const nodeId = asString(rec.node_id);
    if (nodeId === undefined) return undefined;
    if (
      typeof rec.iteration !== 'number' ||
      !Number.isInteger(rec.iteration) ||
      rec.iteration < 1
    ) {
      return undefined;
    }
    entries.push({ node_id: nodeId, iteration: rec.iteration });
  }
  return entries;
}

function eventMs(row: WorkflowEventRow): number {
  const parsed = Date.parse(row.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEvents(events: readonly WorkflowEventRow[]): WorkflowEventRow[] {
  return events.slice().sort((left, right) => {
    const orderLeft = left.event_order ?? Number.MAX_SAFE_INTEGER;
    const orderRight = right.event_order ?? Number.MAX_SAFE_INTEGER;
    if (orderLeft !== orderRight) return orderLeft - orderRight;
    const byTime = eventMs(left) - eventMs(right);
    if (byTime !== 0) return byTime;
    return left.id.localeCompare(right.id);
  });
}

function statusFromEvent(eventType: string, data: Record<string, unknown>): string {
  if (eventType === 'node_completed' || eventType === 'loop_iteration_completed')
    return 'completed';
  if (eventType === 'node_failed' || eventType === 'loop_iteration_failed') return 'failed';
  if (eventType === 'node_skipped' || eventType === 'node_skipped_prior_success') return 'skipped';
  if (eventType === 'node_started' || eventType === 'loop_iteration_started') return 'running';
  const awaiting = asString(data.state);
  return awaiting ?? eventType;
}

function pushOccurrence(
  openByOccurrence: Map<string, NodeExecution[]>,
  occurrenceId: string,
  execution: NodeExecution
): void {
  const stack = openByOccurrence.get(occurrenceId);
  if (stack === undefined) openByOccurrence.set(occurrenceId, [execution]);
  else stack.push(execution);
}

function popOccurrence(
  openByOccurrence: Map<string, NodeExecution[]>,
  occurrenceId: string
): NodeExecution | undefined {
  const stack = openByOccurrence.get(occurrenceId);
  if (stack === undefined || stack.length === 0) return undefined;
  const open = stack.pop();
  if (stack.length === 0) openByOccurrence.delete(occurrenceId);
  return open;
}

function closeExecution(
  open: NodeExecution,
  row: WorkflowEventRow,
  data: Record<string, unknown>,
  runStartedMs: number | undefined
): NodeExecution {
  const endedAt = row.created_at;
  const startedMs = open.started_at !== undefined ? Date.parse(open.started_at) : Number.NaN;
  const endedMs = Date.parse(endedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
      ? endedMs - startedMs
      : undefined;
  const startOffsetMs =
    runStartedMs !== undefined && Number.isFinite(startedMs) && startedMs >= runStartedMs
      ? startedMs - runStartedMs
      : open.start_offset_ms;
  return nodeExecutionSchema.parse({
    ...open,
    status: statusFromEvent(row.event_type, data),
    ended_at: endedAt,
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(startOffsetMs !== undefined ? { start_offset_ms: startOffsetMs } : {}),
    ...(asString(data.error) !== undefined ? { error: asString(data.error) } : {}),
  });
}

export function projectWorkflowExecutionHistory(
  input: ProjectWorkflowExecutionHistoryInput
): NodeExecution[] {
  const runStartedMs =
    input.runStartedAt !== undefined ? Date.parse(input.runStartedAt) : Number.NaN;
  const runStart = Number.isFinite(runStartedMs) ? runStartedMs : undefined;
  const completed: NodeExecution[] = [];
  const openByOccurrence = new Map<string, NodeExecution[]>();
  const openUnscopedByStep = new Map<string, NodeExecution>();

  for (const row of sortEvents(input.events)) {
    const stepName = row.step_name;
    if (stepName === null || stepName.length === 0) continue;
    const data = asRecord(row.data);
    const occurrenceId = asString(data.occurrence_id);
    const attemptId = asString(data.attempt_id);
    const retryEpoch = asEpoch(data.retry_epoch);
    const nodeType = asString(data.type);

    if (START_EVENTS.has(row.event_type)) {
      const startOffsetMs =
        runStart !== undefined ? Math.max(0, eventMs(row) - runStart) : undefined;
      const loopAncestry = asLoopAncestry(data.loop_ancestry);
      const routeActivationSeq = asEpoch(data.route_activation_seq);
      const base: NodeExecution = nodeExecutionSchema.parse({
        node_id: stepName,
        status: 'running',
        started_at: row.created_at,
        ...(nodeType !== undefined ? { node_type: nodeType } : {}),
        ...(occurrenceId !== undefined ? { occurrence_id: occurrenceId } : {}),
        ...(attemptId !== undefined ? { attempt_id: attemptId } : {}),
        ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
        ...(loopAncestry !== undefined ? { loop_ancestry: loopAncestry } : {}),
        ...(routeActivationSeq !== undefined ? { route_activation_seq: routeActivationSeq } : {}),
        ...(startOffsetMs !== undefined ? { start_offset_ms: startOffsetMs } : {}),
      });
      if (occurrenceId !== undefined) {
        pushOccurrence(openByOccurrence, occurrenceId, base);
        continue;
      }
      const previousUnscoped = openUnscopedByStep.get(stepName);
      if (previousUnscoped !== undefined) {
        completed.push(
          nodeExecutionSchema.parse({
            ...previousUnscoped,
            unknown_scope: true,
            unknown_reason: 'overlapping_unscoped_starts',
          })
        );
      }
      openUnscopedByStep.set(stepName, base);
      continue;
    }

    if (!TERMINAL_EVENTS.has(row.event_type)) continue;

    if (occurrenceId !== undefined) {
      const open = popOccurrence(openByOccurrence, occurrenceId);
      if (open !== undefined) {
        completed.push(closeExecution(open, row, data, runStart));
        continue;
      }
      if (row.event_type === 'node_skipped' || row.event_type === 'node_skipped_prior_success') {
        completed.push(
          nodeExecutionSchema.parse({
            node_id: stepName,
            status: 'skipped',
            ended_at: row.created_at,
            started_at: row.created_at,
            ...(asString(data.type) !== undefined ? { node_type: asString(data.type) } : {}),
            occurrence_id: occurrenceId,
            ...(attemptId !== undefined ? { attempt_id: attemptId } : {}),
            ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
          })
        );
        continue;
      }
    }
    const unscoped = openUnscopedByStep.get(stepName);
    if (unscoped !== undefined) {
      completed.push(closeExecution(unscoped, row, data, runStart));
      openUnscopedByStep.delete(stepName);
      continue;
    }
    completed.push(
      nodeExecutionSchema.parse({
        node_id: stepName,
        status: statusFromEvent(row.event_type, data),
        ended_at: row.created_at,
        unknown_scope: true,
        unknown_reason: 'terminal_without_matching_start',
        ...(asString(data.error) !== undefined ? { error: asString(data.error) } : {}),
        ...(occurrenceId !== undefined ? { occurrence_id: occurrenceId } : {}),
        ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
      })
    );
  }

  for (const stack of openByOccurrence.values()) {
    for (const open of stack) completed.push(open);
  }
  for (const open of openUnscopedByStep.values()) completed.push(open);

  const awaiting = (input.pendingInteractions ?? []).filter(row => row.status === 'pending');
  for (const pending of awaiting) {
    const scope = pending.execution_scope;
    if (scope?.occurrence_id !== undefined) {
      const existing = completed.find(item => item.occurrence_id === scope.occurrence_id);
      if (existing !== undefined) {
        existing.status = 'awaiting';
        continue;
      }
    }
    completed.push(
      nodeExecutionSchema.parse({
        node_id: pending.node_id,
        status: 'awaiting',
        ...(scope != null
          ? {
              occurrence_id: scope.occurrence_id,
              attempt_id: scope.attempt_id,
              retry_epoch: scope.retry_epoch,
            }
          : { unknown_scope: true, unknown_reason: 'pending_without_execution_scope' }),
      })
    );
  }

  return completed.sort((left, right) => {
    const leftStart = left.started_at ?? left.ended_at ?? '';
    const rightStart = right.started_at ?? right.ended_at ?? '';
    if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
    return left.node_id.localeCompare(right.node_id);
  });
}
