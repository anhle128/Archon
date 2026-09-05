import { z } from '@hono/zod-openapi';

export const gitEmptyReasonSchema = z.enum(['container', 'no_checkout']).openapi('GitEmptyReason');
export type GitEmptyReason = z.infer<typeof gitEmptyReasonSchema>;

export const gitChangedFileStatusSchema = z.enum(['M', 'A', 'D']).openapi('GitChangedFileStatus');

export const gitChangedFileSchema = z
  .object({
    path: z.string().min(1),
    status: gitChangedFileStatusSchema,
  })
  .openapi('GitChangedFile');
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

const gitReadyChangesResponseSchema = z.object({
  files: z.array(gitChangedFileSchema),
  revision: revisionSchema,
});

const gitEmptyChangesResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
  files: z.array(gitChangedFileSchema).max(0),
  revision: z.literal(''),
});

export const gitChangesResponseSchema = z
  .union([gitReadyChangesResponseSchema, gitEmptyChangesResponseSchema])
  .openapi('GitChangesResponse');
export type GitChangesResponse = z.infer<typeof gitChangesResponseSchema>;
