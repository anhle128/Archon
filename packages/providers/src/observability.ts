import { createLogger } from '@archon/paths';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type {
  LangfuseAgent,
  LangfuseGeneration,
  LangfuseTool,
  ObservationLevel,
} from '@langfuse/tracing';
import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  TokenUsage,
} from './types';

const TRACE_TEXT_LIMIT = 20_000;
const TRACE_ATTRIBUTE_LIMIT = 200;
const REDACTED = '[REDACTED]';
const TRUNCATED = '\n[TRUNCATED]';
const SENSITIVE_KEY =
  /(api[_-]?key|authorization|credential|password|private[_-]?key|secret|token)/i;

type StartObservation = typeof import('@langfuse/tracing').startObservation;
type PropagateAttributes = typeof import('@langfuse/tracing').propagateAttributes;

/** @internal Runtime seam used by the focused provider-stream regression test. */
export interface LangfuseRuntime {
  sdk: Pick<NodeSDK, 'shutdown'>;
  startObservation: StartObservation;
  propagateAttributes: PropagateAttributes;
}

type RuntimeProvider = () => Promise<LangfuseRuntime | null>;

let runtimePromise: Promise<LangfuseRuntime | null> | undefined;
let partialCredentialsWarningLogged = false;
let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.langfuse');
  return cachedLog;
}

function truncateTraceText(value: string): string {
  if (value.length <= TRACE_TEXT_LIMIT) return value;
  return value.slice(0, TRACE_TEXT_LIMIT - TRUNCATED.length) + TRUNCATED;
}

