import { describe, expect, test } from 'bun:test';
import type { PendingInteraction } from './schemas/pending-interaction';
import {
  latestOccurrenceId,
  loopIterationFromScope,
  mintTranscriptExecutionScope,
  newTranscriptAttempt,
  recoverScopeFromPending,
  selectAnsweredAsksForActivation,
  sharedAskResumeScope,
} from './transcript-execution-scope';

const OCCURRENCE_A = '11111111-1111-4111-8111-111111111111';
const OCCURRENCE_B = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_A = '22222222-2222-4222-8222-222222222222';

function pending(
  overrides: Partial<PendingInteraction> & Pick<PendingInteraction, 'tool_use_id' | 'node_id'>
): PendingInteraction {
  return {
    id: overrides.id ?? overrides.tool_use_id,
    workflow_run_id: 'run-1',
    kind: 'ask',
    status: 'answered',
    envelope: {},
    answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
    provider_session_id: 'sess-1',
    created_at: '2026-09-07T00:00:00.000Z',
    resolved_at: '2026-09-07T00:00:01.000Z',
    resolved_by: 'user-1',
    ...overrides,
  };
}

describe('mintTranscriptExecutionScope', () => {
  test('mints distinct UUID occurrence and attempt ids', () => {
    const first = mintTranscriptExecutionScope({ retryEpoch: 0 });
    const second = mintTranscriptExecutionScope({
      retryEpoch: 1,
      loopAncestry: [{ node_id: 'loop', iteration: 3 }],
    });
    expect(first.occurrence_id).not.toBe(second.occurrence_id);
    expect(first.attempt_id).not.toBe(second.attempt_id);
    expect(first.retry_epoch).toBe(0);
    expect(second.loop_ancestry).toEqual([{ node_id: 'loop', iteration: 3 }]);
    expect(newTranscriptAttempt(first).occurrence_id).toBe(first.occurrence_id);
    expect(newTranscriptAttempt(first).attempt_id).not.toBe(first.attempt_id);
  });
});

describe('selectAnsweredAsksForActivation', () => {
  const scoped = pending({
    node_id: 'review',
    tool_use_id: 'toolu_1',
    execution_scope: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 0 },
  });
  const otherOccurrence = pending({
    node_id: 'review',
    tool_use_id: 'toolu_old',
    execution_scope: { occurrence_id: OCCURRENCE_B, attempt_id: ATTEMPT_A, retry_epoch: 0 },
  });
  const retried = pending({
    node_id: 'review',
    tool_use_id: 'toolu_retry',
    execution_scope: { occurrence_id: OCCURRENCE_A, attempt_id: ATTEMPT_A, retry_epoch: 1 },
  });
  const unscoped = pending({ node_id: 'review', tool_use_id: 'toolu_legacy' });

  test('returns nothing when reuse is refused (route/retry admission)', () => {
    expect(selectAnsweredAsksForActivation([scoped], 'review', 0, { reuseAnswers: false })).toEqual(
      []
    );
  });

  test('selects only this epoch scoped answers and ignores other nodes', () => {
    const otherNode = pending({
      node_id: 'other',
      tool_use_id: 'toolu_x',
      execution_scope: scoped.execution_scope,
    });
    expect(
      selectAnsweredAsksForActivation([scoped, retried, otherNode], 'review', 0, {
        reuseAnswers: true,
      })
    ).toEqual([scoped]);
  });

  test('selects only the active occurrence when two same-epoch occurrences exist', () => {
    const current = pending({
      ...scoped,
      created_at: '2026-09-07T00:00:05.000Z',
    });
    const older = pending({
      ...otherOccurrence,
      created_at: '2026-09-07T00:00:01.000Z',
    });
    expect(
      selectAnsweredAsksForActivation([older, current], 'review', 0, { reuseAnswers: true })
    ).toEqual([current]);
    expect(
      selectAnsweredAsksForActivation([older, current], 'review', 0, {
        reuseAnswers: true,
        occurrenceId: OCCURRENCE_B,
      })
    ).toEqual([older]);
    expect(latestOccurrenceId([older, current])).toBe(OCCURRENCE_A);
  });

  test('selects only expected tool requests for the active occurrence', () => {
    const extraTool = pending({
      node_id: 'review',
      tool_use_id: 'toolu_extra',
      execution_scope: scoped.execution_scope,
    });
    expect(
      selectAnsweredAsksForActivation([scoped, extraTool, otherOccurrence], 'review', 0, {
        reuseAnswers: true,
        occurrenceId: OCCURRENCE_A,
        expectedToolUseIds: ['toolu_1'],
      })
    ).toEqual([scoped]);
  });

  test('does not reuse unscoped answers when scoped rows exist', () => {
    expect(
      selectAnsweredAsksForActivation([unscoped, scoped], 'review', 0, { reuseAnswers: true })
    ).toEqual([scoped]);
  });

  test('legacy unscoped answers resume only at epoch 0 when no scoped row exists', () => {
    expect(
      selectAnsweredAsksForActivation([unscoped], 'review', 0, { reuseAnswers: true })
    ).toEqual([unscoped]);
    expect(
      selectAnsweredAsksForActivation([unscoped], 'review', 1, { reuseAnswers: true })
    ).toEqual([]);
  });

  test('sharedAskResumeScope refuses mixed occurrences', () => {
    expect(sharedAskResumeScope([scoped])?.occurrence_id).toBe(OCCURRENCE_A);
    expect(sharedAskResumeScope([scoped, otherOccurrence])).toBeUndefined();
    expect(recoverScopeFromPending(unscoped)).toBeUndefined();
  });
});

describe('loopIterationFromScope', () => {
  test('restores the matching namespaced loop index from full ancestry', () => {
    const scope = mintTranscriptExecutionScope({
      retryEpoch: 0,
      loopAncestry: [
        { node_id: 'outer', iteration: 2 },
        { node_id: 'outer.inner', iteration: 3 },
      ],
    });
    expect(loopIterationFromScope(scope, 'outer.inner')).toBe(3);
    expect(loopIterationFromScope(scope, 'missing')).toBeUndefined();
  });
});
