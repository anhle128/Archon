import { createLogger } from '@archon/paths';

import type { MessageChunk, TokenUsage } from '../../types';
import { tryParseStructuredOutput } from '../../shared/structured-output';

const MAX_ERROR_PREVIEW_CHARS = 1000;
const log = createLogger('provider.omp.event-parser');

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function serializeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export class OmpEventParser {
  private sessionId: string | undefined;
  private sawAgentEnd = false;
  private sawAssistantMessage = false;
  private pendingAssistant = '';
  private currentMessageText = '';
  private structuredText = '';
  private tokens: TokenUsage = { input: 0, output: 0, total: 0, cost: 0 };
  private stopReason: string | undefined;
  private errorMessage: string | undefined;
  private resolvedModel: string | undefined;
  private numTurns = 0;

  constructor(private readonly wantsStructured: boolean) {}

  consumeLine(line: string): MessageChunk[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const preview = line.slice(0, MAX_ERROR_PREVIEW_CHARS);
      throw new Error(`OMP CLI emitted invalid JSON: ${preview}`);
    }
    const event = asObject(parsed);
    if (!event) throw new Error('OMP CLI emitted a non-object JSON record.');
    return this.consumeEvent(event);
  }

  buildResult(resumed: boolean | undefined): MessageChunk {
    if (!this.sessionId || !this.sawAgentEnd || !this.sawAssistantMessage) {
      const missing = !this.sessionId
        ? 'session header'
        : !this.sawAgentEnd
          ? 'agent_end event'
          : 'assistant message';
      return {
        type: 'result',
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        isError: true,
        errorSubtype: 'omp_incomplete_output',
        errors: [`OMP CLI completed without a required ${missing}.`],
        ...(resumed !== undefined ? { resumed: false } : {}),
      };
    }

    const isError = this.stopReason === 'error' || this.stopReason === 'aborted';
    const structuredOutput = this.wantsStructured
      ? tryParseStructuredOutput(this.structuredText)
      : undefined;
    return {
      type: 'result',
      sessionId: this.sessionId,
      tokens: this.tokens,
      cost: this.tokens.cost,
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      numTurns: this.numTurns,
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(isError
        ? {
            isError: true,
            errorSubtype: this.stopReason,
            ...(this.errorMessage ? { errors: [this.errorMessage] } : {}),
          }
        : {}),
      ...(resumed !== undefined ? { resumed } : {}),
    };
  }

  private consumeEvent(event: JsonObject): MessageChunk[] {
    const type = stringField(event.type);
    switch (type) {
      case 'session': {
        const sessionId = stringField(event.id);
        if (!sessionId) throw new Error('OMP CLI emitted a session event without an id.');
        this.sessionId = sessionId;
        return [];
      }
      case 'message_start': {
        const message = asObject(event.message);
        if (stringField(message?.role) === 'assistant') this.currentMessageText = '';
        return [];
      }
      case 'message_update':
        return this.consumeMessageUpdate(asObject(event.assistantMessageEvent));
      case 'message_end':
        return this.consumeMessageEnd(asObject(event.message));
      case 'tool_execution_start':
        return this.consumeToolStart(event);
      case 'tool_execution_end':
        return this.consumeToolEnd(event);
      case 'notice': {
        const chunks = this.flushAssistant();
        const message = stringField(event.message);
        return message ? [...chunks, { type: 'system', content: message }] : chunks;
      }
      case 'auto_retry_start': {
        const chunks = this.flushAssistant();
        const attempt = event.attempt;
        const error = stringField(event.errorMessage) ?? stringField(event.error);
        const details = [
          typeof attempt === 'number' && Number.isFinite(attempt)
            ? `attempt ${attempt}`
            : undefined,
          error,
        ].filter((value): value is string => value !== undefined);
        return details.length > 0
          ? [...chunks, { type: 'system', content: `OMP auto retry: ${details.join(': ')}` }]
          : chunks;
      }
      case 'agent_end':
        this.sawAgentEnd = true;
        return this.flushAssistant();
      default:
        return this.flushAssistant();
    }
  }

  private consumeMessageUpdate(event: JsonObject | undefined): MessageChunk[] {
    const type = stringField(event?.type);
    const delta = stringField(event?.delta);
    if (type === 'text_delta' && delta) {
      this.pendingAssistant += delta;
      this.currentMessageText += delta;
      if (this.wantsStructured) this.structuredText += delta;
      return [];
    }
    if (type === 'thinking_delta' && delta) {
      return [...this.flushAssistant(), { type: 'thinking', content: delta }];
    }
    return type === 'text_end' || type === 'done' || type === 'error' ? this.flushAssistant() : [];
  }

  private consumeMessageEnd(message: JsonObject | undefined): MessageChunk[] {
    if (stringField(message?.role) !== 'assistant') return [];
    this.sawAssistantMessage = true;
    const content = Array.isArray(message?.content) ? message.content : [];
    const completeText = content
      .map(asObject)
      .map(block => (stringField(block?.type) === 'text' ? (stringField(block?.text) ?? '') : ''))
      .join('');
    let chunks: MessageChunk[] = [];
    if (completeText.startsWith(this.currentMessageText)) {
      const suffix = completeText.slice(this.currentMessageText.length);
      this.pendingAssistant += suffix;
      this.currentMessageText += suffix;
      if (this.wantsStructured) this.structuredText += suffix;
      chunks = this.flushAssistant();
    } else {
      log.warn(
        { streamedLength: this.currentMessageText.length, completeLength: completeText.length },
        'omp.streaming_text_mismatch'
      );
      this.pendingAssistant = '';
    }
    this.accumulateUsage(asObject(message?.usage));
    this.numTurns += 1;
    const provider = stringField(message?.provider);
    const model = stringField(message?.model);
    this.resolvedModel = provider && model ? `${provider}/${model}` : model;
    this.stopReason = stringField(message?.stopReason);
    this.errorMessage = stringField(message?.errorMessage);
    return chunks;
  }

  private consumeToolStart(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) return chunks;
    const toolCallId = stringField(event.toolCallId);
    const toolInput = asObject(event.args);
    return [
      ...chunks,
      {
        type: 'tool',
        toolName,
        ...(toolInput ? { toolInput } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      },
    ];
  }

  private consumeToolEnd(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) return chunks;
    const toolCallId = stringField(event.toolCallId);
    const result: MessageChunk[] = [...chunks];
    if (event.isError === true)
      result.push({ type: 'system', content: `OMP tool ${toolName} failed.` });
    result.push({
      type: 'tool_result',
      toolName,
      toolOutput: serializeToolResult(event.result),
      ...(toolCallId ? { toolCallId } : {}),
    });
    return result;
  }

  private flushAssistant(): MessageChunk[] {
    if (this.pendingAssistant.length === 0) return [];
    const content = this.pendingAssistant;
    this.pendingAssistant = '';
    return [{ type: 'assistant', content }];
  }

  private accumulateUsage(usage: JsonObject | undefined): void {
    const cost = asObject(usage?.cost);
    this.tokens = {
      input: this.tokens.input + numberField(usage?.input),
      output: this.tokens.output + numberField(usage?.output),
      total: (this.tokens.total ?? 0) + numberField(usage?.totalTokens),
      cost: (this.tokens.cost ?? 0) + numberField(cost?.total),
    };
  }
}
