import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { AskAnswerBody, PendingInteraction } from '@/lib/api';
import { ensureUtc, formatDurationMs } from '@/lib/format';

import type { AskCardPresentation } from './ask-card-presentation';
import {
  draftToAnswerBody,
  isAskDraftValid,
  type AskDraft,
  type AskQuestion,
} from './parse-ask-envelope';

export interface AskCardProps {
  interaction: PendingInteraction;
  questions: readonly AskQuestion[];
  presentation: AskCardPresentation;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  agentDisplayName: string;
  nodeId: string;
  autoFocus: boolean;
  nowMs: number;
  onSubmit: (body: Extract<AskAnswerBody, { answers: unknown }>) => void;
  onDecline: () => void;
}

function elapsedWaitingMs(createdAt: string, nowMs: number): number {
  const startedAt = new Date(ensureUtc(createdAt)).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }
  return Math.max(0, nowMs - startedAt);
}

function formatAnswerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function answerSummaries(
  questions: readonly AskQuestion[],
  answer: AskAnswerBody | null
): { key: string; label: string; value: string }[] {
  if (answer === null || 'decline' in answer) {
    return [];
  }
  const prompts = new Map(
    questions.map((question): [string, string] => [question.id, question.prompt])
  );
  return answer.answers.map((item, index) => ({
    key: `${item.questionId}:${String(index)}`,
    label: prompts.get(item.questionId) ?? item.questionId,
    value: formatAnswerValue(item.value),
  }));
}

function PayloadDisclosure(props: {
  envelope: PendingInteraction['envelope'];
}): React.ReactElement {
  return (
    <details>
      <summary>View payload</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
        {JSON.stringify(props.envelope, null, 2)}
      </pre>
    </details>
  );
}

function ResolvedStamp(props: {
  presentation: AskCardPresentation;
  viewerIsStarter: boolean;
}): React.ReactElement | null {
  const { presentation, viewerIsStarter } = props;
  let text: string | null = null;
  if (presentation.viewState === 'answered') {
    text = viewerIsStarter ? 'Answered · by you' : 'Answered';
  } else if (presentation.viewState === 'declined') {
    text = 'Declined';
  } else if (presentation.viewState === 'rejected-late') {
    text = 'Already answered';
  } else if (presentation.viewState === 'failed-resume') {
    text = 'Resume failed — node failed; your answer is preserved below';
  }
  if (text === null) {
    return null;
  }
  return (
    <p className="text-sm text-text-primary">
      <span>{text}</span>
      {presentation.viewState === 'failed-resume' && presentation.error !== null ? (
        <span className="mt-1 block text-error">{presentation.error}</span>
      ) : null}
      {presentation.resolvedAt !== null ? (
        <time className="mt-1 block text-xs text-text-tertiary" dateTime={presentation.resolvedAt}>
          {presentation.resolvedAt}
        </time>
      ) : null}
    </p>
  );
}

