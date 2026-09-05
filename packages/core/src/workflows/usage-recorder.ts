/**
 * Core implementation of IWorkflowUsageRecorder.
 *
 * Sequence (plan §9):
 * 1. Strictly validate complete input; convert camelCase → snake_case event payload.
 * 2. Resolve estimates + generate one event id BEFORE opening a DB transaction.
 * 3. withTransaction: insert node_usage_recorded event + one ledger row per entry.
 * 4. On transaction failure: roll back both sinks, then one event-only fallback
 *    with the same pre-generated id + duplicate-id-ignore (no estimated fields).
 *
 * Never throws into workflow execution. Never enqueues external workflow events.
 * Never mutates lifecycle state or masks the original node result.
 */
import { createLogger } from '@archon/paths';
import type { IWorkflowUsageRecorder, RecordWorkflowUsageInput } from '@archon/workflows/deps';
import {
  buildNodeUsageRecordedEventData,
  modelUsageEntrySchema,
  type ModelUsageEntry,
  type NodeUsageRecordedEventData,
} from '@archon/workflows/schemas/usage-breakdown';
import { getDatabase, getDialect, pool } from '../db/connection';
import { insertUsageLedgerRows } from '../db/usage-ledger';
import { insertWorkflowEvent } from '../db/workflow-events';
import type { UsageLedgerRow } from '../schemas/usage-ledger';
import { loadPricingLookups, materializeUsageCost, type PricingLookups } from '../usage/estimate';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflows.usage-recorder');
  return cachedLog;
}

