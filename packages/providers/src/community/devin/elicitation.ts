import type { CreateElicitationRequest } from '@agentclientprotocol/sdk';

import type { ResumeInteraction } from '../../types';
import { DevinProviderError } from './errors';
import { DEVIN_ASK_TOOL_NAME } from './event-bridge';

const ALLOW_OTHER_META = 'cognition.ai/allowOther';

export interface DevinAskHumanQuestion {
  id: string;
  prompt: string;
  selection: 'single' | 'multi';
  options: string[];
  allowOther: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function protocolError(message: string): never {
  throw new DevinProviderError('devin_protocol_error', message);
}

/** Option labels from `oneOf: [{ const }]` or `enum: []`; undefined when neither exists. */
function optionLabels(node: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(node.oneOf)) {
    const labels = node.oneOf.map(entry => (isRecord(entry) ? entry.const : undefined));
    if (labels.length > 0 && labels.every((label): label is string => typeof label === 'string')) {
      return labels;
    }
    return undefined;
  }
  if (
    Array.isArray(node.enum) &&
    node.enum.length > 0 &&
    node.enum.every((v): v is string => typeof v === 'string')
  ) {
    return [...node.enum];
  }
  return undefined;
}

function questionPrompt(node: Record<string, unknown>, fallback: string): string {
  if (typeof node.description === 'string' && node.description.length > 0) return node.description;
  if (typeof node.title === 'string' && node.title.length > 0) return node.title;
  return fallback;
}

/**
 * Convert a Devin form elicitation into Archon AskHuman questions. Only
 * choice-shaped properties are accepted: a free-text or numeric field has no
 * AskHuman equivalent, and inventing one would answer a question Devin never
 * asked in that form.
 */
export function elicitationToAskHumanQuestions(
  request: CreateElicitationRequest
): DevinAskHumanQuestion[] {
  if (request.mode !== 'form') {
    protocolError(
      `Devin elicitation mode "${request.mode}" is not supported; only form questions map to AskHuman.`
    );
  }
  const schema = (request as { requestedSchema?: unknown }).requestedSchema;
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    protocolError('Devin elicitation carried no object schema.');
  }
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) protocolError('Devin elicitation carried no questions.');

  const allowOther = request._meta?.[ALLOW_OTHER_META] === true;
  return entries.map(([id, node]) => {
    if (!isRecord(node)) protocolError(`Devin elicitation property "${id}" is not an object.`);
    if (node.type === 'string') {
      const options = optionLabels(node);
      if (options === undefined) {
        protocolError(`Devin elicitation property "${id}" is free text; AskHuman needs options.`);
      }
      return {
        id,
        prompt: questionPrompt(node, request.message),
        selection: 'single',
        options,
        allowOther,
      };
    }
    if (node.type === 'array') {
      const items = isRecord(node.items) ? node.items : {};
      const options = optionLabels(items);
      if (options === undefined) {
        protocolError(`Devin elicitation property "${id}" is an array without options.`);
      }
      return {
        id,
        prompt: questionPrompt(node, request.message),
        selection: 'multi',
        options,
        allowOther,
      };
    }
    return protocolError(
      `Devin elicitation property "${id}" has unsupported type "${String(node.type)}".`
    );
  });
}

/**
 * The one user message a re-entry turn sends. The original prompt is already in
 * the loaded session, so this carries only the validated answers.
 */
export function buildDevinAskResumePrompt(interactions: readonly ResumeInteraction[]): string {
  const blocks = interactions.map(interaction =>
    interaction.declined
      ? `AskHuman ${interaction.tool_use_id} was declined.`
      : `AskHuman ${interaction.tool_use_id} answers:\n${JSON.stringify(interaction.payload)}`
  );
  return (
    blocks.join('\n\n') +
    `\n\nContinue the task using these answers. Do not call ${DEVIN_ASK_TOOL_NAME} again for these questions.`
  );
}
