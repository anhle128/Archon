import { describe, expect, test } from 'bun:test';
import {
  buildWorkflowEventEnvelope,
  workflowEventEnvelopeSchema,
  type ExternalWorkflowEventType,
} from './workflow-event-envelope';

const run = {
  id: 'run-1',
  workflow_name: 'bmad-dev-story',
};

const binding = {
  provider: 'archon',
  name: 'workflow-engine-primary',
};

const baseCodebase = {
  id: 'cb-1',
  name: 'workflow-engine',
  default_cwd: '/workspace/workflow-engine',
  default_branch: 'dev',
};

const payloads: Record<ExternalWorkflowEventType, Record<string, unknown>> = {
  'workflow.run.started': { state: 'running', startedAt: '2026-07-25T00:00:00.000Z' },
  'workflow.run.completed': {
    state: 'completed',
    result: { outcome: 'accepted', completedAt: '2026-07-25T00:05:00.000Z' },
  },
  'workflow.run.failed': {
    state: 'failed',
    failure: {
      code: 'WORKFLOW_FAILED',
      category: 'workflow_failure',
      retryable: false,
      details: { error: 'failed' },
    },
  },
  'workflow.approval.requested': {
    state: 'waiting-for-approval',
    approval: {
      requestId: 'approval:run-1:review',
      requestedAction: 'approve-or-reject',
      phase: 'review',
      gateType: 'approval',
      nodeId: 'review',
      message: 'Review the plan.',
      userPrompt: 'Build the approved bridge.',
      reviewUrl: 'https://archon.example.ts.net/console/p/cb-1/r/run-1',
    },
  },
  'workflow.delivery.failed': {
    deliveryOnly: true,
    mutationIntent: 'none',
    deliveryStatus: 'retrying',
    failedDeliveryId: 'attempt-1',
    nextStatus: 'retrying',
    diagnosticRef: 'workflow-event-outbox:evt-1',
  },
  'workflow.artifact.recorded': {
    artifact: {
      type: 'markdown',
      name: 'summary',
      uri: 'file:_bmad-output/summary.md',
      digest: 'sha256:digest',
    },
  },
};

describe('buildWorkflowEventEnvelope', () => {
  for (const eventType of [
    'workflow.run.started',
    'workflow.run.completed',
    'workflow.run.failed',
    'workflow.approval.requested',
    'workflow.delivery.failed',
  ] as const) {
    test(`builds the 10-field envelope for ${eventType}`, () => {
      const envelope = buildWorkflowEventEnvelope({
        eventId: `evt-${eventType}`,
        eventType,
        occurredAt: '2026-07-25T00:00:00.000Z',
        run,
        codebase: baseCodebase,
        binding,
        payload: payloads[eventType],
      });

      expect(Object.keys(envelope).sort()).toEqual(
        [
          'schemaVersion',
          'provider',
          'eventId',
          'eventType',
          'occurredAt',
          'bindingRef',
          'workflowRunRef',
          'projectRef',
          'idempotencyKey',
          'payload',
        ].sort()
      );
      expect(envelope.bindingRef.projectRef).toBe('project:cb-1');
      expect(envelope.workflowRunRef.projectRef).toBe('project:cb-1');
      expect(envelope.projectRef.codebaseRef).toBe('workflow-engine');
      expect(envelope.idempotencyKey).toBe(`archon:workflow-engine-primary:evt-${eventType}`);
      expect('signature' in envelope).toBe(false);
      expect('delivery' in envelope).toBe(false);
      expect('profileRoute' in envelope).toBe(false);
    });
  }

  test('omits defaultBranch for folder codebases without a default branch', () => {
    const envelope = buildWorkflowEventEnvelope({
      eventId: 'evt-folder',
      eventType: 'workflow.run.started',
      occurredAt: '2026-07-25T00:00:00.000Z',
      run,
      codebase: { ...baseCodebase, id: 'folder-1', default_branch: null },
      binding,
      payload: payloads['workflow.run.started'],
    });

    expect(envelope.projectRef).toEqual({
      id: 'folder-1',
      codebaseRef: 'workflow-engine',
      repositoryPath: '/workspace/workflow-engine',
    });
  });

  test('rejects payloads that do not match their event type', () => {
    expect(() =>
      buildWorkflowEventEnvelope({
        eventId: 'evt-invalid',
        eventType: 'workflow.run.completed',
        occurredAt: '2026-07-25T00:00:00.000Z',
        run,
        codebase: baseCodebase,
        binding,
        payload: { state: 'completed' },
      })
    ).toThrow();
  });

  test('rejects approval payloads missing userPrompt or reviewUrl', () => {
    const approvalPayload = payloads['workflow.approval.requested'];

    expect(() =>
      buildWorkflowEventEnvelope({
        eventId: 'evt-missing-user-prompt',
        eventType: 'workflow.approval.requested',
        occurredAt: '2026-07-25T00:00:00.000Z',
        run,
        codebase: baseCodebase,
        binding,
        payload: {
          ...approvalPayload,
          approval: {
            ...(approvalPayload.approval as Record<string, unknown>),
            userPrompt: undefined,
          },
        },
      })
    ).toThrow();

    expect(() =>
      buildWorkflowEventEnvelope({
        eventId: 'evt-missing-review-url',
        eventType: 'workflow.approval.requested',
        occurredAt: '2026-07-25T00:00:00.000Z',
        run,
        codebase: baseCodebase,
        binding,
        payload: {
          ...approvalPayload,
          approval: {
            ...(approvalPayload.approval as Record<string, unknown>),
            reviewUrl: undefined,
          },
        },
      })
    ).toThrow();
  });

  test('rejects approval review URLs outside HTTP and HTTPS', () => {
    const approvalPayload = payloads['workflow.approval.requested'];

    expect(() =>
      buildWorkflowEventEnvelope({
        eventId: 'evt-file-review-url',
        eventType: 'workflow.approval.requested',
        occurredAt: '2026-07-25T00:00:00.000Z',
        run,
        codebase: baseCodebase,
        binding,
        payload: {
          ...approvalPayload,
          approval: {
            ...(approvalPayload.approval as Record<string, unknown>),
            reviewUrl: 'file:///tmp/review',
          },
        },
      })
    ).toThrow();
  });

  test('rejects approval review URLs with user-info credentials', () => {
    const approvalPayload = payloads['workflow.approval.requested'];

    for (const reviewUrl of [
      'https://user@archon.example.ts.net/console/p/cb-1/r/run-1',
      'https://user:token@archon.example.ts.net/console/p/cb-1/r/run-1',
    ]) {
      expect(() =>
        buildWorkflowEventEnvelope({
          eventId: 'evt-credential-review-url',
          eventType: 'workflow.approval.requested',
          occurredAt: '2026-07-25T00:00:00.000Z',
          run,
          codebase: baseCodebase,
          binding,
          payload: {
            ...approvalPayload,
            approval: {
              ...(approvalPayload.approval as Record<string, unknown>),
              reviewUrl,
            },
          },
        })
      ).toThrow();
    }
  });
});

