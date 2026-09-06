/**
 * Adopted pending-interaction row shape for the empty GET-run embed.
 *
 * Story 5.1 returns no pending rows; this schema types the required array.
 * Types are derived with `z.infer`. Import `z` from `@hono/zod-openapi`.
 */
import { z } from '@hono/zod-openapi';

const pendingJsonObjectSchema = z.record(z.string(), z.unknown());

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    kind: z.enum(['ask', 'permission']),
    status: z.enum(['pending', 'answered', 'purged']),
    envelope: pendingJsonObjectSchema,
    answer: pendingJsonObjectSchema.nullable(),
    provider_session_id: z.string().min(1),
    created_at: z.union([z.date(), z.string()]),
    resolved_at: z.union([z.date(), z.string()]).nullable(),
    resolved_by: z.string().min(1).nullable(),
  })
  .strict();

export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;
