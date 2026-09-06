/**
 * Canonical per-node transcript row schemas.
 *
 * Discriminated on `kind` so text, tool, and status payloads cannot drift.
 * Types are derived with `z.infer`. Import `z` from `@hono/zod-openapi`.
 */
import { z } from '@hono/zod-openapi';

const identityShape = {
  workflow_run_id: z.string().min(1),
  node_id: z.string().min(1),
};

export const nodeMessageTextPayloadSchema = z.object({ text: z.string().min(1) }).strict();
export const nodeMessageToolPayloadSchema = z
  .object({
    name: z.string().min(1),
    id: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  })
  .strict();
export const nodeMessageStatusPayloadSchema = z
  .object({ state: z.string().min(1), detail: z.string().optional() })
  .strict();

export const nodeMessageTextInputSchema = z
  .object({ ...identityShape, kind: z.literal('text'), payload: nodeMessageTextPayloadSchema })
  .strict();
export const nodeMessageToolInputSchema = z
  .object({ ...identityShape, kind: z.literal('tool'), payload: nodeMessageToolPayloadSchema })
  .strict();
export const nodeMessageStatusInputSchema = z
  .object({ ...identityShape, kind: z.literal('status'), payload: nodeMessageStatusPayloadSchema })
  .strict();

export const appendNodeMessageSchema = z.discriminatedUnion('kind', [
  nodeMessageTextInputSchema,
  nodeMessageToolInputSchema,
  nodeMessageStatusInputSchema,
]);

const rowShape = {
  id: z.string().min(1),
  seq: z.number().int().positive(),
  created_at: z.union([z.date(), z.string()]),
};

export const nodeMessageTextSchema = nodeMessageTextInputSchema.safeExtend(rowShape);
export const nodeMessageToolSchema = nodeMessageToolInputSchema.safeExtend(rowShape);
export const nodeMessageStatusSchema = nodeMessageStatusInputSchema.safeExtend(rowShape);
export const nodeMessageSchema = z.discriminatedUnion('kind', [
  nodeMessageTextSchema,
  nodeMessageToolSchema,
  nodeMessageStatusSchema,
]);

export type NodeMessageTextPayload = z.infer<typeof nodeMessageTextPayloadSchema>;
export type NodeMessageToolPayload = z.infer<typeof nodeMessageToolPayloadSchema>;
export type NodeMessageStatusPayload = z.infer<typeof nodeMessageStatusPayloadSchema>;
export type AppendNodeMessageInput = z.infer<typeof appendNodeMessageSchema>;
export type NodeMessage = z.infer<typeof nodeMessageSchema>;
