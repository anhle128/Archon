import { describe, expect, test } from 'bun:test';

import {
  draftToAnswerBody,
  isAskDraftValid,
  isQuestionValid,
  parseAskAnswer,
  parseAskEnvelope,
  type AskDraft,
  type AskQuestion,
} from './parse-ask-envelope';

const SINGLE: AskQuestion = {
  id: 'q1',
  prompt: 'Ship it?',
  selection: 'single',
  options: ['Ship', 'Hold'],
  allowOther: true,
};

const MULTI: AskQuestion = {
  id: 'q2',
  prompt: 'Who should review?',
  selection: 'multi',
  options: ['Alice', 'Bob'],
  allowOther: false,
};

const VALID_ENVELOPE: Record<string, unknown> = {
  questions: [SINGLE, MULTI],
};

describe('parseAskEnvelope', () => {
  test('parses ordered Ask questions', () => {
    expect(parseAskEnvelope(VALID_ENVELOPE)).toEqual([SINGLE, MULTI]);
  });

  test('rejects malformed Ask envelopes', () => {
    const cases: Array<{ name: string; envelope: Record<string, unknown> }> = [
      { name: 'missing questions', envelope: {} },
      { name: 'non-array questions', envelope: { questions: { id: 'q1' } } },
      { name: 'empty questions', envelope: { questions: [] } },
      { name: 'non-object item', envelope: { questions: ['not-an-object'] } },
      { name: 'null item', envelope: { questions: [null] } },
      {
        name: 'empty id',
        envelope: { questions: [{ ...SINGLE, id: '' }] },
      },
      {
        name: 'non-string prompt',
        envelope: { questions: [{ ...SINGLE, prompt: 1 }] },
      },
      {
        name: 'invalid selection',
        envelope: { questions: [{ ...SINGLE, selection: 'many' }] },
      },
      {
        name: 'non-array options',
        envelope: { questions: [{ ...SINGLE, options: 'Ship' }] },
      },
      {
        name: 'non-string option',
        envelope: { questions: [{ ...SINGLE, options: ['Ship', 2] }] },
      },
      {
        name: 'non-boolean allowOther',
        envelope: { questions: [{ ...SINGLE, allowOther: 'yes' }] },
      },
      {
        name: 'missing allowOther',
        envelope: {
          questions: [
            {
              id: 'q1',
              prompt: 'Ship it?',
              selection: 'single',
              options: ['Ship'],
            },
          ],
        },
      },
      {
        name: 'duplicate ids',
        envelope: { questions: [SINGLE, { ...MULTI, id: 'q1' }] },
      },
    ];

    for (const { envelope } of cases) {
      expect(parseAskEnvelope(envelope)).toBeNull();
    }

    expect(parseAskEnvelope(null as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('Ask draft validity', () => {
  test('validates complete Ask drafts', () => {
    const forbiddenOther: AskQuestion = { ...MULTI, allowOther: false };
    const allowedOther: AskQuestion = { ...MULTI, allowOther: true };

    const cases: Array<{
      questions: AskQuestion[];
      draft: AskDraft;
      expected: boolean;
    }> = [
      { questions: [SINGLE], draft: { q1: 'Ship' }, expected: true },
      { questions: [SINGLE], draft: { q1: 'Hold the line' }, expected: true },
      {
        questions: [{ ...SINGLE, allowOther: false }],
        draft: { q1: 'Hold the line' },
        expected: false,
      },
      { questions: [SINGLE], draft: { q1: '   ' }, expected: false },
      { questions: [forbiddenOther], draft: { q2: [] }, expected: false },
      { questions: [forbiddenOther], draft: { q2: ['Alice', 'Bob'] }, expected: true },
      { questions: [allowedOther], draft: { q2: ['Alice', 'Carol'] }, expected: true },
      { questions: [SINGLE], draft: { q1: ['Ship'] }, expected: false },
      { questions: [forbiddenOther], draft: { q2: 'Alice' }, expected: false },
      { questions: [SINGLE, MULTI], draft: { q1: 'Ship' }, expected: false },
    ];

    for (const { questions, draft, expected } of cases) {
      expect(isAskDraftValid(questions, draft)).toBe(expected);
    }

    expect(isQuestionValid(SINGLE, 'Ship')).toBe(true);
    expect(isQuestionValid(SINGLE, ['Ship'])).toBe(false);
    expect(isQuestionValid(MULTI, ['Alice'])).toBe(true);
    expect(isQuestionValid(MULTI, 'Alice')).toBe(false);
  });
});

describe('Ask answer codec', () => {
  test('decodes stored answers and builds an ordered answer body', () => {
    expect(parseAskAnswer({ decline: true })).toEqual({ decline: true });
    expect(
      parseAskAnswer({
        answers: [
          { questionId: 'q1', value: 'Ship' },
          { questionId: 'q2', value: ['Alice', 'Bob'] },
        ],
      })
    ).toEqual({
      answers: [
        { questionId: 'q1', value: 'Ship' },
        { questionId: 'q2', value: ['Alice', 'Bob'] },
      ],
    });

    const invalidAnswers: Array<Record<string, unknown> | null> = [
      null,
      {},
      { decline: false },
      { decline: true, extra: 1 },
      { answers: [], extra: 1 },
      { answers: [] },
      { answers: [{ questionId: '', value: 'Ship' }] },
      { answers: [{ questionId: 'q1', value: 'Ship', extra: true }] },
      { answers: [{ questionId: 'q1', value: 1 }] },
      { answers: [{ questionId: 'q1', value: [1] }] },
      { answers: [{ questionId: 'q1' }] },
      { answers: [{ questionId: 'q1', value: 'Ship' }], extra: true },
    ];

    for (const answer of invalidAnswers) {
      expect(parseAskAnswer(answer)).toBeNull();
    }

    const draft: AskDraft = { q1: 'Ship', q2: ['Alice', 'Bob'] };
    expect(isAskDraftValid([SINGLE, MULTI], draft)).toBe(true);
    expect(draftToAnswerBody([SINGLE, MULTI], draft)).toEqual({
      answers: [
        { questionId: 'q1', value: 'Ship' },
        { questionId: 'q2', value: ['Alice', 'Bob'] },
      ],
    });
  });
});
