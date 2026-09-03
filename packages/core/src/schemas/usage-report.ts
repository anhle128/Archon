/**
 * CamelCase usage report contract shared by core query, REST, and CLI.
 *
 * Types are derived with `z.infer` only — no parallel handwritten interfaces.
 * Metric sums stay nullable so "absent" is distinct from known zero.
 */
import { z } from '@hono/zod-openapi';
import { usageLedgerKindSchema, usageLedgerModelSourceSchema } from './usage-ledger';

export const usageGroupBySchema = z.enum([
  'agent',
  'provider',
  'model',
  'project',
  'run',
  'day',
  'node',
]);
export type UsageGroupBy = z.infer<typeof usageGroupBySchema>;

/** Filter values for `kind`. `unclassified` maps to SQL NULL on the ledger row. */
export const usageKindFilterSchema = z.enum(['unclassified', 'advisor', 'subagent']);
export type UsageKindFilter = z.infer<typeof usageKindFilterSchema>;

/**
 * Aggregated measures for a group or the report totals.
 * No combined "effective USD" — reported and estimated stay separate.
 */
export const usageMetricsSchema = z
  .object({
    tokensInput: z.number().nullable(),
    tokensOutput: z.number().nullable(),
    tokensReasoning: z.number().nullable(),
    tokensCacheRead: z.number().nullable(),
    tokensCacheWrite: z.number().nullable(),
    requests: z.number().nullable(),
    reportedUsd: z.number().nullable(),
    estimatedUsd: z.number().nullable(),
    recordCount: z.number(),
    missingTokensInput: z.number(),
    missingTokensOutput: z.number(),
    missingTokensReasoning: z.number(),
    missingTokensCacheRead: z.number(),
    missingTokensCacheWrite: z.number(),
    missingRequests: z.number(),
    /** Rows with neither reported nor estimated USD. */
    rowsMissingUsd: z.number(),
  })
  .strict();
export type UsageMetrics = z.infer<typeof usageMetricsSchema>;

/**
 * Explicit optional dimension fields for a group.
 * Opaque concatenated keys are intentionally not used.
 */
export const usageDimensionsSchema = z
  .object({
    agentProvider: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().nullable().optional(),
    modelSource: usageLedgerModelSourceSchema.optional(),
    codebaseId: z.string().nullable().optional(),
    /** Current codebase name; null when the run is no longer assigned a project. */
    codebaseName: z.string().nullable().optional(),
    runId: z.string().optional(),
    workflowName: z.string().optional(),
    /** UTC calendar day `YYYY-MM-DD`. */
    day: z.string().optional(),
    /** Exact persisted step name (`e.step_name`). */
    nodeId: z.string().nullable().optional(),
    kind: usageLedgerKindSchema.nullable().optional(),
  })
  .strict();
export type UsageDimensions = z.infer<typeof usageDimensionsSchema>;

/**
 * Ledger-integrity coverage only: compares `node_usage_recorded` events to
 * normalized ledger rows under date/project/run/node filters.
 * Cannot detect provider passes that never emitted an event.
 */
export const usageLedgerCoverageSchema = z
  .object({
    usageEventCount: z.number(),
    ledgeredEventCount: z.number(),
    unledgeredEventCount: z.number(),
    hasRecordedUsage: z.boolean(),
    historicalBackfill: z.literal(false),
    filterScope: z.literal('date-project-run-node'),
  })
  .strict();
export type UsageLedgerCoverage = z.infer<typeof usageLedgerCoverageSchema>;

export const usageReportGroupSchema = z
  .object({
    dimensions: usageDimensionsSchema,
    metrics: usageMetricsSchema,
  })
  .strict();
export type UsageReportGroup = z.infer<typeof usageReportGroupSchema>;

export const usageReportScopeSchema = z
  .object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    codebaseId: z.string().optional(),
    runId: z.string().optional(),
    /** Child charges are never copied onto a parent; always false. */
    includesChildRollup: z.literal(false),
  })
  .strict();
export type UsageReportScope = z.infer<typeof usageReportScopeSchema>;

export const usageReportSchema = z
  .object({
    scope: usageReportScopeSchema,
    groupBy: usageGroupBySchema,
    totals: usageMetricsSchema,
    groups: z.array(usageReportGroupSchema),
    coverage: usageLedgerCoverageSchema,
  })
  .strict();
export type UsageReport = z.infer<typeof usageReportSchema>;
