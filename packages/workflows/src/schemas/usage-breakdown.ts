/**
 * Workflow usage event schemas and provider-result boundary validation.
 *
 * The provider package owns the runtime observation contract
 * (`ModelUsageEntry` / `UsageBreakdown`). This module:
 * 1. Mirrors that contract as strict Zod schemas (camelCase TS/API types).
 * 2. Defines the snake_case persisted `node_usage_recorded` event payload.
 * 3. Validates provider-result entries at the workflow boundary before any
 *    event write — valid entries are retained in order; rejected index/issue
 *    codes are logged without raw values; an empty remainder means no event.
 *
 * `step_name` is NOT part of the payload — it lives on the workflow_events row
 * and MUST be the actual persisted step name:
 * - normal node: node id
 * - loop-group body node: namespaced `<groupId>.<nodeId>`
 * - direct loop: loop node id
 *
 * Do not copy usage into `node_completed` or run metadata.
 */
import { z } from '@hono/zod-openapi';
import type {
  ModelSource as ProviderModelSource,
  ModelUsageEntry as ProviderModelUsageEntry,
  UsageBreakdown as ProviderUsageBreakdown,
} from '@archon/providers/types';
import { createLogger, type Logger } from '@archon/paths';

// ---------------------------------------------------------------------------
// Shared numeric helpers — match provider normalizer invariants exactly
// ---------------------------------------------------------------------------

const nonNegativeSafeIntegerSchema = z.number().refine(n => Number.isSafeInteger(n) && n >= 0, {
  message: 'must be a non-negative safe integer',
});

const positiveSafeIntegerSchema = z.number().refine(n => Number.isSafeInteger(n) && n > 0, {
  message: 'must be a positive safe integer',
});

const finiteNonNegativeSchema = z.number().refine(n => Number.isFinite(n) && n >= 0, {
  message: 'must be a finite non-negative number',
});

// ---------------------------------------------------------------------------
// CamelCase provider-aligned entry (TS / API / boundary validation)
// ---------------------------------------------------------------------------

export const modelSourceSchema = z.enum(['reported', 'requested', 'unknown']);

export type ModelSource = z.infer<typeof modelSourceSchema>;

/**
 * One validated usage observation. Field names and optionality match
 * `@archon/providers/types` ModelUsageEntry — enforced by the compile-time
 * structural check below.
 */
export const modelUsageEntrySchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().nullable(),
    modelSource: modelSourceSchema,
    inputTokens: nonNegativeSafeIntegerSchema.optional(),
    outputTokens: nonNegativeSafeIntegerSchema.optional(),
    reasoningTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheReadTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheWriteTokens: nonNegativeSafeIntegerSchema.optional(),
    requests: positiveSafeIntegerSchema.optional(),
    costUsd: finiteNonNegativeSchema.optional(),
    kind: z.enum(['advisor', 'subagent']).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.modelSource === 'unknown') {
      if (entry.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: 'model_source_unknown_requires_null_model',
        });
      }
    } else if (typeof entry.model !== 'string' || entry.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'model_required_for_known_source',
      });
    } else if (entry.model !== entry.model.trim()) {
      // Provider normalizer trims; reject untrimmed at the boundary so persisted
      // values stay identical to the provider contract after clean-up.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'model_untrimmed',
      });
    }

    if (typeof entry.provider === 'string' && entry.provider !== entry.provider.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'provider_untrimmed',
      });
    }

    if (
      entry.reasoningTokens !== undefined &&
      entry.outputTokens !== undefined &&
      entry.reasoningTokens > entry.outputTokens
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasoningTokens'],
        message: 'reasoning_exceeds_output',
      });
    }

    const hasMeasure =
      entry.inputTokens !== undefined ||
      entry.outputTokens !== undefined ||
      entry.reasoningTokens !== undefined ||
      entry.cacheReadTokens !== undefined ||
      entry.cacheWriteTokens !== undefined ||
      entry.requests !== undefined ||
      entry.costUsd !== undefined;

    if (!hasMeasure) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'missing_numeric_measure',
      });
    }
  })
  .transform(entry => {
    // Trim identities after validation so callers that already pass trimmed
    // values are unchanged, and any path that skipped the untrimmed checks
    // still lands clean (defensive — superRefine rejects untrimmed strings).
    return {
      ...entry,
      provider: entry.provider.trim(),
      model:
        entry.modelSource === 'unknown'
          ? null
          : typeof entry.model === 'string'
            ? entry.model.trim()
            : entry.model,
    };
  });

export type ModelUsageEntry = z.infer<typeof modelUsageEntrySchema>;

export const usageBreakdownSchema = z.array(modelUsageEntrySchema).min(1);

