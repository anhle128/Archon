import { z } from '@hono/zod-openapi';

const dbTimestamp = z.union([z.date(), z.string()]);

export const workflowEventOutboxStatusSchema = z.enum([
  'pending',
  'retrying',
  'delivered',
  'terminal-failure',
  'not-routable',
]);

export const workflowEventOutboxRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  idempotency_key: z.string(),
  event_type: z.string(),
  provider: z.string(),
  workflow_run_id: z.string(),
  codebase_id: z.string().nullable(),
  binding_id: z.string().nullable(),
  event_route: z.string().nullable(),
  event_body: z.string(),
  status: workflowEventOutboxStatusSchema,
  not_routable_reason: z.string().nullable(),
  attempt_count: z.number(),
  last_attempt_at: dbTimestamp.nullable(),
  next_attempt_at: dbTimestamp.nullable(),
  last_error: z.string().nullable(),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
});

export type WorkflowEventOutboxStatus = z.infer<typeof workflowEventOutboxStatusSchema>;
export type WorkflowEventOutboxRow = z.infer<typeof workflowEventOutboxRowSchema>;
