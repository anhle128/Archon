import type { AskAnswerBody, PendingInteraction, WorkflowNodeStateResponse } from '@/lib/api';

import type { AskActionState } from './ask-answer-controller';
import { parseAskAnswer } from './parse-ask-envelope';

export type AskCardViewState =
  | 'pending'
  | 'sending'
  | 'answered'
  | 'declined'
  | 'rejected-late'
  | 'failed-resume';

export interface AskCardPresentation {
  viewState: AskCardViewState;
  answer: AskAnswerBody | null;
  error: string | null;
  resolvedAt: string | null;
}

const ASK_RESUME_ERROR_PREFIX = 'Could not resume the AskHuman session';
const MALFORMED_CANONICAL_ANSWER_ERROR = 'Malformed canonical answer';

function isDecline(answer: AskAnswerBody): boolean {
  return 'decline' in answer;
}

function readCanonicalAnswer(interaction: PendingInteraction): {
  answer: AskAnswerBody | null;
  malformed: boolean;
} {
  if (interaction.answer === null) {
    return { answer: null, malformed: false };
  }
  const parsed = parseAskAnswer(interaction.answer);
  if (parsed === null) {
    return { answer: null, malformed: true };
  }
  return { answer: parsed, malformed: false };
}

function applyResumeFailure(
  presentation: AskCardPresentation,
  nodeStatus: WorkflowNodeStateResponse['status'] | undefined,
  nodeError: string | undefined
): AskCardPresentation {
  if (
    (presentation.viewState === 'answered' || presentation.viewState === 'declined') &&
    nodeStatus === 'failed' &&
    typeof nodeError === 'string' &&
    nodeError.startsWith(ASK_RESUME_ERROR_PREFIX)
  ) {
    return {
      ...presentation,
      viewState: 'failed-resume',
      error: nodeError,
    };
  }
  return presentation;
}

export function resolveAskCardPresentation(input: {
  interaction: PendingInteraction;
  action: AskActionState | undefined;
  nodeStatus: WorkflowNodeStateResponse['status'] | undefined;
  nodeError: string | undefined;
}): AskCardPresentation {
  const { interaction, action, nodeStatus, nodeError } = input;

  if (action?.phase === 'rejected-late') {
    return {
      viewState: 'rejected-late',
      answer: readCanonicalAnswer(interaction).answer,
      error: null,
      resolvedAt: interaction.resolved_at,
    };
  }

  if (action?.phase === 'sending') {
    return {
      viewState: 'sending',
      answer: null,
      error: null,
      resolvedAt: null,
    };
  }

  const canonical = readCanonicalAnswer(interaction);
  if (canonical.malformed) {
    return {
      viewState: 'answered',
      answer: null,
      error: MALFORMED_CANONICAL_ANSWER_ERROR,
      resolvedAt: interaction.resolved_at,
    };
  }

  const localAccepted = action?.phase === 'accepted' ? action : undefined;
  const effectiveAnswer = canonical.answer ?? localAccepted?.answer ?? null;
  const resolvedAt =
    canonical.answer !== null ? interaction.resolved_at : (localAccepted?.resolvedAt ?? null);

  if (effectiveAnswer !== null) {
    return applyResumeFailure(
      {
        viewState: isDecline(effectiveAnswer) ? 'declined' : 'answered',
        answer: effectiveAnswer,
        error: null,
        resolvedAt,
      },
      nodeStatus,
      nodeError
    );
  }

  if (action?.phase === 'error') {
    return {
      viewState: 'pending',
      answer: null,
      error: action.message,
      resolvedAt: null,
    };
  }

  return {
    viewState: 'pending',
    answer: null,
    error: null,
    resolvedAt: null,
  };
}