export type UsageBreakdown = z.infer<typeof usageBreakdownSchema>;

// ---------------------------------------------------------------------------
// Compile-time structural check against the provider contract
// ---------------------------------------------------------------------------

// ExactMatch must return `false` (not `never`) on mismatch: `never extends true`
// is true in TypeScript, so a never-based assert would silently accept drift.
type ExactMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

/** Fails type-check if workflow ModelSource drifts from the provider contract. */
type ProviderContractModelSource = AssertTrue<ExactMatch<ModelSource, ProviderModelSource>>;

/**
 * Fails type-check if workflow ModelUsageEntry drifts from the provider contract.
 * The inferred Zod output must remain assignable both ways to ProviderModelUsageEntry.
 */
type ProviderContractModelUsageEntry = AssertTrue<
  ExactMatch<ModelUsageEntry, ProviderModelUsageEntry>
>;

/** Fails type-check if UsageBreakdown element type drifts. */
type ProviderContractUsageBreakdown = AssertTrue<
  ExactMatch<UsageBreakdown[number], ProviderUsageBreakdown[number]>
>;

// Touch the assert aliases so `noUnusedLocals` cannot drop them silently.
export type ProviderUsageContractChecks = [
  ProviderContractModelSource,
  ProviderContractModelUsageEntry,
  ProviderContractUsageBreakdown,
];

// ---------------------------------------------------------------------------
// Snake_case persisted event payload (workflow_events.data for node_usage_recorded)
// ---------------------------------------------------------------------------

/**
 * One usage row as stored inside the event JSON. Snake_case only — camelCase
 * belongs on TypeScript/API objects, never in the persisted event document.
 */
export const modelUsageEntryPersistedSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().nullable(),
    model_source: modelSourceSchema,
    input_tokens: nonNegativeSafeIntegerSchema.optional(),
    output_tokens: nonNegativeSafeIntegerSchema.optional(),
    reasoning_tokens: nonNegativeSafeIntegerSchema.optional(),
    cache_read_tokens: nonNegativeSafeIntegerSchema.optional(),
    cache_write_tokens: nonNegativeSafeIntegerSchema.optional(),
    requests: positiveSafeIntegerSchema.optional(),
    cost_usd: finiteNonNegativeSchema.optional(),
    kind: z.enum(['advisor', 'subagent']).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.model_source === 'unknown') {
      if (entry.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: 'model_source_unknown_requires_null_model',
        });
      }
    } else if (typeof entry.model !== 'string' || entry.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'model_required_for_known_source',
      });
    }

    if (
      entry.reasoning_tokens !== undefined &&
      entry.output_tokens !== undefined &&
      entry.reasoning_tokens > entry.output_tokens
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasoning_tokens'],
        message: 'reasoning_exceeds_output',
      });
    }

    const hasMeasure =
      entry.input_tokens !== undefined ||
      entry.output_tokens !== undefined ||
      entry.reasoning_tokens !== undefined ||
      entry.cache_read_tokens !== undefined ||
      entry.cache_write_tokens !== undefined ||
      entry.requests !== undefined ||
      entry.cost_usd !== undefined;

    if (!hasMeasure) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'missing_numeric_measure',
      });
    }
  });

export type ModelUsageEntryPersisted = z.infer<typeof modelUsageEntryPersistedSchema>;

/**
 * Authoritative per-run JSON sink for raw observed usage.
 * Written as `workflow_events.data` for `event_type: 'node_usage_recorded'`.
 *
 * Not added to `node_completed`, run metadata, external outbox, or dashboard
 * source event types — those sinks cannot faithfully represent failed/retry/
 * reask spend.
 */
export const nodeUsageRecordedEventDataSchema = z
  .object({
    schema_version: z.literal(1),
    agent_provider: z.string().min(1),
    usage_breakdown: z.array(modelUsageEntryPersistedSchema).min(1),
    retry_epoch: z.number().int().nonnegative(),
    iteration: z.number().int().positive().nullable(),
    reask_attempt: z.number().int().nonnegative(),
    terminal_error: z.boolean(),
    error_subtype: z.string().nullable(),
  })
  .strict();

export type NodeUsageRecordedEventData = z.infer<typeof nodeUsageRecordedEventDataSchema>;

// ---------------------------------------------------------------------------
// CamelCase ↔ snake_case conversion
// ---------------------------------------------------------------------------

