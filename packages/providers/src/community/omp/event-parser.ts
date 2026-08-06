import { createLogger } from '@archon/paths';

import type { MessageChunk, TokenUsage } from '../../types';
import { tryParseStructuredOutput } from '../../shared/structured-output';

const MAX_ERROR_PREVIEW_CHARS = 1000;
const log = createLogger('provider.omp.event-parser');

type JsonObject = Record<string, unknown>;
type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

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
  private activeAssistantMessage = false;
  private pendingAssistant = '';
  private currentMessageText = '';
  private currentStructuredText = '';
  private structuredText = '';
  private streamError: string | undefined;
  private readonly activeTools = new Map<string, string>();
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

  buildResult(resumed: boolean | undefined): ResultChunk {
    const observedResult = this.buildObservedResult(resumed);
    if (
      !this.sessionId ||
      !this.sawAgentEnd ||
      !this.sawAssistantMessage ||
      this.activeAssistantMessage
    ) {
      const missing = !this.sessionId
        ? 'session header'
        : !this.sawAgentEnd
          ? 'agent_end event'
          : this.activeAssistantMessage
            ? 'completed assistant message'
            : 'assistant message';
      return {
        ...observedResult,
        isError: true,
        errorSubtype: 'omp_incomplete_output',
        errors: [
          `OMP CLI completed without a required ${missing}.`,
          ...((this.streamError ?? this.errorMessage)
            ? [this.streamError ?? this.errorMessage ?? '']
            : []),
        ],
        ...(resumed !== undefined ? { resumed: false } : {}),
      };
    }

    const isError =
      this.streamError !== undefined ||
      this.stopReason === 'error' ||
      this.stopReason === 'aborted';
    return {
      ...observedResult,
      ...(isError
        ? {
            isError: true,
            errorSubtype: this.streamError ?? this.stopReason,
            ...((this.streamError ?? this.errorMessage)
              ? { errors: [this.streamError ?? this.errorMessage ?? ''] }
              : {}),
          }
        : {}),
    };
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  private buildObservedResult(resumed: boolean | undefined): ResultChunk {
    const structuredOutput =
      this.wantsStructured && !this.streamError
        ? tryParseStructuredOutput(this.structuredText)
        : undefined;
    return {
      type: 'result',
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.numTurns > 0
        ? { tokens: this.tokens, cost: this.tokens.cost, numTurns: this.numTurns }
        : {}),
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(resumed !== undefined ? { resumed } : {}),
    };
  }

  private consumeEvent(event: JsonObject): MessageChunk[] {
    if (this.sawAgentEnd) throw new Error('OMP CLI emitted an event after agent_end.');
    const type = stringField(event.type);
    switch (type) {
      case 'session': {
        const sessionId = stringField(event.id);
        if (!sessionId) throw new Error('OMP CLI emitted a session event without an id.');
        if (this.sessionId && this.sessionId !== sessionId)
          throw new Error('OMP CLI emitted conflicting session headers.');
        this.sessionId = sessionId;
        return [];
      }
      case 'message_start': {
        const message = asObject(event.message);
        if (stringField(message?.role) === 'assistant') {
          if (this.activeAssistantMessage || this.pendingAssistant)
            throw new Error(
              'OMP CLI started an assistant message before the unfinished message ended.'
            );
          this.activeAssistantMessage = true;
          this.currentMessageText = '';
          this.currentStructuredText = '';
        }
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
        if (this.activeTools.size > 0)
          throw new Error('OMP CLI ended with an outstanding tool call.');
        this.sawAgentEnd = true;
        return this.activeAssistantMessage ? [] : this.flushAssistant();
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
      if (this.wantsStructured) this.currentStructuredText += delta;
      return [];
    }
    if (type === 'thinking_delta' && delta) {
      return [...this.flushAssistant(), { type: 'thinking', content: delta }];
    }
    return type === 'text_end' || type === 'done' || type === 'error' ? this.flushAssistant() : [];
  }

  private consumeMessageEnd(message: JsonObject | undefined): MessageChunk[] {
    if (!message || stringField(message.role) !== 'assistant') return [];
    if (!Array.isArray(message.content))
      throw new Error('OMP CLI assistant message_end is missing content.');
    const usage = asObject(message.usage);
    if (!usage) throw new Error('OMP CLI assistant message_end is missing usage.');
    const model = stringField(message.model);
    if (!model) throw new Error('OMP CLI assistant message_end is missing model.');
    const stopReason = stringField(message.stopReason);
    if (!stopReason) throw new Error('OMP CLI assistant message_end is missing stop reason.');
    this.assertUsage(usage);
    const content = message.content;
    const completeText = content
      .map(asObject)
      .map(block => (stringField(block?.type) === 'text' ? (stringField(block?.text) ?? '') : ''))
      .join('');
    let chunks: MessageChunk[] = [];
    if (completeText.startsWith(this.currentMessageText)) {
      const suffix = completeText.slice(this.currentMessageText.length);
      this.pendingAssistant += suffix;
      this.currentMessageText += suffix;
      if (this.wantsStructured) this.structuredText += completeText;
      chunks = this.flushAssistant();
    } else {
      log.warn(
        { streamedLength: this.currentMessageText.length, completeLength: completeText.length },
        'omp.streaming_text_mismatch'
      );
      chunks = this.flushAssistant();
      this.streamError = 'omp_stream_mismatch';
    }
    this.sawAssistantMessage = true;
    this.activeAssistantMessage = false;
    this.accumulateUsage(usage);
    this.numTurns += 1;
    const provider = stringField(message.provider);
    this.resolvedModel = provider && model ? `${provider}/${model}` : model;
    this.stopReason = stopReason;
    this.errorMessage = stringField(message.errorMessage);
    return chunks;
  }

  private consumeToolStart(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) throw new Error('OMP CLI tool_execution_start is missing toolName.');
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) throw new Error('OMP CLI tool_execution_start is missing toolCallId.');
    const toolInput = asObject(event.args);
    if (!toolInput) throw new Error('OMP CLI tool_execution_start has invalid args.');
    if (this.activeTools.has(toolCallId))
      throw new Error('OMP CLI emitted a duplicate active toolCallId.');
    this.activeTools.set(toolCallId, toolName);
    return [
      ...chunks,
      {
        type: 'tool',
        toolName,
        toolInput,
        toolCallId,
      },
    ];
  }

  private consumeToolEnd(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) throw new Error('OMP CLI tool_execution_end is missing toolName.');
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) throw new Error('OMP CLI tool_execution_end is missing toolCallId.');
    const startedToolName = this.activeTools.get(toolCallId);
    if (!startedToolName) throw new Error('OMP CLI emitted an unmatched tool_execution_end.');
    if (startedToolName !== toolName)
      throw new Error('OMP CLI emitted a mismatched tool_execution_end.');
    if (!Object.hasOwn(event, 'result'))
      throw new Error('OMP CLI errored tool_execution_end is missing result.');
    this.activeTools.delete(toolCallId);
    const result: MessageChunk[] = [...chunks];
    if (event.isError === true)
      result.push({
        type: 'system',
        content: `OMP tool ${toolName} failed: ${serializeToolResult(event.result)}`,
      });
    result.push({
      type: 'tool_result',
      toolName,
      toolOutput: serializeToolResult(event.result),
      toolCallId,
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

  private assertUsage(usage: JsonObject): void {
    const cost = asObject(usage.cost);
    if (
      !cost ||
      !Number.isFinite(usage.input) ||
      !Number.isFinite(usage.output) ||
      !Number.isFinite(usage.totalTokens) ||
      !Number.isFinite(cost.total)
    ) {
      throw new Error('OMP CLI assistant message_end has invalid usage.');
    }
  }
}
