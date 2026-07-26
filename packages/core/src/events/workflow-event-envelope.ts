import { deriveBindingId } from '../db/provider-bindings';
import { z } from '@hono/zod-openapi';

export type ExternalWorkflowEventType =
  | 'workflow.run.started'
  | 'workflow.run.completed'
  | 'workflow.run.failed'
  | 'workflow.approval.requested'
  | 'workflow.delivery.failed'
  | 'workflow.artifact.recorded';

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

export interface WorkflowEventEnvelope {
  schemaVersion: 'workflow-event-envelope.v1';
  provider: string;
  eventId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  bindingRef: {
    provider: string;
    name: string;
    bindingId: string;
    projectRef: string;
  };
  workflowRunRef: {
    provider: string;
    runId: string;
    workflowName: string;
    projectRef: string;
  };
  projectRef: {
    id: string;
    codebaseRef: string;
    repositoryPath: string;
    defaultBranch?: string;
  };
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

const nonEmptyStringSchema = z.string().min(1);
const dateTimeSchema = z.string().datetime();

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
