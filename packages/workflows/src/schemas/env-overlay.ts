/**
 * Zod schemas for Workflow ENV overlays — invocation/storage patches that
 * override a bounded allowlist of node execution fields on a cloned workflow
 * definition without mutating discovered YAML.
 *
 * Import `z` from `@hono/zod-openapi`; types are derived with `z.infer`.
 */
import { z } from '@hono/zod-openapi';
import { effortLevelSchema, thinkingConfigSchema } from './dag-node';
import { modelReasoningEffortSchema } from './workflow';

/** Maximum number of node targets in one ENV patch document. */
export const ENV_OVERLAY_MAX_TARGETS = 256;

/** Maximum UTF-8 byte size of `JSON.stringify(patches)`. */
export const ENV_OVERLAY_MAX_BYTES = 1024 * 1024;

/**
 * Document-level patch field keys. Unknown keys are rejected at schema
 * boundaries and again defensively during apply.
 */
export const ENV_OVERLAY_PATCH_FIELDS = [
  'provider',
  'model',
  'effort',
  'thinking',
  'prompt',
  'bash',
] as const;

export type EnvOverlayPatchField = (typeof ENV_OVERLAY_PATCH_FIELDS)[number];

const RESERVED_TARGET_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Target node id keys for an ENV patch map.
 *
 * Accepts the same character class as safe node ids (`[A-Za-z_][A-Za-z0-9_-]*`)
 * but WITHOUT the base 64-character cap: include expansion prefixes ids with
 * `<includeId>__` and can produce longer legitimate top-level targets. Empty
 * and reserved object keys are rejected.
 */
export const envPatchTargetKeySchema = z
  .string()
  .min(1, 'env overlay target id must not be empty')
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'env overlay target id must match [A-Za-z_][A-Za-z0-9_-]*')
  .refine(
    id => !RESERVED_TARGET_KEYS.has(id),
    'env overlay target id must not be a reserved object key'
  );

export type EnvPatchTargetKey = z.infer<typeof envPatchTargetKeySchema>;

/**
 * Per-node patch document. Every supplied key is optional at the field level,
 * but the object must contain at least one allowed field. Unknown keys fail
 * via `.strict()`.
 *
 * - `provider` / `model`: trimmed; empty after trim is invalid (ENV cannot unset).
 * - `prompt` / `bash`: arbitrary strings preserved byte-for-byte (empty/whitespace OK).
 * - `effort` / `thinking`: existing engine schemas (thinking shorthand normalized).
 */
export const envNodePatchSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(1, "'provider' must be a non-empty string after trim")
      .optional(),
    model: z.string().trim().min(1, "'model' must be a non-empty string after trim").optional(),
    effort: effortLevelSchema.optional(),
    thinking: thinkingConfigSchema.optional(),
    prompt: z.string().optional(),
    bash: z.string().optional(),
  })
  .strict()
  .refine(
    value =>
      value.provider !== undefined ||
      value.model !== undefined ||
      value.effort !== undefined ||
      value.thinking !== undefined ||
      value.prompt !== undefined ||
      value.bash !== undefined,
    'env overlay per-node patch must include at least one field'
  );

export type EnvNodePatch = z.infer<typeof envNodePatchSchema>;

/**
 * Full ENV patches map: target id → per-node patch.
 * Enforces ≤256 targets and ≤1 MiB UTF-8 JSON serialization.
 */
export const envPatchesSchema = z
  .record(envPatchTargetKeySchema, envNodePatchSchema)
  .superRefine((patches, ctx) => {
    const keys = Object.keys(patches);
    if (keys.length > ENV_OVERLAY_MAX_TARGETS) {
      ctx.addIssue({
        code: 'custom',
        message: `env overlay patches exceed ${ENV_OVERLAY_MAX_TARGETS} targets`,
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(patches)).byteLength;
    if (bytes > ENV_OVERLAY_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `env overlay patches exceed ${ENV_OVERLAY_MAX_BYTES} UTF-8 bytes`,
      });
    }
  });

export type EnvPatches = z.infer<typeof envPatchesSchema>;

/**
 * Prospective provider request metadata resolved before DAG scheduling.
 * Not proof of execution and not the provider-reported final model identity.
 */
export const nodeExecutionMetadataSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    tier: z.enum(['small', 'medium', 'large']).optional(),
    modelReasoningEffort: modelReasoningEffortSchema.optional(),
    effort: effortLevelSchema.optional(),
    thinking: thinkingConfigSchema.optional(),
  })
  .strict();

export type NodeExecutionMetadata = z.infer<typeof nodeExecutionMetadataSchema>;

/** Frozen row contents selected at Start, before target filtering. */
export const envOverlayCandidateSchema = z
  .object({
    envId: z.string().min(1),
    envName: z.string().min(1),
    workflowName: z.string().min(1),
    patches: envPatchesSchema,
  })
  .strict();

export type EnvOverlayCandidate = z.infer<typeof envOverlayCandidateSchema>;

/**
 * Pending applied overlay written at the first run-row insert, before
 * `resolved` is available. `patches` contains only ids that existed at the
 * original start; `skippedNodeIds` are ids absent then (sorted).
 */
export const appliedEnvOverlaySchema = z
  .object({
    envId: z.string().min(1),
    envName: z.string().min(1),
    workflowName: z.string().min(1),
    patches: envPatchesSchema,
    skippedNodeIds: z.array(z.string()),
  })
  .strict();

export type AppliedEnvOverlay = z.infer<typeof appliedEnvOverlaySchema>;

/**
 * Complete run-owned snapshot after latest resolution is written. `patches`
 * and `skippedNodeIds` stay frozen from the original start;
 * `latestMissingNodeIds` tracks currently-absent originally-applied ids.
 */
export const envOverlaySnapshotSchema = appliedEnvOverlaySchema
  .extend({
    latestMissingNodeIds: z.array(z.string()),
    resolved: z.record(z.string(), nodeExecutionMetadataSchema),
  })
  .strict();

export type EnvOverlaySnapshot = z.infer<typeof envOverlaySnapshotSchema>;

/**
 * Stored `metadata.envOverlay` union. Complete form is tried first so its
 * `resolved` / `latestMissingNodeIds` keys are not rejected as extras by the
 * pending form when both component schemas are strict.
 */
export const storedEnvOverlaySchema = z.union([envOverlaySnapshotSchema, appliedEnvOverlaySchema]);

export type StoredEnvOverlay = z.infer<typeof storedEnvOverlaySchema>;
