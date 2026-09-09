import type {
  MessageResponse,
  PendingInteraction,
  WorkflowEventResponse,
  WorkflowNodeStateResponse,
} from '@/lib/api';
import { readApprovalContext } from '@/lib/approval-context';
import { ensureUtc } from '@/lib/format';

import type { LogRow, LogRowSelection } from './build-log-rows';
import type { NodeBodyKind } from './resolve-room-kind';

export type ChatTimelineNodeStatus = Exclude<WorkflowNodeStateResponse['status'], 'awaiting'>;

export type ChatTimelineEntry =
  | {
      kind: 'user';
      id: string;
      createdAt: string;
      content: string;
    }
  | {
      kind: 'node_status';
      id: string;
      createdAt: string;
      nodeId: string;
      label: string;
      nodeType: NodeBodyKind;
      status: ChatTimelineNodeStatus;
      detail: string;
      selection: LogRowSelection;
    }
  | {
      kind: 'ask';
      id: string;
      createdAt: string;
      interaction: PendingInteraction;
      rowId: string;
      scopeLimitation: string | null;
    }
  | {
      kind: 'gate';
      id: string;
      createdAt: string;
      nodeId: string;
      rowId: string;
      scopeLimitation: string | null;
    };

interface IndexedEntry {
  entry: ChatTimelineEntry;
  timestamp: number;
  encounterIndex: number;
}

interface MappedNodeStatus {
  status: ChatTimelineNodeStatus;
  detail: string;
  selection: LogRowSelection;
}

