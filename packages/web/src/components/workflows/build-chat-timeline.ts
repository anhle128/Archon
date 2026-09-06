import type { MessageResponse, WorkflowEventResponse, WorkflowNodeStateResponse } from '@/lib/api';
import { ensureUtc } from '@/lib/format';

import type { LogRowSelection } from './build-log-rows';
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

function mapNodeEvent(event: WorkflowEventResponse): MappedNodeStatus | null {
  switch (event.event_type) {
    case 'node_started':
      return { status: 'running', detail: 'started', selection: { kind: 'node' } };
    case 'node_completed':
      return { status: 'completed', detail: 'completed', selection: { kind: 'node' } };
    case 'node_failed':
      return { status: 'failed', detail: 'failed', selection: { kind: 'node' } };
    case 'node_skipped':
    case 'node_skipped_prior_success':
      return { status: 'skipped', detail: 'skipped', selection: { kind: 'node' } };
    case 'approval_requested':
      return { status: 'running', detail: 'gate requested', selection: { kind: 'node' } };
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

export function buildChatTimeline(input: {
  messages: readonly MessageResponse[];
  events: readonly WorkflowEventResponse[];
  nodeStates: readonly WorkflowNodeStateResponse[];
  resolveNodeType: (nodeId: string) => NodeBodyKind;
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

  return indexed.map(item => item.entry);
}
