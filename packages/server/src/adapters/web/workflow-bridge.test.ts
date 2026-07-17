import { describe, expect, test } from 'bun:test';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';
import { mapWorkflowEvent } from './workflow-bridge';

describe('mapWorkflowEvent', () => {
  test('maps live node_started events with runtime AI metadata', () => {
    const event: WorkflowEmitterEvent = {
      type: 'node_started',
      runId: 'run-ai',
      nodeId: 'create-story',
      nodeName: 'create-story',
      provider: 'codex',
      model: 'gpt-5.5',
      tier: 'large',
      modelReasoningEffort: 'xhigh',
    };

    const mapped = mapWorkflowEvent(event);

    expect(mapped).not.toBeNull();
    expect(JSON.parse(mapped as string)).toMatchObject({
      type: 'dag_node',
      runId: 'run-ai',
      nodeId: 'create-story',
      status: 'running',
      provider: 'codex',
      model: 'gpt-5.5',
      tier: 'large',
      modelReasoningEffort: 'xhigh',
    });
  });

  test('maps live node_routed events to completed dag_node events with route decision metadata', () => {
    const routeDecision = {
      sources: ['review'],
      outcome: 'exhausted',
      to: 'escalate',
      condition: "$review.output.approved == '<redacted>'",
      condition_result: false,
      negative_count: 3,
      max_iterations: 2,
      attempt: 3,
      execution_seq: 9,
    } as const;

    const event: WorkflowEmitterEvent = {
      type: 'node_routed',
      runId: 'run-route',
      nodeId: 'review-router',
      nodeName: 'Review Router',
      data: routeDecision,
    };

    const mapped = mapWorkflowEvent(event);

    expect(mapped).not.toBeNull();
    expect(JSON.parse(mapped as string)).toMatchObject({
      type: 'dag_node',
      runId: 'run-route',
      nodeId: 'review-router',
      name: 'Review Router',
      status: 'completed',
      routeDecision,
    });
  });
});

describe('mapWorkflowEvent — container_lifecycle (Phase B)', () => {
  test('container_lifecycle created → workflow_container_lifecycle SSE', () => {
    const event: WorkflowEmitterEvent = {
      type: 'container_lifecycle',
      runId: 'run-1',
      phase: 'created',
      containerId: 'abc123def456',
    };
    const sse = mapWorkflowEvent(event);
    const payload = JSON.parse(sse ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_container_lifecycle');
    expect(payload.runId).toBe('run-1');
    expect(payload.phase).toBe('created');
    expect(payload.containerId).toBe('abc123def456');
  });

  test('container_lifecycle destroyed → SSE without a containerId', () => {
    const event: WorkflowEmitterEvent = {
      type: 'container_lifecycle',
      runId: 'run-1',
      phase: 'destroyed',
    };
    const payload = JSON.parse(mapWorkflowEvent(event) ?? '{}') as Record<string, unknown>;
    expect(payload.type).toBe('workflow_container_lifecycle');
    expect(payload.phase).toBe('destroyed');
    expect(payload).not.toHaveProperty('containerId');
  });
});
