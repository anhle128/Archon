import { z } from '@hono/zod-openapi';

const dbTimestamp = z.union([z.date(), z.string()]);

export const workflowEventDeliveryAttemptOutcomeSchema = z.enum(['pending', 'succeeded', 'failed']);

export const workflowEventDeliveryAttemptRowSchema = z.object({
  id: z.string(),
  outbox_event_id: z.string(),
  attempt_number: z.number(),
  request_url: z.string(),
  request_method: z.string(),
  request_headers: z.string(),
  request_body: z.string(),
  response_status: z.number().nullable(),
  response_headers: z.string().nullable(),
  response_body: z.string().nullable(),
  transport_error: z.string().nullable(),
  started_at: dbTimestamp,
  completed_at: dbTimestamp.nullable(),
  duration_ms: z.number().nullable(),
  outcome: workflowEventDeliveryAttemptOutcomeSchema,
});

export type WorkflowEventDeliveryAttemptOutcome = z.infer<
  typeof workflowEventDeliveryAttemptOutcomeSchema
>;
export type WorkflowEventDeliveryAttemptRow = z.infer<typeof workflowEventDeliveryAttemptRowSchema>;
