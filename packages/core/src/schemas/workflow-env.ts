/**
 * Core row/name schemas for install-wide Workflow ENV overlays.
 *
 * Identity is `(workflow_name, name)`. `created_by_user_id` is provenance only.
 * Patch bodies validate through `envPatchesSchema` (empty `{}` is valid).
 */
import { z } from '@hono/zod-openapi';
import { isValidWorkflowName } from '@archon/workflows/command-validation';
import { envPatchesSchema } from '@archon/workflows/schemas/env-overlay';
import type { EnvPatches } from '@archon/workflows/schemas/env-overlay';

// PostgreSQL returns TIMESTAMPTZ as Date; SQLite stores TEXT. Accept both.
const dbTimestamp = z.union([z.date(), z.string()]);

/**
 * Workflow name at ENV write boundaries: isValidWorkflowName + max 255.
 * Do not rely on PostgreSQL VARCHAR alone — SQLite accepts longer TEXT.
 */
export const workflowEnvWorkflowNameSchema = z
  .string()
  .min(1, 'workflow name must not be empty')
  .max(255, 'workflow name must be at most 255 characters')
  .refine(isValidWorkflowName, {
    message: 'workflow name must be a valid workflow path (at most one namespace slash)',
  });

/**
 * ENV display name: trimmed 1–64, case-sensitive, `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
 */
export const workflowEnvNameSchema = z
  .string()
  .trim()
  .min(1, 'ENV name must be 1–64 characters after trim')
  .max(64, 'ENV name must be 1–64 characters after trim')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'ENV name must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');

/**
 * Full ENV row as returned from the store (snake_case columns 1:1 with DB).
 * Identity fields reuse the write-path schemas so corrupt stored rows fail closed.
 */
export const workflowEnvRowSchema = z.object({
  id: z.string().min(1),
  workflow_name: workflowEnvWorkflowNameSchema,
  name: workflowEnvNameSchema,
  patches: envPatchesSchema,
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
  created_by_user_id: z.string().nullable(),
});

export type WorkflowEnvRow = z.infer<typeof workflowEnvRowSchema>;

/** List/summary row — omits the patches body. */
export const workflowEnvSummarySchema = workflowEnvRowSchema.omit({ patches: true });

export type WorkflowEnvSummary = z.infer<typeof workflowEnvSummarySchema>;

export type { EnvPatches };
