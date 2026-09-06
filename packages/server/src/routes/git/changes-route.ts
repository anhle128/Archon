import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitChangesResponseSchema } from '../schemas/git.schemas';

export const gitChangesRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/changes',
  tags: ['Workflows'],
  summary: "List a run's live or commit-scoped git changes",
  request: {
    params: z.object({ runId: z.string().min(1) }),
    query: z.object({
      ref: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitChangesResponseSchema } },
      description: 'Live changes, commit changes, or a CAP-6 empty envelope',
    },
    400: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Invalid commit ref',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run not found',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