export function AskCard(props: AskCardProps): React.ReactElement {
  const {
    interaction,
    questions,
    presentation,
    viewerIsStarter,
    starterDisplayName,
    agentDisplayName,
    nodeId,
    autoFocus,
    nowMs,
    onSubmit,
    onDecline,
  } = props;

  const [listedSingle, setListedSingle] = useState<Record<string, string>>({});
  const [listedMulti, setListedMulti] = useState<Record<string, string[]>>({});
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [declineOpen, setDeclineOpen] = useState(false);

  const draft = useMemo((): AskDraft => {
    const next: AskDraft = {};
    for (const question of questions) {
      if (question.selection === 'single') {
        if (otherSelected[question.id]) {
          next[question.id] = otherText[question.id] ?? '';
        } else if (listedSingle[question.id] !== undefined) {
          next[question.id] = listedSingle[question.id];
        }
        continue;
      }
      const selected = listedMulti[question.id] ?? [];
      if (otherSelected[question.id]) {
        next[question.id] = [...selected, otherText[question.id] ?? ''];
      } else {
        next[question.id] = selected;
      }
    }
    return next;
  }, [listedMulti, listedSingle, otherSelected, otherText, questions]);

  const draftValid = isAskDraftValid(questions, draft);
  const isPending = presentation.viewState === 'pending';
  const lockAnswers = !isPending || !viewerIsStarter;
  const showActions = isPending && viewerIsStarter;
  const waitingLabel = `Waiting for ${starterDisplayName ?? 'the run starter'} to answer`;

  function selectSingle(questionId: string, option: string): void {
    setOtherSelected(current => ({ ...current, [questionId]: false }));
    setListedSingle(current => ({ ...current, [questionId]: option }));
  }

  function selectSingleOther(questionId: string): void {
    setOtherSelected(current => ({ ...current, [questionId]: true }));
  }

  function toggleMulti(questionId: string, option: string, checked: boolean): void {
    setListedMulti(current => {
      const existing = current[questionId] ?? [];
      const next = checked
        ? existing.includes(option)
          ? existing
          : [...existing, option]
        : existing.filter(item => item !== option);
      return { ...current, [questionId]: next };
    });
  }

  function setQuestionOtherSelected(questionId: string, selected: boolean): void {
    setOtherSelected(current => ({ ...current, [questionId]: selected }));
  }

  function setQuestionOtherText(questionId: string, value: string): void {
    setOtherText(current => ({ ...current, [questionId]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!showActions || !draftValid) {
      return;
    }
    onSubmit(draftToAnswerBody(questions, draft));
  }

  return (
    <form
      aria-label={`question from agent, ${String(questions.length)} questions`}
      onSubmit={handleSubmit}
    >
      <Card className="border-warning bg-surface-elevated shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-text-primary">
            {`${agentDisplayName} is asking`}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>{nodeId}</span>
            <span>{formatDurationMs(elapsedWaitingMs(interaction.created_at, nowMs))}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {presentation.viewState === 'sending' ? (
            <p className="text-sm text-text-secondary">Sending…</p>
          ) : null}
          <ResolvedStamp presentation={presentation} viewerIsStarter={viewerIsStarter} />
          {presentation.error !== null && presentation.viewState !== 'failed-resume' ? (
            <p role="alert" className="text-sm text-error">
              {presentation.error}
            </p>
          ) : null}
          {answerSummaries(questions, presentation.answer).map(item => (
            <p key={item.key} className="text-sm text-text-primary">
              {item.label}: {item.value}
            </p>
          ))}
          <fieldset disabled={lockAnswers} className="min-w-0 space-y-4 border-0 p-0">
            {questions.map((question, questionIndex) => {
              const isOtherOn = otherSelected[question.id] ?? false;
              return (
                <fieldset key={question.id} className="min-w-0 space-y-2 border-0 p-0">
                  <legend className="text-sm font-medium text-text-primary">
                    {question.prompt}
                  </legend>
                  {question.options.map((option, optionIndex) => {
                    const controlId = `${interaction.id}:${question.id}:${option}`;
                    const focusFirst = autoFocus && questionIndex === 0 && optionIndex === 0;
                    if (question.selection === 'single') {
                      return (
                        <label
                          key={option}
                          className="flex items-center gap-2 text-sm text-text-primary"
                        >
                          <input
                            id={controlId}
                            type="radio"
                            name={`${interaction.id}:${question.id}`}
                            value={option}
                            checked={!isOtherOn && listedSingle[question.id] === option}
                            autoFocus={focusFirst}
                            onChange={(): void => {
                              selectSingle(question.id, option);
                            }}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    }
                    return (
                      <label
                        key={option}
                        className="flex items-center gap-2 text-sm text-text-primary"
                      >
                        <input
                          id={controlId}
                          type="checkbox"
                          name={`${interaction.id}:${question.id}`}
                          value={option}
                          checked={(listedMulti[question.id] ?? []).includes(option)}
                          autoFocus={focusFirst}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                            toggleMulti(question.id, option, event.target.checked);
                          }}
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                  {question.allowOther ? (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-text-primary">
                        <input
                          type={question.selection === 'single' ? 'radio' : 'checkbox'}
                          name={`${interaction.id}:${question.id}`}
                          value="__other__"
                          checked={isOtherOn}
                          autoFocus={
                            autoFocus && questionIndex === 0 && question.options.length === 0
                          }
                          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                            if (question.selection === 'single') {
                              selectSingleOther(question.id);
                              return;
                            }
                            setQuestionOtherSelected(question.id, event.target.checked);
                          }}
                        />
                        <span>Other</span>
                      </label>
                      {isOtherOn ? (
                        <Textarea
                          aria-label={`Other answer for ${question.prompt}`}
                          aria-required="true"
                          value={otherText[question.id] ?? ''}
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
                            setQuestionOtherText(question.id, event.target.value);
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
          </fieldset>
          {!viewerIsStarter && isPending ? (
            <p className="text-sm text-text-secondary">{waitingLabel}</p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          {showActions ? (
            <div className="flex flex-col items-stretch gap-3">
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={!draftValid}>
                  Submit
                </Button>
                <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline">
                      Decline
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Decline this ask?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The agent will be told you declined
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(): void => {
                          onDecline();
                        }}
                      >
                        Decline
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : null}
          <PayloadDisclosure envelope={interaction.envelope} />
        </CardFooter>
      </Card>
    </form>
  );
}

export function InvalidAskCard(props: {
  interaction: PendingInteraction;
  agentDisplayName: string;
  nodeId: string;
}): React.ReactElement {
  return (
    <section
      role="alert"
      className="rounded-lg border border-error bg-error/5 p-4 text-text-primary shadow-sm"
    >
      <p className="text-sm font-medium">Invalid Ask payload</p>
      <p className="mt-1 text-xs text-text-secondary">{`${props.agentDisplayName} · ${props.nodeId}`}</p>
      <div className="mt-3">
        <PayloadDisclosure envelope={props.interaction.envelope} />
      </div>
    </section>
  );
}
