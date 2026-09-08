/**
 * Project recorded node-message rows and workflow events into render-neutral
 * agent history items. Text and tool pairing stay in the existing projectors;
 * this module only maps those results onto assistant, tool, and lifecycle items.
 */
import type { components } from './api.generated';
import type { NodeMessageRow } from './node-message-pages';
import type { ToolTranscriptCard } from './pair-tool-transcript';
import { projectToolTranscript } from './pair-tool-transcript';
import { projectTextTranscript } from './project-text-transcript';

export interface AgentHistoryInput {
  rows: readonly NodeMessageRow[];
  events: readonly components['schemas']['WorkflowEvent'][];
  nodeId: string;
}

export type AgentHistoryItem =
  | {
      kind: 'assistant';
      id: string;
      seq: number;
      role: 'assistant';
      text: string;
    }
  | {
      kind: 'tool';
      id: string;
      seq: number;
      role: 'tool';
      name: string;
      toolUseId: string;
      context: { label: string; value: string }[];
      input: unknown;
      output: unknown;
      outcome: 'running' | 'succeeded' | 'failed' | 'unknown';
      durationMs: number | null;
      canLoadFullOutput: boolean;
      messageId: string;
    }
  | {
      kind: 'lifecycle';
      id: string;
      seq: number;
      state: string;
      detail: string | null;
    };

const TOOL_CONTEXT_KEYS = ['cmd', 'path', 'file_path', 'query', 'url'] as const;

type ToolOutcome = Extract<AgentHistoryItem, { kind: 'tool' }>['outcome'];
type ToolCard = ToolTranscriptCard<NodeMessageRow>;
type ToolRow = Extract<NodeMessageRow, { kind: 'tool' }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function recordedExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordedDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function isTruncatedMetadata(metadata: unknown): boolean {
  const record = asRecord(metadata);
  if (record === null) return false;
  return record.truncated === true || record.output_state === 'truncated';
}

function extraToolFields(row: ToolRow | null): {
  outcome: string | null;
  exitCode: number | null;
  error: unknown;
} {
  const record = asRecord(row?.metadata);
  if (record === null) {
    return { outcome: null, exitCode: null, error: undefined };
  }
  return {
    outcome: stringField(record, 'outcome'),
    exitCode: recordedExitCode(record.exit_code),
    error: record.error,
  };
}

function deriveOutcome(card: ToolCard): ToolOutcome {
  if (card.pending) return 'running';

  const resultFields = extraToolFields(card.result);
  const callFields = extraToolFields(card.call);
  const recordedOutcome = resultFields.outcome ?? callFields.outcome ?? card.outcome ?? null;
  const exitCode = resultFields.exitCode ?? callFields.exitCode ?? card.exitCode ?? null;
  const error = resultFields.error ?? callFields.error;

  if (exitCode !== null && exitCode !== 0) return 'failed';
  if (recordedOutcome === 'error' || recordedOutcome === 'failed') return 'failed';
  if (typeof error === 'string' && error.length > 0) return 'failed';
  if (recordedOutcome === 'success') return 'succeeded';
  if (card.call === null) return 'unknown';
  if (recordedOutcome === 'interrupted' || recordedOutcome === 'unknown') return 'unknown';
  return 'succeeded';
}

function toolUseIdFrom(card: ToolCard): string {
  const row = card.call ?? card.result;
  if (row !== null && typeof row.payload.id === 'string' && row.payload.id.length > 0) {
    return row.payload.id;
  }
  return card.id;
}

function toToolItem(
  card: ToolCard,
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  const toolUseId = toolUseIdFrom(card);
  return {
    kind: 'tool',
    id: card.id,
    seq: card.call?.seq ?? card.result?.seq ?? 0,
    role: 'tool',
    name: card.name,
    toolUseId,
    context: toolContext(card.input),
    input: card.input,
    output: card.output,
    outcome: deriveOutcome(card),
    durationMs: toolRuntime(events, nodeId, toolUseId).durationMs,
    canLoadFullOutput:
      card.truncated === true ||
      card.outputState === 'truncated' ||
      isTruncatedMetadata(card.call?.metadata) ||
      isTruncatedMetadata(card.result?.metadata),
    messageId: card.result?.id ?? card.call?.id ?? card.id,
  };
}

export function toolContext(input: unknown): { label: string; value: string }[] {
  const record = asRecord(input);
  if (record === null) return [];
  const context: { label: string; value: string }[] = [];
  for (const key of TOOL_CONTEXT_KEYS) {
    const raw = record[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length === 0) continue;
    context.push({ label: key, value });
  }
  return context;
}

export function toolRuntime(
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  toolUseId: string
): { durationMs: number | null } {
  const matches: number[] = [];
  for (const workflowEvent of events) {
    if (workflowEvent.event_type !== 'tool_completed') continue;
    if (workflowEvent.step_name !== nodeId) continue;
    const data = asRecord(workflowEvent.data);
    if (data === null) continue;
    if (data.tool_call_id !== toolUseId) continue;
    const durationMs = recordedDurationMs(data.duration_ms);
    if (durationMs === null) continue;
    matches.push(durationMs);
  }
  if (matches.length !== 1) {
    return { durationMs: null };
  }
  return { durationMs: matches[0] ?? null };
}

export function buildAgentHistory(input: AgentHistoryInput): AgentHistoryItem[] {
  const projected = projectToolTranscript(projectTextTranscript(input.rows));
  const items: AgentHistoryItem[] = [];
  for (const item of projected) {
    if (item.kind === 'tool-card') {
      items.push(toToolItem(item, input.events, input.nodeId));
      continue;
    }
    const message = item.message;
    if (message.kind === 'text') {
      items.push({
        kind: 'assistant',
        id: message.id,
        seq: message.seq,
        role: 'assistant',
        text: message.payload.text,
      });
      continue;
    }
    if (message.kind === 'status') {
      items.push({
        kind: 'lifecycle',
        id: message.id,
        seq: message.seq,
        state: message.payload.state,
        detail: message.payload.detail ?? null,
      });
    }
  }
  return items;
}
