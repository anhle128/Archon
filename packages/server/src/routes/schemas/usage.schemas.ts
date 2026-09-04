/**
 * HTTP query + OpenAPI-labelled response schemas for usage reports.
 * Reuses the core camelCase usage report contract — no parallel API shape.
 */
import { z } from '@hono/zod-openapi';
import {
  usageGroupBySchema,
  usageInstantStringSchema,
  usageKindFilterSchema,
  usageReportSchema,
} from '@archon/core/schemas/usage-report';

/**
 * GET /api/usage query params (camelCase API convention).
 * Date pair, range bounds, node/run requirements, and grouping semantics are
 * enforced by core after the OpenAPI string/enum parse. Instant shape is
 * validated here via the shared core RFC 3339 schema.
 */
export const usageQuerySchema = z
  .object({
    from: usageInstantStringSchema.optional().openapi({
      description:
        'RFC 3339 inclusive range start with Z or numeric offset; optional fractional seconds limited to 1–3 digits (millisecond precision). Must be paired with `to`. Half-open range is [from, to).',
    }),
    to: usageInstantStringSchema.optional().openapi({
      description:
        'RFC 3339 exclusive range end with Z or numeric offset; optional fractional seconds limited to 1–3 digits (millisecond precision). Must be paired with `from`. Half-open range is [from, to).',
    }),

    codebaseId: z.string().optional(),
    agentProvider: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    kind: usageKindFilterSchema.optional().openapi({
      description:
        '`unclassified` maps to SQL NULL on the ledger row; `advisor` and `subagent` match those kinds.',
    }),
    runId: z.string().optional(),
    nodeId: z.string().optional().openapi({
      description: 'Exact persisted step name (`e.step_name`). Requires `runId`.',
    }),
    groupBy: usageGroupBySchema.optional().openapi({
      description:
        'Group dimensions: agent | provider (default) | model | project | run | day | node. `node` requires `runId`.',
    }),
  })
  .openapi('UsageQuery');

/**
 * GET /api/usage response — same core report contract with an OpenAPI label.
 * Coverage is ledger-integrity only (date/project/run/node filters); it cannot
 * detect provider passes that never emitted a usage event.
 */
export const usageReportResponseSchema = usageReportSchema.openapi('UsageReport');

export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type UsageReportResponse = z.infer<typeof usageReportResponseSchema>;
