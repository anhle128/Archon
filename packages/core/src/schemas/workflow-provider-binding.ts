import { z } from '@hono/zod-openapi';

export const workflowProviderBindingSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  codebase_id: z.string(),
  event_route: z.string(),
  state: z.string(),
  binding_version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkflowProviderBinding = z.infer<typeof workflowProviderBindingSchema>;
