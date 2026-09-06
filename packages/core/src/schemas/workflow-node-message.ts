/**
 * Core row-schema alias for persisted workflow node transcript rows.
 *
 * Canonical discriminated union lives in `@archon/workflows/schemas/node-message`.
 * Types are derived with `z.infer`.
 */
import { z } from '@hono/zod-openapi';
import { nodeMessageSchema } from '@archon/workflows/schemas/node-message';

export const workflowNodeMessageRowSchema = nodeMessageSchema;
export type WorkflowNodeMessageRow = z.infer<typeof workflowNodeMessageRowSchema>;
