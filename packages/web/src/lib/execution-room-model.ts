/**
 * Exact execution identity and header data for run rooms.
 *
 * Selection, labels, opener ids, and runtime fields stay pure so Legacy and
 * Console can share the same resolution without sharing UI.
 */
import type { components } from './api.generated';
import type { RoomSurface } from './room-split-layout';

type WorkflowEvent = components['schemas']['WorkflowEvent'];

export type ExecutionRowSelection =
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

export interface ExecutionRow {
  id: string;
  nodeId: string;
  label: string;
  status: string;
  order: number;
  selection: ExecutionRowSelection;
  startedAt?: string;
  durationMs?: number;
  startedOffsetMs?: number;
  unknownScope?: boolean;
}

export interface ExecutionHeaderModel {
  nodeId: string;
  nodeLabel: string;
  executionLabel: string;
  status: string;
  startedOffsetMs: number | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  unknownScope: boolean;
}

export interface ExecutionHeaderInput {
  row: ExecutionRow;
  events: readonly WorkflowEvent[];
  runStartedAt: string;
}

export type RoomOpenerKind = 'log' | 'graph';

interface ExecutionChoiceRow {
  id: string;
  nodeId: string;
  status: string;
  order: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function latestByOrder<T extends { order: number }>(rows: readonly T[]): T {
  return rows.reduce((best, row) => (row.order >= best.order ? row : best));
}

function executionLabel(selection: ExecutionRowSelection): string {
  if (selection.kind === 'loop_iteration') {
    return `Iteration ${String(selection.iteration)}`;
  }
  if (selection.kind === 'occurrence') {
    if (selection.iteration !== undefined) {
      return `Iteration ${String(selection.iteration)}`;
    }
    return `Attempt ${String((selection.retryEpoch ?? 0) + 1)}`;
  }
  return 'Execution unknown';
}

function startedOffsetMs(row: ExecutionRow, runStartedAt: string): number | null {
  if (row.startedAt !== undefined) {
    const started = Date.parse(row.startedAt);
    const runStarted = Date.parse(runStartedAt);
    if (Number.isFinite(started) && Number.isFinite(runStarted)) {
      return Math.max(0, started - runStarted);
    }
  }
  return row.startedOffsetMs ?? null;
}

function eventMatchesSelection(event: WorkflowEvent, row: ExecutionRow): boolean {
  if (event.event_type !== 'node_started' || event.step_name !== row.nodeId) {
    return false;
  }
  const data = asRecord(event.data);
  if (data === null) return false;
  const occurrenceId = stringField(data, 'occurrence_id');
  const attemptId = stringField(data, 'attempt_id');
  if (row.selection.kind === 'occurrence') {
    if (occurrenceId !== row.selection.occurrenceId) return false;
    const expectedAttempt = row.selection.attemptId ?? null;
    return attemptId === expectedAttempt;
  }
  return occurrenceId === null && attemptId === null;
}

export function chooseExecutionForNode<T extends ExecutionChoiceRow>(
  rows: readonly T[],
  nodeId: string,
  lastExplicitRowId?: string | null
): T | null {
  const forNode = rows.filter(row => row.nodeId === nodeId);
  if (forNode.length === 0) return null;
  if (lastExplicitRowId !== undefined && lastExplicitRowId !== null) {
    const explicit = forNode.find(row => row.id === lastExplicitRowId);
    if (explicit !== undefined) return explicit;
  }
  const awaiting = forNode.filter(row => row.status === 'awaiting');
  if (awaiting.length > 0) return latestByOrder(awaiting);
  const running = forNode.filter(row => row.status === 'running');
  if (running.length > 0) return latestByOrder(running);
  return latestByOrder(forNode);
}

export function runtimeForSelection(
  events: readonly WorkflowEvent[],
  row: ExecutionRow
): { provider: string; model: string } | null {
  const matches = events.filter(event => eventMatchesSelection(event, row));
  if (matches.length === 0) return null;
  const selected = row.selection.kind === 'occurrence' ? matches[0] : matches[matches.length - 1];
  if (selected === undefined) return null;
  const data = asRecord(selected.data);
  if (data === null) return null;
  const provider = stringField(data, 'provider');
  const model = stringField(data, 'model');
  if (provider === null && model === null) return null;
  return { provider: provider ?? '', model: model ?? '' };
}

export function buildExecutionHeader(input: ExecutionHeaderInput): ExecutionHeaderModel {
  const runtime = runtimeForSelection(input.events, input.row);
  return {
    nodeId: input.row.nodeId,
    nodeLabel: input.row.label,
    executionLabel: executionLabel(input.row.selection),
    status: input.row.status,
    startedOffsetMs: startedOffsetMs(input.row, input.runStartedAt),
    durationMs: input.row.durationMs ?? null,
    provider: runtime?.provider || null,
    model: runtime?.model || null,
    unknownScope: input.row.unknownScope ?? true,
  };
}

export function roomOpenerId(surface: RoomSurface, kind: RoomOpenerKind, key: string): string {
  return `${surface}-${kind}-${encodeURIComponent(key)}`;
}

export function askCardId(requestId: string): string {
  return `run-ask-card-${encodeURIComponent(requestId)}`;
}
