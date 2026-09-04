/**
 * Application-side usage ledger row contract.
 *
 * Mirrors `remote_agent_usage_ledger` (17 columns). SQL constraints enforce the
 * same invariants at the database boundary; this schema validates rows once
 * they are read or about to be written by application code.
 */
import { z } from '@hono/zod-openapi';

export const usageLedgerModelSourceSchema = z.enum(['reported', 'requested', 'unknown']);
export type UsageLedgerModelSource = z.infer<typeof usageLedgerModelSourceSchema>;

export const usageLedgerKindSchema = z.enum(['advisor', 'subagent']);
export type UsageLedgerKind = z.infer<typeof usageLedgerKindSchema>;

export const usageLedgerPricingSourceSchema = z.enum(['config', 'catalog']);
export type UsageLedgerPricingSource = z.infer<typeof usageLedgerPricingSourceSchema>;

const nonNegativeSafeIntegerSchema = z.number().refine(n => Number.isSafeInteger(n) && n >= 0, {
  message: 'must be a non-negative safe integer',
});

const positiveSafeIntegerSchema = z.number().refine(n => Number.isSafeInteger(n) && n > 0, {
  message: 'must be a positive safe integer',
});

const finiteNonNegativeSchema = z.number().refine(n => Number.isFinite(n) && n >= 0, {
  message: 'must be a finite non-negative number',
});

/**
 * One normalized ledger row. Field names match DB columns 1:1 (snake_case).
 * Does not duplicate run/node/workflow/codebase/user/source/timestamp — those
 * live on the owning workflow event and run.
 */
export const usageLedgerRowSchema = z
  .object({
    id: z.string().min(1),
    workflow_event_id: z.string().min(1),
    entry_index: nonNegativeSafeIntegerSchema,
    agent_provider: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1).nullable(),
    model_source: usageLedgerModelSourceSchema,
    kind: usageLedgerKindSchema.nullable(),
    tokens_input: nonNegativeSafeIntegerSchema.nullable(),
    tokens_output: nonNegativeSafeIntegerSchema.nullable(),
    tokens_reasoning: nonNegativeSafeIntegerSchema.nullable(),
    tokens_cache_read: nonNegativeSafeIntegerSchema.nullable(),
    tokens_cache_write: nonNegativeSafeIntegerSchema.nullable(),
    requests: positiveSafeIntegerSchema.nullable(),
    cost_usd: finiteNonNegativeSchema.nullable(),
    cost_estimated_usd: finiteNonNegativeSchema.nullable(),
    pricing_source: usageLedgerPricingSourceSchema.nullable(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const hasMeasure =
      row.tokens_input !== null ||
      row.tokens_output !== null ||
      row.tokens_reasoning !== null ||
      row.tokens_cache_read !== null ||
      row.tokens_cache_write !== null ||
      row.requests !== null ||
      row.cost_usd !== null ||
      row.cost_estimated_usd !== null;

    if (!hasMeasure) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one token, request, or cost measure is required',
      });
    }

    if (row.cost_usd !== null && row.cost_estimated_usd !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cost_usd'],
        message: 'reported and estimated USD are mutually exclusive',
      });
    }

    if (row.cost_estimated_usd === null && row.pricing_source !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['pricing_source'],
        message: 'pricing_source requires cost_estimated_usd',
      });
    }

    if (row.cost_estimated_usd !== null && row.pricing_source === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['pricing_source'],
        message: 'cost_estimated_usd requires pricing_source',
      });
    }

    if (row.model_source === 'unknown') {
      if (row.model !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['model'],
          message: 'model must be null when model_source is unknown',
        });
      }
    } else if (row.model === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'model is required when model_source is reported or requested',
      });
    }

    if (
      row.tokens_reasoning !== null &&
      row.tokens_output !== null &&
      row.tokens_reasoning > row.tokens_output
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tokens_reasoning'],
        message: 'tokens_reasoning must not exceed tokens_output',
      });
    }
  });

export type UsageLedgerRow = z.infer<typeof usageLedgerRowSchema>;
