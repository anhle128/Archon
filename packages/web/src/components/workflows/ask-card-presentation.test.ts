import { describe, expect, test } from 'bun:test';

import type { AskAnswerBody, PendingInteraction } from '@/lib/api';

import type { AskActionState } from './ask-answer-controller';
import { resolveAskCardPresentation, type AskCardPresentation } from './ask-card-presentation';

const CREATED_AT = '2026-09-06T00:00:00.000Z';
const LOCAL_RESOLVED_AT = '2026-09-07T12:00:00.000Z';
const CANONICAL_RESOLVED_AT = '2026-09-07T12:05:00.000Z';
const LOCAL_ANSWER: AskAnswerBody = { answers: [{ questionId: 'q1', value: 'Hold' }] };
const CANONICAL_ANSWER: AskAnswerBody = { answers: [{ questionId: 'q1', value: 'Ship' }] };
const DECLINE: AskAnswerBody = { decline: true };
const RESUME_ERROR = 'Could not resume the AskHuman session: provider closed';

function interaction(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-a',
    kind: 'ask',
    status: 'pending',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function resolve(input: {
  interaction?: PendingInteraction;
  action?: AskActionState;
  nodeStatus?: Parameters<typeof resolveAskCardPresentation>[0]['nodeStatus'];
  nodeError?: string;
}): AskCardPresentation {
  return resolveAskCardPresentation({
    interaction: input.interaction ?? interaction(),
    action: input.action,
    nodeStatus: input.nodeStatus,
    nodeError: input.nodeError,
  });
}

describe('resolveAskCardPresentation', () => {
  test('derives honest Ask card states', () => {
    const cases: Array<{
      name: string;
      actual: AskCardPresentation;
      expected: AskCardPresentation;
    }> = [
      {
        name: 'pending',
        actual: resolve({}),
        expected: { viewState: 'pending', answer: null, error: null, resolvedAt: null },
      },
      {
        name: 'sending',
        actual: resolve({ action: { phase: 'sending' } }),
        expected: { viewState: 'sending', answer: null, error: null, resolvedAt: null },
      },
      {
        name: 'accepted answers',
        actual: resolve({
          action: { phase: 'accepted', answer: LOCAL_ANSWER, resolvedAt: LOCAL_RESOLVED_AT },
        }),
        expected: {
          viewState: 'answered',
          answer: LOCAL_ANSWER,
          error: null,
          resolvedAt: LOCAL_RESOLVED_AT,
        },
      },
      {
        name: 'accepted decline',
        actual: resolve({
          action: { phase: 'accepted', answer: DECLINE, resolvedAt: LOCAL_RESOLVED_AT },
        }),
        expected: {
          viewState: 'declined',
          answer: DECLINE,
          error: null,
          resolvedAt: LOCAL_RESOLVED_AT,
        },
      },
      {
        name: 'canonical answer overrides local',
        actual: resolve({
          interaction: interaction({
            status: 'answered',
            answer: CANONICAL_ANSWER,
            resolved_at: CANONICAL_RESOLVED_AT,
          }),
          action: { phase: 'accepted', answer: LOCAL_ANSWER, resolvedAt: LOCAL_RESOLVED_AT },
        }),
        expected: {
          viewState: 'answered',
          answer: CANONICAL_ANSWER,
          error: null,
          resolvedAt: CANONICAL_RESOLVED_AT,
        },
      },
      {
        name: 'rejected-late overrides canonical',
        actual: resolve({
          interaction: interaction({
            status: 'answered',
            answer: CANONICAL_ANSWER,
            resolved_at: CANONICAL_RESOLVED_AT,
          }),
          action: { phase: 'rejected-late' },
        }),
        expected: {
          viewState: 'rejected-late',
          answer: CANONICAL_ANSWER,
          error: null,
          resolvedAt: CANONICAL_RESOLVED_AT,
        },
      },
      {
        name: 'per-card error retention',
        actual: resolve({ action: { phase: 'error', message: 'network down' } }),
        expected: {
          viewState: 'pending',
          answer: null,
          error: 'network down',
          resolvedAt: null,
        },
      },
      {
        name: 'malformed canonical answer',
        actual: resolve({
          interaction: interaction({
            status: 'answered',
            answer: { extra: true },
            resolved_at: CANONICAL_RESOLVED_AT,
          }),
          action: { phase: 'accepted', answer: LOCAL_ANSWER, resolvedAt: LOCAL_RESOLVED_AT },
        }),
        expected: {
          viewState: 'answered',
          answer: null,
          error: 'Malformed canonical answer',
          resolvedAt: CANONICAL_RESOLVED_AT,
        },
      },
      {
        name: 'answered status without canonical answer',
        actual: resolve({
          interaction: interaction({
            status: 'answered',
            answer: null,
            resolved_at: CANONICAL_RESOLVED_AT,
          }),
          action: { phase: 'accepted', answer: LOCAL_ANSWER, resolvedAt: LOCAL_RESOLVED_AT },
        }),
        expected: {
          viewState: 'answered',
          answer: null,
          error: 'Malformed canonical answer',
          resolvedAt: CANONICAL_RESOLVED_AT,
        },
      },
    ];

    for (const { actual, expected } of cases) {
      expect(actual).toEqual(expected);
    }
  });

  test('uses failed-resume only for the persisted resume error', () => {
    const accepted = {
      phase: 'accepted' as const,
      answer: CANONICAL_ANSWER,
      resolvedAt: LOCAL_RESOLVED_AT,
    };

    expect(
      resolve({
        action: accepted,
        nodeStatus: 'failed',
        nodeError: RESUME_ERROR,
      })
    ).toEqual({
      viewState: 'failed-resume',
      answer: CANONICAL_ANSWER,
      error: RESUME_ERROR,
      resolvedAt: LOCAL_RESOLVED_AT,
    });

    expect(
      resolve({
        action: accepted,
        nodeStatus: 'failed',
        nodeError: 'lint failed',
      })
    ).toEqual({
      viewState: 'answered',
      answer: CANONICAL_ANSWER,
      error: null,
      resolvedAt: LOCAL_RESOLVED_AT,
    });

    expect(
      resolve({
        action: { phase: 'accepted', answer: DECLINE, resolvedAt: LOCAL_RESOLVED_AT },
        nodeStatus: 'failed',
        nodeError: RESUME_ERROR,
      })
    ).toEqual({
      viewState: 'failed-resume',
      answer: DECLINE,
      error: RESUME_ERROR,
      resolvedAt: LOCAL_RESOLVED_AT,
    });

    expect(
      resolve({
        nodeStatus: 'failed',
        nodeError: RESUME_ERROR,
      })
    ).toEqual({
      viewState: 'pending',
      answer: null,
      error: null,
      resolvedAt: null,
    });
  });
});
