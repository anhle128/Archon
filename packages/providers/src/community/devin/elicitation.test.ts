import { describe, expect, test } from 'bun:test';
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk';

import { buildDevinAskResumePrompt, elicitationToAskHumanQuestions } from './elicitation';
import { DevinProviderError } from './errors';

function form(
  properties: Record<string, unknown>,
  meta?: Record<string, unknown>
): CreateElicitationRequest {
  return {
    sessionId: 'sess-1',
    mode: 'form',
    message: 'Which color do you prefer?',
    requestedSchema: { type: 'object', properties, required: Object.keys(properties) },
    ...(meta ? { _meta: meta } : {}),
  } as unknown as CreateElicitationRequest;
}

describe('elicitationToAskHumanQuestions', () => {
  test('maps the observed single-select shape', () => {
    const request = form(
      {
        q0: {
          title: 'Color',
          description: 'Which color do you prefer?',
          type: 'string',
          oneOf: [
            { const: 'red', title: 'Choose red.' },
            { const: 'blue', title: 'Choose blue.' },
          ],
        },
      },
      { 'cognition.ai/allowOther': true }
    );
    expect(elicitationToAskHumanQuestions(request)).toEqual([
      {
        id: 'q0',
        prompt: 'Which color do you prefer?',
        selection: 'single',
        options: ['red', 'blue'],
        allowOther: true,
      },
    ]);
  });

  test('maps string enum and array multi-select shapes; allowOther defaults to false', () => {
    const request = form({
      q0: { title: 'Size', type: 'string', enum: ['s', 'm'] },
      q1: {
        description: 'Toppings',
        type: 'array',
        items: { oneOf: [{ const: 'a' }, { const: 'b' }] },
      },
      q2: { title: 'Extras', type: 'array', items: { enum: ['x'] } },
    });
    expect(elicitationToAskHumanQuestions(request)).toEqual([
      { id: 'q0', prompt: 'Size', selection: 'single', options: ['s', 'm'], allowOther: false },
      { id: 'q1', prompt: 'Toppings', selection: 'multi', options: ['a', 'b'], allowOther: false },
      { id: 'q2', prompt: 'Extras', selection: 'multi', options: ['x'], allowOther: false },
    ]);
  });

  test('falls back to the request message as the prompt', () => {
    const request = form({ q0: { type: 'string', enum: ['yes', 'no'] } });
    expect(elicitationToAskHumanQuestions(request)[0]?.prompt).toBe('Which color do you prefer?');
  });

  test('rejects url mode, non-object schemas, and free-text properties', () => {
    const url = {
      sessionId: 's',
      mode: 'url',
      message: 'm',
      url: 'https://x',
    } as unknown as CreateElicitationRequest;
    expect(() => elicitationToAskHumanQuestions(url)).toThrow(DevinProviderError);
    expect(() => elicitationToAskHumanQuestions(form({}))).toThrow(/no questions/);
    expect(() => elicitationToAskHumanQuestions(form({ q0: { type: 'string' } }))).toThrow(
      /property "q0"/
    );
    expect(() => elicitationToAskHumanQuestions(form({ q0: { type: 'number' } }))).toThrow(
      DevinProviderError
    );
  });

  test('rejects questions with empty option lists', () => {
    expect(() =>
      elicitationToAskHumanQuestions(form({ q0: { type: 'string', enum: [] } }))
    ).toThrow(DevinProviderError);
    expect(() =>
      elicitationToAskHumanQuestions(form({ q0: { type: 'array', items: { oneOf: [] } } }))
    ).toThrow(DevinProviderError);
  });
});

describe('buildDevinAskResumePrompt', () => {
  test('names each tool call, carries only the answer payload, and forbids re-asking', () => {
    const prompt = buildDevinAskResumePrompt([
      { tool_use_id: 'call_1', payload: [{ questionId: 'q0', value: 'blue' }], declined: false },
      { tool_use_id: 'call_2', payload: 'declined', declined: true },
    ]);
    expect(prompt).toBe(
      'AskHuman call_1 answers:\n[{"questionId":"q0","value":"blue"}]\n\n' +
        'AskHuman call_2 was declined.\n\n' +
        'Continue the task using these answers. Do not call ask_user_question again for these questions.'
    );
  });
});