function timestampOf(createdAt: string): number {
  const parsed = Date.parse(ensureUtc(createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventNodeId(event: WorkflowEventResponse): string | null {
  const stepName = event.step_name;
  if (typeof stepName === 'string' && stepName.trim().length > 0) return stepName;
  const dataNodeId = event.data.nodeId;
  return typeof dataNodeId === 'string' && dataNodeId.trim().length > 0 ? dataNodeId : null;
}

function printableRouteField(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'unknown';
}

function lifecycleSelection(event: WorkflowEventResponse): LogRowSelection {
  const occurrenceId = event.data.occurrence_id;
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) return { kind: 'node' };
  const attemptId = event.data.attempt_id;
  return {
    kind: 'occurrence',
    occurrenceId,
    ...(typeof attemptId === 'string' && attemptId.length > 0 ? { attemptId } : {}),
  };
}

function mapNodeEvent(event: WorkflowEventResponse): MappedNodeStatus | null {
  switch (event.event_type) {
    case 'node_started':
      return { status: 'running', detail: 'started', selection: lifecycleSelection(event) };
    case 'node_completed':
      return { status: 'completed', detail: 'completed', selection: lifecycleSelection(event) };
    case 'node_failed':
      return { status: 'failed', detail: 'failed', selection: lifecycleSelection(event) };
    case 'node_skipped':
    case 'node_skipped_prior_success':
      return { status: 'skipped', detail: 'skipped', selection: lifecycleSelection(event) };
    case 'approval_requested':
      return { status: 'running', detail: 'gate requested', selection: lifecycleSelection(event) };
    case 'loop_iteration_started':
    case 'loop_iteration_completed':
    case 'loop_iteration_failed': {
      const iteration = event.data.iteration;
      if (typeof iteration !== 'number' || !Number.isSafeInteger(iteration) || iteration < 1) {
        return null;
      }
      const suffix =
        event.event_type === 'loop_iteration_started'
          ? 'started'
          : event.event_type === 'loop_iteration_completed'
            ? 'completed'
            : 'failed';
      const status: ChatTimelineNodeStatus =
        suffix === 'started' ? 'running' : suffix === 'completed' ? 'completed' : 'failed';
      return {
        status,
        detail: `iteration ${String(iteration)} ${suffix}`,
        selection: { kind: 'loop_iteration', iteration },
      };
    }
    case 'node_routed': {
      const executionSeq = event.data.execution_seq;
      const selection: LogRowSelection =
        typeof executionSeq === 'number' && Number.isSafeInteger(executionSeq) && executionSeq >= 1
          ? { kind: 'route_iteration', executionSeq }
          : { kind: 'node' };
      return {
        status: 'completed',
        detail: `routed ${printableRouteField(event.data.outcome)} → ${printableRouteField(event.data.to)}`,
        selection,
      };
    }
    default:
      return null;
  }
}

function decorateLabel(baseLabel: string, selection: LogRowSelection): string {
  if (selection.kind === 'loop_iteration') {
    return `${baseLabel} ×${String(selection.iteration)}`;
  }
  if (selection.kind === 'route_iteration') {
    return `${baseLabel} #${String(selection.executionSeq)}`;
  }
  return baseLabel;
}

export const UNSCOPED_INTERACTION_LIMITATION =
  'Execution scope was not recorded for this interaction.';

function rowMatchesScope(
  row: LogRow,
  scope: NonNullable<PendingInteraction['execution_scope']>
): boolean {
  return (
    row.selection.kind === 'occurrence' &&
    scope.occurrence_id === row.selection.occurrenceId &&
    scope.attempt_id === row.selection.attemptId
  );
}

function latestRowForNode(rows: readonly LogRow[], nodeId: string): LogRow | null {
  const matching = rows.filter(row => row.nodeId === nodeId);
  if (matching.length === 0) return null;
  return matching.reduce((best, row) => (row.order >= best.order ? row : best));
}

function assignInteractionRow(
  nodeId: string,
  scope: PendingInteraction['execution_scope'] | undefined,
  rows: readonly LogRow[]
): { row: LogRow; limitation: string | null } | null {
  if (scope !== undefined && scope !== null) {
    const exact = rows.find(row => row.nodeId === nodeId && rowMatchesScope(row, scope));
    return exact === undefined ? null : { row: exact, limitation: null };
  }
  const latest = latestRowForNode(rows, nodeId);
  if (latest === null) return null;
  return { row: latest, limitation: UNSCOPED_INTERACTION_LIMITATION };
}

function nodeStatusEntriesForNode(
  entries: readonly ChatTimelineEntry[],
  nodeId: string
): Extract<ChatTimelineEntry, { kind: 'node_status' }>[] {
  return entries.filter(
    (entry): entry is Extract<ChatTimelineEntry, { kind: 'node_status' }> =>
      entry.kind === 'node_status' && entry.nodeId === nodeId
  );
}

type NodeStatusEntry = Extract<ChatTimelineEntry, { kind: 'node_status' }>;

function statusMatchesRow(status: NodeStatusEntry, row: LogRow): boolean {
  const left = status.selection;
  const right = row.selection;
  if (left.kind !== right.kind) return false;
  switch (right.kind) {
    case 'node':
      return true;
    case 'loop_iteration':
      return left.kind === 'loop_iteration' && left.iteration === right.iteration;
    case 'route_iteration':
      return left.kind === 'route_iteration' && left.executionSeq === right.executionSeq;
    case 'occurrence':
      return (
        left.kind === 'occurrence' &&
        left.occurrenceId === right.occurrenceId &&
        (right.attemptId === undefined || left.attemptId === right.attemptId)
      );
  }
}

function isExecutionStart(status: NodeStatusEntry): boolean {
  return status.detail === 'started' || status.detail.endsWith(' started');
}

export function buildChatTimeline(input: {
  messages: readonly MessageResponse[];
  events: readonly WorkflowEventResponse[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  resolveNodeType: (nodeId: string) => NodeBodyKind;
  rows?: readonly LogRow[];
  pendingInteractions?: readonly PendingInteraction[];
  approval?: unknown;
}): ChatTimelineEntry[] {
  const namesById = new Map<string, string>();
  for (const state of input.nodeStates) {
    namesById.set(state.nodeId, state.name);
  }

  const indexed: IndexedEntry[] = [];
  let encounterIndex = 0;

  for (const message of input.messages) {
    if (message.role !== 'user') continue;
    if (message.content.trim().length === 0) continue;
    indexed.push({
      entry: {
        kind: 'user',
        id: message.id,
        createdAt: message.created_at,
        content: message.content,
      },
      timestamp: timestampOf(message.created_at),
      encounterIndex,
    });
    encounterIndex += 1;
  }

  for (const event of input.events) {
    const nodeId = eventNodeId(event);
    if (nodeId === null) continue;
    const mapped = mapNodeEvent(event);
    if (mapped === null) continue;
    indexed.push({
      entry: {
        kind: 'node_status',
        id: event.id,
        createdAt: event.created_at,
        nodeId,
        label: decorateLabel(namesById.get(nodeId) ?? nodeId, mapped.selection),
        nodeType: input.resolveNodeType(nodeId),
        status: mapped.status,
        detail: mapped.detail,
        selection: mapped.selection,
      },
      timestamp: timestampOf(event.created_at),
      encounterIndex,
    });
    encounterIndex += 1;
  }

  indexed.sort((left, right) => {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    if (left.entry.kind !== right.entry.kind) {
      return left.entry.kind === 'user' ? -1 : 1;
    }
    return left.encounterIndex - right.encounterIndex;
  });

  const base = indexed.map(item => item.entry);
  const rows = input.rows ?? [];
  const placements: { row: LogRow; entry: ChatTimelineEntry }[] = [];

  for (const interaction of input.pendingInteractions ?? []) {
    if (interaction.kind !== 'ask') continue;
    const assigned = assignInteractionRow(interaction.node_id, interaction.execution_scope, rows);
    if (assigned === null) continue;
    placements.push({
      row: assigned.row,
      entry: {
        kind: 'ask',
        id: interaction.id,
        createdAt: interaction.created_at,
        interaction,
        rowId: assigned.row.id,
        scopeLimitation: assigned.limitation,
      },
    });
  }

  const approval = readApprovalContext(input.approval);
  if (
    approval !== null &&
    (approval.type === undefined ||
      approval.type === 'approval' ||
      approval.type === 'plannotator_gate')
  ) {
    const assigned = assignInteractionRow(approval.nodeId, undefined, rows);
    if (assigned !== null) {
      placements.push({
        row: assigned.row,
        entry: {
          kind: 'gate',
          id: `gate:${approval.nodeId}:${assigned.row.id}`,
          createdAt: base[base.length - 1]?.createdAt ?? approval.message,
          nodeId: approval.nodeId,
          rowId: assigned.row.id,
          scopeLimitation: assigned.limitation,
        },
      });
    }
  }

  if (placements.length === 0) return base;

  const rowsByNode = new Map<string, LogRow[]>();
  for (const row of [...rows].sort((left, right) => left.order - right.order)) {
    const list = rowsByNode.get(row.nodeId) ?? [];
    list.push(row);
    rowsByNode.set(row.nodeId, list);
  }
  const anchorByRowId = new Map<string, string>();
  for (const [nodeId, nodeRows] of rowsByNode) {
    const statuses = nodeStatusEntriesForNode(base, nodeId);
    const starts = statuses.filter(isExecutionStart);
    for (const [index, row] of nodeRows.entries()) {
      const exact =
        statuses.find(status => statusMatchesRow(status, row) && isExecutionStart(status)) ??
        statuses.find(status => statusMatchesRow(status, row));
      const anchor =
        exact ?? starts[index] ?? starts[starts.length - 1] ?? statuses[statuses.length - 1];
      if (anchor !== undefined) anchorByRowId.set(row.id, anchor.id);
    }
  }

  const inserted = new Set<string>();
  const result: ChatTimelineEntry[] = [];
  for (const entry of base) {
    result.push(entry);
    if (entry.kind !== 'node_status') continue;
    for (const placement of placements) {
      if (inserted.has(placement.entry.id)) continue;
      if (anchorByRowId.get(placement.row.id) !== entry.id) continue;
      result.push(placement.entry);
      inserted.add(placement.entry.id);
    }
  }
  for (const placement of placements) {
    if (inserted.has(placement.entry.id)) continue;
    result.push(placement.entry);
  }
  return result;
}
