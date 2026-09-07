/**
 * Join selectable Log rows to folded divider metadata without duplicating usage.
 */
import type { NodeRun } from '../../primitives/event';
import type { WorkflowEvent } from '../../skills/runs';
import type { LogRow } from './build-log-rows';
import { inspectStatus, type InspectStatus } from './inspect-status';

export interface ConsoleLogEntry {
  row: LogRow;
  displayStatus: InspectStatus;
  startedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  stopReason: string | null;
  skipReason: string | null;
  skipExpr: string | null;
  showNodeUsage: boolean;
}

export interface BuildConsoleLogEntriesInput {
  rows: readonly LogRow[];
  rawEvents: readonly WorkflowEvent[];
  nodeRuns: readonly NodeRun[];
  runStartedAt: string;
}

function eventData(event: WorkflowEvent): Record<string, unknown> {
  return event.data;
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function readFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readTerminalDuration(data: Record<string, unknown>): number | null {
  return (
    readFiniteNonNegativeNumber(data.duration_ms) ?? readFiniteNonNegativeNumber(data.duration)
  );
}

function eventById(events: readonly WorkflowEvent[], id: string): WorkflowEvent | undefined {
  return events.find(event => event.id === id);
}

function matchingNodeRun(nodeRuns: readonly NodeRun[], nodeId: string): NodeRun | undefined {
  return nodeRuns.find(run => run.nodeId === nodeId);
}

function emptyMeta(
  startedAt: string
): Omit<ConsoleLogEntry, 'row' | 'displayStatus' | 'showNodeUsage'> {
  return {
    startedAt,
    durationMs: null,
    costUsd: null,
    numTurns: null,
    stopReason: null,
    skipReason: null,
    skipExpr: null,
  };
}

function ordinaryEntry(
  row: LogRow,
  input: BuildConsoleLogEntriesInput
): Omit<ConsoleLogEntry, 'row' | 'displayStatus' | 'showNodeUsage'> {
  const nodeRun = matchingNodeRun(input.nodeRuns, row.nodeId);
  const raw = eventById(input.rawEvents, row.id);
  const startedAt = raw?.created_at ?? nodeRun?.startedAt ?? input.runStartedAt;
  if (nodeRun === undefined) return emptyMeta(startedAt);
  return {
    startedAt,
    durationMs: nodeRun.durationMs,
    costUsd: nodeRun.costUsd,
    numTurns: nodeRun.numTurns,
    stopReason: nodeRun.stopReason,
    skipReason: nodeRun.skipReason,
    skipExpr: nodeRun.skipExpr,
  };
}

function loopEntry(
  row: LogRow,
  input: BuildConsoleLogEntriesInput
): Omit<ConsoleLogEntry, 'row' | 'displayStatus' | 'showNodeUsage'> {
  const iteration = row.selection.kind === 'loop_iteration' ? row.selection.iteration : null;
  if (iteration === null) return emptyMeta(input.runStartedAt);
  let start: WorkflowEvent | undefined;
  let terminal: WorkflowEvent | undefined;
  for (const event of input.rawEvents) {
    if (event.step_name !== row.nodeId) continue;
    if (readPositiveSafeInteger(eventData(event).iteration) !== iteration) continue;
    if (event.event_type === 'loop_iteration_started' && start === undefined) start = event;
    if (
      event.event_type === 'loop_iteration_completed' ||
      event.event_type === 'loop_iteration_failed'
    ) {
      terminal = event;
    }
  }
  return {
    ...emptyMeta(start?.created_at ?? terminal?.created_at ?? input.runStartedAt),
    durationMs: terminal !== undefined ? readTerminalDuration(eventData(terminal)) : null,
  };
}

function routeEntry(
  row: LogRow,
  input: BuildConsoleLogEntriesInput
): Omit<ConsoleLogEntry, 'row' | 'displayStatus' | 'showNodeUsage'> {
  const executionSeq = row.selection.kind === 'route_iteration' ? row.selection.executionSeq : null;
  if (executionSeq === null) return emptyMeta(input.runStartedAt);
  const routed = input.rawEvents.find(event => {
    if (event.event_type !== 'node_routed' || event.step_name !== row.nodeId) return false;
    return readPositiveSafeInteger(eventData(event).execution_seq) === executionSeq;
  });
  return emptyMeta(routed?.created_at ?? input.runStartedAt);
}

export function buildConsoleLogEntries(input: BuildConsoleLogEntriesInput): ConsoleLogEntry[] {
  const lastIndexByNode = new Map<string, number>();
  input.rows.forEach((row, index) => lastIndexByNode.set(row.nodeId, index));

  return input.rows.map((row, index) => {
    const meta =
      row.selection.kind === 'loop_iteration'
        ? loopEntry(row, input)
        : row.selection.kind === 'route_iteration'
          ? routeEntry(row, input)
          : ordinaryEntry(row, input);
    return {
      row,
      displayStatus: inspectStatus(row.status),
      ...meta,
      showNodeUsage: lastIndexByNode.get(row.nodeId) === index,
    };
  });
}
