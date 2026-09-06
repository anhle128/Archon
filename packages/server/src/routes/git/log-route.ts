import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitLogResponseSchema } from '../schemas/git.schemas';

export const gitLogRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/log',
  tags: ['Workflows'],
  summary: "List a run checkout's commit history",
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitLogResponseSchema } },
      description: 'Commit log or a CAP-6 empty envelope',
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
