import { z } from '@hono/zod-openapi';
import { externalWorkflowEventTypeSchema } from './workflow-event';
import { providerBindingTransformSchema } from './provider-binding-transform';

export const workflowProviderBindingStateSchema = z.enum(['active', 'disabled', 'rotated']);

// PostgreSQL returns TIMESTAMPTZ columns as Date objects through node-postgres;
// SQLite stores the same fields as strings. Accept both DB row shapes.
const dbTimestamp = z.union([z.date(), z.string()]);

export const workflowProviderBindingSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  codebase_id: z.string(),
  event_route: z.string(),
  event_types: z.array(externalWorkflowEventTypeSchema),
  transform: providerBindingTransformSchema.nullable().optional(),
  state: workflowProviderBindingStateSchema,
  binding_version: z.number(),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
});

export type WorkflowProviderBinding = z.infer<typeof workflowProviderBindingSchema>;
