import type { AskAnswerBody } from '@/lib/api';

export interface AskQuestion {
  id: string;
  prompt: string;
  selection: 'single' | 'multi';
  options: string[];
  allowOther: boolean;
}

export type AskDraftValue = string | string[];
export type AskDraft = Record<string, AskDraftValue>;
export type AskDraftByRequest = Record<string, AskDraft | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every(key => keys.includes(key));
}

function parseQuestion(item: unknown, seenIds: Set<string>): AskQuestion | null {
  if (!isPlainObject(item)) {
    return null;
  }

  const { id, prompt, selection, options, allowOther } = item;
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (seenIds.has(id)) {
    return null;
  }
  if (typeof prompt !== 'string') {
    return null;
  }
  if (selection !== 'single' && selection !== 'multi') {
    return null;
  }
  if (!isStringArray(options)) {
    return null;
  }
  if (typeof allowOther !== 'boolean') {
    return null;
  }

  seenIds.add(id);
  return { id, prompt, selection, options, allowOther };
}

export function parseAskEnvelope(envelope: Record<string, unknown>): AskQuestion[] | null {
  if (!isPlainObject(envelope)) {
    return null;
  }

  const { questions } = envelope;
  if (!Array.isArray(questions) || questions.length === 0) {
    return null;
  }

  const seenIds = new Set<string>();
  const parsed: AskQuestion[] = [];
  for (const item of questions) {
    const question = parseQuestion(item, seenIds);
    if (question === null) {
      return null;
    }
    parsed.push(question);
  }
  return parsed;
}

function isAllowedChoice(question: AskQuestion, value: string): boolean {
  if (question.options.includes(value)) {
    return true;
  }
  return question.allowOther && value.trim() !== '';
}

export function isQuestionValid(question: AskQuestion, value: AskDraftValue | undefined): boolean {
  if (question.selection === 'single') {
    return typeof value === 'string' && isAllowedChoice(question, value);
  }
  return (
    Array.isArray(value) && value.length > 0 && value.every(item => isAllowedChoice(question, item))
  );
}

export function isAskDraftValid(questions: readonly AskQuestion[], draft: AskDraft): boolean {
  return questions.every(question => isQuestionValid(question, draft[question.id]));
}

export function draftToAnswerBody(
  questions: readonly AskQuestion[],
  draft: AskDraft
): Extract<AskAnswerBody, { answers: unknown }> {
  return {
    answers: questions.map(question => {
      const value = draft[question.id];
      if (value === undefined) {
        throw new Error(`Ask draft is missing ${question.id}`);
      }
      return { questionId: question.id, value };
    }),
  };
}

function parseAskAnswerItem(
  item: unknown
): { questionId: string; value: string | string[] } | null {
  if (!isPlainObject(item) || !hasExactKeys(item, ['questionId', 'value'])) {
    return null;
  }

  const { questionId, value } = item;
  if (typeof questionId !== 'string' || questionId.length === 0) {
    return null;
  }
  if (typeof value === 'string' || isStringArray(value)) {
    return { questionId, value };
  }
  return null;
}

export function parseAskAnswer(answer: Record<string, unknown> | null): AskAnswerBody | null {
  if (answer === null || !isPlainObject(answer)) {
    return null;
  }

  if (hasExactKeys(answer, ['decline'])) {
    return answer.decline === true ? { decline: true } : null;
  }

  if (!hasExactKeys(answer, ['answers'])) {
    return null;
  }

  const { answers } = answer;
  if (!Array.isArray(answers) || answers.length === 0) {
    return null;
  }

  const parsed: { questionId: string; value: string | string[] }[] = [];
  for (const item of answers) {
    const parsedItem = parseAskAnswerItem(item);
    if (parsedItem === null) {
      return null;
    }
    parsed.push(parsedItem);
  }
  return { answers: parsed };
}
