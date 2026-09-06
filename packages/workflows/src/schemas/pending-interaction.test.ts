import { describe, expect, test } from 'bun:test';
import {
  askAnswerBodySchema,
  askAnswerItemSchema,
  askHumanQuestionSchema,
  insertPendingInteractionSchema,
  pendingInteractionSchema,
  resolvePendingInteractionInputSchema,
  resolvePendingInteractionResultSchema,
  type AskAnswerBody,
  type ResolvePendingInteractionInput,
  type ResolvePendingInteractionResult,
} from './pending-interaction';

const valid = {
  id: 'pending-1',
  workflow_run_id: 'run-1',
  node_id: 'review',
  tool_use_id: 'tool-1',
  kind: 'ask',
  status: 'pending',
  envelope: { questions: [] },
  answer: null,
  provider_session_id: 'session-1',
  created_at: '2026-09-06T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

describe('pendingInteractionSchema', () => {
  test('accepts the adopted empty-embed row contract', () => {
    expect(pendingInteractionSchema.parse(valid)).toEqual(valid);
  });

  test('rejects forked kind and status values', () => {
    expect(pendingInteractionSchema.safeParse({ ...valid, kind: 'question' }).success).toBe(false);
    expect(pendingInteractionSchema.safeParse({ ...valid, status: 'open' }).success).toBe(false);
  });
});

test('insert schema accepts only caller-assigned fields', () => {
  const parsed = insertPendingInteractionSchema.parse({
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'toolu_1',
    kind: 'ask',
    envelope: { questions: [] },
    provider_session_id: 'sess-1',
  });
  expect(parsed.kind).toBe('ask');
  expect(insertPendingInteractionSchema.safeParse({ ...parsed, status: 'pending' }).success).toBe(
    false
  );
});

test('insert schema rejects empty provider_session_id', () => {
  expect(
    insertPendingInteractionSchema.safeParse({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions: [] },
      provider_session_id: '',
    }).success
  ).toBe(false);
});

test('exports askHumanQuestionSchema without changing the accepted shape', () => {
  const question = {
    id: 'q1',
    prompt: 'Ship it?',
    selection: 'single' as const,
    options: ['yes', 'no'],
    allowOther: false,
  };
  expect(askHumanQuestionSchema.parse(question)).toEqual(question);
});

describe('askAnswerBodySchema', () => {
  test('accepts exactly one answers-or-decline variant', () => {
    const answers: AskAnswerBody = askAnswerBodySchema.parse({
      answers: [{ questionId: 'q1', value: 'yes' }],
    });
    const decline: AskAnswerBody = askAnswerBodySchema.parse({ decline: true });
    expect(answers).toEqual({ answers: [{ questionId: 'q1', value: 'yes' }] });
    expect(decline).toEqual({ decline: true });
    expect(
      askAnswerBodySchema.safeParse({
        answers: [{ questionId: 'q1', value: 'yes' }],
        decline: true,
      }).success
    ).toBe(false);
  });

  test('accepts string arrays for multi answers', () => {
    expect(askAnswerItemSchema.parse({ questionId: 'q2', value: ['alpha', 'beta'] })).toEqual({
      questionId: 'q2',
      value: ['alpha', 'beta'],
    });
    expect(
      askAnswerBodySchema.parse({
        answers: [{ questionId: 'q2', value: ['alpha', 'beta'] }],
      })
    ).toEqual({
      answers: [{ questionId: 'q2', value: ['alpha', 'beta'] }],
    });
  });

  test('rejects empty answers and false decline', () => {
    expect(askAnswerBodySchema.safeParse({ answers: [] }).success).toBe(false);
    expect(askAnswerBodySchema.safeParse({ decline: false }).success).toBe(false);
    expect(askAnswerItemSchema.safeParse({ questionId: '', value: 'yes' }).success).toBe(false);
  });

  test('rejects unknown keys at every object level', () => {
    expect(
      askAnswerItemSchema.safeParse({
        questionId: 'q1',
        value: 'yes',
        extra: true,
      }).success
    ).toBe(false);
    expect(
      askAnswerBodySchema.safeParse({
        answers: [{ questionId: 'q1', value: 'yes' }],
        extra: true,
      }).success
    ).toBe(false);
    expect(askAnswerBodySchema.safeParse({ decline: true, extra: true }).success).toBe(false);
  });
});

describe('resolvePendingInteraction schemas', () => {
  test('derives strict resolve input and result shapes', () => {
    const input: ResolvePendingInteractionInput = resolvePendingInteractionInputSchema.parse({
      workflow_run_id: 'run-1',
      tool_use_id: 'tool-1',
      answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
      resolved_by: 'user-1',
    });
    expect(input.answer).toEqual({ answers: [{ questionId: 'q1', value: 'yes' }] });

    const result: ResolvePendingInteractionResult = resolvePendingInteractionResultSchema.parse({
      interaction: { ...valid, status: 'answered', answer: { decline: true } },
      resumed: true,
      remaining_pending: 0,
    });
    expect(result.resumed).toBe(true);
    expect(result.remaining_pending).toBe(0);

    expect(resolvePendingInteractionInputSchema.safeParse({ ...input, extra: true }).success).toBe(
      false
    );
    expect(
      resolvePendingInteractionResultSchema.safeParse({ ...result, extra: true }).success
    ).toBe(false);
    expect(
      resolvePendingInteractionResultSchema.safeParse({
        ...result,
        remaining_pending: -1,
      }).success
    ).toBe(false);
  });
});
