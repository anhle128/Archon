import type { AskAnswerBody, WorkflowRunActionResponse } from '@/lib/api';
import { getApiErrorStatus } from '@/lib/api';

export type AskActionState =
  | { phase: 'sending' }
  | { phase: 'accepted'; answer: AskAnswerBody; resolvedAt: string }
  | { phase: 'rejected-late' }
  | { phase: 'error'; message: string };

export type AskActionStateByRequest = Record<string, AskActionState | undefined>;

export interface AskAnswerController {
  submit: (requestId: string, answer: AskAnswerBody) => Promise<void>;
}

export function createAskAnswerController(input: {
  runId: string;
  postAnswer: (
    runId: string,
    requestId: string,
    answer: AskAnswerBody
  ) => Promise<WorkflowRunActionResponse>;
  setActionState: (requestId: string, state: AskActionState) => void;
  invalidate: () => Promise<void>;
  now: () => Date;
}): AskAnswerController {
  const inFlight = new Set<string>();

  const invalidateAfterTerminal = async (requestId: string): Promise<void> => {
    try {
      await input.invalidate();
    } catch (err: unknown) {
      console.warn('[AskAnswer] Failed to invalidate query cache', {
        runId: input.runId,
        requestId,
        error: err instanceof Error ? err.message : err,
      });
    }
  };

  return {
    submit: async (requestId: string, answer: AskAnswerBody): Promise<void> => {
      if (inFlight.has(requestId)) {
        return;
      }
      inFlight.add(requestId);
      try {
        input.setActionState(requestId, { phase: 'sending' });
        try {
          await input.postAnswer(input.runId, requestId, answer);
          input.setActionState(requestId, {
            phase: 'accepted',
            answer,
            resolvedAt: input.now().toISOString(),
          });
          await invalidateAfterTerminal(requestId);
        } catch (error: unknown) {
          if (getApiErrorStatus(error) === 409) {
            input.setActionState(requestId, { phase: 'rejected-late' });
            await invalidateAfterTerminal(requestId);
            return;
          }
          const message = error instanceof Error ? error.message : 'Failed to answer.';
          input.setActionState(requestId, { phase: 'error', message });
        }
      } finally {
        inFlight.delete(requestId);
      }
    },
  };
}
