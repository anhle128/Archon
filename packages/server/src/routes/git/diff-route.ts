import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../schemas/common.schemas';
import { gitDiffResponseSchema } from '../schemas/git.schemas';

export const gitDiffRoute = createRoute({
  method: 'get',
  path: '/api/workflows/runs/{runId}/git/diff',
  tags: ['Workflows'],
  summary: "Read a run's Now or commit git hunks for a modified file",
  request: {
    params: z.object({ runId: z.string().min(1) }),
    query: z.object({
      path: z.string(),
      cursor: z.string().optional(),
      ref: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: gitDiffResponseSchema } },
      description: 'Ready Now or commit hunks or a CAP-6 empty envelope',
    },
    400: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Invalid file path or Invalid commit ref',
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Workflow run or file not found',
    },
    409: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'File changed',
    },
    500: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Git read failed',
    },
  },
});