/** Convert a validated camelCase entry to the persisted snake_case shape. */
export function toPersistedUsageEntry(entry: ModelUsageEntry): ModelUsageEntryPersisted {
  const persisted: ModelUsageEntryPersisted = {
    provider: entry.provider,
    model: entry.model,
    model_source: entry.modelSource,
  };
  if (entry.inputTokens !== undefined) persisted.input_tokens = entry.inputTokens;
  if (entry.outputTokens !== undefined) persisted.output_tokens = entry.outputTokens;
  if (entry.reasoningTokens !== undefined) persisted.reasoning_tokens = entry.reasoningTokens;
  if (entry.cacheReadTokens !== undefined) persisted.cache_read_tokens = entry.cacheReadTokens;
  if (entry.cacheWriteTokens !== undefined) persisted.cache_write_tokens = entry.cacheWriteTokens;
  if (entry.requests !== undefined) persisted.requests = entry.requests;
  if (entry.costUsd !== undefined) persisted.cost_usd = entry.costUsd;
  if (entry.kind !== undefined) persisted.kind = entry.kind;
  return persisted;
}

export interface BuildNodeUsageRecordedEventDataInput {
  agentProvider: string;
  usageBreakdown: readonly ModelUsageEntry[];
  retryEpoch: number;
  /** Direct-loop iteration number; null for non-loop / loop-group body nodes. */
  iteration: number | null;
  reaskAttempt: number;
  terminalError: boolean;
  errorSubtype: string | null;
}

/**
 * Build the snake_case event payload from validated camelCase boundary data.
 * Call only after `validateProviderUsageAtBoundary` returned a non-null breakdown.
 */
export function buildNodeUsageRecordedEventData(
  input: BuildNodeUsageRecordedEventDataInput
): NodeUsageRecordedEventData {
  return nodeUsageRecordedEventDataSchema.parse({
    schema_version: 1,
    agent_provider: input.agentProvider,
    usage_breakdown: input.usageBreakdown.map(toPersistedUsageEntry),
    retry_epoch: input.retryEpoch,
    iteration: input.iteration,
    reask_attempt: input.reaskAttempt,
    terminal_error: input.terminalError,
    error_subtype: input.errorSubtype,
  });
}

// ---------------------------------------------------------------------------
// Provider-result runtime boundary validation
// ---------------------------------------------------------------------------

export interface UsageEntryRejection {
  /** Index in the caller-supplied array. */
  index: number;
  /**
   * Schema issue code — never embeds raw payload values.
   * Prefer the first custom message, else the first issue code/path summary.
   */
  issue: string;
}

export interface ValidateProviderUsageResult {
  /** Valid entries retained in original order. */
  breakdown: ModelUsageEntry[];
  /** Rejected entries by index/issue (no raw values). */
  rejected: readonly UsageEntryRejection[];
}

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('workflow.usage-breakdown');
  return cachedLog;
}

function issueCodeFromZod(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'entry_invalid';
  // Prefer explicit custom messages we attached (stable issue codes).
  if (first.code === 'custom' && typeof first.message === 'string' && first.message.length > 0) {
    return first.message;
  }
  if (first.code === 'unrecognized_keys') {
    const keys = 'keys' in first && Array.isArray(first.keys) ? first.keys : [];
    const key = typeof keys[0] === 'string' ? keys[0] : 'unknown';
    // Key name only — never the value.
    return `forbidden_field:${key}`;
  }
  const path = first.path.length > 0 ? first.path.map(String).join('.') : 'entry';
  return `${path}_${first.code}`;
}

/**
 * Validate provider-result usage entries at the workflow boundary.
 *
 * - Each entry is validated independently.
 * - Valid entries are retained in order.
 * - Rejected index + issue codes are logged; raw values are never logged.
 * - Returns `null` when no valid entries remain — callers must not write a
 *   `node_usage_recorded` event in that case.
 */
export function validateProviderUsageAtBoundary(
  entries: readonly unknown[],
  options?: { log?: boolean }
): ValidateProviderUsageResult | null {
  const breakdown: ModelUsageEntry[] = [];
  const rejected: UsageEntryRejection[] = [];
  const shouldLog = options?.log !== false;

  for (let index = 0; index < entries.length; index++) {
    const parsed = modelUsageEntrySchema.safeParse(entries[index]);
    if (parsed.success) {
      breakdown.push(parsed.data);
    } else {
      rejected.push({ index, issue: issueCodeFromZod(parsed.error) });
    }
  }

  if (shouldLog && rejected.length > 0) {
    getLog().warn(
      {
        rejectedCount: rejected.length,
        retainedCount: breakdown.length,
        // index + issue only — never raw entry payloads
        rejected: rejected.map(r => ({ index: r.index, issue: r.issue })),
      },
      'workflow.usage_entry_rejected'
    );
  }

  if (breakdown.length === 0) {
    return null;
  }

  return { breakdown, rejected };
}