test('workflowEventEnvelopeSchema selects the payload schema from eventType', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-schema',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(workflowEventEnvelopeSchema.parse(envelope).eventType).toBe('workflow.run.started');
  expect(() =>
    workflowEventEnvelopeSchema.parse({ ...envelope, eventType: 'workflow.run.completed' })
  ).toThrow();
});

test('workflowEventEnvelopeSchema normalizes payload ordering like the live builder', () => {
  const live = buildWorkflowEventEnvelope({
    eventId: 'evt-order',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  const parsed = workflowEventEnvelopeSchema.parse({
    ...live,
    payload: {
      startedAt: '2026-07-25T00:00:00.000Z',
      state: 'running',
    },
  });

  expect(JSON.stringify(parsed.payload)).toBe(JSON.stringify(live.payload));
});

test('workflowEventEnvelopeSchema rejects non-canonical top-level and ref keys', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-strict',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(() => workflowEventEnvelopeSchema.parse({ ...envelope, extra: true })).toThrow();
  expect(() =>
    workflowEventEnvelopeSchema.parse({
      ...envelope,
      bindingRef: { ...envelope.bindingRef, secret: 'must-not-pass' },
    })
  ).toThrow();
});

test('identity serialization remains byte-identical to the current literal shape', () => {
  const envelope = buildWorkflowEventEnvelope({
    eventId: 'evt-identity',
    eventType: 'workflow.run.started',
    occurredAt: '2026-07-25T00:00:00.000Z',
    run,
    codebase: baseCodebase,
    binding,
    payload: payloads['workflow.run.started'],
  });
  expect(JSON.stringify(envelope)).toBe(
    '{"schemaVersion":"workflow-event-envelope.v1","provider":"archon","eventId":"evt-identity","eventType":"workflow.run.started","occurredAt":"2026-07-25T00:00:00.000Z","bindingRef":{"provider":"archon","name":"workflow-engine-primary","bindingId":"wpb_archon::workflow_engine_primary","projectRef":"project:cb-1"},"workflowRunRef":{"provider":"archon","runId":"run-1","workflowName":"bmad-dev-story","projectRef":"project:cb-1"},"projectRef":{"id":"cb-1","codebaseRef":"workflow-engine","repositoryPath":"/workspace/workflow-engine","defaultBranch":"dev"},"idempotencyKey":"archon:workflow-engine-primary:evt-identity","payload":{"state":"running","startedAt":"2026-07-25T00:00:00.000Z"}}'
  );
});
