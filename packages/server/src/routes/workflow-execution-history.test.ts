import { describe, expect, test } from 'bun:test';
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import type { PendingInteraction } from '@archon/workflows/schemas/pending-interaction';
import { projectWorkflowExecutionHistory } from './workflow-execution-history';

function event(
  overrides: Partial<WorkflowEventRow> & Pick<WorkflowEventRow, 'id' | 'event_type'>
): WorkflowEventRow {
  return {
    workflow_run_id: 'run-1',
    step_index: null,
    step_name: 'review',
    data: {},
    created_at: '2026-09-07T00:00:00.000Z',
    event_order: null,
    ...overrides,
  };
}

const OCCURRENCE_A = '11111111-1111-4111-8111-111111111111';
const OCCURRENCE_B = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_A = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_B = '44444444-4444-4444-8444-444444444444';

describe('projectWorkflowExecutionHistory', () => {
  test('groups scoped node_started/completed pairs as distinct occurrences', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'prompt' },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
        event({
          id: 'e3',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:03.000Z',
          data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_A, type: 'prompt' },
        }),
        event({
          id: 'e4',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:04.000Z',
          data: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions.map(item => item.occurrence_id)).toEqual([OCCURRENCE_A, OCCURRENCE_B]);
    expect(executions[0]?.status).toBe('completed');
    expect(executions[0]?.duration_ms).toBe(1000);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('marks overlapping unscoped starts unknown instead of assigning the first iteration', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { iteration: 1 },
        }),
        event({
          id: 'e2',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { iteration: 2 },
        }),
        event({
          id: 'e3',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:03.000Z',
          data: {},
        }),
      ],
    });
    expect(executions.some(item => item.unknown_scope === true)).toBe(true);
    expect(executions.some(item => item.unknown_reason === 'overlapping_unscoped_starts')).toBe(
      true
    );
  });

  test('copies loop_ancestry and route_activation_seq onto history entries', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          step_name: 'inspect-twice',
          event_type: 'loop_iteration_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            loop_ancestry: [{ node_id: 'inspect-twice', iteration: 2 }],
            route_activation_seq: 3,
          },
        }),
        event({
          id: 'e2',
          step_name: 'inspect-twice',
          event_type: 'loop_iteration_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.loop_ancestry).toEqual([{ node_id: 'inspect-twice', iteration: 2 }]);
    expect(executions[0]?.route_activation_seq).toBe(3);
  });

  test('pairs executor-shaped start and terminal events that share occurrence identity', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            retry_epoch: 0,
            route_activation_seq: 2,
            type: 'prompt',
          },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:02.000Z',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            retry_epoch: 0,
            route_activation_seq: 2,
            duration_ms: 1000,
          },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('completed');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
    expect(executions[0]?.route_activation_seq).toBe(2);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('nests loop iteration terminals under the same node occurrence', () => {
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, type: 'loop' },
        }),
        event({
          id: 'e2',
          event_type: 'loop_iteration_started',
          created_at: '2026-09-07T00:00:02.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, iteration: 1 },
        }),
        event({
          id: 'e3',
          event_type: 'loop_iteration_completed',
          created_at: '2026-09-07T00:00:03.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, iteration: 1 },
        }),
        event({
          id: 'e4',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:04.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A },
        }),
      ],
    });
    expect(executions).toHaveLength(2);
    expect(executions.every(item => item.unknown_scope === undefined)).toBe(true);
    expect(executions.map(item => item.status)).toEqual(['completed', 'completed']);
  });

  test('records a scoped skip without a matching start as skipped, not unknown', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_skipped',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, reason: 'trigger_rule' },
        }),
      ],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('skipped');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
    expect(executions[0]?.unknown_scope).toBeUndefined();
  });

  test('preserves same-attempt start timing when an interaction becomes awaiting', () => {
    const pending: PendingInteraction = {
      id: 'pending-same-attempt',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-same-attempt',
      kind: 'ask',
      status: 'pending',
      envelope: {},
      answer: null,
      provider_session_id: 'session-1',
      created_at: '2026-09-07T00:00:02.000Z',
      resolved_at: null,
      resolved_by: null,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_A,
        retry_epoch: 0,
      },
    };
    const executions = projectWorkflowExecutionHistory({
      runStartedAt: '2026-09-07T00:00:00.000Z',
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
      ],
      pendingInteractions: [pending],
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_A,
      status: 'awaiting',
      started_at: '2026-09-07T00:00:01.000Z',
      start_offset_ms: 1000,
    });
  });

  test('projects a re-asked pending interaction onto its current attempt', () => {
    const pending: PendingInteraction = {
      id: 'pending-1',
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'tool-1',
      kind: 'ask',
      status: 'pending',
      envelope: {},
      answer: null,
      provider_session_id: 'session-1',
      created_at: '2026-09-07T00:00:02.000Z',
      resolved_at: null,
      resolved_by: null,
      execution_scope: {
        occurrence_id: OCCURRENCE_A,
        attempt_id: ATTEMPT_B,
        retry_epoch: 1,
      },
    };
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
      ],
      pendingInteractions: [pending],
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_B,
      retry_epoch: 1,
      status: 'awaiting',
    });
    expect(executions[0]?.started_at).toBeUndefined();
    expect(executions[0]?.start_offset_ms).toBeUndefined();
  });
  test('projects a successful re-ask terminal onto its current attempt', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
        }),
        event({
          id: 'e2',
          event_type: 'node_completed',
          created_at: '2026-09-07T00:00:01.000Z',
          data: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_B, retry_epoch: 1 },
        }),
      ],
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      occurrence_id: OCCURRENCE_A,
      attempt_id: ATTEMPT_B,
      retry_epoch: 1,
      status: 'completed',
    });
  });

  test('does not copy unknown event data keys onto history entries', () => {
    const executions = projectWorkflowExecutionHistory({
      events: [
        event({
          id: 'e1',
          event_type: 'node_started',
          data: {
            occurrence_id: OCCURRENCE_A,
            attempt_id: ATTEMPT_A,
            secret: 'DO_NOT_COPY',
          },
        }),
      ],
    });
    expect(JSON.stringify(executions)).not.toContain('DO_NOT_COPY');
    expect(executions[0]?.occurrence_id).toBe(OCCURRENCE_A);
  });
});