function redactString(value: string, secretValues: readonly string[]): string {
  let redacted = value;

  for (const secret of secretValues) {
    if (secret.length >= 8) redacted = redacted.split(secret).join(REDACTED);
  }

  redacted = redacted
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|pk)-(?:lf-|proj-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED)
    .replace(/\b(?:glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, REDACTED)
    .replace(
      /\b(authorization|api[_-]?key|credential|password|private[_-]?key|secret|token)(\s*[:=]\s*)(["']?)[^\s,"'}]+/gi,
      (_match, key: string, separator: string, quote: string) =>
        `${key}${separator}${quote}${REDACTED}${quote}`
    )
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${REDACTED}@`);

  return truncateTraceText(redacted);
}

function redactValue(
  value: unknown,
  secretValues: readonly string[],
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') return redactString(value, secretValues);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, secretValues, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, secretValues, seen),
    ])
  );
}

/**
 * Redact credentials and cap large values before they leave the process.
 *
 * ponytail: The 20k character ceiling keeps traces reviewable and bounded.
 * Raise it or move oversized payloads to Langfuse media when full artifacts become necessary.
 */
export function redactTraceValue(value: unknown, secretValues: readonly string[] = []): unknown {
  return redactValue(value, secretValues, new WeakSet());
}

function collectSecretValues(options?: SendQueryOptions): string[] {
  const values = new Set<string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (SENSITIVE_KEY.test(key) && value && value.length >= 8) values.add(value);
  }
  for (const [key, value] of Object.entries(options?.env ?? {})) {
    if (SENSITIVE_KEY.test(key) && value.length >= 8) values.add(value);
  }

  return [...values].sort((a, b) => b.length - a.length);
}

function boundedAttribute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, TRACE_ATTRIBUTE_LIMIT);
}

function observationName(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return boundedAttribute(normalized) || fallback;
}

function resolveModel(
  options: SendQueryOptions | undefined,
  chunk?: MessageChunk
): string | undefined {
  // Precedence: terminal resolvedModel → effective options.model → configured
  // assistant model → absent. Never guess from a multi-model usage array.
  if (chunk?.type === 'result' && chunk.resolvedModel?.id) {
    const resolved = chunk.resolvedModel.id.trim();
    if (resolved.length > 0) return resolved;
  }

  if (options?.model) {
    const requested = options.model.trim();
    if (requested.length > 0) return requested;
  }

  const configuredModel = options?.assistantConfig?.model;
  if (typeof configuredModel === 'string') {
    const configured = configuredModel.trim();
    if (configured.length > 0) return configured;
  }

  return undefined;
}

function usageAttributes(tokens: TokenUsage | undefined): Record<string, number> | undefined {
  if (!tokens) return undefined;
  return {
    input: tokens.input,
    output: tokens.output,
    total: tokens.total ?? tokens.input + tokens.output,
  };
}

function appendTraceText(current: string, next: string): string {
  if (current.length >= TRACE_TEXT_LIMIT) return current;
  return truncateTraceText(current + next);
}

async function initializeLangfuseRuntime(): Promise<LangfuseRuntime | null> {
  try {
    const [sdkModule, otelModule, tracing] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@langfuse/otel'),
      import('@langfuse/tracing'),
    ]);
    const exporterSecrets = collectSecretValues();
    const sdk = new sdkModule.NodeSDK({
      spanProcessors: [
        new otelModule.LangfuseSpanProcessor({
          mask: ({ data }): unknown => redactTraceValue(data, exporterSecrets),
        }),
      ],
    });
    sdk.start();
    getLog().info('langfuse.tracing_started');
    return {
      sdk,
      startObservation: tracing.startObservation,
      propagateAttributes: tracing.propagateAttributes,
    };
  } catch (error) {
    getLog().warn({ err: error as Error }, 'langfuse.tracing_initialization_failed');
    return null;
  }
}

async function getLangfuseRuntime(): Promise<LangfuseRuntime | null> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

  if (!publicKey && !secretKey) return null;
  if (!publicKey || !secretKey) {
    if (!partialCredentialsWarningLogged) {
      partialCredentialsWarningLogged = true;
      getLog().warn(
        'langfuse.tracing_disabled_incomplete_credentials: set both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY'
      );
    }
    return null;
  }

  runtimePromise ??= initializeLangfuseRuntime();
  return runtimePromise;
}

function endOpenTools(tools: Iterable<LangfuseTool>): void {
  for (const tool of tools) {
    tool.update({
      level: 'WARNING',
      statusMessage: 'Provider stream ended before a matching tool result was emitted.',
    });
    tool.end();
  }
}

function endOpenSubagents(subagents: Iterable<LangfuseAgent>): void {
  for (const subagent of subagents) {
    subagent.update({
      level: 'WARNING',
      statusMessage: 'Provider stream ended before the subagent reported a terminal status.',
    });
    subagent.end();
  }
}

function finishTool(
  chunk: Extract<MessageChunk, { type: 'tool_result' }>,
  toolsById: Map<string, LangfuseTool>,
  toolsByName: Map<string, LangfuseTool[]>,
  secretValues: readonly string[]
): void {
  let tool: LangfuseTool | undefined;
  if (chunk.toolCallId) {
    tool = toolsById.get(chunk.toolCallId);
    toolsById.delete(chunk.toolCallId);
  } else {
    const queue = toolsByName.get(chunk.toolName);
    tool = queue?.shift();
    if (queue?.length === 0) toolsByName.delete(chunk.toolName);
  }
  if (!tool) return;

  tool.update({ output: redactTraceValue(chunk.toolOutput, secretValues) });
  tool.end();
}

function updateGenerationFromResult(
  generation: LangfuseGeneration,
  chunk: Extract<MessageChunk, { type: 'result' }>,
  options: SendQueryOptions | undefined,
  output: unknown,
  secretValues: readonly string[]
): void {
  const cost = chunk.cost ?? chunk.tokens?.cost;
  const level: ObservationLevel = chunk.isError ? 'ERROR' : 'DEFAULT';
  const statusMessage = chunk.isError
    ? redactString(
        chunk.errors?.join('; ') || chunk.errorSubtype || 'Provider returned an error.',
        secretValues
      )
    : undefined;

  generation.update({
    output: redactTraceValue(output, secretValues),
    model: resolveModel(options, chunk),
    usageDetails: usageAttributes(chunk.tokens),
    costDetails: cost === undefined ? undefined : { total: cost },
    level,
    statusMessage,
    metadata: {
      stopReason: chunk.stopReason,
      numTurns: chunk.numTurns,
      resumed: chunk.resumed,
    },
  });
}

async function* tracedQuery(
  provider: IAgentProvider,
  runtime: LangfuseRuntime,
  prompt: string,
  cwd: string,
  resumeSessionId: string | undefined,
  options: SendQueryOptions | undefined
): AsyncGenerator<MessageChunk> {
  const providerType = provider.getType();
  const traceContext = options?.traceContext;
  const traceName = observationName(traceContext?.name, 'run-agent');
  const secretValues = collectSecretValues(options);
  const propagatedMetadata = Object.fromEntries(
    Object.entries({
      provider: providerType,
      ...(traceContext?.metadata ?? {}),
    }).map(([key, value]) => [key, boundedAttribute(value) ?? ''])
  );
  const root = runtime.propagateAttributes(
    {
      traceName,
      sessionId: boundedAttribute(traceContext?.sessionId),
      userId: boundedAttribute(traceContext?.userId),
      tags: traceContext?.tags
        ?.map(tag => boundedAttribute(tag))
        .filter((tag): tag is string => !!tag),
      metadata: propagatedMetadata,
    },
    () =>
      runtime.startObservation(
        traceName,
        {
          input: redactTraceValue(traceContext?.input ?? prompt, secretValues),
          metadata: { provider: providerType },
        },
        { asType: 'agent' }
      )
  );

  // ponytail: Providers expose one aggregate stream rather than model-turn boundaries.
  // Split this into one generation per model turn when the shared chunk contract exposes them.
  const generation = root.startObservation(
    'generate-response',
    {
      input: redactTraceValue(prompt, secretValues),
      model: resolveModel(options),
      metadata: { provider: providerType },
    },
    { asType: 'generation' }
  );
  const toolsById = new Map<string, LangfuseTool>();
  const toolsByName = new Map<string, LangfuseTool[]>();
  const subagents = new Map<string, LangfuseAgent>();
  let assistantOutput = '';
  let structuredOutput: unknown;
  let completionStarted = false;
  let rootLevel: ObservationLevel = 'DEFAULT';
  let rootStatusMessage: string | undefined;

  try {
    for await (const chunk of provider.sendQuery(prompt, cwd, resumeSessionId, options)) {
      if (chunk.type === 'assistant') {
        assistantOutput = appendTraceText(assistantOutput, chunk.content);
        if (!completionStarted) {
          completionStarted = true;
          generation.update({ completionStartTime: new Date() });
        }
      } else if (chunk.type === 'tool') {
        const tool = root.startObservation(
          observationName(chunk.toolName, 'run-tool'),
          { input: redactTraceValue(chunk.toolInput, secretValues) },
          { asType: 'tool' }
        );
        if (chunk.toolCallId) {
          toolsById.set(chunk.toolCallId, tool);
        } else {
          const queue = toolsByName.get(chunk.toolName) ?? [];
          queue.push(tool);
          toolsByName.set(chunk.toolName, queue);
        }
      } else if (chunk.type === 'tool_result') {
        finishTool(chunk, toolsById, toolsByName, secretValues);
      } else if (chunk.type === 'task_started') {
        const subagent = root.startObservation(
          `run-${observationName(chunk.taskType, 'subagent')}`,
          {
            input: redactTraceValue(chunk.prompt ?? chunk.description, secretValues),
            metadata: { description: redactTraceValue(chunk.description, secretValues) },
          },
          { asType: 'agent' }
        );
        subagents.set(chunk.taskId, subagent);
      } else if (chunk.type === 'task_progress') {
        subagents.get(chunk.taskId)?.update({
          metadata: {
            summary: redactTraceValue(chunk.summary, secretValues),
            lastToolName: chunk.lastToolName,
            ...chunk.usage,
          },
        });
      } else if (chunk.type === 'task_notification') {
        const subagent = subagents.get(chunk.taskId);
        if (subagent) {
          subagent.update({
            output: redactTraceValue(chunk.summary, secretValues),
            level: chunk.status === 'failed' ? 'ERROR' : 'DEFAULT',
            statusMessage: chunk.status === 'failed' ? 'Subagent failed.' : undefined,
            metadata: { status: chunk.status, ...chunk.usage },
          });
          subagent.end();
          subagents.delete(chunk.taskId);
        }
      } else if (chunk.type === 'result') {
        structuredOutput = chunk.structuredOutput;
        const output = structuredOutput ?? assistantOutput;
        updateGenerationFromResult(generation, chunk, options, output, secretValues);
        if (chunk.isError) {
          rootLevel = 'ERROR';
          rootStatusMessage = redactString(
            chunk.errors?.join('; ') || chunk.errorSubtype || 'Provider returned an error.',
            secretValues
          );
        }
      }

      yield chunk;
    }
  } catch (error) {
    const message = redactString(
      error instanceof Error ? error.message : String(error),
      secretValues
    );
    rootLevel = 'ERROR';
    rootStatusMessage = message;
    generation.update({ level: 'ERROR', statusMessage: message });
    throw error;
  } finally {
    endOpenTools([...toolsById.values(), ...[...toolsByName.values()].flat()]);
    endOpenSubagents(subagents.values());
    const output = redactTraceValue(structuredOutput ?? assistantOutput, secretValues);
    generation.update({ output });
    generation.end();
    root.update({ output, level: rootLevel, statusMessage: rootStatusMessage });
    root.end();
  }
}

/**
 * Decorate a provider without changing its public streaming contract.
 *
 * The optional runtime provider is an internal test seam; production callers use the lazy singleton.
 */
export function instrumentProvider(
  provider: IAgentProvider,
  runtimeProvider: RuntimeProvider = getLangfuseRuntime
): IAgentProvider {
  return {
    getType(): string {
      return provider.getType();
    },
    getCapabilities(): ProviderCapabilities {
      return provider.getCapabilities();
    },
    async *sendQuery(
      prompt: string,
      cwd: string,
      resumeSessionId?: string,
      options?: SendQueryOptions
    ): AsyncGenerator<MessageChunk> {
      const runtime = await runtimeProvider();
      if (!runtime) {
        yield* provider.sendQuery(prompt, cwd, resumeSessionId, options);
        return;
      }
      yield* tracedQuery(provider, runtime, prompt, cwd, resumeSessionId, options);
    },
  };
}

/** Flush buffered Langfuse spans during server and CLI shutdown. */
export async function shutdownLangfuse(): Promise<void> {
  if (!runtimePromise) return;

  const runtime = await runtimePromise;
  runtimePromise = undefined;
  if (!runtime) return;

  try {
    await runtime.sdk.shutdown();
    getLog().info('langfuse.tracing_stopped');
  } catch (error) {
    getLog().warn({ err: error as Error }, 'langfuse.tracing_shutdown_failed');
  }
}
