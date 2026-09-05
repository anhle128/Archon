/**
 * Zod schemas for Workflow ENV CRUD + preview API endpoints.
 */
import { z } from '@hono/zod-openapi';
import {
  envPatchesSchema,
  ENV_OVERLAY_PATCH_FIELDS,
  nodeExecutionMetadataSchema,
} from '@archon/workflows/schemas/env-overlay';
import {
  workflowEnvNameSchema,
  workflowEnvWorkflowNameSchema,
} from '@archon/core/schemas/workflow-env';

/** Path param: workflow name (validated further in handlers for stable codes). */
export const workflowEnvWorkflowParamsSchema = z
  .object({
    name: z.string().min(1),
  })
  .openapi('WorkflowEnvWorkflowParams');

/** Path params: workflow name + env id. */
export const workflowEnvParamsSchema = z
  .object({
    name: z.string().min(1),
    envId: z.string().min(1),
  })
  .openapi('WorkflowEnvParams');

/** Error body with optional safe detail (never patch bodies). */
export const workflowEnvErrorSchema = z
  .object({
    error: z.string(),
    detail: z.string().optional(),
  })
  .openapi('WorkflowEnvError');

/** List summary row — no patches. */
export const workflowEnvSummaryResponseSchema = z
  .object({
    id: z.string().min(1),
    workflowName: z.string().min(1),
    name: z.string().min(1),
    updatedAt: z.string(),
  })
  .openapi('WorkflowEnvSummaryResponse');

/** Full ENV row wire shape. */
export const workflowEnvResponseSchema = workflowEnvSummaryResponseSchema
  .extend({
    patches: envPatchesSchema,
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
  })
  .openapi('WorkflowEnvResponse');

/** GET /api/workflows/{name}/envs */
export const workflowEnvListResponseSchema = z
  .object({
    envs: z.array(workflowEnvSummaryResponseSchema),
  })
  .openapi('WorkflowEnvListResponse');

/** GET/POST/PATCH detail envelope. */
export const workflowEnvDetailResponseSchema = z
  .object({
    env: workflowEnvResponseSchema,
  })
  .openapi('WorkflowEnvDetailResponse');

/** POST body. */
export const createWorkflowEnvBodySchema = z
  .object({
    name: workflowEnvNameSchema,
    patches: envPatchesSchema,
  })
  .openapi('CreateWorkflowEnvBody');

/** PATCH body — at least one of name/patches. */
export const updateWorkflowEnvBodySchema = z
  .object({
    name: workflowEnvNameSchema.optional(),
    patches: envPatchesSchema.optional(),
  })
  .refine(value => value.name !== undefined || value.patches !== undefined, {
    message: 'at least one of name or patches is required',
  })
  .openapi('UpdateWorkflowEnvBody');

/** DELETE response. */
export const deleteWorkflowEnvResponseSchema = z
  .object({
    deleted: z.boolean(),
  })
  .openapi('DeleteWorkflowEnvResponse');

/** Preview query: required cwd, optional envId. */
export const workflowEnvPreviewQuerySchema = z
  .object({
    cwd: z.string().min(1),
    envId: z.string().min(1).optional(),
  })
  .openapi('WorkflowEnvPreviewQuery');

const envOverlayPatchFieldSchema = z.enum(ENV_OVERLAY_PATCH_FIELDS);

/** Preview target row for the console editor matrix. */
export const workflowEnvPreviewTargetSchema = z
  .object({
    id: z.string().min(1),
    nodeType: z.string().min(1),
    allowedFields: z.array(envOverlayPatchFieldSchema),
  })
  .openapi('WorkflowEnvPreviewTarget');

/** Preview resolved provider-turn row. */
export const workflowEnvPreviewResolvedSchema = nodeExecutionMetadataSchema
  .extend({
    nodeId: z.string().min(1),
  })
  .openapi('WorkflowEnvPreviewResolved');

/** GET /api/workflows/{name}/env-preview response. */
export const workflowEnvPreviewResponseSchema = z
  .object({
    preview: z.literal(true),
    authoritative: z.literal(false),
    workflowName: z.string().min(1),
    envId: z.string().nullable(),
    envName: z.string().nullable(),
    skippedNodeIds: z.array(z.string()),
    targets: z.array(workflowEnvPreviewTargetSchema),
    resolved: z.array(workflowEnvPreviewResolvedSchema),
  })
  .openapi('WorkflowEnvPreviewResponse');

export type WorkflowEnvSummaryResponse = z.infer<typeof workflowEnvSummaryResponseSchema>;
export type WorkflowEnvResponse = z.infer<typeof workflowEnvResponseSchema>;
export type CreateWorkflowEnvBody = z.infer<typeof createWorkflowEnvBodySchema>;
export type UpdateWorkflowEnvBody = z.infer<typeof updateWorkflowEnvBodySchema>;
export type WorkflowEnvPreviewResponse = z.infer<typeof workflowEnvPreviewResponseSchema>;

// Re-export path name schema for handler-level validation without a second import path.
export { workflowEnvWorkflowNameSchema, workflowEnvNameSchema };
