import { describe, expect, test } from 'bun:test';
import {
  buildWorkflowEventEnvelope,
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
});
