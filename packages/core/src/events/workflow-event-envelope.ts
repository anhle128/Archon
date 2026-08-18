import { deriveBindingId } from '../db/provider-bindings';
import {
  externalWorkflowEventTypeSchema,
  type ExternalWorkflowEventType,
} from '../schemas/workflow-event';
import { z } from '@hono/zod-openapi';

export type { ExternalWorkflowEventType } from '../schemas/workflow-event';

export interface WorkflowEventEnvelopeRun {
  id: string;
  workflow_name: string;
}

export interface WorkflowEventEnvelopeCodebase {
  id: string;
  name: string;
  default_cwd: string;
  default_branch: string | null;
}

export interface WorkflowEventEnvelopeBinding {
  provider: string;
  name: string;
}

export interface BuildWorkflowEventEnvelopeInput {
  eventId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  run: WorkflowEventEnvelopeRun;
  codebase: WorkflowEventEnvelopeCodebase;
  binding: WorkflowEventEnvelopeBinding;
  payload: Record<string, unknown>;
}

const nonEmptyStringSchema = z.string().min(1);
const dateTimeSchema = z.string().datetime();
const approvalGateTypeSchema = z.enum([
  'approval',
  'interactive_loop',
  'writeback',
  'plannotator_gate',
]);
const httpUrlSchema = z
  .string()
  .url()
  .refine(value => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  });

const workflowEventPayloadSchemas = {
  'workflow.run.started': z
    .object({ state: nonEmptyStringSchema, startedAt: dateTimeSchema })
    .passthrough(),
  'workflow.run.completed': z
    .object({
      state: nonEmptyStringSchema,
      result: z.object({ outcome: nonEmptyStringSchema }).passthrough(),
    })
    .passthrough(),
  'workflow.run.failed': z
    .object({
      state: nonEmptyStringSchema,
      failure: z
        .object({
          code: nonEmptyStringSchema,
          category: nonEmptyStringSchema,
          retryable: z.boolean(),
          details: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    })
    .passthrough(),
  'workflow.approval.requested': z
    .object({
      state: nonEmptyStringSchema,
      approval: z
        .object({
          requestId: nonEmptyStringSchema,
          requestedAction: nonEmptyStringSchema,
          phase: nonEmptyStringSchema,
          gateType: approvalGateTypeSchema,
          nodeId: nonEmptyStringSchema,
          message: nonEmptyStringSchema,
          userPrompt: nonEmptyStringSchema,
          reviewUrl: httpUrlSchema,
        })
        .passthrough(),
    })
    .passthrough(),
  'workflow.delivery.failed': z
    .object({
      deliveryOnly: z.literal(true),
      mutationIntent: z.literal('none'),
      deliveryStatus: nonEmptyStringSchema,
      failedDeliveryId: nonEmptyStringSchema,
      nextStatus: nonEmptyStringSchema,
      diagnosticRef: nonEmptyStringSchema,
    })
    .passthrough(),
  'workflow.artifact.recorded': z
    .object({
      artifact: z
        .object({
          type: nonEmptyStringSchema,
          name: nonEmptyStringSchema,
          uri: nonEmptyStringSchema,
          digest: nonEmptyStringSchema,
        })
        .passthrough(),
    })
    .passthrough(),
} satisfies Record<ExternalWorkflowEventType, z.ZodType<Record<string, unknown>>>;

const bindingRefSchema = z
  .object({
    provider: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    bindingId: nonEmptyStringSchema,
    projectRef: nonEmptyStringSchema,
  })
  .strict();

const workflowRunRefSchema = z
  .object({
    provider: nonEmptyStringSchema,
    runId: nonEmptyStringSchema,
    workflowName: nonEmptyStringSchema,
    projectRef: nonEmptyStringSchema,
  })
  .strict();

const projectRefSchema = z
  .object({
    id: nonEmptyStringSchema,
    codebaseRef: nonEmptyStringSchema,
    repositoryPath: nonEmptyStringSchema,
    defaultBranch: nonEmptyStringSchema.optional(),
  })
  .strict();

export const workflowEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('workflow-event-envelope.v1'),
    provider: nonEmptyStringSchema,
    eventId: nonEmptyStringSchema,
    eventType: externalWorkflowEventTypeSchema,
    occurredAt: dateTimeSchema,
    bindingRef: bindingRefSchema,
    workflowRunRef: workflowRunRefSchema,
    projectRef: projectRefSchema,
    idempotencyKey: nonEmptyStringSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((value, ctx) => {
    const parsed = workflowEventPayloadSchemas[value.eventType].safeParse(value.payload);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', ...issue.path],
        message: issue.message,
      });
    }
  });

export type WorkflowEventEnvelope = z.infer<typeof workflowEventEnvelopeSchema>;

export function buildWorkflowEventEnvelope(
  input: BuildWorkflowEventEnvelopeInput
): WorkflowEventEnvelope {
  const projectRef = `project:${input.codebase.id}`;
  const payload = workflowEventPayloadSchemas[input.eventType].parse(input.payload);
  return {
    schemaVersion: 'workflow-event-envelope.v1',
    provider: input.binding.provider,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    bindingRef: {
      provider: input.binding.provider,
      name: input.binding.name,
      bindingId: deriveBindingId(input.binding.provider, input.binding.name),
      projectRef,
    },
    workflowRunRef: {
      provider: input.binding.provider,
      runId: input.run.id,
      workflowName: input.run.workflow_name,
      projectRef,
    },
    projectRef: {
      id: input.codebase.id,
      codebaseRef: input.codebase.name,
      repositoryPath: input.codebase.default_cwd,
      ...(input.codebase.default_branch ? { defaultBranch: input.codebase.default_branch } : {}),
    },
    idempotencyKey: `archon:${input.binding.name}:${input.eventId}`,
    payload,
  };
}
