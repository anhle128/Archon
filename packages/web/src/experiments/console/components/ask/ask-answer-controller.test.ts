import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import type { AskAnswerBody, WorkflowRunActionResponse } from '../../skills/runs';
import { HttpError } from '../../lib/http';

import {
  createAskAnswerController,
  type AskActionState,
  type AskActionStateByRequest,
} from './ask-answer-controller';

const RUN_ID = 'run-1';
const REQUEST_A = 'tool-a';
const REQUEST_B = 'tool-b';
const RESOLVED_AT = '2026-09-07T12:00:00.000Z';
const ANSWER_A: AskAnswerBody = { answers: [{ questionId: 'q1', value: 'Ship' }] };
const ANSWER_B: AskAnswerBody = { decline: true };
const ACCEPTED: WorkflowRunActionResponse = { success: true, message: 'accepted' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(
  postImpl?: (
    runId: string,
    requestId: string,
    answer: AskAnswerBody
  ) => Promise<WorkflowRunActionResponse>
): {
  states: AskActionStateByRequest;
  transitions: Array<{ requestId: string; state: AskActionState }>;
  postAnswer: ReturnType<typeof mock>;
  invalidate: ReturnType<typeof mock>;
  controller: ReturnType<typeof createAskAnswerController>;
} {
  const states: AskActionStateByRequest = {};
  const transitions: Array<{ requestId: string; state: AskActionState }> = [];
  const postAnswer = mock(
    postImpl ??
      (async (
        _runId: string,
        _requestId: string,
        _answer: AskAnswerBody
      ): Promise<WorkflowRunActionResponse> => ACCEPTED)
  );
  const invalidate = mock(async (): Promise<void> => undefined);
  const controller = createAskAnswerController({
    runId: RUN_ID,
    postAnswer,
    setActionState: (requestId: string, state: AskActionState): void => {
      states[requestId] = state;
      transitions.push({ requestId, state });
    },
    invalidate,
    now: (): Date => new Date(RESOLVED_AT),
  });
  return { states, transitions, postAnswer, invalidate, controller };
}

let warnSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
});

describe('createAskAnswerController', () => {
  test('accepts one Ask answer', async () => {
    const pending = deferred<WorkflowRunActionResponse>();
    const { states, transitions, postAnswer, invalidate, controller } = createHarness(
      async (): Promise<WorkflowRunActionResponse> => pending.promise
    );

    const submit = controller.submit(REQUEST_A, ANSWER_A);
    expect(states[REQUEST_A]).toEqual({ phase: 'sending' });
    expect(postAnswer).toHaveBeenCalledTimes(1);
    expect(postAnswer).toHaveBeenCalledWith(RUN_ID, REQUEST_A, ANSWER_A);
    expect(invalidate).toHaveBeenCalledTimes(0);

    pending.resolve(ACCEPTED);
    await submit;

    expect(states[REQUEST_A]).toEqual({
      phase: 'accepted',
      answer: ANSWER_A,
      resolvedAt: RESOLVED_AT,
    });
    expect(transitions.map(item => item.state.phase)).toEqual(['sending', 'accepted']);
    expect(postAnswer).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test('deduplicates only the same in-flight request', async () => {
    const pendingA = deferred<WorkflowRunActionResponse>();
    const pendingB = deferred<WorkflowRunActionResponse>();
    const { states, postAnswer, invalidate, controller } = createHarness(
      async (
        _runId: string,
        requestId: string,
        _answer: AskAnswerBody
      ): Promise<WorkflowRunActionResponse> =>
        requestId === REQUEST_A ? pendingA.promise : pendingB.promise
    );

    const first = controller.submit(REQUEST_A, ANSWER_A);
    const duplicate = controller.submit(REQUEST_A, ANSWER_A);
    const other = controller.submit(REQUEST_B, ANSWER_B);

    expect(postAnswer).toHaveBeenCalledTimes(2);
    expect(postAnswer.mock.calls[0]?.slice(0, 2)).toEqual([RUN_ID, REQUEST_A]);
    expect(postAnswer.mock.calls[1]?.slice(0, 2)).toEqual([RUN_ID, REQUEST_B]);
    expect(states[REQUEST_A]).toEqual({ phase: 'sending' });
    expect(states[REQUEST_B]).toEqual({ phase: 'sending' });

    pendingA.resolve(ACCEPTED);
    pendingB.resolve(ACCEPTED);
    await Promise.all([first, duplicate, other]);

    expect(states[REQUEST_A]).toEqual({
      phase: 'accepted',
      answer: ANSWER_A,
      resolvedAt: RESOLVED_AT,
    });
    expect(states[REQUEST_B]).toEqual({
      phase: 'accepted',
      answer: ANSWER_B,
      resolvedAt: RESOLVED_AT,
    });
    expect(postAnswer).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test('classifies rejected and failed Ask answers', async () => {
    const cases: Array<{
      name: string;
      error: unknown;
      expected: AskActionState;
      invalidateCalls: number;
    }> = [
      {
        name: '409',
        error: new HttpError(409, '/ask', 'taken'),
        expected: { phase: 'rejected-late' },
        invalidateCalls: 1,
      },
      {
        name: 'Error',
        error: new Error('network down'),
        expected: { phase: 'error', message: 'network down' },
        invalidateCalls: 0,
      },
      {
        name: 'non-Error',
        error: 'boom',
        expected: { phase: 'error', message: 'Failed to answer.' },
        invalidateCalls: 0,
      },
    ];

    for (const { error, expected, invalidateCalls } of cases) {
      const { states, postAnswer, invalidate, controller } = createHarness(
        async (): Promise<WorkflowRunActionResponse> => {
          throw error;
        }
      );

      await controller.submit(REQUEST_A, ANSWER_A);

      expect(states[REQUEST_A]).toEqual(expected);
      expect(postAnswer).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(invalidateCalls);
    }
  });

  test('warns on invalidation failure without reverting accepted state', async () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    const states: AskActionStateByRequest = {};
    const harness = createAskAnswerController({
      runId: RUN_ID,
      postAnswer: async (): Promise<WorkflowRunActionResponse> => ACCEPTED,
      setActionState: (requestId: string, state: AskActionState): void => {
        states[requestId] = state;
      },
      invalidate: async (): Promise<void> => {
        throw new Error('cache down');
      },
      now: (): Date => new Date(RESOLVED_AT),
    });

    await harness.submit(REQUEST_A, ANSWER_A);

    expect(states[REQUEST_A]).toEqual({
      phase: 'accepted',
      answer: ANSWER_A,
      resolvedAt: RESOLVED_AT,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[AskAnswer] Failed to invalidate query cache', {
      runId: RUN_ID,
      requestId: REQUEST_A,
      error: 'cache down',
    });
  });
});
