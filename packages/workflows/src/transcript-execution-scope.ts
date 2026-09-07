/**
 * Mint and recover transcript execution identity.
 *
 * Occurrence/attempt IDs are UUIDs — never timestamps or process-global counters.
 * Ask resume recovers scope from the pending row, including when transcript
 * append failed. Route/retry admissions that are not that incomplete pause
 * must not reuse earlier answers.
 */
import { randomUUID } from 'node:crypto';
import type { PendingInteraction } from './schemas/pending-interaction';
import {
  transcriptExecutionScopeSchema,
  type LoopAncestryEntry,
  type NodeTranscriptMetadata,
  type TranscriptExecutionScope,
} from './schemas/node-execution';

export interface MintTranscriptExecutionScopeInput {
  retryEpoch: number;
  loopAncestry?: readonly LoopAncestryEntry[];
  routeActivationSeq?: number;
}

export function mintTranscriptExecutionScope(
  input: MintTranscriptExecutionScopeInput
): TranscriptExecutionScope {
  return {
    occurrence_id: randomUUID(),
    attempt_id: randomUUID(),
    retry_epoch: input.retryEpoch,
    ...(input.loopAncestry !== undefined && input.loopAncestry.length > 0
      ? { loop_ancestry: [...input.loopAncestry] }
      : {}),
    ...(input.routeActivationSeq !== undefined
      ? { route_activation_seq: input.routeActivationSeq }
      : {}),
  };
}

export function newTranscriptAttempt(scope: TranscriptExecutionScope): TranscriptExecutionScope {
  return { ...scope, attempt_id: randomUUID() };
}

export function recoverScopeFromPending(
  row: PendingInteraction | undefined
): TranscriptExecutionScope | undefined {
  if (row?.execution_scope == null) return undefined;
  const parsed = transcriptExecutionScopeSchema.safeParse(row.execution_scope);
  return parsed.success ? parsed.data : undefined;
}

export function sharedAskResumeScope(
  rows: readonly PendingInteraction[]
): TranscriptExecutionScope | undefined {
  const scopes = rows.map(recoverScopeFromPending);
  const first = scopes[0];
  if (first === undefined) return undefined;
  if (scopes.some(scope => scope?.occurrence_id !== first.occurrence_id)) return undefined;
  return first;
}

export function loopIterationFromScope(
  scope: TranscriptExecutionScope | undefined,
  stepName: string
): number | undefined {
  const ancestry = scope?.loop_ancestry;
  if (ancestry === undefined) return undefined;
  for (let index = ancestry.length - 1; index >= 0; index -= 1) {
    const entry = ancestry[index];
    if (entry?.node_id === stepName) return entry.iteration;
  }
  return undefined;
}

export function selectAnsweredAsksForActivation(
  rows: readonly PendingInteraction[],
  stepName: string,
  retryEpoch: number,
  options: { reuseAnswers: boolean; occurrenceId?: string; expectedToolUseIds?: readonly string[] }
): PendingInteraction[] {
  if (!options.reuseAnswers) return [];
  const matched = rows.filter(
    row => row.kind === 'ask' && row.status === 'answered' && row.node_id === stepName
  );
  if (matched.length === 0) return [];
  const scoped = matched.filter(row => {
    const scope = recoverScopeFromPending(row);
    if (scope === undefined) return false;
    return (scope.retry_epoch ?? 0) === retryEpoch;
  });
  const occurrenceId = options.occurrenceId ?? latestOccurrenceId(scoped);
  const occurrenceScoped =
    occurrenceId === undefined
      ? scoped
      : scoped.filter(row => recoverScopeFromPending(row)?.occurrence_id === occurrenceId);
  const expected = options.expectedToolUseIds;
  const selected =
    expected === undefined
      ? occurrenceScoped
      : occurrenceScoped.filter(row => expected.includes(row.tool_use_id));
  if (selected.length > 0) return selected;
  const unscoped = matched.filter(row => recoverScopeFromPending(row) === undefined);
  if (unscoped.length === matched.length && retryEpoch === 0) return unscoped;
  return [];
}

export function latestOccurrenceId(rows: readonly PendingInteraction[]): string | undefined {
  let latestMs = Number.NEGATIVE_INFINITY;
  let occurrenceId: string | undefined;
  for (const row of rows) {
    const scope = recoverScopeFromPending(row);
    if (scope === undefined) continue;
    const createdMs = pendingCreatedAtMs(row);
    if (createdMs > latestMs) {
      latestMs = createdMs;
      occurrenceId = scope.occurrence_id;
    }
  }
  return occurrenceId;
}

function pendingCreatedAtMs(row: PendingInteraction): number {
  const raw = row.created_at;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function transcriptMetadata(
  scope: TranscriptExecutionScope,
  extra: Omit<NodeTranscriptMetadata, 'execution'> = {}
): NodeTranscriptMetadata {
  return { execution: scope, ...extra };
}

export function executionScopeEventFields(
  scope: TranscriptExecutionScope
): Record<string, unknown> {
  return {
    occurrence_id: scope.occurrence_id,
    attempt_id: scope.attempt_id,
    retry_epoch: scope.retry_epoch ?? 0,
    ...(scope.loop_ancestry !== undefined ? { loop_ancestry: scope.loop_ancestry } : {}),
    ...(scope.route_activation_seq !== undefined
      ? { route_activation_seq: scope.route_activation_seq }
      : {}),
  };
}