interface ValidatedRecordInput {
  runId: string;
  stepName: string;
  agentProvider: string;
  usageBreakdown: ModelUsageEntry[];
  retryEpoch: number;
  iteration: number | null;
  reaskAttempt: number;
  terminalError: boolean;
  errorSubtype: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validate the complete recorder input. Returns null and logs on any failure.
 * Re-parses usage entries so a corrupted caller cannot bypass the boundary schema.
 */
function validateRecordInput(input: RecordWorkflowUsageInput): ValidatedRecordInput | null {
  if (!isNonEmptyString(input.runId)) {
    getLog().warn({ issue: 'invalid_run_id' }, 'usage.recorder_input_invalid');
    return null;
  }
  if (!isNonEmptyString(input.stepName)) {
    getLog().warn(
      { issue: 'invalid_step_name', runId: input.runId },
      'usage.recorder_input_invalid'
    );
    return null;
  }
  if (!isNonEmptyString(input.agentProvider)) {
    getLog().warn(
      { issue: 'invalid_agent_provider', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }
  if (!isNonNegativeInt(input.retryEpoch)) {
    getLog().warn(
      { issue: 'invalid_retry_epoch', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }
  if (!isNonNegativeInt(input.reaskAttempt)) {
    getLog().warn(
      { issue: 'invalid_reask_attempt', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }
  if (typeof input.terminalError !== 'boolean') {
    getLog().warn(
      { issue: 'invalid_terminal_error', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }

  const iterationRaw = input.iteration === undefined ? null : input.iteration;
  if (iterationRaw !== null && !isPositiveInt(iterationRaw)) {
    getLog().warn(
      { issue: 'invalid_iteration', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }

  const errorSubtypeRaw = input.errorSubtype === undefined ? null : input.errorSubtype;
  if (errorSubtypeRaw !== null && typeof errorSubtypeRaw !== 'string') {
    getLog().warn(
      { issue: 'invalid_error_subtype', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }

  if (!Array.isArray(input.usageBreakdown) || input.usageBreakdown.length === 0) {
    getLog().warn(
      { issue: 'empty_usage_breakdown', runId: input.runId, stepName: input.stepName },
      'usage.recorder_input_invalid'
    );
    return null;
  }

  const usageBreakdown: ModelUsageEntry[] = [];
  for (let index = 0; index < input.usageBreakdown.length; index++) {
    const parsed = modelUsageEntrySchema.safeParse(input.usageBreakdown[index]);
    if (!parsed.success) {
      getLog().warn(
        {
          issue: 'invalid_usage_entry',
          index,
          runId: input.runId,
          stepName: input.stepName,
        },
        'usage.recorder_input_invalid'
      );
      return null;
    }
    usageBreakdown.push(parsed.data);
  }

  return {
    runId: input.runId.trim(),
    stepName: input.stepName.trim(),
    agentProvider: input.agentProvider.trim(),
    usageBreakdown,
    retryEpoch: input.retryEpoch,
    iteration: iterationRaw,
    reaskAttempt: input.reaskAttempt,
    terminalError: input.terminalError,
    errorSubtype: errorSubtypeRaw,
  };
}

function buildLedgerRows(args: {
  eventId: string;
  agentProvider: string;
  usageBreakdown: readonly ModelUsageEntry[];
  lookups: PricingLookups;
}): UsageLedgerRow[] {
  const dialect = getDialect();
  return args.usageBreakdown.map((entry, entryIndex) => {
    const cost = materializeUsageCost(entry, args.lookups);
    return {
      id: dialect.generateUuid(),
      workflow_event_id: args.eventId,
      entry_index: entryIndex,
      agent_provider: args.agentProvider,
      provider: entry.provider,
      model: entry.model,
      model_source: entry.modelSource,
      kind: entry.kind ?? null,
      tokens_input: entry.inputTokens ?? null,
      tokens_output: entry.outputTokens ?? null,
      tokens_reasoning: entry.reasoningTokens ?? null,
      tokens_cache_read: entry.cacheReadTokens ?? null,
      tokens_cache_write: entry.cacheWriteTokens ?? null,
      requests: entry.requests ?? null,
      cost_usd: cost.cost_usd,
      cost_estimated_usd: cost.cost_estimated_usd,
      pricing_source: cost.pricing_source,
    };
  });
}

async function writeEventOnlyFallback(args: {
  eventId: string;
  runId: string;
  stepName: string;
  eventData: NodeUsageRecordedEventData;
}): Promise<void> {
  await insertWorkflowEvent(
    (sql, params) => pool.query(sql, params),
    {
      id: args.eventId,
      workflow_run_id: args.runId,
      event_type: 'node_usage_recorded',
      step_name: args.stepName,
      // Authoritative observed usage only — estimates never enter event JSON.
      data: args.eventData as unknown as Record<string, unknown>,
    },
    { ignoreDuplicateId: true }
  );
}

/**
 * Create the core usage recorder. Wired only through `createWorkflowDeps()`.
 */
export function createWorkflowUsageRecorder(): IWorkflowUsageRecorder {
  return {
    async recordWorkflowUsage(input: RecordWorkflowUsageInput): Promise<void> {
      try {
        const validated = validateRecordInput(input);
        if (!validated) {
          return;
        }

        let eventData: NodeUsageRecordedEventData;
        try {
          eventData = buildNodeUsageRecordedEventData({
            agentProvider: validated.agentProvider,
            usageBreakdown: validated.usageBreakdown,
            retryEpoch: validated.retryEpoch,
            iteration: validated.iteration,
            reaskAttempt: validated.reaskAttempt,
            terminalError: validated.terminalError,
            errorSubtype: validated.errorSubtype,
          });
        } catch (err) {
          getLog().warn(
            {
              err: err as Error,
              runId: validated.runId,
              stepName: validated.stepName,
              issue: 'event_payload_build_failed',
            },
            'usage.recorder_input_invalid'
          );
          return;
        }

        // Resolve estimates + event id BEFORE opening a transaction.
        const lookups = await loadPricingLookups();
        const eventId = getDialect().generateUuid();
        const ledgerRows = buildLedgerRows({
          eventId,
          agentProvider: validated.agentProvider,
          usageBreakdown: validated.usageBreakdown,
          lookups,
        });

        try {
          await getDatabase().withTransaction(async query => {
            await insertWorkflowEvent(query, {
              id: eventId,
              workflow_run_id: validated.runId,
              event_type: 'node_usage_recorded',
              step_name: validated.stepName,
              data: eventData as unknown as Record<string, unknown>,
            });
            await insertUsageLedgerRows(query, ledgerRows);
          });
        } catch (txErr) {
          getLog().error(
            {
              err: txErr as Error,
              errorType: (txErr as Error).constructor.name,
              runId: validated.runId,
              stepName: validated.stepName,
              eventId,
              entryCount: ledgerRows.length,
            },
            'usage.recorder_transaction_failed'
          );

          try {
            await writeEventOnlyFallback({
              eventId,
              runId: validated.runId,
              stepName: validated.stepName,
              eventData,
            });
            getLog().warn(
              {
                runId: validated.runId,
                stepName: validated.stepName,
                eventId,
                entryCount: ledgerRows.length,
              },
              'usage.recorder_fallback_event_written'
            );
          } catch (fallbackErr) {
            getLog().error(
              {
                err: fallbackErr as Error,
                errorType: (fallbackErr as Error).constructor.name,
                runId: validated.runId,
                stepName: validated.stepName,
                eventId,
              },
              'usage.recorder_fallback_failed'
            );
          }
        }
      } catch (err) {
        // Outer safety net — never throw into workflow execution.
        getLog().error(
          {
            err: err as Error,
            errorType: (err as Error).constructor.name,
            runId: typeof input?.runId === 'string' ? input.runId : undefined,
            stepName: typeof input?.stepName === 'string' ? input.stepName : undefined,
          },
          'usage.recorder_failed'
        );
      }
    },
  };
}
