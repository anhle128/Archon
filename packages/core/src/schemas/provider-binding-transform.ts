import { z } from '@hono/zod-openapi';

export const JSONATA_EXPRESSION_MAX_BYTES = 32_768;

export const jsonataProviderBindingTransformSchema = z.object({
  engine: z.literal('jsonata'),
  expression: z.string().min(1),
  timeoutMs: z.number().int().positive().max(200).default(50),
  stackDepth: z.number().int().positive().max(512).default(128),
  maxSequenceSize: z.number().int().positive().max(100_000).default(10_000),
  maxOutputBytes: z.number().int().positive().max(262_144).default(65_536),
});

export const providerBindingTransformSchema = z.discriminatedUnion('engine', [
  jsonataProviderBindingTransformSchema,
]);

export type ProviderBindingTransform = z.infer<typeof providerBindingTransformSchema>;
