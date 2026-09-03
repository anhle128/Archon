import type { MessageChunk, ModelUsageEntry, TokenUsage, UsageBreakdown } from '../types';
import { toUsageBreakdown } from '../usage-breakdown';

const MAX_ERROR_PREVIEW_CHARS = 1000;
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export class GrokEventParser {
  private readonly activeTools = new Map<string, string>();
  private sawEnd = false;
  private sessionId: string | undefined;
  private tokens: TokenUsage | undefined;
  private cost: number | undefined;
  private stopReason: string | undefined;
  private numTurns: number | undefined;
  private modelUsage: Record<string, unknown> | undefined;
  private structuredOutput: unknown;
  private errorMessage: string | undefined;
  private structuredOutputError: string | undefined;
  private readonly requestedModel: string | undefined;

  constructor(requestedModel?: string) {
    this.requestedModel =
      typeof requestedModel === 'string' && requestedModel.trim() !== ''
        ? requestedModel.trim()
        : undefined;
  }
  consumeLine(line: string): MessageChunk[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Grok CLI emitted invalid JSON: ${line.slice(0, MAX_ERROR_PREVIEW_CHARS)}`);
    }
    const event = asObject(parsed);
    if (!event) throw new Error('Grok CLI emitted a non-object JSON record.');
    if (this.sawEnd) throw new Error('Grok CLI emitted an event after end.');
    const type = stringField(event.type);
    if (!type) throw new Error('Grok CLI emitted a record without an event type.');

    switch (type) {
      case 'text': {
        const data = stringField(event.data);
        return data ? [{ type: 'assistant', content: data }] : [];
      }
      case 'thought': {
        const data = stringField(event.data);
        return data ? [{ type: 'thinking', content: data }] : [];
      }
      case 'tool_call':
        return this.consumeToolCall(event);
      case 'tool_call_update':
        return this.consumeToolUpdate(event);
      case 'error': {
        this.errorMessage = stringField(event.message) ?? 'Grok reported an unknown error.';
        return [{ type: 'system', content: this.errorMessage }];
      }
      case 'end':
        this.consumeEnd(event);
        return [];
      default:
        return [];
    }
  }

  closeOutstandingTools(): MessageChunk[] {
    const chunks: MessageChunk[] = [];
    for (const [toolCallId, toolName] of this.activeTools) {
      chunks.push({
        type: 'tool_result',
        toolName,
        toolCallId,
        toolOutput: 'Grok ended before reporting a tool result.',
        toolOutcome: 'unknown',
      });
    }
    this.activeTools.clear();
    return chunks;
  }

  buildResult(resumed: boolean | undefined): ResultChunk {
    if (this.errorMessage || this.structuredOutputError) {
      const message = this.errorMessage ?? this.structuredOutputError ?? 'Grok failed.';
      return {
        ...this.observedResult(resumed === undefined ? undefined : false),
        isError: true,
        errorSubtype: this.structuredOutputError ? 'grok_structured_output_error' : 'grok_error',
        errors: [message],
      };
    }
    if (!this.sawEnd || !this.sessionId) {
      return {
        ...this.observedResult(resumed === undefined ? undefined : false),
        isError: true,
        errorSubtype: 'grok_incomplete_output',
        errors: [
          `Grok CLI completed without a required ${this.sawEnd ? 'session ID' : 'end event'}.`,
        ],
      };
    }
    return this.observedResult(resumed);
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  private observedResult(resumed: boolean | undefined): ResultChunk {
    const usageBreakdown = this.buildUsageBreakdown();
    return {
      type: 'result',
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.tokens ? { tokens: this.tokens } : {}),
      ...(this.cost !== undefined ? { cost: this.cost } : {}),
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(this.numTurns !== undefined ? { numTurns: this.numTurns } : {}),
      ...(this.modelUsage ? { modelUsage: this.modelUsage } : {}),
      ...(usageBreakdown ? { usageBreakdown } : {}),
      ...(this.structuredOutput !== undefined ? { structuredOutput: this.structuredOutput } : {}),
      ...(resumed !== undefined ? { resumed } : {}),
    };
  }

  /**
   * Build normalized observations from Grok aggregate usage + modelUsage keys.
   * Never apportions aggregate tokens/USD across model names.
   */
  private buildUsageBreakdown(): UsageBreakdown | undefined {
    const modelEntries = this.collectReportedModels();
    const hasAggregate =
      this.tokens !== undefined || (this.cost !== undefined && Number.isFinite(this.cost));
    if (modelEntries.length === 0 && !hasAggregate) return undefined;

    const entries: ModelUsageEntry[] = [];

    if (modelEntries.length === 1) {
      const only = modelEntries[0];
      entries.push({
        provider: 'xai',
        model: only.model,
        modelSource: 'reported',
        ...(this.tokens
          ? { inputTokens: this.tokens.input, outputTokens: this.tokens.output }
          : {}),
        ...(this.cost !== undefined ? { costUsd: this.cost } : {}),
        ...(only.requests !== undefined ? { requests: only.requests } : {}),
      });
    } else if (modelEntries.length > 1) {
      for (const entry of modelEntries) {
        if (entry.requests === undefined) continue;
        entries.push({
          provider: 'xai',
          model: entry.model,
          modelSource: 'reported',
          requests: entry.requests,
        });
      }
      if (hasAggregate) {
        entries.push({
          provider: 'xai',
          model: null,
          modelSource: 'unknown',
          ...(this.tokens
            ? { inputTokens: this.tokens.input, outputTokens: this.tokens.output }
            : {}),
          ...(this.cost !== undefined ? { costUsd: this.cost } : {}),
        });
      }
    } else if (this.requestedModel) {
      entries.push({
        provider: 'xai',
        model: this.requestedModel,
        modelSource: 'requested',
        ...(this.tokens
          ? { inputTokens: this.tokens.input, outputTokens: this.tokens.output }
          : {}),
        ...(this.cost !== undefined ? { costUsd: this.cost } : {}),
      });
    } else {
      entries.push({
        provider: 'xai',
        model: null,
        modelSource: 'unknown',
        ...(this.tokens
          ? { inputTokens: this.tokens.input, outputTokens: this.tokens.output }
          : {}),
        ...(this.cost !== undefined ? { costUsd: this.cost } : {}),
      });
    }

    const breakdown = toUsageBreakdown(entries);
    return breakdown.length > 0 ? breakdown : undefined;
  }

  private collectReportedModels(): { model: string; requests?: number }[] {
    if (!this.modelUsage) return [];
    const models: { model: string; requests?: number }[] = [];
    for (const [rawModel, raw] of Object.entries(this.modelUsage)) {
      const model = rawModel.trim();
      if (!model) continue;
      const obj = asObject(raw);
      const modelCalls = obj ? finiteNumber(obj.modelCalls) : undefined;
      const requests =
        modelCalls !== undefined && Number.isSafeInteger(modelCalls) && modelCalls > 0
          ? modelCalls
          : undefined;
      models.push({ model, ...(requests !== undefined ? { requests } : {}) });
    }
    return models;
  }

  private consumeToolCall(event: JsonObject): MessageChunk[] {
    const toolCallId = stringField(event.toolCallId);
    const toolName = stringField(event.toolName);
    if (!toolCallId || !toolName) {
      throw new Error('Grok CLI emitted a tool_call without toolCallId or toolName.');
    }
    if (this.activeTools.has(toolCallId)) {
      throw new Error(`Grok CLI emitted duplicate tool call '${toolCallId}'.`);
    }
    this.activeTools.set(toolCallId, toolName);
    const toolInput = asObject(event.rawInput);
    return [{ type: 'tool', toolName, toolCallId, ...(toolInput ? { toolInput } : {}) }];
  }

  private consumeToolUpdate(event: JsonObject): MessageChunk[] {
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) throw new Error('Grok CLI emitted a tool update without toolCallId.');
    const status = stringField(event.status);
    if (status !== 'completed' && status !== 'failed') return [];
    const toolName = this.activeTools.get(toolCallId);
    if (!toolName) throw new Error(`Grok CLI updated unknown tool call '${toolCallId}'.`);
    this.activeTools.delete(toolCallId);
    const output = event.rawOutput ?? event.content ?? null;
    return [
      {
        type: 'tool_result',
        toolName,
        toolCallId,
        toolOutput: serialize(output),
        toolOutcome: status === 'completed' ? 'success' : 'error',
      },
    ];
  }

  private consumeEnd(event: JsonObject): void {
    this.sawEnd = true;
    this.sessionId = stringField(event.sessionId);
    this.stopReason = stringField(event.stopReason);
    this.numTurns = finiteNumber(event.num_turns);
    this.cost = finiteNumber(event.total_cost_usd);
    this.modelUsage = asObject(event.modelUsage);
    this.structuredOutputError = stringField(event.structuredOutputError);
    if ('structuredOutput' in event && event.structuredOutput !== null) {
      this.structuredOutput = event.structuredOutput;
    }
    const usage = asObject(event.usage);
    if (usage) {
      const input = finiteNumber(usage.input_tokens) ?? 0;
      const output = finiteNumber(usage.output_tokens) ?? 0;
      const total = finiteNumber(usage.total_tokens) ?? input + output;
      this.tokens = {
        input,
        output,
        total,
        ...(this.cost !== undefined ? { cost: this.cost } : {}),
      };
    }
  }
}
