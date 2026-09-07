/**
 * Canonical pending-interaction row, AskHuman question, answer, and resolve contracts.
 *
 * Types are derived with `z.infer`. Import `z` from `@hono/zod-openapi`.
 */
import { z } from '@hono/zod-openapi';

const pendingJsonObjectSchema = z.record(z.string(), z.unknown());

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    workflow_run_id: z.string().min(1),
    node_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    kind: z.enum(['ask', 'permission']),
    status: z.enum(['pending', 'answered', 'purged']),
    envelope: pendingJsonObjectSchema,
    answer: pendingJsonObjectSchema.nullable(),
    provider_session_id: z.string().min(1),
    created_at: z.union([z.date(), z.string()]),
    resolved_at: z.union([z.date(), z.string()]).nullable(),
    resolved_by: z.string().min(1).nullable(),
  })
  .strict();

export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

export const insertPendingInteractionSchema = pendingInteractionSchema
  .pick({
    workflow_run_id: true,
    node_id: true,
    tool_use_id: true,
    kind: true,
    envelope: true,
    provider_session_id: true,
  })
  .strict();

export type InsertPendingInteractionInput = z.infer<typeof insertPendingInteractionSchema>;

export const askHumanQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  selection: z.enum(['single', 'multi']),
  options: z.array(z.string()),
  allowOther: z.boolean(),
});

export type AskHumanQuestion = z.infer<typeof askHumanQuestionSchema>;

export const askAnswerItemSchema = z
  .object({
    questionId: z.string().min(1),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .strict();

export type AskAnswerItem = z.infer<typeof askAnswerItemSchema>;

export const askAnswerBodySchema = z.union([
  z.object({ answers: z.array(askAnswerItemSchema).min(1) }).strict(),
  z.object({ decline: z.literal(true) }).strict(),
]);

export type AskAnswerBody = z.infer<typeof askAnswerBodySchema>;

export const permissionConfirmBodySchema = z
  .object({
    intent: z
      .string()
      .min(1)
      .refine(value => value.trim().length > 0, 'Intent must not be blank'),
  })
  .strict();

export type PermissionConfirmBody = z.infer<typeof permissionConfirmBodySchema>;

export const confirmPendingPermissionInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    answer: permissionConfirmBodySchema,
    resolved_by: z.string().min(1),
  })
  .strict();

export type ConfirmPendingPermissionInput = z.infer<typeof confirmPendingPermissionInputSchema>;

export const resolvePendingInteractionInputSchema = z
  .object({
    workflow_run_id: z.string().min(1),
    tool_use_id: z.string().min(1),
    answer: askAnswerBodySchema,
    resolved_by: z.string().min(1),
  })
  .strict();

export const resolvePendingInteractionResultSchema = z
  .object({
    interaction: pendingInteractionSchema,
    resumed: z.boolean(),
    remaining_pending: z.number().int().nonnegative(),
  })
  .strict();

export type ResolvePendingInteractionInput = z.infer<typeof resolvePendingInteractionInputSchema>;
export type ResolvePendingInteractionResult = z.infer<typeof resolvePendingInteractionResultSchema>;
