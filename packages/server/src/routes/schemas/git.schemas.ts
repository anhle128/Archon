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

export const gitDiffChangeSchema = z
  .union([
    z.object({
      type: z.literal('normal'),
      content: z.string(),
      oldLine: z.number().int().positive(),
      newLine: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('insert'),
      content: z.string(),
      newLine: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('delete'),
      content: z.string(),
      oldLine: z.number().int().positive(),
    }),
  ])
  .openapi('GitDiffChange');
export type GitDiffChange = z.infer<typeof gitDiffChangeSchema>;

export const gitDiffHunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    header: z.string(),
    changes: z.array(gitDiffChangeSchema),
  })
  .openapi('GitDiffHunk');
export type GitDiffHunk = z.infer<typeof gitDiffHunkSchema>;

const gitReadyDiffResponseSchema = z.object({
  path: z.string().min(1),
  status: z.literal('M'),
  scope: z.enum(['now', 'commit']),
  ref: z.string().min(1),
  hunks: z.array(gitDiffHunkSchema),
  cursor: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
});

const gitEmptyDiffResponseSchema = z.object({
  emptyReason: gitEmptyReasonSchema,
});

export const gitDiffResponseSchema = z
  .union([gitReadyDiffResponseSchema, gitEmptyDiffResponseSchema])
  .openapi('GitDiffResponse');
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
